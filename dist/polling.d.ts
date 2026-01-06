/**
 * Log-Based Deployment Polling
 *
 * Polls the EnforceAuth API policy logs for deployment status until completion or timeout.
 * Detects phase transitions and completion/failure from log metadata actions.
 */
import { EnforceAuthClient } from "./api-client";
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
 * Result of polling for deployment completion
 */
export interface PollingResult {
    status: "success" | "failed" | "timeout";
    durationMs?: number;
    errorMessage?: string;
    phases: string[];
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
export declare function pollForCompletion(client: EnforceAuthClient, entityId: string, runId: string, timeoutMinutes: number, config?: PollingConfig): Promise<PollingResult>;
/**
 * Determines if a polling result represents a successful completion.
 */
export declare function isSuccessful(result: PollingResult): boolean;
/**
 * Determines if a polling result represents a failure.
 */
export declare function isFailed(result: PollingResult): boolean;
