import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { npMedia, npMediaRefs, npNavigation, npRevisions, npSettings } from "@nexpress/core";
import { npAuditEvents } from "../../../packages/core/src/db/schema/community.js";
import {
  npAgentApprovals,
  npAgentChangesets,
  npAgentChangesetExecutions,
  npAgentChangesetOperations,
} from "../../../packages/core/src/db/schema/agent.js";
import { postsTable } from "../src/db/generated/collections.js";
import type { NpTransaction } from "../../../packages/core/src/collections/pipeline.js";
import { createAgentChangeSetValidationResourceServiceV1 } from "../../../packages/core/src/agent/changeset-validation-resources.js";
import type { NpAgentChangeSetDraftInputV1 } from "../../../packages/core/src/agent-contract/changeset-wire-contract.js";
import { command, draft, siteId } from "./agent-changeset-fixture.js";
import { decideApproval, executionFixture } from "./agent-changeset-execution-fixture.js";
import {
  closeTestDb,
  ensureMigrated,
  registerTestCollections,
  skipIfNoTestDb,
  truncateAll,
} from "./harness.js";

type Fixture = Awaited<ReturnType<typeof executionFixture>>;
const digest = `cj1:sha256:${"A".repeat(43)}`;

async function approveSecondPlan(f: Fixture) {
  const created = await f.service.create({
    actor: f.actor,
    command: await command({
      title: "Competing SEO",
      summary: null,
      operations: [
        {
          kind: "setting",
          operation: "replace",
          clientOperationId: "seo",
          reason: null,
          resource: { key: "seo" },
          base: null,
          input: {
            value: { defaultOgImage: null, twitterHandle: "competitor", defaultLocale: "en" },
          },
        },
      ],
    }),
  });
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
  await f.service.processPreview({ siteId, previewId: preview.previewId });
  const requested = await f.service.requestApproval({
    actor: f.actor,
    id: created.id,
    command: {
      schemaVersion: "np.agent-changeset-request-approval-input.v1",
      expectedDraftVersion: 1,
      planHash: sealed.planHash,
      intendedOperation: "apply",
      scheduledFor: null,
      idempotencyKey: randomUUID(),
    },
  });
  const approved = await decideApproval(f.service.approvals!, f.actor, requested);
  return {
    id: created.id,
    command: {
      ...f.executionCommand,
      planHash: sealed.planHash,
      approvalId: approved.item.approval.id,
      statementHash: approved.item.statementHash,
      idempotencyKey: randomUUID(),
    },
  };
}

async function resourceFixture(intendedOperation: "apply" | "schedule" = "apply") {
  return executionFixture({
    intendedOperation,
    draftInput: async (seed) => {
      const [media] = await seed.db
        .insert(npMedia)
        .values({
          siteId,
          filename: "acceptance.png",
          originalFilename: "acceptance.png",
          mimeType: "image/png",
          filesize: 1,
          storageKey: "acceptance-object",
          hash: "acceptance-hash",
          status: "ready",
        })
        .returning({ id: npMedia.id });
      await seed.db.insert(npNavigation).values({ siteId, location: "main", items: [] });
      const navigation = {
        kind: "navigation" as const,
        operation: "replace" as const,
        clientOperationId: "nav",
        reason: null,
        resource: { location: "main" },
        base: { version: "pending", digest },
        input: { items: [{ id: "home", type: "link" as const, label: "Home", url: "/" }] },
      };
      const current = await seed.db.transaction((tx) =>
        createAgentChangeSetValidationResourceServiceV1().readBase({
          tx: tx as unknown as NpTransaction,
          siteId,
          user: seed.actor.actor.user,
          changeSetId: randomUUID(),
          ordinal: 2,
          canonicalResourceKey: { kind: "navigation", location: "main" },
          operation: navigation,
        }),
      );
      if (!current.base) throw new Error("Expected navigation base");
      const proposed = draft();
      const create = proposed.operations[0];
      if (create.kind !== "document" || create.operation !== "create")
        throw new Error("Expected create fixture");
      const value: NpAgentChangeSetDraftInputV1 = {
        title: "Atomic resources",
        summary: null,
        operations: [
          {
            ...create,
            input: {
              ...create.input,
              document: { ...create.input.document, coverImage: media.id },
            },
          },
          { ...navigation, base: current.base },
          {
            kind: "setting",
            operation: "replace",
            clientOperationId: "seo",
            reason: null,
            resource: { key: "seo" },
            base: null,
            input: {
              value: { defaultOgImage: null, twitterHandle: "atomic", defaultLocale: "en" },
            },
          },
        ],
      };
      return value;
    },
  });
}

