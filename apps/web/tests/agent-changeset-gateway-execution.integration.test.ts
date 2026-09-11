import { randomUUID } from "node:crypto";
import {
  getCollectionConfig,
  getCollectionTable,
  registerCollection,
} from "../../../packages/core/src/collections/registry.js";
import {
  saveDocument,
  type NpTransaction,
} from "../../../packages/core/src/collections/pipeline.js";
import { npCreateEmptyRichTextContent } from "../../../packages/core/src/fields/rich-text.js";
import { withCurrentSite } from "../../../packages/core/src/sites/context.js";
import { createAgentChangeSetValidationResourceServiceV1 } from "../../../packages/core/src/agent/changeset-validation-resources.js";
import {
  npRequireAgentRunLimitsCanonical,
  npDigestAgentRunLimitsCanonical,
} from "../../../packages/core/src/agent-contract/canonical-bodies.js";
import {
  npRequireAgentBudgetSnapshotCanonical,
  npDigestAgentBudgetSnapshotCanonical,
} from "../../../packages/core/src/agent-contract/canonical-budget-snapshot.js";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  npAgentPrincipals,
  npAgentServiceTokens,
  npAgentInvocations,
  npAgentRuns,
  npAgentActions,
  npAgentChangesetExecutions,
} from "../../../packages/core/src/db/schema/agent.js";
import { npRequireAgentChangeSetExecutionOutputV1 } from "../../../packages/core/src/agent-contract/installed-capability-contract.js";
import {
  gatewayExecutionFixture as gatewayFixture,
  gatewayExecutionRequest as request,
  invokeGatewayExecution as invoke,
  readyGatewayExecution as ready,
  approveGatewayExecution as approve,
} from "./agent-changeset-gateway-execution-fixture.js";
import { command, draft, oauthFixture, siteId } from "./agent-changeset-fixture.js";
import {
  ensureMigrated,
  truncateAll,
  registerTestCollections,
  closeTestDb,
  skipIfNoTestDb,
} from "./harness.js";

