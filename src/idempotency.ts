/**
 * Idempotency Key Generation (EA-132)
 *
 * Generates deterministic idempotency keys for GitHub Actions deployments.
 * The key is based on:
 * - Entity ID (target of deployment)
 * - Commit SHA (what's being deployed)
 * - Workflow name (which workflow triggered it)
 * - Job name (which job in the workflow)
 * - Run ID (unique workflow run identifier)
 * - Run attempt (retry number for the same run)
 *
 * This ensures that:
 * - Same commit in same workflow/job = same key (prevents duplicates)
 * - Retry of failed job = new key (run_attempt changes)
 * - Different workflow/job = new key (different context)
 */

import * as crypto from 'crypto';
import * as github from '@actions/github';

/**
 * Generates a deterministic idempotency key for the current GitHub Actions context.
 *
 * The key format is: gha_<32-char-hex-hash>
 *
 * @param entityId - The EnforceAuth entity ID being deployed
 * @returns A deterministic idempotency key for this deployment
 */
export function generateIdempotencyKey(entityId: string): string {
  const context = github.context;

  // Build a deterministic string from the GitHub context
  const components = [
    entityId,
    context.sha,
    context.workflow,
    context.job,
    String(context.runId),
    String(context.runAttempt),
  ];

  // Create SHA-256 hash and take first 32 characters
  const hash = crypto
    .createHash('sha256')
    .update(components.join(':'))
    .digest('hex')
    .substring(0, 32);

  return `gha_${hash}`;
}

/**
 * Context information used for idempotency key generation.
 * Exposed for logging and debugging purposes.
 */
export interface IdempotencyContext {
  entityId: string;
  sha: string;
  workflow: string;
  job: string;
  runId: number;
  runAttempt: number;
}

/**
 * Gets the current idempotency context for logging.
 *
 * @param entityId - The EnforceAuth entity ID being deployed
 * @returns The context used for idempotency key generation
 */
export function getIdempotencyContext(entityId: string): IdempotencyContext {
  const context = github.context;

  return {
    entityId,
    sha: context.sha,
    workflow: context.workflow,
    job: context.job,
    runId: context.runId,
    runAttempt: context.runAttempt,
  };
}
