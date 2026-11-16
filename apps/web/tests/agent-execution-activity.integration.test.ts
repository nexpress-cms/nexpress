import { randomUUID } from "node:crypto";
import { createSite, grantSiteMembership } from "@nexpress/core";
import { eq } from "drizzle-orm";
import { beforeAll, beforeEach, afterAll, describe, it, expect } from "vitest";
import { createAgentActivityServiceV1 } from "../../../packages/core/src/agent/activity-service.js";
import { createAgentMcpGatewayV1 } from "../../../packages/core/src/agent/mcp-gateway.js";
import { npCollectAgentHealthSummaryV1 } from "../../../packages/core/src/agent/contract-diagnostics.js";
import { npAgentActions } from "../../../packages/core/src/db/schema/agent.js";
import {
  gatewayExecutionEnvironmentFixture,
  readyGatewayExecution,
  gatewayExecutionRequest,
  invokeGatewayExecution,
  approveGatewayExecution,
} from "./agent-changeset-gateway-execution-fixture.js";
import { siteId } from "./agent-changeset-fixture.js";
import { decideApproval } from "./agent-changeset-execution-fixture.js";
import {
  ensureMigrated,
  truncateAll,
  registerTestCollections,
  closeTestDb,
  skipIfNoTestDb,
} from "./harness.js";

async function fixture() {
  const f = await gatewayExecutionEnvironmentFixture();
  const plan = await readyGatewayExecution(f);
  const result = await invokeGatewayExecution(
    f,
    gatewayExecutionRequest("changeset.apply", {
      changeSetId: plan.id,
      planHash: plan.planHash,
      approvalId: null,
    }),
  );
  const [action] = await f.db
    .select()
    .from(npAgentActions)
    .where(eq(npAgentActions.invocationId, result.invocationId));
  if (!action?.runId) throw new Error("Expected a real Gateway run/action");
  const activity = createAgentActivityServiceV1({
    cursorHmacKey: new Uint8Array(32).fill(49),
    admission: f.principal.admission,
    changesets: f.service,
  });
  return { ...f, plan, result, action, activity, read: { siteId, actor: f.actor.actor } };
}

