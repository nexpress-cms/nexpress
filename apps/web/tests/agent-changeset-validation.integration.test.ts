import { createHash, randomUUID } from "node:crypto";
// eslint-disable-next-line import-x/no-relative-packages
import {
  npDigestAgentChangeSetPlanCanonical,
  npDigestAgentChangeSetSnapshotCanonical,
} from "../../../packages/core/src/agent-contract/canonical-changeset.js";
// eslint-disable-next-line import-x/no-relative-packages
import { withCurrentSite } from "../../../packages/core/src/sites/context.js";
// eslint-disable-next-line import-x/no-relative-packages
import { saveDocument } from "../../../packages/core/src/collections/pipeline.js";
// eslint-disable-next-line import-x/no-relative-packages
import { createAgentChangeSetValidationResourceServiceV1 } from "../../../packages/core/src/agent/changeset-validation-resources.js";
// eslint-disable-next-line import-x/no-relative-packages
import type { NpAgentChangeSetOperationInput } from "../../../packages/core/src/agent-contract/types.js";
// eslint-disable-next-line import-x/no-relative-packages
import { npCreateEmptyRichTextContent } from "../../../packages/core/src/fields/rich-text.js";
import { eq } from "drizzle-orm";
import { beforeAll, beforeEach, afterEach, afterAll, describe, expect, it } from "vitest";
import { createSite, grantSiteMembership, npUsers, npSessions, npRevisions } from "@nexpress/core";
// eslint-disable-next-line import-x/no-relative-packages
import {
  createAgentChangeSetServiceV1,
  type NpAgentChangeSetActorV1,
  type NpAgentChangeSetServiceOptionsV1,
} from "../../../packages/core/src/agent/changeset-service.js";
// eslint-disable-next-line import-x/no-relative-packages
import {
  npBuildAgentChangeSetDraftInputJsonV1,
  npDigestAgentChangeSetDraftInputV1,
  type NpAgentChangeSetDraftInputV1,
} from "../../../packages/core/src/agent-contract/changeset-wire-contract.js";
// eslint-disable-next-line import-x/no-relative-packages
import {
  npAgentChangesets,
  npAgentChangesetOperations,
  npAgentActions,
  npAgentChangesetValidationAttempts,
  npAgentApprovals,
} from "../../../packages/core/src/db/schema/agent.js";
// eslint-disable-next-line import-x/no-relative-packages
import { createAgentGatewayServiceV1 } from "../../../packages/core/src/agent/gateway-service.js";
// eslint-disable-next-line import-x/no-relative-packages
import { createAgentOauthServiceV1 } from "../../../packages/core/src/agent/oauth-service.js";
// eslint-disable-next-line import-x/no-relative-packages
import { createAgentCapabilityAdmissionServiceV1 } from "../../../packages/core/src/agent/capability-admission.js";
// eslint-disable-next-line import-x/no-relative-packages
import { createAgentReadCapabilityRegistryV1 } from "../../../packages/core/src/agent/capability-registry.js";
// eslint-disable-next-line import-x/no-relative-packages
import { createAgentCoreReadCapabilityExecutorsV1 } from "../../../packages/core/src/agent/read-capability-executors.js";
// eslint-disable-next-line import-x/no-relative-packages
import {
  getCollectionConfig,
  getCollectionTable,
  registerCollection,
} from "../../../packages/core/src/collections/registry.js";
import { postsTable } from "../src/db/generated/collections.js";
import {
  ensureMigrated,
  closeTestDb,
  getTestDb,
  seedUser,
  skipIfNoTestDb,
  truncateAll,
  registerTestCollections,
} from "./harness.js";
const siteId = "changeset-validation";
const settings = {
  schemaVersion: "np.agent-gateway-settings.v1" as const,
  stdio: "propose" as const,
  mcpHttp: "disabled" as const,
  agentHttp: "disabled" as const,
};
function draft(title = "Proposed content"): NpAgentChangeSetDraftInputV1 {
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
async function command(value = draft(), idempotencyKey = randomUUID(), expectedVersion?: number) {
  return {
    idempotencyKey,
    proposalJson: npBuildAgentChangeSetDraftInputJsonV1(value),
    proposalHash: await npDigestAgentChangeSetDraftInputV1(value),
    ...(expectedVersion === undefined ? {} : { expectedVersion }),
  };
}
async function fixture(options: Partial<NpAgentChangeSetServiceOptionsV1> = {}) {
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
        id: user!.id,
        email: user!.email,
        name: user!.name,
        role: user!.role,
        tokenVersion: user!.tokenVersion,
      },
      sessionId: session!.id,
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
async function principalFixture(
  f: Awaited<ReturnType<typeof fixture>>,
  writeOnly = false,
  options: Partial<NpAgentChangeSetServiceOptionsV1> = {},
) {
  const gateway = createAgentGatewayServiceV1({
    tokenHashKeyring: { active: { id: "draft-key", key: new Uint8Array(32).fill(25) } },
    environment: "production",
    deploymentGatewaySettings: settings,
    resolveSiteGatewaySettings: () => settings,
    reauthentication: { verify: () => true },
  });
  const scopes = writeOnly
    ? ["changeset:write", "content:draft", "site:read"]
    : ["changeset:read", "changeset:write", "content:draft", "content:read", "site:read"];
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
      transport: "stdio",
      exposure: "propose",
      expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    },
  });
  const authentication = await gateway.authenticateServiceToken({
    siteId,
    credential: token.oneTimeValue,
    transport: "stdio",
    audience: "urn:nexpress:agent-gateway:stdio",
  });
  const executors = createAgentCoreReadCapabilityExecutorsV1({
    cursorHmacKey: { id: "draft-read-key", key: new Uint8Array(32).fill(26) },
    resolveBlockSchemas: () => [],
    resolveUser: () => f.actor.actor.user,
  });
  const registry = await createAgentReadCapabilityRegistryV1(executors);
  const admission = createAgentCapabilityAdmissionServiceV1({
    registry,
    resolveGatewaySettings: () => settings,
  });
  return {
    gateway,
    principal,
    authentication,
    token,
    service: createAgentChangeSetServiceV1({
      cursorKey: new Uint8Array(32).fill(44),
      admission,
      gateway,
      ...options,
      reauthentication: { verify: () => true },
    }),
    actor: { kind: "principal" as const, authentication },
  };
}

