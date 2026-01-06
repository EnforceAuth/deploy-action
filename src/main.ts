/**
 * EnforceAuth Deploy Action - Main Entry Point (EA-132)
 *
 * This GitHub Action enables customers to deploy OPA bundles from their
 * CI/CD pipelines using OIDC workload identity - no API keys required.
 *
 * Flow:
 * 1. Get GitHub OIDC token
 * 2. Exchange for EnforceAuth access token
 * 3. Trigger deployment via API
 * 4. Optionally poll for completion
 * 5. Set outputs (run-id, status, bundle-version, duration-seconds)
 */

import * as core from "@actions/core";
import * as github from "@actions/github";
import { authenticate } from "./oidc";
import { EnforceAuthClient } from "./api-client";
import { generateIdempotencyKey, getIdempotencyContext } from "./idempotency";
import { pollForCompletion, isFailed, LogVerbosity } from "./polling";

/**
 * Action inputs from action.yml
 */
interface ActionInputs {
  entityId: string;
  apiUrl: string;
  waitForCompletion: boolean;
  timeoutMinutes: number;
  dryRun: boolean;
  pollIntervalSeconds: number;
  logVerbosity: LogVerbosity;
}

/**
 * Parses and validates action inputs.
 */
function getInputs(): ActionInputs {
  const entityId = core.getInput("entity-id", { required: true });
  const apiUrl = core.getInput("api-url") || "https://api.enforceauth.com";
  const waitForCompletion = core.getBooleanInput("wait-for-completion");
  const timeoutMinutes = parseInt(core.getInput("timeout-minutes") || "10", 10);
  const dryRun = core.getBooleanInput("dry-run");
  const pollIntervalSeconds = parseInt(
    core.getInput("poll-interval-seconds") || "2",
    10,
  );
  const logVerbosityInput = core.getInput("log-verbosity") || "normal";

  // Validate inputs
  if (timeoutMinutes < 1 || timeoutMinutes > 60) {
    throw new Error("timeout-minutes must be between 1 and 60");
  }

  if (pollIntervalSeconds < 1 || pollIntervalSeconds > 30) {
    throw new Error("poll-interval-seconds must be between 1 and 30");
  }

  const validVerbosities: LogVerbosity[] = [
    "none",
    "quiet",
    "normal",
    "verbose",
  ];
  if (!validVerbosities.includes(logVerbosityInput as LogVerbosity)) {
    throw new Error(
      `log-verbosity must be one of: ${validVerbosities.join(", ")}`,
    );
  }

  return {
    entityId,
    apiUrl,
    waitForCompletion,
    timeoutMinutes,
    dryRun,
    pollIntervalSeconds,
    logVerbosity: logVerbosityInput as LogVerbosity,
  };
}

/**
 * Logs context information for debugging.
 */
function logContext(inputs: ActionInputs): void {
  const context = github.context;

  core.info("EnforceAuth Deploy Action");
  core.info("=========================");
  core.info(`Entity: ${inputs.entityId}`);
  core.info(`API URL: ${inputs.apiUrl}`);
  core.info(`Wait for completion: ${inputs.waitForCompletion}`);
  core.info(`Timeout: ${inputs.timeoutMinutes} minutes`);
  core.info(`Dry run: ${inputs.dryRun}`);
  core.info("");
  core.info("GitHub Context:");
  core.info(`  Repository: ${context.repo.owner}/${context.repo.repo}`);
  core.info(`  Ref: ${context.ref}`);
  core.info(`  SHA: ${context.sha}`);
  core.info(`  Workflow: ${context.workflow}`);
  core.info(`  Job: ${context.job}`);
  core.info(`  Run ID: ${context.runId}`);
  core.info(`  Run Attempt: ${context.runAttempt}`);
  core.info("");
}

/**
 * Main action execution.
 */
async function run(): Promise<void> {
  const startTime = Date.now();

  try {
    // Parse inputs
    const inputs = getInputs();

    // Log context for debugging
    logContext(inputs);

    // Generate idempotency key
    const idempotencyKey = generateIdempotencyKey(inputs.entityId);
    const idempotencyContext = getIdempotencyContext(inputs.entityId);
    core.debug(`Idempotency key: ${idempotencyKey}`);
    core.debug(`Idempotency context: ${JSON.stringify(idempotencyContext)}`);

    // Authenticate via OIDC
    const accessToken = await authenticate(inputs.apiUrl, inputs.entityId);

    // Create API client
    const client = new EnforceAuthClient(inputs.apiUrl, accessToken);

    // Handle dry-run mode
    if (inputs.dryRun) {
      core.info("Dry run mode enabled - skipping actual deployment");
      core.setOutput("run-id", "dry-run");
      core.setOutput("status", "dry-run");
      core.setOutput(
        "duration-seconds",
        Math.round((Date.now() - startTime) / 1000),
      );
      return;
    }

    // Trigger deployment
    const runId = await client.triggerDeployment(
      inputs.entityId,
      idempotencyKey,
    );

    // Set run-id output immediately
    core.setOutput("run-id", runId);

    // If not waiting for completion, we're done
    if (!inputs.waitForCompletion) {
      core.info(
        "Deployment triggered successfully (not waiting for completion)",
      );
      core.setOutput("status", "pending");
      core.setOutput(
        "duration-seconds",
        Math.round((Date.now() - startTime) / 1000),
      );
      return;
    }

    // Poll for completion using log-based polling
    const result = await pollForCompletion(
      client,
      inputs.entityId,
      runId,
      inputs.timeoutMinutes,
      {
        pollDelayMs: inputs.pollIntervalSeconds * 1000,
        logVerbosity: inputs.logVerbosity,
      },
    );

    // Set outputs
    core.setOutput("status", result.status);
    const durationSeconds = result.durationMs
      ? Math.round(result.durationMs / 1000)
      : Math.round((Date.now() - startTime) / 1000);
    core.setOutput("duration-seconds", durationSeconds);

    if (result.bundleVersion) {
      core.setOutput("bundle-version", result.bundleVersion);
    }
    if (result.deploymentUrl) {
      core.setOutput("deployment-url", result.deploymentUrl);
    }

    // Fail the action if deployment failed
    if (isFailed(result)) {
      const errorMessage =
        result.errorMessage || "Deployment failed without error message";
      core.setFailed(`Deployment failed: ${errorMessage}`);
      return;
    }
  } catch (error) {
    // Handle errors
    const message = error instanceof Error ? error.message : String(error);
    core.setFailed(message);

    // Set duration even on failure
    core.setOutput(
      "duration-seconds",
      Math.round((Date.now() - startTime) / 1000),
    );
  }
}

// Run the action
run();
