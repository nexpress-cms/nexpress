import { createHash } from "node:crypto";

import type { NpAgentJsonObject, NpAgentModelPricingV1 } from "../agent-contract/index.js";
import {
  npCreateAgentProviderResultDigestV1,
  type NpAgentConnectionAuthAdapterV1,
  type NpAgentParsedConnectionConfigV1,
  type NpAgentProviderAuthOperationResultV1,
  type NpAgentProviderProbeResultV1,
} from "./provider-auth-contract.js";

const TEXT_ENCODER = new TextEncoder();
const TEXT_DECODER = new TextDecoder("utf-8", { fatal: true });

export interface NpAgentFakeProviderAdapterOptionsV1 {
  apiKey?: string;
  authorizationOrigin?: string;
  authorizationCode?: string;
  unavailable?: boolean;
  now?: () => Date;
}

function adapterFingerprint(): string {
  return `cj1:sha256:${createHash("sha256")
    .update("np.agent-provider-adapter.fake.v1", "utf8")
    .digest("base64url")}`;
}

function stringConfig(value: NpAgentJsonObject, key: string): string {
  const current = value[key];
  if (typeof current !== "string") throw new Error(`Fake provider config ${key} is invalid.`);
  return current;
}

function pricing(modelId: string): NpAgentModelPricingV1 {
  return {
    schemaVersion: "np.agent-model-pricing.v1",
    pricingId: `fake-${modelId}`,
    version: 1,
    fingerprint: `pr1:sha256:${createHash("sha256")
      .update(`fake-pricing:${modelId}`, "utf8")
      .digest("base64url")}`,
    modelId,
    currency: "USD",
    unitTokens: 1_000_000,
    inputMicrosPerUnit: 1_000_000,
    cachedInputMicrosPerUnit: 500_000,
    outputMicrosPerUnit: 2_000_000,
    minimumRequestMicros: 0,
    rounding: "ceil-each-component",
    effectiveFrom: "2020-01-01T00:00:00.000Z",
    effectiveUntil: null,
  };
}

function readyProbe(
  parsed: NpAgentParsedConnectionConfigV1,
  grantedPermissions: string[],
): NpAgentProviderProbeResultV1 {
  const connectionKind = stringConfig(parsed.config, "connectionKind");
  const accountId = stringConfig(parsed.config, "accountId");
  const capabilityIds = connectionKind === "model" ? ["model.generate"] : ["notification.send"];
  const safe = { accountId, capabilityIds, grantedPermissions };
  return {
    schemaVersion: "np.agent-provider-probe-result.v1",
    status: "ready",
    providerSubject: TEXT_ENCODER.encode(`fake-account:${accountId}`),
    grantedPermissions,
    capabilityIds,
    safeCode: null,
    resultDigest: npCreateAgentProviderResultDigestV1("fake-probe-ready", safe),
  };
}

function unavailableProbe(): NpAgentProviderProbeResultV1 {
  const safe = { safeCode: "FAKE_PROVIDER_UNAVAILABLE", status: "unavailable" };
  return {
    schemaVersion: "np.agent-provider-probe-result.v1",
    status: "unavailable",
    providerSubject: null,
    grantedPermissions: [],
    capabilityIds: [],
    safeCode: "FAKE_PROVIDER_UNAVAILABLE",
    resultDigest: npCreateAgentProviderResultDigestV1("fake-probe-unavailable", safe),
  };
}

