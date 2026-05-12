// Stub — see ./init-core.ts for the rationale.
export function getAuthRuntimeConfig(): {
  secret: string;
  tokenExpiration: number;
  refreshTokenExpiration: number;
} {
  return { secret: "", tokenExpiration: 0, refreshTokenExpiration: 0 };
}