describe.skipIf(skipIfNoTestDb())("Gateway execution Activity item authority", () => {
  beforeAll(ensureMigrated);
  beforeEach(async () => {
    await truncateAll();
    registerTestCollections();
  });
  afterAll(closeTestDb);

  it("shows real setting targets through current ChangeSet authority without canonical input", async () => {
    const f = await fixture();
    const detail = await f.activity.getAction({ ...f.read, id: f.action.id });
    expect(detail.action.targetRefs).toEqual([{ kind: "setting", key: "seo" }]);
    expect(detail.action.inputRedacted).toEqual({});
    expect(detail).not.toHaveProperty("inputCanonical");
    expect((await f.activity.getRun({ ...f.read, id: f.action.runId! })).run.origin).toBe(
      "gateway",
    );
    expect(
      (await f.activity.listActions(f.read)).items.some((item) => item.action.id === f.action.id),
    ).toBe(true);
    const mcp = createAgentMcpGatewayV1({
      admission: f.principal.admission,
      runs: f.activity,
      cursorKey: { id: "activity-run", key: new Uint8Array(32).fill(51) },
    });
    const uri = `nexpress://site/${siteId}/runs/${f.action.runId!}`;
    const resource = await mcp.readResource(f.principal.authentication, uri);
    expect(JSON.parse(resource.contents[0].text)).toEqual(
      await f.activity.getMachineRun({
        authentication: f.principal.authentication,
        runId: f.action.runId!,
      }),
    );
    for (const missingUri of [
      `nexpress://site/foreign/runs/${f.action.runId!}`,
      `nexpress://site/${siteId}/runs/${randomUUID()}`,
    ])
      await expect(mcp.readResource(f.principal.authentication, missingUri)).rejects.toMatchObject({
        mcpCode: -32602,
        message: "Invalid params",
      });
    if (f.result.output.state !== "approval_required" || !f.result.output.approvalId)
      throw new Error("Expected approval request");
    const approvalId = f.result.output.approvalId;
    expect(await f.activity.getRun({ ...f.read, id: f.action.runId! })).toMatchObject({
      related: { approvalIds: [approvalId], changeSetIds: [f.plan.id], incidentIds: [] },
    });
    const withoutApprovalAccess = createAgentActivityServiceV1({
      cursorHmacKey: new Uint8Array(32).fill(50),
      changesets: f.service,
      approvals: {
        get: async () => {
          throw new Error("Approval unavailable");
        },
      },
    });
    expect(await withoutApprovalAccess.getRun({ ...f.read, id: f.action.runId! })).toMatchObject({
      related: { approvalIds: [], changeSetIds: [f.plan.id] },
    });
    const list = (query: unknown) => f.activity.listRuns({ ...f.read, query });
    const first = await list({ approvalId, limit: 1 });
    expect(first.items.map(({ run }) => run.id)).toEqual([f.action.runId]);
    expect(first.nextCursor).toBeTruthy();
    await expect(
      list({ approvalId, changeSetId: f.plan.id, limit: 1, cursor: first.nextCursor }),
    ).rejects.toMatchObject({ code: "ACTIVITY_CURSOR_INVALID" });
    const approved = await approveGatewayExecution(f, approvalId);
    expect((await f.activity.getRun({ ...f.read, id: f.action.runId! })).run.state).toBe(
      "succeeded",
    );
    expect(await f.seo()).toBeUndefined();
    await decideApproval(f.service.approvals!, f.actor, approved, "revoke");
    const next = await invokeGatewayExecution(
      f,
      gatewayExecutionRequest("changeset.apply", {
        changeSetId: f.plan.id,
        planHash: f.plan.planHash,
        approvalId: null,
      }),
    );
    if (next.output.state !== "approval_required") throw new Error("Expected another approval");
    expect(next.output.approvalId).not.toBe(approvalId);
    expect((await list({ approvalId })).items.map(({ run }) => run.id)).toEqual([f.action.runId]);
    expect(
      (await list({ approvalId: next.output.approvalId })).items.map(({ run }) => run.id),
    ).toEqual([next.output.runId]);
    expect(
      new Set((await list({ changeSetId: f.plan.id })).items.map(({ run }) => run.id)),
    ).toEqual(new Set([f.action.runId, next.output.runId]));
    const otherSite = "other-activity-site";
    await createSite({ id: otherSite, name: "Other Activity site" });
    await grantSiteMembership(otherSite, f.read.actor.user.id, "admin");
    expect(
      (
        await f.activity.listRuns({
          ...f.read,
          siteId: otherSite,
          query: { approvalId, changeSetId: f.plan.id },
        })
      ).items,
    ).toEqual([]);
  }, 90_000);

  it("hides existing runs and actions when the shared item authority is absent or denies access", async () => {
    const f = await fixture();
    for (const changesets of [
      undefined,
      {
        get: () => Promise.reject(new Error("Private resource detail")),
      },
    ]) {
      const activity = createAgentActivityServiceV1({
        cursorHmacKey: new Uint8Array(32).fill(50),
        changesets,
      });
      for (const id of [f.action.id, randomUUID()])
        await expect(activity.getAction({ ...f.read, id })).rejects.toMatchObject({
          code: "ACTIVITY_NOT_FOUND",
          status: 404,
          message: "Activity is unavailable.",
        });
      await expect(activity.getRun({ ...f.read, id: f.action.runId! })).rejects.toMatchObject({
        code: "ACTIVITY_NOT_FOUND",
        status: 404,
      });
      expect((await activity.listActions(f.read)).items).toEqual([]);
      expect(
        (await activity.listRuns({ ...f.read, query: { changeSetId: f.plan.id } })).items,
      ).toEqual([]);
    }
  }, 90_000);

  it("rejects each tampered link and exposes only aggregate diagnostics", async () => {
    const f = await fixture();
    const original = {
      inputCanonical: f.action.inputCanonical,
      invocationFingerprint: f.action.invocationFingerprint,
      runFingerprint: f.action.runFingerprint,
      targetRefs: f.action.targetRefs,
    };
    for (const kind of ["input", "invocation", "run", "targets"] as const) {
      // Each mutation starts from real, currently readable Gateway evidence.
      expect((await f.activity.getAction({ ...f.read, id: f.action.id })).action.id, kind).toBe(
        f.action.id,
      );
      const digest = `cj1:sha256:${"Z".repeat(43)}`;
      const patch =
        kind === "input"
          ? { inputCanonical: { ...f.action.inputCanonical, changeSetId: randomUUID() } }
          : kind === "invocation"
            ? { invocationFingerprint: digest }
            : kind === "run"
              ? { runFingerprint: digest }
              : { targetRefs: [{ kind: "navigation" as const, location: "primary" }] };
      await f.db.update(npAgentActions).set(patch).where(eq(npAgentActions.id, f.action.id));
      try {
        await expect(
          f.activity.getAction({ ...f.read, id: f.action.id }),
          kind,
        ).rejects.toMatchObject({
          code: "ACTIVITY_NOT_FOUND",
          status: 404,
        });
        await expect(
          f.activity.getRun({ ...f.read, id: f.action.runId! }),
          kind,
        ).rejects.toMatchObject({
          code: "ACTIVITY_NOT_FOUND",
          status: 404,
        });
        expect((await f.activity.listActions(f.read)).items, kind).toEqual([]);
        if (kind !== "targets") {
          const summary = await npCollectAgentHealthSummaryV1();
          expect(summary.issues.some((issue) => issue.code === "AGENT_EXECUTION_DIVERGED")).toBe(
            true,
          );
          expect(JSON.stringify(summary)).not.toContain(f.action.id);
          expect(JSON.stringify(summary)).not.toContain(f.plan.id);
        }
      } finally {
        await f.db.update(npAgentActions).set(original).where(eq(npAgentActions.id, f.action.id));
      }
      expect(
        (await f.db.select().from(npAgentActions).where(eq(npAgentActions.id, f.action.id)))[0],
        kind,
      ).toEqual(f.action);
    }
  }, 90_000);
});