/** Deterministic server-only adapter used by lifecycle and hostile-result fixtures. */
export function createAgentFakeProviderAdapterV1(
  options: NpAgentFakeProviderAdapterOptionsV1 = {},
): NpAgentConnectionAuthAdapterV1 {
  const apiKey = options.apiKey ?? "fake-api-key";
  const authorizationCode = options.authorizationCode ?? "fake-authorization-code";
  const origin = options.authorizationOrigin ?? "https://provider.example";
  const now = options.now ?? (() => new Date());
  const fingerprint = adapterFingerprint();

  const adapter: NpAgentConnectionAuthAdapterV1 = {
    id: "fake-provider",
    contractVersion: 1,
    fingerprint,
    credentialEnvelopeVersions: [1],
    supportedConnectionKinds: ["model", "notification"],
    supportedAuthKinds: ["api_key", "oauth"],
    configSchema: {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      type: "object",
      additionalProperties: false,
      properties: {
        accountId: { type: "string", minLength: 1, maxLength: 128 },
        connectionKind: { enum: ["model", "notification"] },
        destination: {
          anyOf: [{ type: "string", minLength: 1, maxLength: 256 }, { type: "null" }],
        },
        modelId: { anyOf: [{ type: "string", minLength: 1, maxLength: 128 }, { type: "null" }] },
      },
      required: ["accountId", "connectionKind", "destination", "modelId"],
    },
    destinationDescriptorSchema: {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      type: "object",
      additionalProperties: false,
      properties: { channel: { type: "string", minLength: 1, maxLength: 256 } },
      required: ["channel"],
    },
    oauth: {
      authorizationOrigins: [origin],
      permissionInventory: ["account.read", "model.generate", "notification.send"],
      buildAuthorizationUrl(input) {
        const url = new URL("/oauth/authorize", origin);
        url.searchParams.set("redirect_uri", input.redirectUri);
        url.searchParams.set("state", input.state);
        url.searchParams.set("code_challenge", input.codeChallenge);
        url.searchParams.set("code_challenge_method", input.codeChallengeMethod);
        url.searchParams.set("scope", input.requestedPermissions.join(" "));
        return {
          schemaVersion: "np.agent-provider-oauth-authorize-result.v1",
          authorizationUrl: url.toString(),
        };
      },
      async exchangeAuthorizationCode(input, context) {
        if (options.unavailable) return failedAuthResult("FAKE_PROVIDER_UNAVAILABLE", true);
        const accepted = await context.codeLease.use(async (code) => {
          const verifierAccepted = await context.pkceLease.use((verifier) =>
            Promise.resolve(verifier.length === 64),
          );
          return verifierAccepted && TEXT_DECODER.decode(code) === authorizationCode;
        });
        if (!accepted) return failedAuthResult("FAKE_AUTHORIZATION_INVALID", false);
        return successAuthResult(input.connection, input.requestedPermissions, now());
      },
      async refreshCredential(input, context) {
        if (options.unavailable) return failedAuthResult("FAKE_PROVIDER_UNAVAILABLE", true);
        const accepted = await context.credentialLease.use((credential) =>
          Promise.resolve(credential.kind === "oauth" && credential.refresh.mode === "present"),
        );
        if (!accepted) return failedAuthResult("FAKE_REFRESH_UNAVAILABLE", false);
        const result = successAuthResult(input.connection, input.requestedPermissions, now());
        if (result.status === "success") result.credential.refreshToken = { mode: "retain" };
        return result;
      },
    },
    parseConfig(input) {
      const connectionKind = stringConfig(input.config, "connectionKind");
      const modelId = input.config.modelId;
      const pricingCatalog =
        connectionKind === "model" && typeof modelId === "string" ? [pricing(modelId)] : [];
      return {
        schemaVersion: "np.agent-parsed-connection-config.v1",
        connectionId: input.connectionId,
        adapterId: adapter.id,
        adapterContractVersion: adapter.contractVersion,
        adapterFingerprint: adapter.fingerprint,
        configVersion: input.configVersion,
        // The host fills and verifies both canonical fingerprints.
        configHash: "",
        config: structuredClone(input.config),
        pricingCatalog,
        pricingCatalogFingerprint: "",
      };
    },
    deriveDestinationDescriptor({ parsedConfig }) {
      if (stringConfig(parsedConfig.config, "connectionKind") !== "notification") return null;
      const destination = stringConfig(parsedConfig.config, "destination");
      return {
        schemaVersion: "np.agent-connection-destination-descriptor.v1",
        kind: "notification",
        adapterId: adapter.id,
        descriptor: { channel: destination },
      };
    },
    async probeCredential(parsed, context) {
      if (options.unavailable) return unavailableProbe();
      return context.credentialLease.use((credential) => {
        if (credential.kind === "api_key") {
          return Promise.resolve(
            TEXT_DECODER.decode(credential.secret) === apiKey
              ? readyProbe(parsed, [])
              : {
                  schemaVersion: "np.agent-provider-probe-result.v1",
                  status: "unauthorized",
                  providerSubject: null,
                  grantedPermissions: [],
                  capabilityIds: [],
                  safeCode: "FAKE_API_KEY_INVALID",
                  resultDigest: npCreateAgentProviderResultDigestV1("fake-probe-unauthorized", {
                    safeCode: "FAKE_API_KEY_INVALID",
                  }),
                },
          );
        }
        return Promise.resolve(
          TEXT_DECODER.decode(credential.accessToken).startsWith("fake-access-token:")
            ? readyProbe(parsed, [...credential.grantedPermissions])
            : {
                schemaVersion: "np.agent-provider-probe-result.v1",
                status: "unauthorized",
                providerSubject: null,
                grantedPermissions: [],
                capabilityIds: [],
                safeCode: "FAKE_ACCESS_TOKEN_INVALID",
                resultDigest: npCreateAgentProviderResultDigestV1("fake-probe-unauthorized", {
                  safeCode: "FAKE_ACCESS_TOKEN_INVALID",
                }),
              },
        );
      });
    },
  };
  return adapter;
}

function failedAuthResult(code: string, retryable: boolean): NpAgentProviderAuthOperationResultV1 {
  return {
    schemaVersion: "np.agent-provider-auth-operation-result.v1",
    status: "failed",
    errorClass: retryable ? "network" : "authorization",
    retryable,
    safeCode: code,
    resultDigest: npCreateAgentProviderResultDigestV1("fake-auth-failed", { code, retryable }),
  };
}

function successAuthResult(
  parsed: NpAgentParsedConnectionConfigV1,
  requestedPermissions: string[],
  at: Date,
): NpAgentProviderAuthOperationResultV1 {
  const accountId = stringConfig(parsed.config, "accountId");
  const expiresAt = new Date(at.getTime() + 60 * 60 * 1_000).toISOString();
  const refreshExpiresAt = new Date(at.getTime() + 30 * 24 * 60 * 60 * 1_000).toISOString();
  return {
    schemaVersion: "np.agent-provider-auth-operation-result.v1",
    status: "success",
    credential: {
      schemaVersion: "np.agent-provider-oauth-credential.v1",
      tokenType: "Bearer",
      accessToken: TEXT_ENCODER.encode(`fake-access-token:${accountId}:${at.getTime().toString()}`),
      refreshToken: {
        mode: "replace",
        token: TEXT_ENCODER.encode(`fake-refresh-token:${accountId}`),
        refreshExpiresAt,
      },
      accessExpiresAt: expiresAt,
      grantedPermissions: [...requestedPermissions],
      providerSubject: TEXT_ENCODER.encode(`fake-account:${accountId}`),
    },
    safeAccountHint: `fake:${accountId}`,
    resultDigest: npCreateAgentProviderResultDigestV1("fake-auth-success", {
      accountId,
      grantedPermissions: requestedPermissions,
    }),
  };
}
