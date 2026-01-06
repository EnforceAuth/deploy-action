/**
 * Deployment Status Polling (EA-132)
 *
 * Polls the EnforceAuth API for deployment status until completion or timeout.
 * Uses exponential backoff with jitter to avoid overwhelming the API.
 */
import { EnforceAuthClient, DeploymentStatus } from './api-client';
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
 * Result of polling for deployment completion
 */
export interface PollingResult {
    status: DeploymentStatus;
    durationSeconds: number;
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
export declare function pollForCompletion(client: EnforceAuthClient, runId: string, timeoutMinutes: number, config?: PollingConfig): Promise<PollingResult>;
/**
 * Determines if a deployment status represents a successful completion.
 *
 * @param status - Deployment status
 * @returns True if the deployment was successful
 */
export declare function isSuccessful(status: DeploymentStatus): boolean;
/**
 * Determines if a deployment status represents a failure.
 *
 * @param status - Deployment status
 * @returns True if the deployment failed
 */
export declare function isFailed(status: DeploymentStatus): boolean;
export {};
