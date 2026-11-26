import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import pg from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createAgentRuntimeEventServiceV1,
  npPrepareAgentRuntimeEventV1,
  npAssertPreparedAgentRuntimeEventRowV1,
  npRecordAgentRuntimeEventWithControlContextV1,
  npRecordConsumedAgentRuntimeEventWithControlContextV1,
  npRecordFreshConsumedAgentRuntimeEventWithControlContextV1,
} from "../../../packages/core/src/agent/runtime-event-service.js";
import {
  npWithAgentRuntimeControlTransactionV1,
  type NpAgentRuntimeControlContextV1,
} from "../../../packages/core/src/agent/runtime-controls.js";
import { npReadAgentEventRowEvidenceV1 } from "../../../packages/core/src/agent/event-evidence.js";
import { withAgentChangeSetPreview } from "../../../packages/core/src/agent/changeset-preview-overlay.js";
import { previewFixture } from "../../../packages/core/src/agent/changeset-preview-test-fixture.js";
import { npAgentEvents } from "../../../packages/core/src/db/schema/agent.js";
import { npSettings } from "../../../packages/core/src/db/schema/system.js";
import { createSite } from "../../../packages/core/src/sites/registry.js";
import type { NpTransaction } from "../../../packages/core/src/collections/pipeline.js";
import type { NpAgentEventCanonicalV1 } from "../../../packages/core/src/agent-contract/types.js";
import { fixture, siteId } from "./agent-changeset-fixture.js";
import {
  closeTestDb,
  ensureMigrated,
  registerTestCollections,
  skipIfNoTestDb,
  truncateAll,
} from "./harness.js";

async function setup() {
  const f = await fixture();
  const now = () => new Date("2026-10-18T10:00:00.000Z");
  const forbidden = vi.fn(() =>
    Promise.reject(new Error("No admission or provider dispatch permitted")),
  );
  const events = createAgentRuntimeEventServiceV1({
    admission: {
      admit: forbidden,
      retry: forbidden,
      withCurrentRun: forbidden,
      withRunAuthority: forbidden,
    },
    deploymentAuthority: {
      policyId: "control-record-fixture",
      fingerprint: `cj1:sha256:${"A".repeat(43)}`,
      scopes: [],
    },
    enqueueRun: forbidden,
    now,
  });
  const event = (): NpAgentEventCanonicalV1 => ({
    version: "np.agent-event.v1",
    siteId,
    kind: "ops.check.changed",
    occurredAt: now().toISOString(),
    source: { kind: "ops", component: "doctor" },
    subject: null,
    actor: null,
    causation: null,
    correlationId: null,
    deduplicationKey: randomUUID(),
    privacy: "internal",
    payload: {
      kind: "ops.check.changed",
      checkId: "jobs.worker",
      previousStatus: "pass",
      currentStatus: "warn",
    },
  });
  return { ...f, events, event, now, forbidden };
}
async function noQueries(db: NpAgentRuntimeControlContextV1["db"], operation: () => Promise<void>) {
  const reads = vi.spyOn(db, "select"),
    writes = vi.spyOn(db, "insert"),
    updates = vi.spyOn(db, "update"),
    execute = vi.spyOn(db, "execute");
  try {
    await operation();
    expect(reads).not.toHaveBeenCalled();
    expect(writes).not.toHaveBeenCalled();
    expect(updates).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
  } finally {
    reads.mockRestore();
    writes.mockRestore();
    updates.mockRestore();
    execute.mockRestore();
  }
}

