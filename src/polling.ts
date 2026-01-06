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
 * Result of polling for deployment completion
 */
export interface PollingResult {
  status: "success" | "failed" | "timeout";
  durationMs?: number;
  errorMessage?: string;
  phases: string[];
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
      };
    }

    // Fetch logs
    let logs: LogEntry[];
    try {
      logs = await client.getPolicyLogs(entityId, runId, cfg.logLimit);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
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
      if (showLogs) {
        const isDebugLog = log.level.toLowerCase() === "debug";
        if (!isDebugLog || showDebugLogs) {
          const logTime = formatTimestamp(log.timestamp);
          const level = log.level.toUpperCase().padEnd(5);
          core.info(`[${logTime}] ${level} ${log.message}`);
        }
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
          seenPhases.add(phase);
          phases.push(phase);

          if (showPhases) {
            const formattedTime = formatTimestamp(timestamp);
            core.info(`[${formattedTime}] PHASE  ✅ ${phase}`);
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

        return {
          status: "success",
          durationMs,
          phases,
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
        if (showPhases) {
          const failTime = formatTimestamp(metadata.timestamp || log.timestamp);
          core.info(`[${failTime}] PHASE  ❌ failed`);
          core.info("");
        }
        core.error(`Deployment failed: ${errorMessage}`);

        return {
          status: "failed",
          errorMessage,
          phases,
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
