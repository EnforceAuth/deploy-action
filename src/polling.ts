/**
 * Deployment Status Polling (EA-132)
 *
 * Polls the EnforceAuth API for deployment status until completion or timeout.
 * Uses exponential backoff with jitter to avoid overwhelming the API.
 */

import * as core from '@actions/core';
import { EnforceAuthClient, DeploymentStatus } from './api-client';

/**
 * Terminal deployment statuses (no more polling needed)
 */
const TERMINAL_STATUSES = ['success', 'failed', 'timeout'] as const;

/**
 * Polling configuration
 */
interface PollingConfig {
  /** Initial delay between polls in milliseconds */
  initialDelayMs: number;
  /** Maximum delay between polls in milliseconds */
  maxDelayMs: number;
  /** Backoff multiplier */
  backoffMultiplier: number;
  /** Maximum jitter percentage (0-1) */
  jitterPercent: number;
}

/**
 * Default polling configuration
 */
const DEFAULT_POLLING_CONFIG: PollingConfig = {
  initialDelayMs: 2000, // 2 seconds
  maxDelayMs: 30000, // 30 seconds
  backoffMultiplier: 1.5,
  jitterPercent: 0.2, // +/- 20%
};

/**
 * Result of polling for deployment completion
 */
export interface PollingResult {
  status: DeploymentStatus;
  durationSeconds: number;
}

/**
 * Calculates the next delay with exponential backoff and jitter.
 *
 * @param currentDelay - Current delay in milliseconds
 * @param config - Polling configuration
 * @returns Next delay in milliseconds
 */
function calculateNextDelay(
  currentDelay: number,
  config: PollingConfig
): number {
  // Apply backoff
  let nextDelay = currentDelay * config.backoffMultiplier;

  // Cap at maximum
  nextDelay = Math.min(nextDelay, config.maxDelayMs);

  // Apply jitter (+/- jitterPercent)
  const jitterRange = nextDelay * config.jitterPercent;
  const jitter = (Math.random() - 0.5) * 2 * jitterRange;
  nextDelay = nextDelay + jitter;

  return Math.round(nextDelay);
}

/**
 * Sleeps for the specified duration.
 *
 * @param ms - Duration in milliseconds
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Formats a status for logging.
 *
 * @param status - Deployment status
 * @returns Formatted status string
 */
function formatStatus(status: DeploymentStatus): string {
  let message = `Status: ${status.status}`;

  if (status.current_phase) {
    message += ` (phase: ${status.current_phase})`;
  }

  if (status.error_message) {
    message += ` - Error: ${status.error_message}`;
  }

  return message;
}

/**
 * Polls for deployment completion.
 *
 * Uses exponential backoff with jitter to avoid overwhelming the API.
 * Logs status updates and provides progress information.
 *
 * @param client - EnforceAuth API client
 * @param runId - Deployment run ID to poll
 * @param timeoutMinutes - Maximum time to wait in minutes
 * @param config - Optional polling configuration
 * @returns Final deployment status and duration
 * @throws Error if polling times out
 */
export async function pollForCompletion(
  client: EnforceAuthClient,
  runId: string,
  timeoutMinutes: number,
  config: PollingConfig = DEFAULT_POLLING_CONFIG
): Promise<PollingResult> {
  const startTime = Date.now();
  const timeoutMs = timeoutMinutes * 60 * 1000;
  let currentDelay = config.initialDelayMs;
  let lastStatus: string | null = null;
  let lastPhase: string | null = null;
  let pollCount = 0;

  core.info(
    `Polling for deployment completion (timeout: ${timeoutMinutes} minutes)...`
  );

  while (true) {
    pollCount++;
    const elapsed = Date.now() - startTime;

    // Check for timeout
    if (elapsed >= timeoutMs) {
      throw new Error(
        `Deployment polling timed out after ${timeoutMinutes} minutes. ` +
          `Last status: ${lastStatus || 'unknown'}. ` +
          `Check the EnforceAuth console for more details.`
      );
    }

    // Fetch current status
    let status: DeploymentStatus;
    try {
      status = await client.getDeploymentStatus(runId);
    } catch (error) {
      // Log error but continue polling (transient errors happen)
      const message = error instanceof Error ? error.message : String(error);
      core.warning(
        `Failed to fetch deployment status: ${message}. Retrying...`
      );
      await sleep(currentDelay);
      currentDelay = calculateNextDelay(currentDelay, config);
      continue;
    }

    // Log status changes
    if (status.status !== lastStatus || status.current_phase !== lastPhase) {
      core.info(formatStatus(status));
      lastStatus = status.status;
      lastPhase = status.current_phase;
    } else {
      core.debug(`Poll #${pollCount}: ${formatStatus(status)}`);
    }

    // Check for terminal status
    if (
      TERMINAL_STATUSES.includes(
        status.status as (typeof TERMINAL_STATUSES)[number]
      )
    ) {
      const durationSeconds = Math.round((Date.now() - startTime) / 1000);

      if (status.status === 'success') {
        core.info(
          `Deployment completed successfully in ${durationSeconds} seconds`
        );
      } else if (status.status === 'failed') {
        core.error(
          `Deployment failed: ${status.error_message || 'Unknown error'}` +
            (status.error_phase ? ` (phase: ${status.error_phase})` : '')
        );
      } else if (status.status === 'timeout') {
        core.error('Deployment timed out on the server side');
      }

      return {
        status,
        durationSeconds,
      };
    }

    // Wait before next poll
    await sleep(currentDelay);
    currentDelay = calculateNextDelay(currentDelay, config);
  }
}

/**
 * Determines if a deployment status represents a successful completion.
 *
 * @param status - Deployment status
 * @returns True if the deployment was successful
 */
export function isSuccessful(status: DeploymentStatus): boolean {
  return status.status === 'success';
}

/**
 * Determines if a deployment status represents a failure.
 *
 * @param status - Deployment status
 * @returns True if the deployment failed
 */
export function isFailed(status: DeploymentStatus): boolean {
  return status.status === 'failed' || status.status === 'timeout';
}
