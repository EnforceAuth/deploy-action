/**
 * Log-Based Deployment Polling
 *
 * Polls the EnforceAuth API policy logs for deployment status until completion or timeout.
 * Detects phase transitions and completion/failure from log metadata actions.
 */

import * as core from "@actions/core";
import { EnforceAuthClient, LogEntry } from "./api-client";

/**
 * Polling configuration
 */
interface PollingConfig {
  /** Delay between polls in milliseconds */
  pollDelayMs: number;
  /** Maximum number of logs to fetch per poll */
  logLimit: number;
}

/**
 * Default polling configuration
 */
const DEFAULT_POLLING_CONFIG: PollingConfig = {
  pollDelayMs: 2000, // 2 seconds
  logLimit: 200,
};

/**
 * Result of polling for deployment completion
 */
export interface PollingResult {
  status: "success" | "failed" | "timeout";
  durationMs?: number;
  errorMessage?: string;
  phases: string[];
}

/**
 * Sleeps for the specified duration.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Generates a unique log ID for deduplication.
 */
function getLogId(log: LogEntry): string {
  const messagePrefix = log.message.slice(0, 50);
  return `${log.timestamp}-${messagePrefix}`;
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
 * @throws Error if polling times out
 */
export async function pollForCompletion(
  client: EnforceAuthClient,
  entityId: string,
  runId: string,
  timeoutMinutes: number,
  config: PollingConfig = DEFAULT_POLLING_CONFIG,
): Promise<PollingResult> {
  const startTime = Date.now();
  const timeoutMs = timeoutMinutes * 60 * 1000;

  const seenLogIds = new Set<string>();
  const seenPhases = new Set<string>();
  const phases: string[] = [];

  core.info(
    `Polling for deployment completion (timeout: ${timeoutMinutes} minutes)...`,
  );
  core.info("");

  while (true) {
    const elapsed = Date.now() - startTime;

    // Check for timeout
    if (elapsed >= timeoutMs) {
      throw new Error(
        `Deployment polling timed out after ${timeoutMinutes} minutes. ` +
          `Phases completed: ${phases.join(", ") || "none"}. ` +
          `Check the EnforceAuth console for more details.`,
      );
    }

    // Fetch logs
    let logs: LogEntry[];
    try {
      logs = await client.getPolicyLogs(entityId, runId, config.logLimit);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      core.warning(`Failed to fetch logs: ${message}. Retrying...`);
      await sleep(config.pollDelayMs);
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

          const formattedTime = formatTimestamp(timestamp);
          core.info(`     ${formattedTime}  ✓ ${phase}`);
        }
      }

      // Check for successful completion
      if (metadata.action === "pipeline_complete") {
        const durationMs = metadata.duration_ms;
        core.info("");
        core.info(
          `Deployment completed successfully${durationMs ? ` in ${Math.round(durationMs / 1000)}s` : ""}`,
        );

        return {
          status: "success",
          durationMs,
          phases,
        };
      }

      // Check for failure
      if (
        metadata.action === "pipeline_failed" ||
        metadata.action === "pipeline_error"
      ) {
        const errorMessage =
          metadata.message || "Deployment failed without error message";
        core.info("");
        core.error(`Deployment failed: ${errorMessage}`);

        return {
          status: "failed",
          errorMessage,
          phases,
        };
      }
    }

    // Print progress indicator and wait before next poll
    process.stdout.write(".");
    await sleep(config.pollDelayMs);
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
