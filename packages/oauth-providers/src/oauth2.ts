import { createHash } from "node:crypto";

import type { OAuthProfile, OAuthProvider } from "@nexpress/core";

type OAuthClientAuthentication = "basic" | "request-body";

interface AuthorizationCodeProviderConfig {
  id: string;
  label: string;
  clientId: string;
  clientSecret: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  clientAuthentication: OAuthClientAuthentication;
  scopes: readonly string[];
  pkce: boolean;
  fetch: typeof fetch;
  fetchProfile: (accessToken: string, fetchImpl: typeof fetch) => Promise<OAuthProfile>;
}

interface AuthorizationUrlInput {
  endpoint: string;
  clientId: string;
  redirectUri: string;
  state: string;
  scopes: readonly string[];
  codeVerifier?: string;
}

interface TokenExchangeInput {
  providerId: string;
  endpoint: string;
  clientId: string;
  clientSecret: string;
  clientAuthentication: OAuthClientAuthentication;
  code: string;
  redirectUri: string;
  codeVerifier?: string;
  fetch: typeof fetch;
}

const PKCE_VERIFIER_PATTERN = /^[A-Za-z0-9._~-]{43,128}$/u;
const OAUTH_ERROR_CODE_PATTERN = /^[A-Za-z0-9._-]{1,64}$/u;
const MAX_ACCESS_TOKEN_LENGTH = 8_192;

function requirePkceVerifier(codeVerifier: string): void {
  if (!PKCE_VERIFIER_PATTERN.test(codeVerifier)) {
    throw new Error("OAuth PKCE code verifier must be 43-128 RFC 7636 characters");
  }
}

/** RFC 7636 S256 challenge used by every bundled provider. */
export function createS256CodeChallenge(codeVerifier: string): string {
  requirePkceVerifier(codeVerifier);
  return createHash("sha256").update(codeVerifier, "ascii").digest("base64url");
}

export function createOAuthAuthorizationUrl(input: AuthorizationUrlInput): string {
  const url = new URL(input.endpoint);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", input.clientId);
  url.searchParams.set("redirect_uri", input.redirectUri);
  url.searchParams.set("state", input.state);
  if (input.scopes.length > 0) {
    url.searchParams.set("scope", input.scopes.join(" "));
  }
  if (input.codeVerifier !== undefined) {
    url.searchParams.set("code_challenge_method", "S256");
    url.searchParams.set("code_challenge", createS256CodeChallenge(input.codeVerifier));
  }
  return url.toString();
}

function readOAuthErrorCode(value: unknown): string | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const descriptor = Object.getOwnPropertyDescriptor(value, "error");
  return descriptor?.value &&
    typeof descriptor.value === "string" &&
    OAUTH_ERROR_CODE_PATTERN.test(descriptor.value)
    ? descriptor.value
    : null;
}

function readAccessToken(value: unknown): string | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const descriptor = Object.getOwnPropertyDescriptor(value, "access_token");
  return descriptor?.value &&
    typeof descriptor.value === "string" &&
    descriptor.value.length <= MAX_ACCESS_TOKEN_LENGTH
    ? descriptor.value
    : null;
}

function exchangeError(providerId: string, status: number, code: string | null): Error {
  const suffix = code === null ? `HTTP ${status}` : code;
  return new Error(`${providerId} OAuth token exchange failed: ${suffix}`);
}

export async function exchangeOAuthAuthorizationCode(input: TokenExchangeInput): Promise<string> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code: input.code,
    redirect_uri: input.redirectUri,
  });
  if (input.codeVerifier !== undefined) {
    requirePkceVerifier(input.codeVerifier);
    body.set("code_verifier", input.codeVerifier);
  }

  const headers = new Headers({
    Accept: "application/json",
    "Content-Type": "application/x-www-form-urlencoded",
    "User-Agent": `nexpress-oauth-${input.providerId}`,
  });
  if (input.clientAuthentication === "basic") {
    headers.set(
      "Authorization",
      `Basic ${Buffer.from(`${input.clientId}:${input.clientSecret}`, "utf8").toString("base64")}`,
    );
  } else {
    body.set("client_id", input.clientId);
    body.set("client_secret", input.clientSecret);
  }

  let response: Response;
  try {
    response = await input.fetch(input.endpoint, {
      method: "POST",
      headers,
      body,
    });
  } catch (cause) {
    throw new Error(`${input.providerId} OAuth token exchange request failed`, { cause });
  }

  let data: unknown;
  try {
    data = await response.json();
  } catch (cause) {
    throw new Error(
      `${input.providerId} OAuth token exchange returned invalid JSON (HTTP ${response.status})`,
      { cause },
    );
  }

  const errorCode = readOAuthErrorCode(data);
  if (!response.ok || errorCode !== null) {
    throw exchangeError(input.providerId, response.status, errorCode);
  }
  const accessToken = readAccessToken(data);
  if (accessToken === null) {
    throw new Error(`${input.providerId} OAuth token exchange returned no valid access token`);
  }
  return accessToken;
}

export function createAuthorizationCodeProvider(
  config: AuthorizationCodeProviderConfig,
): OAuthProvider {
  return {
    id: config.id,
    label: config.label,
    authorize({ state, redirectUri, codeVerifier }) {
      return createOAuthAuthorizationUrl({
        endpoint: config.authorizationEndpoint,
        clientId: config.clientId,
        redirectUri,
        state,
        scopes: config.scopes,
        codeVerifier: config.pkce ? codeVerifier : undefined,
      });
    },
    async exchange({ code, redirectUri, codeVerifier }) {
      const accessToken = await exchangeOAuthAuthorizationCode({
        providerId: config.id,
        endpoint: config.tokenEndpoint,
        clientId: config.clientId,
        clientSecret: config.clientSecret,
        clientAuthentication: config.clientAuthentication,
        code,
        redirectUri,
        codeVerifier: config.pkce ? codeVerifier : undefined,
        fetch: config.fetch,
      });
      return config.fetchProfile(accessToken, config.fetch);
    },
  };
}
