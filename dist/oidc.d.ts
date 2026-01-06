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
export declare function getGitHubOIDCToken(audience: string): Promise<string>;
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
export declare function exchangeTokenForEnforceAuth(apiUrl: string, githubToken: string, entityId: string): Promise<OIDCExchangeResult>;
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
export declare function authenticate(apiUrl: string, entityId: string): Promise<string>;
