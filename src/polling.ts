/**
 * Log-Based Deployment Polling
 *
 * Polls the EnforceAuth API policy logs for deployment status until completion or timeout.
 * Detects phase transitions and completion/failure from log metadata actions.
 */

import * as core from "@actions/core";
import { EnforceAuthClient, LogEntry } from "./api-client";

/**
 * Log verbosity levels
 */
export type LogVerbosity = "none" | "quiet" | "normal" | "verbose";

/**
 * Polling configuration
 */
export interface PollingConfig {
  /** Delay between polls in milliseconds */
  pollDelayMs?: number;
  /** Maximum number of logs to fetch per poll */
  logLimit?: number;
  /** Log verbosity level */
  logVerbosity?: LogVerbosity;
}

/**
 * Default polling configuration
 */
const DEFAULT_POLLING_CONFIG: Required<PollingConfig> = {
  pollDelayMs: 2000, // 2 seconds
  logLimit: 200,
  logVerbosity: "normal",
};

/**
 * Timing information for a single phase
 */
export interface PhaseTiming {
  startedAt: string;
  durationMs?: number;
}

/**
 * Map of phase names to timing information
 */
export type PhaseTimings = Record<string, PhaseTiming>;

/**
 * Result of polling for deployment completion
 */
export interface PollingResult {
  status: "success" | "failed" | "timeout";
  durationMs?: number;
  errorMessage?: string;
  phases: string[];
  phaseTimings?: PhaseTimings;
  bundleVersion?: string;
  deploymentUrl?: string;
}

/**
 * Sleeps for the specified duration.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Generates a unique log ID for deduplication.
 * Uses timestamp, message content, and metadata to avoid false positives.
 */
function getLogId(log: LogEntry): string {
  const messageHash =
    log.message.length + log.message.slice(0, 20) + log.message.slice(-20);
  const metadataId = log.metadata?.action || "";
  return `${log.timestamp}-${messageHash}-${metadataId}`;
}

/**
 * Formats a timestamp for display (HH:MM:SS.mmm).
 */
function formatTimestamp(isoTimestamp: string): string {
  return isoTimestamp.slice(11, 23); // Extract HH:MM:SS.mmm
}

/**
 * Formats a duration in milliseconds for display.
 */
