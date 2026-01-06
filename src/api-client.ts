/**
 * EnforceAuth API Client (EA-132)
 *
 * HTTP client for interacting with EnforceAuth API endpoints:
 * - POST /v1/entities/:id/policies/deploy - Trigger deployment
 * - GET /v1/deployments/:run_id - Get deployment status
 */

import * as core from "@actions/core";
import * as github from "@actions/github";

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
export class EnforceAuthClient {
  private readonly apiUrl: string;
  private readonly accessToken: string;

  constructor(apiUrl: string, accessToken: string) {
    // Normalize API URL (remove trailing slash)
    this.apiUrl = apiUrl.replace(/\/$/, "");
    this.accessToken = accessToken;
  }

  /**
   * Makes an authenticated request to the EnforceAuth API.
   */
  private async request<T>(
    method: string,
    path: string,
    options: {
      body?: Record<string, unknown>;
      idempotencyKey?: string;
    } = {},
  ): Promise<T> {
    const url = `${this.apiUrl}${path}`;
    core.debug(`${method} ${url}`);

    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.accessToken}`,
      Accept: "application/json",
    };

    if (options.body) {
      headers["Content-Type"] = "application/json";
    }

    if (options.idempotencyKey) {
      headers["Idempotency-Key"] = options.idempotencyKey;
    }

    const response = await fetch(url, {
      method,
      headers,
      body: options.body ? JSON.stringify(options.body) : undefined,
    });

    const responseText = await response.text();

    // Check for idempotency replay
    if (response.headers.get("X-Idempotency-Replay") === "true") {
      core.info("Request was replayed from idempotency cache");
    }

    if (!response.ok) {
      let errorMessage: string;
      try {
        const errorResponse = JSON.parse(responseText) as ApiError;
        errorMessage = errorResponse.message || errorResponse.error;
      } catch {
        errorMessage = `HTTP ${response.status}: ${responseText}`;
      }

      throw new Error(`API request failed: ${errorMessage}`);
    }

    // Handle 202 Accepted (used by deploy endpoint)
    if (response.status === 202) {
      try {
        const parsed = JSON.parse(responseText) as ApiSuccessResponse<T>;
        return parsed.success && "data" in parsed
          ? parsed.data
          : (parsed as unknown as T);
      } catch {
        throw new Error("API returned invalid JSON response");
      }
    }

    // Parse standard success response
    try {
      const successResponse = JSON.parse(responseText) as ApiSuccessResponse<T>;
      if (!successResponse.success) {
        throw new Error(
          `API returned error: ${(successResponse as unknown as ApiError).message}`,
        );
      }
      // Handle both wrapped (with data) and unwrapped responses
      return "data" in successResponse
        ? successResponse.data
        : (successResponse as T);
    } catch (e) {
      if (e instanceof Error && e.message.startsWith("API")) {
        throw e;
      }
      throw new Error("API returned invalid JSON response");
    }
  }

  /**
   * Triggers a policy deployment for an entity.
   *
   * @param entityId - The entity ID to deploy
   * @param idempotencyKey - Idempotency key for the request
   * @param options - Deployment options
   * @returns The deployment run ID
   */
  async triggerDeployment(
    entityId: string,
    idempotencyKey: string,
  ): Promise<string> {
    core.info(`Triggering deployment for entity: ${entityId}`);

    const body: DeployRequest = {
      commit_sha: github.context.sha,
    };

    const response = await this.request<DeployResponse>(
      "POST",
      `/v1/entities/${entityId}/policies/deploy`,
      {
        body,
        idempotencyKey,
      },
    );

    core.info(`Deployment triggered with run ID: ${response.run_id}`);
    return response.run_id;
  }

  /**
   * Gets the status of a deployment run.
   *
   * @param runId - The deployment run ID
   * @returns The deployment status
   */
  async getDeploymentStatus(runId: string): Promise<DeploymentStatus> {
    core.debug(`Fetching deployment status for run: ${runId}`);

    const response = await this.request<{ deployment: DeploymentStatus }>(
      "GET",
      `/v1/deployments/${runId}`,
    );

    return response.deployment;
  }

  /**
   * Gets the pipeline logs for a deployment run.
   *
   * @param entityId - The entity ID
   * @param runId - The deployment run ID
   * @param limit - Maximum number of log entries to return (default 100)
   * @returns Array of log entries
   */
  async getPolicyLogs(
    entityId: string,
    runId: string,
    limit = 100,
  ): Promise<LogEntry[]> {
    core.debug(`Fetching policy logs for run: ${runId}`);

    const response = await this.request<{ logs: LogEntry[] }>(
      "GET",
      `/v1/entities/${entityId}/policy-logs?run_id=${runId}&limit=${limit}`,
    );

    return response.logs ?? [];
  }
}