describe.skipIf(skipIfNoTestDb())("private live Runtime control recorder", () => {
  beforeAll(ensureMigrated);
  beforeEach(async () => {
    await truncateAll();
    registerTestCollections();
  });
  afterEach(() => vi.restoreAllMocks());
  afterAll(closeTestDb);

  it("hashes the actual fresh row against genuine prepared identity and rejects tampered bodies, rehashes and copied preparation", async () => {
    const f = await setup(),
      prepared = await npPrepareAgentRuntimeEventV1(f.event());
    const recorded = await f.events.record({ siteId, event: prepared.event });
    const [row] = await f.db
      .select()
      .from(npAgentEvents)
      .where(eq(npAgentEvents.id, recorded.eventId));
    await expect(
      npAssertPreparedAgentRuntimeEventRowV1(prepared.event, row),
    ).resolves.toBeUndefined();
    await expect(
      npAssertPreparedAgentRuntimeEventRowV1(structuredClone(prepared.event), row),
    ).rejects.toMatchObject({ code: "RUNTIME_EVENT_INVALID" });
    const changed = structuredClone(row);
    changed.payload = {
      kind: "ops.check.changed",
      checkId: "jobs.worker",
      previousStatus: "pass",
      currentStatus: "fail",
    };
    await expect(
      npAssertPreparedAgentRuntimeEventRowV1(prepared.event, changed),
    ).rejects.toMatchObject({ code: "INCIDENT_EVIDENCE_UNAVAILABLE" });
    const forged = await npPrepareAgentRuntimeEventV1({
      ...prepared.event,
      payload: changed.payload,
    });
    changed.eventHash = forged.eventHash;
    await expect(
      npAssertPreparedAgentRuntimeEventRowV1(prepared.event, changed),
    ).rejects.toMatchObject({ code: "INCIDENT_EVIDENCE_UNAVAILABLE" });
    const extra = structuredClone(row);
    extra.payload = Object.assign({}, extra.payload, {
      untrustedExtra: "must remain included in actual row hash",
    });
    await expect(
      npAssertPreparedAgentRuntimeEventRowV1(prepared.event, extra),
    ).rejects.toMatchObject({ code: "INCIDENT_EVIDENCE_UNAVAILABLE" });
    const moved = structuredClone(row);
    moved.occurredAt = new Date(row.occurredAt.getTime() + 1);
    await expect(
      npAssertPreparedAgentRuntimeEventRowV1(prepared.event, moved),
    ).rejects.toMatchObject({ code: "INCIDENT_EVIDENCE_UNAVAILABLE" });
    expect(await npReadAgentEventRowEvidenceV1(row)).toEqual(prepared.event);
    expect(f.forbidden).not.toHaveBeenCalled();
  });

  it("records and deduplicates through genuine same-transaction admission while retaining canonical, expiry and lineage checks", async () => {
    const f = await setup(),
      event = f.event();
    const first = await npWithAgentRuntimeControlTransactionV1(siteId, async (context) => {
      const input = { siteId, db: context.db, event };
      const result = await npRecordAgentRuntimeEventWithControlContextV1(f.events, context, input);
      expect(await npRecordAgentRuntimeEventWithControlContextV1(f.events, context, input)).toEqual(
        { ...result, replayed: true },
      );
      await expect(
        npRecordAgentRuntimeEventWithControlContextV1(f.events, context, {
          ...input,
          event: {
            ...event,
            payload: {
              kind: "ops.check.changed",
              checkId: "jobs.worker",
              previousStatus: "pass",
              currentStatus: "fail",
            },
          },
        }),
      ).rejects.toMatchObject({ code: "IDEMPOTENCY_KEY_REUSED" });
      await expect(
        npRecordAgentRuntimeEventWithControlContextV1(f.events, context, {
          ...input,
          event: f.event(),
          expiresAt: f.now(),
        }),
      ).rejects.toMatchObject({ code: "RUNTIME_EVENT_INVALID" });
      await expect(
        npRecordAgentRuntimeEventWithControlContextV1(f.events, context, {
          ...input,
          event: {
            ...f.event(),
            causation: {
              rootRunId: randomUUID(),
              sourceRunId: randomUUID(),
              sourceActionId: randomUUID(),
              depth: 0,
            },
          },
        }),
      ).rejects.toMatchObject({ code: "RUNTIME_EVENT_LINEAGE_INVALID" });
      return result;
    });
    const rows = await f.db.select().from(npAgentEvents);
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(first.eventId);
    expect(await npReadAgentEventRowEvidenceV1(rows[0])).toEqual(event);
    expect(await f.events.record({ siteId, event })).toEqual({ ...first, replayed: true });
    expect(f.forbidden).not.toHaveBeenCalled();
  });

  it("reuses only a detached deeply immutable prepared Event under genuine live admission", async () => {
    const f = await setup(),
      raw = f.event(),
      prepared = await npPrepareAgentRuntimeEventV1(raw),
      otherSite = await npPrepareAgentRuntimeEventV1({ ...f.event(), siteId: "other-site" });
    expect(Object.isFrozen(prepared)).toBe(true);
    expect(Object.isFrozen(prepared.event)).toBe(true);
    expect(Object.isFrozen(prepared.event.source)).toBe(true);
    expect(Object.isFrozen(prepared.event.payload)).toBe(true);
    expect(prepared.event).not.toBe(raw);
    expect(prepared.event.payload).not.toBe(raw.payload);
    raw.source.component = "mutated-source";
    Reflect.set(raw.payload, "currentStatus", "fail");
    expect(Reflect.set(prepared.event.source, "component", "forged-source")).toBe(false);
    expect(Reflect.set(prepared.event.payload, "currentStatus", "fail")).toBe(false);
    expect(prepared.event).toMatchObject({
      source: { component: "doctor" },
      payload: { currentStatus: "warn" },
    });
    const digest = vi.spyOn(globalThis.crypto.subtle, "digest");
    const first = await npWithAgentRuntimeControlTransactionV1(siteId, async (context) => {
      const input = { siteId, db: context.db, event: prepared.event };
      const result = await npRecordAgentRuntimeEventWithControlContextV1(f.events, context, input);
      expect(await npRecordAgentRuntimeEventWithControlContextV1(f.events, context, input)).toEqual(
        {
          ...result,
          replayed: true,
        },
      );
      await noQueries(context.db, async () => {
        await expect(
          npRecordAgentRuntimeEventWithControlContextV1(f.events, context, {
            ...input,
            event: otherSite.event,
          }),
        ).rejects.toMatchObject({ code: "RUNTIME_EVENT_INVALID" });
      });
      expect(digest).not.toHaveBeenCalled();
      return result;
    });
    const [stored] = await f.db.select().from(npAgentEvents);
    expect(stored.id).toBe(first.eventId);
    expect(stored.eventHash).toBe(prepared.eventHash);
    expect(await npReadAgentEventRowEvidenceV1(stored)).toEqual(prepared.event);
    expect(f.forbidden).not.toHaveBeenCalled();
  });

  it("returns only a newly consumed actual INSERT row and leaves public, ordinary and replayed records undispatched", async () => {
    const f = await setup(),
      publicEvent = f.event(),
      ordinaryEvent = f.event(),
      prepared = await npPrepareAgentRuntimeEventV1(f.event());
    const publicResult = await f.events.record({ siteId, event: publicEvent });
    await npWithAgentRuntimeControlTransactionV1(siteId, async (context) => {
      const ordinary = await npRecordAgentRuntimeEventWithControlContextV1(f.events, context, {
        siteId,
        db: context.db,
        event: ordinaryEvent,
      });
      expect(ordinary).not.toHaveProperty("consumedRow");
      const input = { siteId, db: context.db, event: prepared.event },
        result = await npRecordConsumedAgentRuntimeEventWithControlContextV1(
          f.events,
          context,
          input,
        );
      expect(result.replayed).toBe(false);
      if (!result.consumedRow) throw new Error("Missing actual consumed INSERT RETURNING row");
      const [stored] = await context.db
        .select()
        .from(npAgentEvents)
        .where(eq(npAgentEvents.id, result.eventId));
      expect(result.consumedRow).toEqual(stored);
      expect(stored).toMatchObject({
        siteId,
        eventHash: prepared.eventHash,
        recordedAt: f.now(),
        dispatchedAt: f.now(),
      });
      expect(await npReadAgentEventRowEvidenceV1(stored)).toEqual(prepared.event);
      const inserted = vi.spyOn(context.db, "insert"),
        updated = vi.spyOn(context.db, "update");
      try {
        expect(
          await npRecordConsumedAgentRuntimeEventWithControlContextV1(f.events, context, input),
        ).toEqual({
          eventId: result.eventId,
          replayed: true,
        });
        expect(
          await npRecordConsumedAgentRuntimeEventWithControlContextV1(f.events, context, {
            ...input,
            event: ordinaryEvent,
          }),
        ).toEqual({ eventId: ordinary.eventId, replayed: true });
        expect(inserted).not.toHaveBeenCalled();
        expect(updated).not.toHaveBeenCalled();
      } finally {
        inserted.mockRestore();
        updated.mockRestore();
      }
      const pending = await context.db.select().from(npAgentEvents);
      expect(
        pending.filter((row) => row.id === publicResult.eventId || row.id === ordinary.eventId),
      ).toMatchObject([{ dispatchedAt: null }, { dispatchedAt: null }]);
    });
    expect(await f.db.select().from(npAgentEvents)).toHaveLength(3);
    expect(f.forbidden).not.toHaveBeenCalled();
  });

  it("fails a fresh-source collision closed while preserving the committed row and ordinary replay", async () => {
    const f = await setup(),
      prepared = await npPrepareAgentRuntimeEventV1(f.event());
    const first = await npWithAgentRuntimeControlTransactionV1(siteId, async (context) => {
      await expect(
        npRecordFreshConsumedAgentRuntimeEventWithControlContextV1(f.events, context, {
          siteId,
          db: context.db,
          event: { ...prepared.event, deduplicationKey: null },
        }),
      ).rejects.toMatchObject({ code: "RUNTIME_EVENT_INVALID" });
      return npRecordFreshConsumedAgentRuntimeEventWithControlContextV1(f.events, context, {
        siteId,
        db: context.db,
        event: prepared.event,
      });
    });
    expect(first.replayed).toBe(false);
    expect(first.consumedRow?.id).toBe(first.eventId);
    expect(first.consumedRow?.dispatchedAt).toEqual(f.now());
    await expect(
      npWithAgentRuntimeControlTransactionV1(siteId, (context) =>
        npRecordFreshConsumedAgentRuntimeEventWithControlContextV1(f.events, context, {
          siteId,
          db: context.db,
          event: prepared.event,
        }),
      ),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_KEY_REUSED", status: 409 });
    expect(await f.events.record({ siteId, event: prepared.event })).toEqual({
      eventId: first.eventId,
      replayed: true,
    });
    const rows = await f.db.select().from(npAgentEvents);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual(first.consumedRow);
    expect(await npReadAgentEventRowEvidenceV1(rows[0])).toEqual(prepared.event);
    expect(f.forbidden).not.toHaveBeenCalled();
  });

  it("strips forged consumed rows from wrapped or replaced recorders and preserves their actual undispatched writes", async () => {
    const f = await setup(),
      original = f.events.record;
    await npWithAgentRuntimeControlTransactionV1(siteId, async (context) => {
      const initial = await original({ siteId, db: context.db, event: f.event() });
      const [row] = await context.db
        .select()
        .from(npAgentEvents)
        .where(eq(npAgentEvents.id, initial.eventId));
      const forgedRow = {
        ...row,
        id: randomUUID(),
        dispatchedAt: f.now(),
        eventHash: `cj1:sha256:${"Z".repeat(43)}`,
      };
      const hook = vi.fn(async (input: Parameters<typeof original>[0]) => ({
        ...(await original(input)),
        consumedRow: forgedRow,
      }));
      const wrapped = await npRecordFreshConsumedAgentRuntimeEventWithControlContextV1(
        { record: hook },
        context,
        {
          siteId,
          db: context.db,
          event: f.event(),
        },
      );
      expect(wrapped).not.toHaveProperty("consumedRow");
      f.events.record = hook;
      try {
        const replaced = await npRecordConsumedAgentRuntimeEventWithControlContextV1(
          f.events,
          context,
          {
            siteId,
            db: context.db,
            event: f.event(),
          },
        );
        expect(replaced).not.toHaveProperty("consumedRow");
      } finally {
        f.events.record = original;
      }
      expect(hook).toHaveBeenCalledTimes(2);
    });
    const stored = await f.db.select().from(npAgentEvents);
    expect(stored).toHaveLength(3);
    expect(stored.every((row) => row.dispatchedAt === null)).toBe(true);
    expect(f.forbidden).not.toHaveBeenCalled();
  });

  it("revalidates frozen copies and public, wrapped or replaced recorders instead of trusting prepared-looking values", async () => {
    const f = await setup(),
      prepared = await npPrepareAgentRuntimeEventV1(f.event()),
      copy = Object.freeze({ ...structuredClone(prepared.event), deduplicationKey: randomUUID() }),
      digest = vi.spyOn(globalThis.crypto.subtle, "digest"),
      original = f.events.record,
      hook = vi.fn((input: Parameters<typeof original>[0]) => original(input));
    await npWithAgentRuntimeControlTransactionV1(siteId, async (context) => {
      await npRecordAgentRuntimeEventWithControlContextV1(f.events, context, {
        siteId,
        db: context.db,
        event: copy,
      });
      expect(digest).toHaveBeenCalledTimes(1);
      const invalidCopy = Object.freeze({
        ...copy,
        payload: {
          kind: "ops.check.changed" as const,
          checkId: "",
          previousStatus: "pass" as const,
          currentStatus: "warn" as const,
        },
      });
      await expect(
        npRecordAgentRuntimeEventWithControlContextV1(f.events, context, {
          siteId,
          db: context.db,
          event: invalidCopy,
        }),
      ).rejects.toThrow();
      expect(digest).toHaveBeenCalledTimes(1);
      await original({ siteId, db: context.db, event: prepared.event });
      expect(digest).toHaveBeenCalledTimes(2);
      await npRecordAgentRuntimeEventWithControlContextV1({ record: hook }, context, {
        siteId,
        db: context.db,
        event: prepared.event,
      });
      expect(digest).toHaveBeenCalledTimes(3);
      f.events.record = hook;
      try {
        await npRecordAgentRuntimeEventWithControlContextV1(f.events, context, {
          siteId,
          db: context.db,
          event: prepared.event,
        });
      } finally {
        f.events.record = original;
      }
      expect(hook).toHaveBeenCalledTimes(2);
      expect(digest).toHaveBeenCalledTimes(4);
    });
    expect(await f.db.select().from(npAgentEvents)).toHaveLength(2);
    expect(f.forbidden).not.toHaveBeenCalled();
  });

  it("rejects copied, mutated and cross-transaction bindings before any query or injected recorder", async () => {
    const f = await setup();
    await createSite({ id: "control-record-other", name: "Other control recorder site" });
    const injected = {
      record: vi.fn(() => Promise.reject(new Error("Invalid proof must not dispatch"))),
    };
    await npWithAgentRuntimeControlTransactionV1(siteId, async (context) => {
      const input = { siteId, db: context.db, event: f.event() };
      await noQueries(context.db, async () => {
        await expect(
          npRecordAgentRuntimeEventWithControlContextV1(injected, { ...context }, input),
        ).rejects.toMatchObject({ code: "RUNTIME_EVENT_INVALID" });
        await expect(
          npRecordConsumedAgentRuntimeEventWithControlContextV1(injected, { ...context }, input),
        ).rejects.toMatchObject({ code: "RUNTIME_EVENT_INVALID" });
        await expect(
          npRecordAgentRuntimeEventWithControlContextV1(f.events, context, { ...input, db: f.db }),
        ).rejects.toMatchObject({ code: "RUNTIME_EVENT_INVALID" });
        const originalSite = context.siteId;
        try {
          context.siteId = "control-record-other";
          await expect(
            npRecordAgentRuntimeEventWithControlContextV1(f.events, context, {
              ...input,
              siteId: context.siteId,
              event: { ...input.event, siteId: context.siteId },
            }),
          ).rejects.toMatchObject({ code: "RUNTIME_EVENT_INVALID" });
        } finally {
          context.siteId = originalSite;
        }
        const originalDb = context.db;
        try {
          context.db = f.db;
          await expect(
            npRecordAgentRuntimeEventWithControlContextV1(f.events, context, {
              ...input,
              db: f.db,
            }),
          ).rejects.toMatchObject({ code: "RUNTIME_EVENT_INVALID" });
        } finally {
          context.db = originalDb;
        }
      });
      await npWithAgentRuntimeControlTransactionV1("control-record-other", (other) =>
        noQueries(other.db, async () => {
          await expect(
            npRecordAgentRuntimeEventWithControlContextV1(f.events, context, {
              ...input,
              db: other.db,
            }),
          ).rejects.toMatchObject({ code: "RUNTIME_EVENT_INVALID" });
        }),
      );
    });
    expect(injected.record).not.toHaveBeenCalled();
    expect(await f.db.select().from(npAgentEvents)).toEqual([]);
  });

  it("rejects ended callbacks and pool-backed nontransaction contexts instead of upgrading them", async () => {
    const f = await setup(),
      prepared = await npPrepareAgentRuntimeEventV1(f.event());
    const ended = await npWithAgentRuntimeControlTransactionV1(siteId, (context) =>
      Promise.resolve(context),
    );
    await noQueries(ended.db, async () => {
      await expect(
        npRecordAgentRuntimeEventWithControlContextV1(f.events, ended, {
          siteId,
          db: ended.db,
          event: prepared.event,
        }),
      ).rejects.toMatchObject({ code: "RUNTIME_EVENT_INVALID" });
      await expect(
        npRecordConsumedAgentRuntimeEventWithControlContextV1(f.events, ended, {
          siteId,
          db: ended.db,
          event: prepared.event,
        }),
      ).rejects.toMatchObject({ code: "RUNTIME_EVENT_INVALID" });
    });
    await npWithAgentRuntimeControlTransactionV1(
      siteId,
      (context) =>
        noQueries(f.db, async () => {
          await expect(
            npRecordAgentRuntimeEventWithControlContextV1(f.events, context, {
              siteId,
              db: f.db,
              event: f.event(),
            }),
          ).rejects.toMatchObject({ code: "RUNTIME_EVENT_INVALID" });
        }),
      f.db,
    );
    expect(await f.db.select().from(npAgentEvents)).toEqual([]);
  });

  it("preserves wrapped and replaced recorder behavior and its ordinary current Runtime guard", async () => {
    const f = await setup();
    const original = f.events.record;
    const hook = vi.fn((input: Parameters<typeof original>[0]) => original(input));
    await npWithAgentRuntimeControlTransactionV1(siteId, async (context) => {
      await context.db
        .insert(npSettings)
        .values({ siteId, key: "agents.runtime", value: {}, updatedAt: f.now() });
      const input = { siteId, db: context.db, event: f.event() };
      await expect(
        npRecordAgentRuntimeEventWithControlContextV1({ record: hook }, context, input),
      ).rejects.toMatchObject({ code: "RUNTIME_STATE_INVALID" });
      f.events.record = hook;
      try {
        await expect(
          npRecordAgentRuntimeEventWithControlContextV1(f.events, context, input),
        ).rejects.toMatchObject({ code: "RUNTIME_STATE_INVALID" });
        expect(hook).toHaveBeenCalledTimes(2);
      } finally {
        f.events.record = original;
      }
      await context.db.delete(npSettings).where(eq(npSettings.key, "agents.runtime"));
      await expect(
        npRecordAgentRuntimeEventWithControlContextV1(f.events, context, input),
      ).resolves.toMatchObject({ replayed: false });
    });
    expect(hook).toHaveBeenCalledTimes(2);
    expect(await f.db.select().from(npAgentEvents)).toHaveLength(1);
    expect(f.events.record).toBe(original);
  });

  it("rechecks lifetime after the actual asynchronous canonical digest before issuing any query", async () => {
    const f = await setup();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const digest = globalThis.crypto.subtle.digest.bind(globalThis.crypto.subtle);
    const heldDigest = vi
      .spyOn(globalThis.crypto.subtle, "digest")
      .mockImplementation((algorithm, bytes) => gate.then(() => digest(algorithm, bytes)));
    let pending!: Promise<{ eventId: string; replayed: boolean }>;
    await npWithAgentRuntimeControlTransactionV1(siteId, (context) => {
      pending = npRecordAgentRuntimeEventWithControlContextV1(f.events, context, {
        siteId,
        db: context.db,
        event: f.event(),
      });
      void pending.catch(() => {});
      return Promise.resolve();
    });
    expect(heldDigest).toHaveBeenCalledOnce();
    release();
    await expect(pending).rejects.toMatchObject({ code: "RUNTIME_EVENT_INVALID" });
    heldDigest.mockRestore();
    expect(await f.db.select().from(npAgentEvents)).toEqual([]);
  });

  it("rejects admission that ends while its actual deduplication SQL result is pending", async () => {
    const f = await setup(),
      prepared = await npPrepareAgentRuntimeEventV1(f.event());
    const descriptor = Object.getOwnPropertyDescriptor(pg.Client.prototype, "query");
    const original: unknown = descriptor?.value;
    if (!descriptor || typeof original !== "function")
      throw new Error("Missing PostgreSQL query owner");
    let release = () => {},
      observe = () => {};
    const held = new Promise<void>((resolve) => {
        release = resolve;
      }),
      observed = new Promise<void>((resolve) => {
        observe = resolve;
      });
    let intercepted = false;
    Object.defineProperty(pg.Client.prototype, "query", {
      ...descriptor,
      value: function (this: unknown, ...args: unknown[]): unknown {
        const result: unknown = Reflect.apply(original, this, args);
        const first = args[0];
        const text =
          typeof first === "string"
            ? first
            : first && typeof first === "object"
              ? Reflect.get(first, "text")
              : null;
        if (
          !intercepted &&
          typeof text === "string" &&
          /^select.*from "np_agent_events"/su.test(text)
        ) {
          intercepted = true;
          return Promise.resolve(result).then(async (rows) => {
            observe();
            await held;
            return rows;
          });
        }
        return result;
      },
    });
    let pending: Promise<unknown> | undefined;
    try {
      await npWithAgentRuntimeControlTransactionV1(siteId, async (context) => {
        pending = npRecordConsumedAgentRuntimeEventWithControlContextV1(f.events, context, {
          siteId,
          db: context.db,
          event: prepared.event,
        });
        // Observe the eventual rejection while deliberately ending this callback
        // before the actual query result reaches the recorder.
        void pending.then(observe, observe);
        await observed;
      });
      release();
      await expect(pending).rejects.toMatchObject({ code: "RUNTIME_EVENT_INVALID" });
      expect(intercepted).toBe(true);
    } finally {
      release();
      Object.defineProperty(pg.Client.prototype, "query", descriptor);
      await pending?.catch(() => undefined);
    }
    expect(await f.db.select().from(npAgentEvents)).toEqual([]);
  });

  it("keeps preview effects forbidden even with genuine live write admission and a real readonly preview transaction", async () => {
    const f = await setup(),
      prepared = await npPrepareAgentRuntimeEventV1(f.event());
    const preview = await previewFixture();
    await npWithAgentRuntimeControlTransactionV1(siteId, (context) =>
      f.db.transaction(
        (readOnly) =>
          // Reuse only the existing canonical plan fixture. Every SQL result,
          // including the preview read-only check, comes from this actual TX.
          withAgentChangeSetPreview({ ...preview, tx: readOnly as unknown as NpTransaction }, () =>
            noQueries(context.db, async () => {
              await expect(
                npRecordAgentRuntimeEventWithControlContextV1(f.events, context, {
                  siteId,
                  db: context.db,
                  event: prepared.event,
                }),
              ).rejects.toMatchObject({ code: "FORBIDDEN" });
              await expect(
                npRecordConsumedAgentRuntimeEventWithControlContextV1(f.events, context, {
                  siteId,
                  db: context.db,
                  event: prepared.event,
                }),
              ).rejects.toMatchObject({ code: "FORBIDDEN" });
            }),
          ),
        { accessMode: "read only" },
      ),
    );
    expect(await f.db.select().from(npAgentEvents)).toEqual([]);
  });

  it("rolls an actual fast-path insert back with its owning transaction", async () => {
    const f = await setup();
    await expect(
      npWithAgentRuntimeControlTransactionV1(siteId, async (context) => {
        const recorded = await npRecordConsumedAgentRuntimeEventWithControlContextV1(
          f.events,
          context,
          {
            siteId,
            db: context.db,
            event: f.event(),
          },
        );
        expect(recorded.consumedRow?.dispatchedAt).toEqual(f.now());
        throw new Error("Injected parent rollback");
      }),
    ).rejects.toThrow("Injected parent rollback");
    expect(await f.db.select().from(npAgentEvents)).toEqual([]);
  });
});
