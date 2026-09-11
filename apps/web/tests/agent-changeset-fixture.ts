import type { NpAgentMcpTaskServiceV1 } from "../../../packages/core/src/agent/mcp-task-service.js";
import type { NpAgentCapabilityAdmissionServiceV1 } from "../../../packages/core/src/agent/capability-admission.js";
import type { NpAgentScope } from "../../../packages/core/src/agent-contract/types.js";
import type { NpAgentPreviewArtifactStorageAdapterV1 } from "../../../packages/core/src/agent/preview-artifact-contract.js";
import {
  createAgentChangeSetCapabilityFacadeV1,
  type NpAgentChangeSetCapabilityFacadeV1,
} from "../../../packages/core/src/agent/changeset-capability.js";
import { createHash, randomUUID } from "node:crypto";
import { createSite, grantSiteMembership, npSessions, npUsers } from "@nexpress/core";
import { eq } from "drizzle-orm";
import { expect } from "vitest";
import { npCreateEmptyRichTextContent } from "../../../packages/core/src/fields/rich-text.js";
import {
  createAgentChangeSetServiceV1,
  type NpAgentChangeSetActorV1,
  type NpAgentChangeSetServiceOptionsV1,
} from "../../../packages/core/src/agent/changeset-service.js";
import {
  npBuildAgentChangeSetDraftInputJsonV1,
  npDigestAgentChangeSetDraftInputV1,
  type NpAgentChangeSetDraftInputV1,
} from "../../../packages/core/src/agent-contract/changeset-wire-contract.js";
import { createAgentGatewayServiceV1 } from "../../../packages/core/src/agent/gateway-service.js";
import { createAgentOauthServiceV1 } from "../../../packages/core/src/agent/oauth-service.js";
import { createAgentCapabilityAdmissionServiceV1 } from "../../../packages/core/src/agent/capability-admission.js";
import { createAgentReadCapabilityRegistryV1 } from "../../../packages/core/src/agent/capability-registry.js";
import { createAgentCoreReadCapabilityExecutorsV1 } from "../../../packages/core/src/agent/read-capability-executors.js";
import { getTestDb, seedUser } from "./harness.js";
export const siteId = "changeset-validation";
export const settings = {
  schemaVersion: "np.agent-gateway-settings.v1" as const,
  stdio: "propose" as const,
  mcpHttp: "disabled" as const,
  agentHttp: "disabled" as const,
};
export function draft(title = "Proposed content"): NpAgentChangeSetDraftInputV1 {
  return {
    title,
    summary: null,
    operations: [
      {
        kind: "document",
        operation: "create",
        clientOperationId: "create-post",
        reason: null,
        resource: { collection: "posts", documentId: null },
        base: null,
        input: {
          document: {
            title: "Proposed post",
            content: npCreateEmptyRichTextContent(),
          },
          targetStatus: "draft",
        },
      },
    ],
  };
}
export async function command(
  value = draft(),
  idempotencyKey = randomUUID(),
  expectedVersion?: number,
) {
  return {
    idempotencyKey,
    proposalJson: npBuildAgentChangeSetDraftInputJsonV1(value),
    proposalHash: await npDigestAgentChangeSetDraftInputV1(value),
    ...(expectedVersion === undefined ? {} : { expectedVersion }),
  };
}
export async function fixture(options: Partial<NpAgentChangeSetServiceOptionsV1> = {}) {
  const db = await getTestDb();
  const seeded = await seedUser({ role: "admin" });
  await createSite({ id: siteId, name: "Draft site" });
  await createSite({ id: "draft-other", name: "Other" });
  await grantSiteMembership(siteId, seeded.userId, "admin");
  await grantSiteMembership("draft-other", seeded.userId, "admin");
  const [user] = await db.select().from(npUsers).where(eq(npUsers.id, seeded.userId));
  const [session] = await db.select().from(npSessions).where(eq(npSessions.userId, seeded.userId));
  const actor: Extract<NpAgentChangeSetActorV1, { kind: "staff" }> = {
    kind: "staff",
    siteId,
    actor: {
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        tokenVersion: user.tokenVersion,
      },
      sessionId: session.id,
    },
  };
  return {
    db,
    actor,
    service: createAgentChangeSetServiceV1({
      cursorKey: new Uint8Array(32).fill(44),
      reauthentication: { verify: () => true },
      ...options,
    }),
  };
}
export interface PrincipalFixtureControl {
  transport?: "stdio" | "mcp-http" | "agent-http";
  tasks?: (input: {
    admission: NpAgentCapabilityAdmissionServiceV1;
    now: () => Date;
    getService: () => ReturnType<typeof createAgentChangeSetServiceV1>;
  }) => NpAgentMcpTaskServiceV1;
}
export async function principalFixture(
  f: Awaited<ReturnType<typeof fixture>>,
  writeOnly = false,
  options: Partial<NpAgentChangeSetServiceOptionsV1> = {},
  extraScopes: NpAgentScope[] = [],
  exposure: "propose" | "approved-execute" = "propose",
  control: PrincipalFixtureControl = {},
) {
  const transport = control.transport ?? "stdio";
  const gatewaySettings = {
    ...settings,
    stdio: exposure,
    ...(transport === "mcp-http" ? { mcpHttp: exposure } : {}),
    ...(transport === "agent-http" ? { agentHttp: exposure } : {}),
  };
  const gateway = createAgentGatewayServiceV1({
    tokenHashKeyring: { active: { id: "draft-key", key: new Uint8Array(32).fill(25) } },
    environment: "production",
    resolveCanonicalSiteOrigin: () => "https://site.example",
    deploymentGatewaySettings: gatewaySettings,
    resolveSiteGatewaySettings: () => gatewaySettings,
    reauthentication: { verify: () => true },
  });
  const baseScopes: NpAgentScope[] = writeOnly
    ? ["changeset:write", "content:draft", "site:read"]
    : ["changeset:read", "changeset:write", "content:draft", "content:read", "site:read"];
  const scopes = [...new Set([...baseScopes, ...extraScopes])].sort();
  const principal = await gateway.executeAdmin({
    siteId,
    actor: f.actor.actor,
    operationId: "agents.gateway.principals.create",
    targetId: null,
    command: {
      idempotencyKey: randomUUID(),
      name: "Draft client",
      description: null,
      scopes: [...scopes],
    },
  });
  const token = await gateway.executeAdmin({
    siteId,
    actor: f.actor.actor,
    operationId: "agents.gateway.principal_tokens.create",
    targetId: principal.resourceId,
    command: {
      idempotencyKey: randomUUID(),
      expectedVersion: 1,
      name: "Draft token",
      scopes: [...scopes],
      transport,
      exposure,
      expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    },
  });
  const authentication = await gateway.authenticateServiceToken({
    siteId,
    credential: token.oneTimeValue,
    transport,
    audience:
      transport === "stdio"
        ? "urn:nexpress:agent-gateway:stdio"
        : transport === "mcp-http"
          ? "https://site.example/api/mcp"
          : "https://site.example/api/agent/v1",
  });
  const executors = createAgentCoreReadCapabilityExecutorsV1({
    cursorHmacKey: { id: "draft-read-key", key: new Uint8Array(32).fill(26) },
    resolveBlockSchemas: () => [],
    resolveUser: () => f.actor.actor.user,
  });
  const registry = await createAgentReadCapabilityRegistryV1(executors);
  let facade: NpAgentChangeSetCapabilityFacadeV1 | null = null;
  const admission = createAgentCapabilityAdmissionServiceV1({
    registry,
    resolveChangeSetCapabilities: () => facade,
    now: options.now,
    resolveGatewaySettings: () => gatewaySettings,
  });
  const tasks = control.tasks?.({
    admission,
    now: options.now ?? (() => new Date()),
    getService: () => service,
  });
  const service: ReturnType<typeof createAgentChangeSetServiceV1> = createAgentChangeSetServiceV1({
    cursorKey: new Uint8Array(32).fill(44),
    admission,
    gateway,
    reauthentication: { verify: () => true },
    ...options,
    ...(tasks ? { tasks } : {}),
  });
  facade = createAgentChangeSetCapabilityFacadeV1(service);
  return {
    tasks,
    gatewaySettings,
    gateway,
    principal,
    authentication,
    token,
    service,
    admission,
    actor: { kind: "principal" as const, authentication },
  };
}

