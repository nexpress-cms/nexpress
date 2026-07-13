export { npReadAuthPositiveInteger as npReadBoundedPositiveInteger } from "@nexpress/core/auth-contract";

export function npAssertRefreshLifetime(accessExpiration: number, refreshExpiration: number): void {
  if (refreshExpiration < accessExpiration) {
    throw new Error("NP_REFRESH_TOKEN_EXPIRATION must not be shorter than NP_TOKEN_EXPIRATION.");
  }
}