describe.skipIf(skipIfNoTestDb())("Gateway approved ChangeSet execution", () => {
  beforeAll(ensureMigrated);
  beforeEach(async () => {
    await truncateAll();
    registerTestCollections();
  });
  afterAll(closeTestDb);

  it.each(["apply", "schedule"] as const)(
    "requests human approval then executes %s under a new invocation key",
    async (operation) => {
      const f = await gatewayFixture("approved-execute", operation);
      const plan = await ready(f);
      const input = {
        changeSetId: plan.id,
        planHash: plan.planHash,
        approvalId: null,
        ...(operation === "schedule" ? { scheduledFor: f.executionCommand.scheduledFor } : {}),
      };
      const firstRequest = request(
        `changeset.${operation}`,
        input,
        "gateway-long-key-" + "x".repeat(200),
      );
      const required = await invoke(f, firstRequest);
      expect(required.output.state).toBe("approval_required");
      if (required.output.state !== "approval_required")
        throw new Error("Expected approval result");
      expect(required.output.approvalResource).toBe(
        `/admin/agents/approvals/${required.output.approvalId}`,
      );
      expect((await invoke(f, firstRequest)).invocationId).toBe(required.invocationId);
      expect(await f.seo()).toBeUndefined();
      const [run] = await f.db
        .select()
        .from(npAgentRuns)
        .where(eq(npAgentRuns.id, required.output.runId));
      const [action] = await f.db
        .select()
        .from(npAgentActions)
        .where(eq(npAgentActions.id, required.output.actionId));
      expect(run).toMatchObject({
        origin: "gateway",
        siteId,
        agentId: null,
        agentVersionId: null,
        usage: { providerCalls: 0, inputTokens: 0, outputTokens: 0, costMicros: 0 },
      });
      expect(npRequireAgentRunLimitsCanonical(run.runLimits)).toEqual(run.runLimits);
      expect(await npDigestAgentRunLimitsCanonical(run.runLimits)).toBe(run.runLimitsHash);
      const budget = npRequireAgentBudgetSnapshotCanonical(run.budgetSnapshot);
      expect(await npDigestAgentBudgetSnapshotCanonical(budget)).toBe(run.budgetSnapshotHash);
      expect(() =>
        npRequireAgentBudgetSnapshotCanonical({ ...budget, providerToken: "private" }),
      ).toThrow();
      expect(action).toMatchObject({ siteId, runId: required.output.runId });
      const [requestInvocation] = await f.db
        .select()
        .from(npAgentInvocations)
        .where(eq(npAgentInvocations.id, required.invocationId));
      for (const evidence of [requestInvocation, action]) {
        expect(evidence.effectProfileId).toBe("domain.read");
        expect(
          evidence.capabilityDefinitionBody!.capabilities[0].effectProfiles.map(
            (profile) => profile.profileId,
          ),
        ).toContain(evidence.effectProfileId);
      }
      await approve(f, required.output.approvalId);
      const executeInput = { ...input, approvalId: required.output.approvalId };
      await expect(
        invoke(
          f,
          request(`changeset.${operation}`, executeInput, firstRequest.arguments.idempotencyKey!),
        ),
      ).rejects.toThrow();
      const execute = request(`changeset.${operation}`, executeInput);
      const admitted = await f.principal.admission.invoke({
        authentication: f.principal.authentication,
        request: execute,
      });
      expect(admitted.invocationId).not.toBe(required.invocationId);
      const [executionInvocation] = await f.db
        .select()
        .from(npAgentInvocations)
        .where(eq(npAgentInvocations.id, admitted.invocationId));
      expect(executionInvocation.effectProfileId).toBe(`changeset.${operation}`);
      expect(
        executionInvocation.capabilityDefinitionBody!.capabilities[0].effectProfiles.map(
          (profile) => profile.profileId,
        ),
      ).toContain(executionInvocation.effectProfileId);
      expect(npRequireAgentChangeSetExecutionOutputV1(admitted.output).runId).not.toBe(
        required.output.runId,
      );
      if (operation === "schedule") {
        expect(await f.seo()).toBeUndefined();
        f.advance(121);
      }
      for (const job of f.applyJobs) await f.service.processExecution(job);
      expect((await f.seo())?.value).toMatchObject({ twitterHandle: "gateway" });
      expect(
        await f.db
          .select()
          .from(npAgentChangesetExecutions)
          .where(eq(npAgentChangesetExecutions.changesetId, plan.id)),
      ).toHaveLength(1);
      const replay = await invoke(f, execute);
      expect(replay.invocationId).toBe(admitted.invocationId);
    },
    90_000,
  );

  it("runs all rollback modes with a separately approved compensation target", async () => {
    const f = await gatewayFixture();
    await invoke(
      f,
      request("changeset.apply", {
        changeSetId: f.id,
        planHash: f.executionCommand.planHash,
        approvalId: f.approved.item.approval.id,
      }),
    );
    for (const job of f.applyJobs) await f.service.processExecution(job);
    expect(await f.seo()).toBeDefined();
    const prepared = await invoke(
      f,
      request("changeset.rollback", { mode: "prepare", changeSetId: f.id }),
    );
    const rollback = prepared.output.changeSet.rollback;
    expect(rollback?.state).toBe("ready");
    if (!rollback?.planHash) throw new Error("Expected prepared rollback");
    const target = {
      changeSetId: f.id,
      rollbackPlanId: rollback.rollbackPlanId,
      planHash: rollback.planHash,
    };
    const required = await invoke(
      f,
      request("changeset.rollback", { mode: "request_approval", ...target }),
    );
    if (required.output.state !== "approval_required")
      throw new Error("Expected rollback approval");
    expect(required.output.proposalHash).toBe(rollback.planHash);
    await approve(f, required.output.approvalId);
    const executed = await invoke(
      f,
      request("changeset.rollback", {
        mode: "execute_approved",
        ...target,
        approvalId: required.output.approvalId,
      }),
    );
    expect(executed.output.changeSet.rollback?.state).toBe("verified");
    expect(await f.seo()).toBeUndefined();
  }, 90_000);

  it("allows proposals but refuses approved execution at propose exposure", async () => {
    const f = await gatewayFixture("propose");
    const plan = await ready(f);
    const proposal = await invoke(
      f,
      request("changeset.apply", {
        changeSetId: plan.id,
        planHash: plan.planHash,
        approvalId: null,
      }),
    );
    expect(proposal.output.state).toBe("approval_required");
    if (proposal.output.state !== "approval_required") throw new Error("Expected proposal");
    await approve(f, proposal.output.approvalId);
    await expect(
      invoke(
        f,
        request("changeset.apply", {
          changeSetId: plan.id,
          planHash: plan.planHash,
          approvalId: proposal.output.approvalId,
        }),
      ),
    ).rejects.toThrow();
    expect(await f.seo()).toBeUndefined();
  }, 90_000);

  it.each(["revocation", "token-version", "audience", "scope", "site", "exposure"] as const)(
    "rejects %s drift before accepting an effect",
    async (mode) => {
      const f = await gatewayFixture();
      if (mode === "revocation")
        await f.db.update(npAgentServiceTokens).set({ status: "revoked", revokedAt: new Date() });
      if (mode === "token-version") await f.db.update(npAgentPrincipals).set({ tokenVersion: 2 });
      if (mode === "audience")
        await f.db
          .update(npAgentServiceTokens)
          .set({ audience: "urn:nexpress:agent-gateway:other" });
      if (mode === "scope")
        await f.db.update(npAgentServiceTokens).set({ scopes: ["changeset:read", "site:read"] });
      if (mode === "exposure") f.principal.gatewaySettings.stdio = "propose";
      const req = request("changeset.apply", {
        changeSetId:
          mode === "site"
            ? (
                await f.service.create({
                  actor: { ...f.actor, siteId: "draft-other" },
                  command: await command(draft()),
                })
              ).id
            : f.id,
        planHash: f.executionCommand.planHash,
        approvalId: f.approved.item.approval.id,
      });
      const before = await f.db
        .select()
        .from(npAgentInvocations)
        .where(
          and(
            eq(npAgentInvocations.operationId, "changeset.apply"),
            eq(npAgentInvocations.siteId, siteId),
          ),
        );
      await expect(invoke(f, req)).rejects.toThrow();
      expect(await f.db.select().from(npAgentChangesetExecutions)).toHaveLength(0);
      expect(
        await f.db
          .select()
          .from(npAgentInvocations)
          .where(
            and(
              eq(npAgentInvocations.operationId, "changeset.apply"),
              eq(npAgentInvocations.siteId, siteId),
            ),
          ),
      ).toHaveLength(before.length);
      expect(await f.seo()).toBeUndefined();
    },
    90_000,
  );

  it.each(["agent-http", "mcp-http"] as const)(
    "never reuses a real %s service credential across HTTP audiences",
    async (transport) => {
      const f = await gatewayFixture("approved-execute", "apply", { transport });
      Object.assign(f.principal.gatewaySettings, {
        agentHttp: "approved-execute",
        mcpHttp: "approved-execute",
      });
      const audience =
        transport === "agent-http"
          ? "https://site.example/api/agent/v1"
          : "https://site.example/api/mcp";
      const credential = f.principal.token.oneTimeValue;
      const auth = await f.principal.gateway.authenticateServiceToken({
        siteId,
        credential,
        transport,
        audience,
      });
      expect(auth.principal.id).toBe(f.principal.authentication.principal.id);
      const other = transport === "agent-http" ? "mcp-http" : "agent-http";
      for (const presented of [
        {
          transport: other,
          audience:
            other === "agent-http"
              ? "https://site.example/api/agent/v1"
              : "https://site.example/api/mcp",
          siteId,
        },
        { transport, audience: "https://other.example/api/agent/v1", siteId },
        { transport, audience, siteId: "draft-other" },
        { transport: "stdio" as const, audience: "urn:nexpress:agent-gateway:stdio", siteId },
      ] as const)
        await expect(
          f.principal.gateway.authenticateServiceToken({ credential, ...presented }),
        ).rejects.toThrow();
      const oauth = await oauthFixture(f);
      await expect(
        f.principal.gateway.authenticateServiceToken({
          siteId,
          credential: oauth.tokens.access_token,
          transport,
          audience,
        }),
      ).rejects.toThrow();
      await expect(
        oauth.oauth.authenticateRemoteBearer({ siteId, authorization: `Bearer ${credential}` }),
      ).rejects.toThrow();
      expect(await f.db.select().from(npAgentChangesetExecutions)).toHaveLength(0);
      expect(await f.seo()).toBeUndefined();
    },
    90_000,
  );
  it("persists a safe invalid rollback preparation and a real terminal Gateway run when the prior schema no longer accepts restoration", async () => {
    const f = await gatewayFixture("approved-execute", "apply", undefined, {
      draftInput: async (seed) => {
        const document = await withCurrentSite(siteId, () =>
          saveDocument(
            "posts",
            null,
            { title: "Long prior title", content: npCreateEmptyRichTextContent() },
            seed.actor.actor.user,
            { status: "draft" },
          ),
        );
        const documentId = String(document.doc.id);
        const proposal = {
          ordinal: 1,
          canonicalResourceKey: { kind: "document" as const, collection: "posts", documentId },
          operation: {
            kind: "document" as const,
            operation: "update" as const,
            resource: { collection: "posts", documentId },
            clientOperationId: "update",
            reason: null,
            base: { version: "pending", digest: `cj1:sha256:${"A".repeat(43)}` },
            input: { patch: { title: "After" }, targetStatus: null },
          },
        };
        const current = await seed.db.transaction((tx) =>
          createAgentChangeSetValidationResourceServiceV1().readBase({
            tx: tx as unknown as NpTransaction,
            siteId,
            user: seed.actor.actor.user,
            changeSetId: randomUUID(),
            ...proposal,
          }),
        );
        if (!current.base) throw new Error("Expected existing document base");
        return {
          title: "Gateway prior restoration",
          summary: null,
          operations: [{ ...proposal.operation, base: current.base }],
        };
      },
    });
    await invoke(
      f,
      request("changeset.apply", {
        changeSetId: f.id,
        planHash: f.executionCommand.planHash,
        approvalId: f.approved.item.approval.id,
      }),
    );
    for (const job of f.applyJobs) await f.service.processExecution(job);
    const config = getCollectionConfig("posts");
    registerCollection("posts", getCollectionTable("posts"), {
      ...config,
      fields: config.fields.map((field) =>
        "name" in field && field.name === "title" && field.type === "text"
          ? { ...field, maxLength: 6 }
          : field,
      ),
    });
    const prepared = await invoke(
      f,
      request("changeset.rollback", { mode: "prepare", changeSetId: f.id }),
    );
    expect(prepared.output.state).toBe("completed");
    expect(prepared.output.changeSet.rollback?.state).toBe("invalid");
    const [run] = await f.db
      .select()
      .from(npAgentRuns)
      .where(eq(npAgentRuns.id, prepared.output.runId));
    expect(run).toMatchObject({ origin: "gateway", state: "succeeded" });
    expect(await f.db.select().from(npAgentChangesetExecutions)).toHaveLength(1);
  }, 90_000);
});