export async function oauthFixture(f: Awaited<ReturnType<typeof fixture>>) {
  const origin = "https://validation.example";
  const resource = `${origin}/api/mcp`;
  const gatewaySettings = { ...settings, mcpHttp: "propose" as const };
  const tokenHashKeyring = { active: { id: "oauth-validation", key: new Uint8Array(32).fill(39) } };
  const gateway = createAgentGatewayServiceV1({
    tokenHashKeyring,
    deploymentGatewaySettings: gatewaySettings,
    resolveSiteGatewaySettings: () => gatewaySettings,
    resolveCanonicalSiteOrigin: () => origin,
    reauthentication: { verify: () => true },
  });
  const keys = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
    "sign",
    "verify",
  ]);
  const oauth = createAgentOauthServiceV1({
    gateway,
    tokenHashKeyring,
    signingKeyring: {
      active: { kid: "oauth-validation", privateKey: keys.privateKey, publicKey: keys.publicKey },
    },
    reauthentication: { verify: () => true },
  });
  const registered = await oauth.executeAdmin({
    siteId,
    actor: f.actor.actor,
    operationId: "agents.gateway.oauth_clients.create",
    targetId: null,
    command: {
      idempotencyKey: randomUUID(),
      name: "Validation client",
      redirectUris: ["http://127.0.0.1:43110/callback"],
      transports: ["mcp-http"],
    },
  });
  const clientId = registered.output.clientId;
  if (typeof clientId !== "string") throw new Error("Expected client id");
  const scopes = [
    "changeset:read",
    "changeset:write",
    "content:draft",
    "content:read",
    "site:read",
  ] as const;
  const verifier = "v".repeat(43);
  const started = await oauth.startAuthorization({
    siteId,
    actor: f.actor.actor,
    request: {
      responseType: "code",
      clientId,
      redirectUri: "http://127.0.0.1:43110/callback",
      state: "validation-client-state",
      scope: scopes.join(" "),
      resource,
      codeChallenge: createHash("sha256").update(verifier, "ascii").digest("base64url"),
      codeChallengeMethod: "S256",
      gatewayMode: "propose",
    },
  });
  const accepted = await oauth.decideAuthorization({
    siteId,
    actor: f.actor.actor,
    consentChallenge: started.consentChallenge,
    approve: true,
    scopes: [...scopes],
    gatewayMode: "propose",
  });
  const tokens = await oauth.exchangeAuthorizationCode({
    siteId,
    clientId,
    code: new URL(accepted.redirectUri).searchParams.get("code"),
    redirectUri: "http://127.0.0.1:43110/callback",
    codeVerifier: verifier,
    resource,
  });
  const authentication = await oauth.authenticateRemoteBearer({
    siteId,
    authorization: `Bearer ${tokens.access_token}`,
  });
  expect(authentication.authorizationContext.authorityRef.kind).toBe("oauth-grant");
  const registry = await createAgentReadCapabilityRegistryV1(
    createAgentCoreReadCapabilityExecutorsV1({
      cursorHmacKey: { id: "oauth-validation", key: new Uint8Array(32).fill(40) },
      resolveBlockSchemas: () => [],
      resolveUser: () => f.actor.actor.user,
    }),
  );
  const admission = createAgentCapabilityAdmissionServiceV1({
    registry,
    resolveGatewaySettings: () => gatewaySettings,
  });
  const service = createAgentChangeSetServiceV1({
    cursorKey: new Uint8Array(32).fill(41),
    gateway,
    admission,
    inlineValidationOperationLimit: 0,
    reauthentication: { verify: () => true },
  });
  return {
    oauth,
    clientId,
    tokens,
    service,
    actor: { kind: "principal" as const, authentication },
  };
}

