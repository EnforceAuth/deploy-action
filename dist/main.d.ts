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
export {};