async function oauthFixture(f: Awaited<ReturnType<typeof fixture>>) {
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
  const clientId = String(registered.output.clientId);
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
async function requester(f: Awaited<ReturnType<typeof fixture>>) {
  const seeded = await seedUser({ role: "admin" });
  await grantSiteMembership(siteId, seeded.userId, "admin");
  const [user] = await f.db.select().from(npUsers).where(eq(npUsers.id, seeded.userId));
  const [session] = await f.db
    .select()
    .from(npSessions)
    .where(eq(npSessions.userId, seeded.userId));
  return { kind: "staff" as const, siteId, actor: { user: user!, sessionId: session!.id } };
}
async function oneAttempt(f: Awaited<ReturnType<typeof fixture>>) {
  const attempts = await f.db.select().from(npAgentChangesetValidationAttempts);
  expect(attempts).toHaveLength(1);
  return attempts[0]!;
}
const validationCommand = () => ({ idempotencyKey: randomUUID(), expectedVersion: 1 });
const digest = "cj1:sha256:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
describe.skipIf(skipIfNoTestDb())("ChangeSet validation lifecycle", () => {
  beforeAll(ensureMigrated);
  beforeEach(registerTestCollections);
  afterEach(async () => {
    await truncateAll();
    registerTestCollections();
  });
  afterAll(closeTestDb);
  it("seals a bounded create plan with exact snapshots and performs no content writes", async () => {
    const f = await fixture();
    const draft = await f.service.create({ actor: f.actor, command: await command() });
    const validated = await f.service.validate({
      actor: f.actor,
      id: draft.id,
      command: validationCommand(),
    });
    expect(validated.state).toBe("ready");
    expect(validated.validation).toMatchObject({ state: "valid", generation: 1 });
    expect(validated.planHash).toMatch(/^cj1:sha256:/);
    const [row] = await f.db.select().from(npAgentChangesets);
    const [operation] = await f.db.select().from(npAgentChangesetOperations);
    expect(row!.sealedPlanBody).not.toBeNull();
    expect(row!.sealedPlanBody!.body.requiredScopes).toEqual([
      "changeset:apply",
      "content:draft",
      "content:publish",
    ]);
    expect(await npDigestAgentChangeSetPlanCanonical(row!.sealedPlanBody!)).toBe(row!.planHash);
    expect(row!.baseFingerprint).not.toBeNull();
    expect(operation!.beforeSnapshot).not.toBeNull();
    expect(operation!.snapshotHash).toMatch(/^cj1:sha256:/);
    expect(await npDigestAgentChangeSetSnapshotCanonical(operation!.beforeSnapshot!)).toBe(
      operation!.snapshotHash,
    );
    expect((await oneAttempt(f)).state).toBe("ready");
    expect(await f.db.select().from(postsTable)).toEqual([]);
    expect(await f.db.select().from(npRevisions)).toEqual([]);
    expect(await f.db.select().from(npAgentActions)).toEqual([]);
    expect(await f.db.select().from(npAgentApprovals)).toEqual([]);
    const encoded = JSON.stringify(validated);
    expect(encoded).not.toContain('"sealedPlanBody"');
    expect(encoded).not.toContain('"beforeSnapshot"');
    expect(encoded).not.toContain('"authorityRef"');
  });
  it("replays validation without new attempts and rejects stale draft versions", async () => {
    const f = await fixture();
    const draft = await f.service.create({ actor: f.actor, command: await command() });
    const input = { actor: f.actor, id: draft.id, command: validationCommand() };
    const first = await f.service.validate(input);
    const replay = await f.service.validate(input);
    expect(replay.planHash).toBe(first.planHash);
    expect((await oneAttempt(f)).generation).toBe(1);
    await expect(
      f.service.validate({ ...input, command: { ...validationCommand(), expectedVersion: 2 } }),
    ).rejects.toMatchObject({ status: 409 });
  });
  it("admits concurrent identical validation once and seals once", async () => {
    const f = await fixture();
    const draft = await f.service.create({ actor: f.actor, command: await command() });
    const input = { actor: f.actor, id: draft.id, command: validationCommand() };
    const outcomes = await Promise.allSettled([
      f.service.validate(input),
      f.service.validate(input),
    ]);
    for (const outcome of outcomes) if (outcome.status === "rejected") throw outcome.reason;
    expect((await oneAttempt(f)).generation).toBe(1);
    expect((await f.db.select().from(npAgentChangesets))[0]!.state).toBe("ready");
  });
  it.each(["revoked", "expired"])(
    "queued work rechecks the %s requester rather than substituting its creator",
    async (mode) => {
      const jobs: Array<{ siteId: string; attemptId: string }> = [];
      const f = await fixture({
        inlineValidationOperationLimit: 0,
        enqueueValidation: async (job) => {
          jobs.push(job);
        },
      });
      const draft = await f.service.create({ actor: f.actor, command: await command() });
      const other = await requester(f);
      const queued = await f.service.validate({
        actor: other,
        id: draft.id,
        command: validationCommand(),
      });
      expect(queued.state).toBe("validating");
      expect(jobs).toHaveLength(1);
      expect((await oneAttempt(f)).requesterId).toBe(other.actor.user.id);
      if (mode === "revoked")
        await f.db.delete(npSessions).where(eq(npSessions.id, other.actor.sessionId));
      else
        await f.db
          .update(npSessions)
          .set({ accessExpiresAt: new Date(Date.now() - 1000) })
          .where(eq(npSessions.id, other.actor.sessionId));
      await f.service.processValidation(jobs[0]!);
      expect(await oneAttempt(f)).toMatchObject({
        state: "failed",
        errorCode: "AUTHORITY_REVOKED",
        resultDigest: null,
      });
      const [row] = await f.db.select().from(npAgentChangesets);
      expect(row!.state).toBe("invalid");
      expect(row!.sealedPlanBody).toBeNull();
      expect(row!.planHash).toBeNull();
      expect(await f.db.select().from(npAgentApprovals)).toEqual([]);
      expect((await f.service.get({ actor: f.actor, id: draft.id })).validation?.state).toBe(
        "failed",
      );
    },
  );
  it("preserves a durable queued attempt when the host enqueue fails", async () => {
    const f = await fixture({
      inlineValidationOperationLimit: 0,
      enqueueValidation: () => Promise.reject(new Error("private queue detail")),
    });
    const draft = await f.service.create({ actor: f.actor, command: await command() });
    const result = await f.service.validate({
      actor: f.actor,
      id: draft.id,
      command: validationCommand(),
    });
    expect(result.state).toBe("validating");
    const attempt = await oneAttempt(f);
    expect(attempt.state).toBe("queued");
    await f.service.reconcileValidations({ siteId, limit: 1 });
    expect((await oneAttempt(f)).state).toBe("ready");
  });
  it("stale generation jobs do not overwrite a newer parent", async () => {
    const f = await fixture({ inlineValidationOperationLimit: 0 });
    const draft = await f.service.create({ actor: f.actor, command: await command() });
    await f.service.validate({ actor: f.actor, id: draft.id, command: validationCommand() });
    const attempt = await oneAttempt(f);
    await f.db
      .update(npAgentChangesets)
      .set({ validationGeneration: 2, draftVersion: 2 })
      .where(eq(npAgentChangesets.id, draft.id));
    await f.service.processValidation({ siteId, attemptId: attempt.id });
    expect((await f.db.select().from(npAgentChangesets))[0]).toMatchObject({
      validationGeneration: 2,
      draftVersion: 2,
      state: "validating",
      planHash: null,
    });
    expect(await f.db.select().from(postsTable)).toEqual([]);
  });
  it("fails closed when persisted proposal hash no longer matches admitted contents", async () => {
    const f = await fixture({ inlineValidationOperationLimit: 0 });
    const draft = await f.service.create({ actor: f.actor, command: await command() });
    await f.service.validate({ actor: f.actor, id: draft.id, command: validationCommand() });
    const attempt = await oneAttempt(f);
    await f.db
      .update(npAgentChangesets)
      .set({ title: "Mutated after admission" })
      .where(eq(npAgentChangesets.id, draft.id));
    await f.service.processValidation({ siteId, attemptId: attempt.id });
    expect((await oneAttempt(f)).state).toBe("failed");
    expect((await f.db.select().from(npAgentChangesets))[0]!.planHash).toBeNull();
    expect(await f.db.select().from(postsTable)).toEqual([]);
  });
  it("rechecks target visibility before a queued validation reads evidence", async () => {
    const f = await fixture({ inlineValidationOperationLimit: 0 });
    const draft = await f.service.create({ actor: f.actor, command: await command() });
    await f.service.validate({ actor: f.actor, id: draft.id, command: validationCommand() });
    const attempt = await oneAttempt(f);
    const original = getCollectionConfig("posts");
    registerCollection("posts", getCollectionTable("posts"), {
      ...original,
      access: { ...original.access, read: () => false },
    });
    await f.service.processValidation({ siteId, attemptId: attempt.id });
    expect(await oneAttempt(f)).toMatchObject({ state: "failed", errorCode: "AUTHORITY_REVOKED" });
    expect((await f.db.select().from(npAgentChangesets))[0]!.sealedPlanBody).toBeNull();
  });
  it("does not grant validation to a write-only principal", async () => {
    const f = await fixture();
    const p = await principalFixture(f, true);
    const draft = await p.service.create({ actor: p.actor, command: await command() });
    await expect(
      p.service.validate({ actor: p.actor, id: draft.id, command: validationCommand() }),
    ).rejects.toThrow();
    expect(await f.db.select().from(npAgentChangesetValidationAttempts)).toEqual([]);
  });
  it("resolves the current service family head after a token rotation", async () => {
    const f = await fixture();
    const p = await principalFixture(f, false, { inlineValidationOperationLimit: 0 });
    const draft = await p.service.create({ actor: p.actor, command: await command() });
    await p.service.validate({ actor: p.actor, id: draft.id, command: validationCommand() });
    const attempt = await oneAttempt(f);
    await p.gateway.executeAdmin({
      siteId,
      actor: f.actor.actor,
      operationId: "agents.gateway.principal_tokens.rotate",
      parentTargetId: p.principal.resourceId,
      targetId: p.token.resourceId,
      command: { idempotencyKey: randomUUID(), expectedVersion: 1, overlapSeconds: 900 },
    });
    await p.service.processValidation({ siteId, attemptId: attempt.id });
    expect((await oneAttempt(f)).state).toBe("ready");
    expect((await f.db.select().from(npAgentChangesets))[0]!.planHash).not.toBeNull();
  });
  it("fails queued principal work when its current transport audience changes", async () => {
    const f = await fixture();
    let audience = "urn:nexpress:agent-gateway:stdio";
    const p = await principalFixture(f, false, {
      inlineValidationOperationLimit: 0,
      gateway: { getTransportAudience: async () => audience },
    });
    const draft = await p.service.create({ actor: p.actor, command: await command() });
    await p.service.validate({ actor: p.actor, id: draft.id, command: validationCommand() });
    const attempt = await oneAttempt(f);
    audience = "https://other.example/api/agent/v1";
    await p.service.processValidation({ siteId, attemptId: attempt.id });
    expect(await oneAttempt(f)).toMatchObject({ state: "failed", errorCode: "AUTHORITY_REVOKED" });
    expect((await f.db.select().from(npAgentChangesets))[0]!.planHash).toBeNull();
  });
  it("returns safe invalid evidence when an existing document base changes", async () => {
    const f = await fixture();
    const saved = await withCurrentSite(siteId, () =>
      saveDocument(
        "posts",
        null,
        { title: "Original", content: npCreateEmptyRichTextContent() },
        f.actor.actor.user,
        { status: "draft" },
      ),
    );
    const documentId = String(saved.doc.id);
    const operation: NpAgentChangeSetOperationInput = {
      kind: "document",
      operation: "update",
      clientOperationId: "update-post",
      reason: null,
      resource: { collection: "posts", documentId },
      base: { version: "placeholder", digest },
      input: { patch: { title: "Proposed" }, targetStatus: null },
    };
    const bases = createAgentChangeSetValidationResourceServiceV1();
    const observed = await f.db.transaction((tx) =>
      bases.readBase({
        tx,
        siteId,
        user: f.actor.actor.user,
        changeSetId: randomUUID(),
        ordinal: 1,
        operation,
        canonicalResourceKey: { kind: "document", collection: "posts", documentId },
      }),
    );
    operation.base = observed.base!;
    const draftInput = { title: "Update proposal", summary: null, operations: [operation] };
    const draft = await f.service.create({ actor: f.actor, command: await command(draftInput) });
    await withCurrentSite(siteId, () =>
      saveDocument(
        "posts",
        documentId,
        { title: "Changed independently", content: npCreateEmptyRichTextContent() },
        f.actor.actor.user,
        { status: "draft" },
      ),
    );
    const revisionsBefore = await f.db.select().from(npRevisions);
    const invalid = await f.service.validate({
      actor: f.actor,
      id: draft.id,
      command: validationCommand(),
    });
    expect(invalid.state).toBe("invalid");
    expect(invalid.validation?.state).toBe("invalid");
    expect(
      invalid.operations
        .flatMap((operation) => operation.issues)
        .some((issue) => issue.code === "BASE_CONFLICT"),
    ).toBe(true);
    expect((await f.db.select().from(npAgentChangesets))[0]!.planHash).toBeNull();
    expect(await f.db.select().from(npRevisions)).toHaveLength(revisionsBefore.length);
    expect((await f.db.select().from(postsTable))[0]!.title).toBe("Changed independently");
    await f.db.update(npAgentChangesetValidationAttempts).set({ resultDigest: digest });
    await expect(f.service.get({ actor: f.actor, id: draft.id })).rejects.toMatchObject({
      status: 404,
      code: "CHANGESET_NOT_FOUND",
    });
  });
  it.each(["plan", "snapshot", "result"])(
    "does not project ready evidence after %s tampering",
    async (target) => {
      const f = await fixture();
      const draft = await f.service.create({ actor: f.actor, command: await command() });
      await f.service.validate({ actor: f.actor, id: draft.id, command: validationCommand() });
      if (target === "plan")
        await f.db
          .update(npAgentChangesets)
          .set({ planHash: digest })
          .where(eq(npAgentChangesets.id, draft.id));
      else if (target === "snapshot") {
        const [operation] = await f.db.select().from(npAgentChangesetOperations);
        await f.db
          .update(npAgentChangesetOperations)
          .set({ beforeSnapshot: { ...operation!.beforeSnapshot!, value: { unexpected: true } } })
          .where(eq(npAgentChangesetOperations.id, operation!.id));
      } else await f.db.update(npAgentChangesetValidationAttempts).set({ resultDigest: digest });
      await expect(f.service.get({ actor: f.actor, id: draft.id })).rejects.toMatchObject({
        status: 404,
        code: "CHANGESET_NOT_FOUND",
      });
      expect((await f.service.list({ actor: f.actor })).items).toEqual([]);
      expect(await f.db.select().from(postsTable)).toEqual([]);
    },
  );
  it.each([false, true])(
    "rechecks a real OAuth grant for queued validation (revoked=%s)",
    async (revoked) => {
      const f = await fixture();
      const p = await oauthFixture(f);
      const draft = await p.service.create({ actor: p.actor, command: await command() });
      await p.service.validate({ actor: p.actor, id: draft.id, command: validationCommand() });
      const attempt = await oneAttempt(f);
      expect(attempt.authorityRef.kind).toBe("oauth-grant");
      if (revoked)
        await p.oauth.revokeToken({ siteId, clientId: p.clientId, token: p.tokens.refresh_token });
      await p.service.processValidation({ siteId, attemptId: attempt.id });
      expect((await oneAttempt(f)).state).toBe(revoked ? "failed" : "ready");
      if (revoked) expect((await oneAttempt(f)).errorCode).toBe("AUTHORITY_REVOKED");
      const [row] = await f.db.select().from(npAgentChangesets);
      expect(row!.planHash === null).toBe(revoked);
      expect(await f.db.select().from(postsTable)).toEqual([]);
      expect(await f.db.select().from(npAgentApprovals)).toEqual([]);
    },
  );
  it("expires ready plans while preserving their immutable sealed evidence", async () => {
    let clock = new Date();
    const f = await fixture({ now: () => clock, eligibilitySeconds: 120 });
    const draft = await f.service.create({ actor: f.actor, command: await command() });
    const ready = await f.service.validate({
      actor: f.actor,
      id: draft.id,
      command: validationCommand(),
    });
    expect(ready.state).toBe("ready");
    const [before] = await f.db.select().from(npAgentChangesets);
    clock = new Date(before!.expiresAt.getTime() + 1);
    expect(await f.service.reconcileExpired({ siteId, limit: 1 })).toMatchObject({ cancelled: 1 });
    const cancelled = await f.service.get({ actor: f.actor, id: draft.id });
    expect(cancelled.state).toBe("cancelled");
    expect(cancelled.planHash).toBe(ready.planHash);
    expect(cancelled.validation?.state).toBe("valid");
    const [after] = await f.db.select().from(npAgentChangesets);
    expect(after!.sealedPlanBody).toEqual(before!.sealedPlanBody);
    expect(await npDigestAgentChangeSetPlanCanonical(after!.sealedPlanBody!)).toBe(ready.planHash);
    expect(after!.cancellationCode).toBe("CHANGESET_EXPIRED");
    expect(await f.db.select().from(postsTable)).toEqual([]);
  });
});