async function resources(f: Fixture) {
  return {
    documents: await f.db.select().from(postsTable),
    revisions: await f.db.select().from(npRevisions),
    references: await f.db.select().from(npMediaRefs),
    navigation: await f.db.select().from(npNavigation),
    settings: await f.db.select().from(npSettings),
    audits: await f.db.select().from(npAuditEvents),
  };
}

describe.skipIf(skipIfNoTestDb())("R4 literal acceptance regressions", () => {
  beforeAll(ensureMigrated);
  beforeEach(async () => {
    await truncateAll();
    registerTestCollections();
  });
  afterAll(closeTestDb);

  it("commits exactly one of two independently approved plans sharing a base and gives the loser a zero-write conflict", async () => {
    const f = await executionFixture();
    const second = await approveSecondPlan(f);
    expect(second.command.approvalId).not.toBe(f.executionCommand.approvalId);
    const [firstRow, secondRow] = await f.db
      .select()
      .from(npAgentChangesets)
      .orderBy(npAgentChangesets.id);
    // Whole-plan fingerprints include snapshots bound to each distinct ChangeSet id.
    // Compare the actual resource identity and base evidence, not those envelopes.
    const originalOperations = await f.db.select().from(npAgentChangesetOperations);
    expect(originalOperations).toHaveLength(2);
    const baseFacts = originalOperations.map((operation) => ({
      resourceKey: operation.resourceKey,
      base: operation.baseVersion,
      beforeHash: operation.beforeHash,
      presence: operation.beforeSnapshot?.presence,
      value: operation.beforeSnapshot?.value,
    }));
    expect(baseFacts[0]).toEqual(baseFacts[1]);
    expect(baseFacts[0].presence).toBe("absent");
    expect(firstRow.planHash).not.toBe(secondRow.planHash);
    const attempts = await Promise.allSettled([
      f.service.apply({ actor: f.actor, id: f.id, command: f.executionCommand }),
      f.service.apply({ actor: f.actor, id: second.id, command: second.command }),
    ]);
    await f.service.reconcileExecutions({ siteId });
    const executions = await f.db.select().from(npAgentChangesetExecutions);
    const committed = executions.filter((row) => row.committedAt !== null);
    expect(committed).toHaveLength(1);
    const loserId = committed[0].changesetId === f.id ? second.id : f.id;
    const loser = executions.find((row) => row.changesetId === loserId);
    if (loser) {
      expect(loser).toMatchObject({
        state: "failed",
        errorCode: "BASE_CONFLICT",
        resultBody: null,
        resultDigest: null,
      });
    } else {
      const attempt = attempts[loserId === f.id ? 0 : 1];
      expect(attempt.status).toBe("rejected");
      if (attempt.status === "rejected")
        expect(attempt.reason).toMatchObject({ status: 409, code: "CHANGESET_CONFLICT" });
    }
    const operations = await f.db
      .select()
      .from(npAgentChangesetOperations)
      .where(eq(npAgentChangesetOperations.changesetId, loserId));
    expect(
      operations.every(
        (operation) => operation.afterHash === null && operation.resultDigest === null,
      ),
    ).toBe(true);
    expect(
      (await f.db.select().from(npAgentApprovals)).filter((row) => row.state === "consumed"),
    ).toHaveLength(1);
    expect(
      await f.db
        .select()
        .from(npAuditEvents)
        .where(eq(npAuditEvents.action, "agents.changesets.execution_committed")),
    ).toHaveLength(1);
    expect((await f.seo())?.value).toMatchObject({
      twitterHandle: loserId === f.id ? "competitor" : "execution",
    });
  }, 90_000);

  it("rejects an operation changed after human approval without consuming approval or writing content", async () => {
    const f = await executionFixture();
    const [operation] = await f.db
      .select()
      .from(npAgentChangesetOperations)
      .where(eq(npAgentChangesetOperations.changesetId, f.id));
    if (operation.input.kind !== "setting" || operation.input.operation !== "replace")
      throw new Error("Expected setting operation");
    await f.db
      .update(npAgentChangesetOperations)
      .set({
        input: {
          ...operation.input,
          input: {
            value: { defaultOgImage: null, twitterHandle: "tampered", defaultLocale: "en" },
          },
        },
      })
      .where(eq(npAgentChangesetOperations.id, operation.id));
    await expect(
      f.service.apply({ actor: f.actor, id: f.id, command: f.executionCommand }),
    ).rejects.toBeDefined();
    expect(await f.execution()).toBeUndefined();
    expect(await f.seo()).toBeUndefined();
    expect((await f.db.select().from(npAgentApprovals))[0]?.state).not.toBe("consumed");
  }, 90_000);

  it("rejects revoked approval when its already-reserved scheduled apply reaches the transaction", async () => {
    const f = await executionFixture({ intendedOperation: "schedule" });
    await f.service.schedule({ actor: f.actor, id: f.id, command: f.executionCommand });
    await decideApproval(f.service.approvals!, f.actor, f.approved, "revoke");
    f.advance(121);
    await f.service.processExecution(f.applyJobs[0]);
    expect(await f.seo()).toBeUndefined();
    expect((await f.execution())?.committedAt).toBeNull();
    expect((await f.db.select().from(npAgentApprovals))[0]?.state).toBe("revoked");
    expect(
      await f.db
        .select()
        .from(npAuditEvents)
        .where(eq(npAuditEvents.action, "agents.changesets.execution_committed")),
    ).toHaveLength(0);
  }, 90_000);

  it("does not duplicate documents revisions media references or audits when the committed response is lost and the caller retries", async () => {
    const f = await resourceFixture();
    // Simulate a transport losing the response after the real service and PostgreSQL commit.
    const deliver = async () => {
      await f.service.apply({ actor: f.actor, id: f.id, command: f.executionCommand });
      throw new Error("fixture response lost after commit");
    };
    await expect(deliver()).rejects.toThrow("fixture response lost after commit");
    expect((await f.execution())?.committedAt).toBeInstanceOf(Date);
    const committed = await resources(f);
    expect(committed.documents).toHaveLength(1);
    expect(committed.revisions).toHaveLength(1);
    expect(committed.references).toHaveLength(1);
    expect(
      committed.audits.filter((event) => event.action === "agents.changesets.execution_committed"),
    ).toHaveLength(1);
    await f.service.apply({ actor: f.actor, id: f.id, command: f.executionCommand });
    await f.service.reconcileExecutions({ siteId });
    expect(await resources(f)).toEqual(committed);
    expect(await f.db.select().from(npAgentChangesetExecutions)).toHaveLength(1);
    expect((await f.db.select().from(npAgentApprovals))[0]?.state).toBe("consumed");
  }, 90_000);

  it("rolls back every resource revision audit approval consumption and applied state on a late injected PostgreSQL failure", async () => {
    const f = await resourceFixture("schedule");
    await f.service.schedule({ actor: f.actor, id: f.id, command: f.executionCommand });
    const before = await resources(f);
    const [approvalBefore] = await f.db.select().from(npAgentApprovals);
    const [planBefore] = await f.db.select().from(npAgentChangesets);
    const operationsBefore = await f.db.select().from(npAgentChangesetOperations);
    const name = `np_r4_acceptance_${randomUUID().replaceAll("-", "")}`;
    await f.db.execute(
      sql.raw(
        `create function ${name}() returns trigger language plpgsql as $$ begin if new.action = 'agents.changesets.execution_committed' then raise exception 'fixture late transaction failure' using errcode = '40001'; end if; return new; end $$`,
      ),
    );
    try {
      await f.db.execute(
        sql.raw(
          `create trigger ${name} before insert on np_audit_events for each row execute function ${name}()`,
        ),
      );
      f.advance(121);
      await f.service.processExecution(f.applyJobs[0]);
      expect(await resources(f)).toEqual(before);
      expect((await f.db.select().from(npAgentApprovals))[0]).toEqual(approvalBefore);
      expect((await f.db.select().from(npAgentChangesets))[0]).toEqual(planBefore);
      expect(await f.db.select().from(npAgentChangesetOperations)).toEqual(operationsBefore);
      expect(await f.execution()).toMatchObject({
        state: "reserved",
        committedAt: null,
        resultBody: null,
        resultDigest: null,
      });
    } finally {
      await f.db.execute(sql.raw(`drop trigger if exists ${name} on np_audit_events`));
      await f.db.execute(sql.raw(`drop function if exists ${name}()`));
    }
    await f.service.processExecution(f.applyJobs[0]);
    expect((await f.execution())?.committedAt).toBeInstanceOf(Date);
    expect((await f.db.select().from(npAgentApprovals))[0]?.state).toBe("consumed");
    expect(
      await f.db
        .select()
        .from(npAuditEvents)
        .where(
          and(
            eq(npAuditEvents.action, "agents.changesets.execution_committed"),
            eq(npAuditEvents.targetId, f.id),
          ),
        ),
    ).toHaveLength(1);
  }, 90_000);
});