function formatDuration(ms: number): string {
  if (ms < 1000) {
    return `${ms}ms`;
  }
  const seconds = ms / 1000;
  if (seconds < 60) {
    return `${seconds.toFixed(1)}s`;
  }
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}m ${remainingSeconds.toFixed(0)}s`;
}

/**
 * Safely parses a timestamp and returns the time in ms, or undefined if invalid.
 */
function parseTimestamp(timestamp: string): number | undefined {
  const time = new Date(timestamp).getTime();
  return Number.isNaN(time) ? undefined : time;
}

/**
 * Calculates phase durations from phase timings.
 * Durations are calculated as the time between consecutive phase starts.
 */
function calculatePhaseDurations(
  phaseTimings: PhaseTimings,
  phases: string[],
  completedAt?: string,
): PhaseTimings {
  const result: PhaseTimings = {};

  for (let i = 0; i < phases.length; i++) {
    const phase = phases[i];
    const timing = phaseTimings[phase];
    if (!timing) continue;

    result[phase] = { ...timing };

    // Calculate duration if not already set
    if (!result[phase].durationMs) {
      const startTime = parseTimestamp(timing.startedAt);
      if (startTime === undefined) continue;

      let endTime: number | undefined;

      if (i < phases.length - 1) {
        // Use next phase start time
        const nextPhase = phases[i + 1];
        const nextTiming = phaseTimings[nextPhase];
        if (nextTiming) {
          endTime = parseTimestamp(nextTiming.startedAt);
        }
      } else if (completedAt) {
        // Last phase - use completion time
        endTime = parseTimestamp(completedAt);
      }

      if (endTime !== undefined) {
        result[phase].durationMs = endTime - startTime;
      }
    }
  }

  return result;
}

/**
 * Polls for deployment completion using log-based polling.
 *
 * Fetches policy logs and watches for phase transitions and completion events.
 * Outputs phase changes in real-time as they are detected.
 *
 * @param client - EnforceAuth API client
 * @param entityId - Entity ID for log fetching
 * @param runId - Deployment run ID to poll
 * @param timeoutMinutes - Maximum time to wait in minutes
 * @param config - Optional polling configuration
 * @returns Final deployment result with status, duration, and phases
 */
export async function pollForCompletion(
  client: EnforceAuthClient,
  entityId: string,
  runId: string,
  timeoutMinutes: number,
  config: PollingConfig = {},
): Promise<PollingResult> {
  const cfg = { ...DEFAULT_POLLING_CONFIG, ...config };
  const startTime = Date.now();
  const timeoutMs = timeoutMinutes * 60 * 1000;

  const seenLogIds = new Set<string>();
  const seenPhases = new Set<string>();
  const phases: string[] = [];
  const phaseTimings: PhaseTimings = {};

  // Verbosity helpers
  const showPhases = cfg.logVerbosity !== "none";
  const showLogs =
    cfg.logVerbosity === "normal" || cfg.logVerbosity === "verbose";
  const showDebugLogs = cfg.logVerbosity === "verbose";

  core.info(
    `Polling for deployment completion (timeout: ${timeoutMinutes} minutes)...`,
  );
  core.info("");

  while (true) {
    const elapsed = Date.now() - startTime;

    // Check for timeout
    if (elapsed >= timeoutMs) {
      core.error(
        `Deployment polling timed out after ${timeoutMinutes} minutes. ` +
          `Phases completed: ${phases.join(", ") || "none"}. ` +
          `Check the EnforceAuth console for more details.`,
      );
      return {
        status: "timeout",
        phases,
        phaseTimings: calculatePhaseDurations(phaseTimings, phases),
      };
    }

    // Fetch logs
    let logs: LogEntry[];
    try {
      logs = await client.getPolicyLogs(entityId, runId, cfg.logLimit);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      // Check for permanent authorization errors that won't resolve with retries
      if (
        message.includes("insufficient_scope") ||
        message.includes("Forbidden")
      ) {
        core.error(
          `Authorization error: Trust policy missing 'pipeline:read' scope. ` +
            `Add it in the EnforceAuth console under Trust Policies.`,
        );
        return {
          status: "failed",
          errorMessage:
            "Missing 'pipeline:read' scope in trust policy. " +
            "Add the 'Read' permission in the EnforceAuth console.",
          phases,
          phaseTimings: calculatePhaseDurations(phaseTimings, phases),
        };
      }

      core.warning(`Failed to fetch logs: ${message}. Retrying...`);
      await sleep(cfg.pollDelayMs);
      continue;
    }

    // Process each log entry
    for (const log of logs) {
      const logId = getLogId(log);

      // Skip already-seen logs
      if (seenLogIds.has(logId)) {
        continue;
      }
      seenLogIds.add(logId);

      // Output log message in real-time based on verbosity
      const logLevel = log.level.toLowerCase();
      if (showLogs) {
        const isDebugLog = logLevel === "debug";
        if (!isDebugLog || showDebugLogs) {
          const logTime = formatTimestamp(log.timestamp);
          const level = log.level.toUpperCase().padEnd(5);
          core.info(`[${logTime}] ${level} ${log.message}`);
        }
      }

      // Fail fast on ERROR level logs
      if (logLevel === "error") {
        const errorTime = formatTimestamp(log.timestamp);
        if (showPhases && phases.length > 0) {
          const failedPhase = phases[phases.length - 1];
          core.info(`[${errorTime}] PHASE  ❌ ${failedPhase}`);
          core.info("");
        }
        const rawError = log.metadata?.error ?? log.metadata?.message;
        const errorMessage =
          typeof rawError === "string" ? rawError : log.message;
        core.error(`Deployment failed: ${errorMessage}`);

        return {
          status: "failed",
          errorMessage,
          phases,
          phaseTimings: calculatePhaseDurations(phaseTimings, phases),
        };
      }

      const metadata = log.metadata;
      if (!metadata?.action) {
        continue;
      }

      // Handle phase transitions
      if (metadata.action === "report_phase_change_success") {
        const phase = metadata.details?.phase;
        const timestamp = metadata.timestamp || log.timestamp;

        if (phase && !seenPhases.has(phase)) {
          // Mark previous phase as complete
          if (showPhases && phases.length > 0) {
            const prevPhase = phases[phases.length - 1];
            const prevTiming = phaseTimings[prevPhase];
            const endTime = parseTimestamp(timestamp);
            const startTime = prevTiming
              ? parseTimestamp(prevTiming.startedAt)
              : undefined;
            if (startTime !== undefined && endTime !== undefined) {
              const durationMs = endTime - startTime;
              core.info(
                `[${formatTimestamp(timestamp)}] PHASE  ✓ ${prevPhase} (${formatDuration(durationMs)})`,
              );
            }
          }

          seenPhases.add(phase);
          phases.push(phase);

          // Record phase start time
          phaseTimings[phase] = { startedAt: timestamp };

          if (showPhases) {
            const formattedTime = formatTimestamp(timestamp);
            core.info(`[${formattedTime}] PHASE  ▶ ${phase}`);
          }
        }
      }

      // Check for successful completion
      if (metadata.action === "pipeline_complete") {
        const durationMs = metadata.duration_ms;
        const bundleVersion = metadata.details?.bundle_version as
          | string
          | undefined;
        const deploymentUrl = metadata.details?.deployment_url as
          | string
          | undefined;
        const completedAt = metadata.timestamp || log.timestamp;

        // Calculate final phase durations
        const finalTimings = calculatePhaseDurations(
          phaseTimings,
          phases,
          completedAt,
        );

        // Mark final phase as complete
        if (showPhases && phases.length > 0) {
          const lastPhase = phases[phases.length - 1];
          const lastTiming = finalTimings[lastPhase];
          if (lastTiming?.durationMs !== undefined) {
            core.info(
              `[${formatTimestamp(completedAt)}] PHASE  ✓ ${lastPhase} (${formatDuration(lastTiming.durationMs)})`,
            );
          }
        }

        core.info("");
        core.info(
          `Deployment completed successfully${durationMs ? ` in ${Math.round(durationMs / 1000)}s` : ""}`,
        );
        if (bundleVersion) {
          core.info(`Bundle version: ${bundleVersion}`);
        }
        if (deploymentUrl) {
          core.info(`Deployment URL: ${deploymentUrl}`);
        }

        // Log phase durations if we have timing data
        if (showPhases && Object.keys(finalTimings).length > 0) {
          core.info("");
          core.info("Phase durations:");
          for (const phase of phases) {
            const timing = finalTimings[phase];
            if (timing?.durationMs !== undefined) {
              core.info(`  ${phase}: ${formatDuration(timing.durationMs)}`);
            }
          }
        }

        return {
          status: "success",
          durationMs,
          phases,
          phaseTimings: finalTimings,
          bundleVersion,
          deploymentUrl,
        };
      }

      // Check for failure
      if (
        metadata.action === "pipeline_failed" ||
        metadata.action === "pipeline_error"
      ) {
        const errorMessage =
          metadata.message || "Deployment failed without error message";
        const failedAt = metadata.timestamp || log.timestamp;
        if (showPhases && phases.length > 0) {
          const failedPhase = phases[phases.length - 1];
          const failTime = formatTimestamp(failedAt);
          core.info(`[${failTime}] PHASE  ❌ ${failedPhase}`);
          core.info("");
        }
        core.error(`Deployment failed: ${errorMessage}`);

        return {
          status: "failed",
          errorMessage,
          phases,
          phaseTimings: calculatePhaseDurations(phaseTimings, phases, failedAt),
        };
      }
    }

    // Wait before next poll
    await sleep(cfg.pollDelayMs);
  }
}

/**
 * Determines if a polling result represents a successful completion.
 */
export function isSuccessful(result: PollingResult): boolean {
  return result.status === "success";
}

/**
 * Determines if a polling result represents a failure.
 */
export function isFailed(result: PollingResult): boolean {
  return result.status === "failed" || result.status === "timeout";
}
