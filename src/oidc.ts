/**
 * OIDC Token Acquisition and Exchange (EA-132)
 *
 * Handles:
 * 1. Acquiring OIDC token from GitHub Actions runtime
 * 2. Exchanging GitHub OIDC token for EnforceAuth access token via RFC 8693
 *
 * The token exchange follows RFC 8693 OAuth 2.0 Token Exchange:
 * - grant_type: urn:ietf:params:oauth:grant-type:token-exchange
 * - subject_token: GitHub OIDC JWT
 * - subject_token_type: urn:ietf:params:oauth:token-type:jwt
 * - requested_token_type: urn:ietf:params:oauth:token-type:access_token
 */

import * as core from '@actions/core';

/**
 * RFC 8693 grant type for token exchange
 */
const TOKEN_EXCHANGE_GRANT_TYPE =
  'urn:ietf:params:oauth:grant-type:token-exchange';

/**
 * RFC 8693 token type for JWT
 */
const TOKEN_TYPE_JWT = 'urn:ietf:params:oauth:token-type:jwt';

/**
 * RFC 8693 token type for access token
 */
const TOKEN_TYPE_ACCESS_TOKEN = 'urn:ietf:params:oauth:token-type:access_token';

/**
 * Token exchange response from EnforceAuth API
 */
export interface TokenExchangeResponse {
  access_token: string;
  issued_token_type: string;
  token_type: string;
  expires_in: number;
}

/**
 * Token exchange error response (RFC 8693 / RFC 6749 format)
 */
export interface TokenExchangeError {
  error: string;
  error_description?: string;
}

/**
 * Result of the OIDC token exchange process
 */
export interface OIDCExchangeResult {
  accessToken: string;
  expiresIn: number;
}

/**
 * Acquires a GitHub OIDC token for the specified audience.
 *
 * This requires the workflow to have `permissions: id-token: write`.
 *
 * @param audience - The audience claim for the OIDC token (typically the API URL)
 * @returns The GitHub OIDC JWT
 * @throws Error if OIDC token acquisition fails
 */
export async function getGitHubOIDCToken(audience: string): Promise<string> {
  core.debug(`Requesting GitHub OIDC token with audience: ${audience}`);

  try {
    const token = await core.getIDToken(audience);

    if (!token) {
      throw new Error('GitHub OIDC token is empty');
    }

    core.debug('Successfully acquired GitHub OIDC token');
    return token;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    // Provide helpful error messages for common issues
    if (message.includes('Unable to get ACTIONS_ID_TOKEN_REQUEST_URL')) {
      throw new Error(
        'Failed to get GitHub OIDC token. Ensure your workflow has "permissions: id-token: write" configured.'
      );
    }

    throw new Error(`Failed to get GitHub OIDC token: ${message}`);
  }
}

/**
 * Exchanges a GitHub OIDC token for an EnforceAuth access token.
 *
 * This calls the EnforceAuth token exchange endpoint following RFC 8693.
 *
 * @param apiUrl - The EnforceAuth API URL
 * @param githubToken - The GitHub OIDC JWT
 * @param entityId - The target entity ID for the deployment
 * @returns The EnforceAuth access token and expiry
 * @throws Error if token exchange fails
 */
export async function exchangeTokenForEnforceAuth(
  apiUrl: string,
  githubToken: string,
  entityId: string
): Promise<OIDCExchangeResult> {
  const tokenEndpoint = `${apiUrl}/v1/auth/oidc/token`;
  core.debug(`Exchanging token at: ${tokenEndpoint}`);

  // Build RFC 8693 token exchange request
  const body = new URLSearchParams({
    grant_type: TOKEN_EXCHANGE_GRANT_TYPE,
    subject_token: githubToken,
    subject_token_type: TOKEN_TYPE_JWT,
    requested_token_type: TOKEN_TYPE_ACCESS_TOKEN,
    entity_id: entityId,
  });

  const response = await fetch(tokenEndpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: body.toString(),
  });

  const responseText = await response.text();

  if (!response.ok) {
    // Try to parse error response
    let errorMessage: string;
    try {
      const errorResponse = JSON.parse(responseText) as TokenExchangeError;
      errorMessage =
        errorResponse.error_description ||
        errorResponse.error ||
        'Unknown error';

      // Provide helpful messages for common errors
      if (errorResponse.error === 'invalid_grant') {
        errorMessage = `Token validation failed: ${errorMessage}. Check that your trust policy is configured correctly.`;
      } else if (errorResponse.error === 'unauthorized_client') {
        errorMessage = `No matching trust policy: ${errorMessage}. Configure a trust policy for your repository and branch.`;
      } else if (errorResponse.error === 'access_denied') {
        errorMessage = `Access denied: ${errorMessage}. The entity may not be accessible with the configured trust policy.`;
      }
    } catch {
      errorMessage = `HTTP ${response.status}: ${responseText}`;
    }

    throw new Error(`Token exchange failed: ${errorMessage}`);
  }

  // Parse success response
  let tokenResponse: TokenExchangeResponse;
  try {
    tokenResponse = JSON.parse(responseText) as TokenExchangeResponse;
  } catch {
    throw new Error('Token exchange returned invalid JSON response');
  }

  if (!tokenResponse.access_token) {
    throw new Error('Token exchange response missing access_token');
  }

  core.debug(
    `Token exchange successful, expires in ${tokenResponse.expires_in}s`
  );

  return {
    accessToken: tokenResponse.access_token,
    expiresIn: tokenResponse.expires_in,
  };
}

/**
 * Complete OIDC authentication flow.
 *
 * 1. Gets GitHub OIDC token
 * 2. Exchanges for EnforceAuth access token
 * 3. Masks the token in logs
 *
 * @param apiUrl - The EnforceAuth API URL
 * @param entityId - The target entity ID for the deployment
 * @returns The EnforceAuth access token
 * @throws Error if authentication fails
 */
export async function authenticate(
  apiUrl: string,
  entityId: string
): Promise<string> {
  core.info('Authenticating with EnforceAuth using OIDC...');

  // Step 1: Get GitHub OIDC token
  const githubToken = await getGitHubOIDCToken(apiUrl);

  // Step 2: Exchange for EnforceAuth token
  const result = await exchangeTokenForEnforceAuth(
    apiUrl,
    githubToken,
    entityId
  );

  // Step 3: Mask the token in logs
  core.setSecret(result.accessToken);

  core.info('Successfully authenticated with EnforceAuth');
  return result.accessToken;
}
