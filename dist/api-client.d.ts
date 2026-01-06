/**
 * EnforceAuth API Client (EA-132)
 *
 * HTTP client for interacting with EnforceAuth API endpoints:
 * - POST /v1/entities/:id/policies/deploy - Trigger deployment
 * - GET /v1/deployments/:run_id - Get deployment status
 */
/**
 * Deployment trigger request body
 */
export interface DeployRequest {
    force?: boolean;
    commit_sha?: string;
    [key: string]: unknown;
}
/**
 * Deployment trigger response
 */
export interface DeployResponse {
    run_id: string;
    message: string;
}
/**
 * Pipeline log entry from API
 */
export interface LogEntry {
    timestamp: string;
    level: string;
    message: string;
    metadata?: Record<string, unknown>;
}
/**
 * Deployment status from API
 */
export interface DeploymentStatus {
    run_id: string;
    entity_id: string;
    trigger_source: string;
    user_id: string;
    repository_url: string | null;
    branch: string | null;
    commit_sha: string | null;
    commit_message: string | null;
    status: "pending" | "in_progress" | "success" | "failed" | "timeout";
    current_phase: string | null;
    started_at: string | null;
    completed_at: string | null;
    timeout_at: string | null;
    error_message: string | null;
    error_phase: string | null;
    duration_ms: number | null;
    metadata: Record<string, unknown> | null;
}
/**
 * API error response
 */
export interface ApiError {
    success: false;
    error: string;
    message: string;
}
/**
 * API success response wrapper
 */
export interface ApiSuccessResponse<T> {
    success: true;
    data: T;
}
/**
 * EnforceAuth API client
 */
export declare class EnforceAuthClient {
    private readonly apiUrl;
    private readonly accessToken;
    constructor(apiUrl: string, accessToken: string);
    /**
     * Makes an authenticated request to the EnforceAuth API.
     */
    private request;
    /**
     * Triggers a policy deployment for an entity.
     *
     * @param entityId - The entity ID to deploy
     * @param idempotencyKey - Idempotency key for the request
     * @param options - Deployment options
     * @returns The deployment run ID
     */
    triggerDeployment(entityId: string, idempotencyKey: string): Promise<string>;
    /**
     * Gets the status of a deployment run.
     *
     * @param runId - The deployment run ID
     * @returns The deployment status
     */
    getDeploymentStatus(runId: string): Promise<DeploymentStatus>;
    /**
     * Gets the pipeline logs for a deployment run.
     *
     * @param entityId - The entity ID
     * @param runId - The deployment run ID
     * @param limit - Maximum number of log entries to return (default 100)
     * @returns Array of log entries
     */
    getPolicyLogs(entityId: string, runId: string, limit?: number): Promise<LogEntry[]>;
}