export function previewConfiguration(): NonNullable<NpAgentChangeSetServiceOptionsV1["preview"]> {
  return {
    contract: {
      schemaVersion: "np.agent-preview-contract.v1",
      overlayResolverVersion: 1,
      rendererId: "fixture-renderer",
      rendererVersion: 1,
      rendererFingerprint: "fixture-renderer-v1",
      screenshotAdapterId: null,
      screenshotAdapterVersion: null,
      screenshotAdapterFingerprint: null,
      routeParserVersion: 1,
      checkRegistryVersion: 1,
      linkAllowlistVersion: 1,
      linkAllowlistOrigins: [],
      networkPolicyVersion: 1,
      artifactLimitsVersion: 1,
      reportSchemaVersion: 1,
      responseHeaderBuilderVersion: 1,
      cspBuilderVersion: 1,
    },
    resolveRoutes: () => Promise.resolve([{ route: "/", locale: null, audience: "public" }]),
  };
}
export async function readyPreview(f: {
  service: ReturnType<typeof createAgentChangeSetServiceV1>;
  actor: NpAgentChangeSetActorV1;
}) {
  const created = await f.service.create({ actor: f.actor, command: await command() });
  const sealed = await f.service.validate({
    actor: f.actor,
    id: created.id,
    command: { idempotencyKey: randomUUID(), expectedVersion: 1 },
  });
  const preview = await f.service.preview({
    actor: f.actor,
    id: created.id,
    command: {
      idempotencyKey: randomUUID(),
      expectedVersion: 1,
      expectedPlanHash: sealed.planHash,
    },
  });
  await f.service.processPreview({
    siteId:
      f.actor.kind === "staff"
        ? f.actor.siteId
        : f.actor.authentication.authorizationContext.siteId,
    previewId: preview.previewId,
  });
  return f.service.getPreview({ actor: f.actor, previewId: preview.previewId });
}

export function previewStorageFixture() {
  const objects = new Map<string, Uint8Array>();
  const adapter: NpAgentPreviewArtifactStorageAdapterV1 = {
    id: "review-store",
    contractVersion: 1,
    fingerprint: `cj1:sha256:${"a".repeat(43)}`,
    put({ request, bytes }) {
      objects.set(request.storageKey, Uint8Array.from(bytes));
      return Promise.resolve({ operationRef: "test-operation" });
    },
    resolveOperation() {
      return Promise.resolve({
        status: "committed",
        resolvedAt: new Date().toISOString(),
        safeCode: null,
      });
    },
    stat({ storageKey }) {
      const b = objects.get(storageKey);
      return Promise.resolve(
        b ? { state: "present", mime: "application/json", bytes: b.length } : { state: "absent" },
      );
    },
    read({ storageKey }) {
      const b = objects.get(storageKey);
      if (!b) return Promise.reject(new Error("missing"));
      return Promise.resolve({ bytes: Uint8Array.from(b), mime: "application/json" });
    },
    delete({ storageKey }) {
      return Promise.resolve({ status: objects.delete(storageKey) ? "deleted" : "already_absent" });
    },
  };
  return { adapter, objects };
}
