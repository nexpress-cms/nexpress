import { npSettings } from "../../../packages/core/src/db/schema/system.js";
import { createAgentRuntimeEventServiceV1 } from "../../../packages/core/src/agent/runtime-event-service.js";
import {
  npRequireAgentEventCanonical,
  npDigestAgentEventCanonical,
} from "../../../packages/core/src/agent-contract/canonical-events.js";
import { createSite } from "../../../packages/core/src/sites/registry.js";
import { createHash, randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createAgentNotificationDeliveryServiceV1 } from "../../../packages/core/src/agent/notification-delivery-service.js";
import { createAgentIncidentNotificationsServiceV1 } from "../../../packages/core/src/agent/incident-notifications-service.js";
import { createAgentIncidentServiceV1 } from "../../../packages/core/src/agent/incident-service.js";
import { createAgentIncidentWriteServiceV1 } from "../../../packages/core/src/agent/incident-write-service.js";
import { createAgentIncidentWorkflowServiceV1 } from "../../../packages/core/src/agent/incident-workflow-service.js";
import { npPruneAgentIncidentRetentionV1 } from "../../../packages/core/src/agent/incident-retention.js";
import { npWithAgentRuntimeControlTransactionV1 } from "../../../packages/core/src/agent/runtime-controls.js";
import { npNormalizeJobPayload } from "../../../packages/core/src/jobs-contract/contract.js";
import {
  npAgentModeratorWindowStartedAtV1,
  npDetectAgentRepeatedLinkSpamV1,
} from "../../../packages/core/src/agent/moderator-detector.js";
import { npCreateDisabledAgentRuntimeSettingsV1 } from "../../../packages/core/src/agent-contract/runtime-contract.js";
import {
  npDigestAgentNotificationDeliveryCanonical,
  npRequireAgentNotificationDeliveryCanonical,
} from "../../../packages/core/src/agent-contract/canonical-notification-policy.js";
import type { NpAgentModeratorFactV1 } from "../../../packages/core/src/agent-contract/moderator-contract.js";
import type { NpAgentNotificationDeliveryResultV1 } from "../../../packages/core/src/agent-contract/notification-delivery-contract.js";
import {
  npAgentNotifications,
  npAgentIncidents,
  npAgentEvents,
} from "../../../packages/core/src/db/schema/agent.js";
import {
  getOptionalJobQueue,
  setJobQueue,
  type NpJobQueue,
} from "../../../packages/core/src/jobs/queue.js";
import { notificationDeliveryFixture } from "./agent-notification-delivery-fixture.js";
import {
  closeTestDb,
  ensureMigrated,
  registerTestCollections,
  skipIfNoTestDb,
  truncateAll,
} from "./harness.js";

type ConnectionFixture = Awaited<ReturnType<typeof notificationDeliveryFixture>>;
const cleanup: ConnectionFixture[] = [];
let priorQueue: NpJobQueue | null;
const digest = `cj1:sha256:${"A".repeat(43)}`;
async function candidate(siteId: string, at: Date, collections = ["posts"]) {
  const windowStartedAt = npAgentModeratorWindowStartedAtV1(
    new Date(at.getTime() - 600000).toISOString(),
  );
  const domain = createHash("sha256").update(randomUUID()).digest("hex");
  const facts: NpAgentModeratorFactV1[] = Array.from({ length: 5 }, (_, i) => {
    const documentId = randomUUID();
    const collection = collections[i % collections.length]!;
    return {
      schemaVersion: "np.agent-moderator-fact.v1",
      siteId,
      observedAt: windowStartedAt,
      subject: { kind: "document", collection, documentId },
      memberId: randomUUID(),
      targetVersionDigest: digest,
      domainHashes: [domain],
      spamVerdict: "pass",
      profanityVerdict: "pass",
      evidence: {
        kind: "revision",
        collection,
        documentId,
        revisionId: randomUUID(),
        observedAt: windowStartedAt,
        digest: "a".repeat(64),
        excerpt: null,
      },
    };
  });
  const [value] = await npDetectAgentRepeatedLinkSpamV1({
    siteId,
    windowStartedAt,
    settings: {
      recipeId: "moderator.repeated-link-spam",
      recipeVersion: 1,
      collectionSlugs: collections,
      windowSeconds: 600,
      minIndependentAccounts: 3,
      minItems: 5,
      automaticConfidenceBasisPoints: 9900,
    },
    facts,
  });
  if (!value) throw new Error("Expected a canonical synthetic detector candidate");
  return value;
}
async function setup(
  options: {
    siteId?: string;
    idempotency?: "enforced" | "none";
    external?: boolean;
    notBefore?: string;
  } = {},
) {
  let clock = new Date();
  const now = () => clock;
  const f = await notificationDeliveryFixture({
    siteId: options.siteId,
    idempotency: options.idempotency,
    now,
  });
  cleanup.push(f);
  const rules = npCreateDisabledAgentRuntimeSettingsV1().defaultPolicyRules;
  rules.providerDataMaximum = "internal-redacted";
  rules.escalation.channels = ["email"];
  rules.escalation.minimumSeverity = "low";
  const state: {
    visible: boolean;
    dispatch: boolean;
    routeFailure: boolean;
    afterLease: (() => void | Promise<void>) | null;
    recipient: ConnectionFixture["actor"];
    leaseExpiry: string | null;
  } = {
    visible: true,
    dispatch: true,
    routeFailure: false,
    afterLease: null,
    recipient: f.actor,
    leaseExpiry: null,
  };
  const reads = createAgentIncidentServiceV1({
    cursorHmacKey: new Uint8Array(32).fill(91),
    canReadIncident: () => false,
    canReadStaffIncident: () => state.visible,
    now,
  }).staff;
  const open = f.vault.leaseProviderCredential.bind(f.vault);
  const lease = vi.fn<typeof f.vault.leaseProviderCredential>(async (input) => {
    const value = await open(input);
    await state.afterLease?.();
    return state.leaseExpiry === null
      ? value
      : {
          secretVersionId: value.secretVersionId,
          envelopeVersion: value.envelopeVersion,
          expiresAt: state.leaseExpiry,
          use: value.use.bind(value),
          dispose: value.dispose.bind(value),
        };
  });
  const service = createAgentNotificationDeliveryServiceV1({
    connections: f.connections,
    registry: f.registry,
    vault: { leaseProviderCredential: lease },
    reads,
    cursorHmacKey: new Uint8Array(32).fill(92),
    notBefore: options.notBefore ?? new Date(clock.getTime() - 60000).toISOString(),
    now,
    resolveRoutes: () =>
      state.routeFailure
        ? Promise.reject(new Error("Synthetic routing owner unavailable"))
        : Promise.resolve([{ channel: "email", connectionId: f.connectionId }]),
    authorizeRoute: ({ phase }) =>
      Promise.resolve(
        phase === "dispatch" && !state.dispatch
          ? null
          : {
              policy: {
                autonomy: "advise",
                capabilityModes: rules.capabilityModes,
                layers: [rules],
              },
              recipient: { siteId: f.siteId, actor: state.recipient },
            },
      ),
  });
  const notifications = createAgentIncidentNotificationsServiceV1({
    reads,
    cursorHmacKey: new Uint8Array(32).fill(93),
    ...(options.external === false ? {} : { delivery: service }),
    now,
  });
  const writer = createAgentIncidentWriteServiceV1({
    resolveEvidence: () => true,
    notifications,
    now,
  });
  const enqueue = vi.fn<NpJobQueue["enqueue"]>(() => Promise.resolve(randomUUID()));
  setJobQueue({
    enqueue,
    start: () => Promise.resolve(),
    stop: () => Promise.resolve(),
    countSiteEnqueues: () => Promise.resolve(0),
  });
  const rows = () =>
    f.db.select().from(npAgentNotifications).where(eq(npAgentNotifications.siteId, f.siteId));
  const external = async () => (await rows()).filter((row) => row.channel !== "admin");
  const local = async () => (await rows()).filter((row) => row.channel === "admin");
  const observe = async (collections?: string[]) =>
    writer.observe(await candidate(f.siteId, clock, collections));
  const process = async (id?: string, expectedAttempt?: number) => {
    const row = id ? (await external()).find((r) => r.id === id) : (await external())[0];
    if (!row) throw new Error("Expected queued external notification");
    await service.process({
      siteId: f.siteId,
      notificationId: row.id,
      expectedAttempt: expectedAttempt ?? row.attempts,
    });
    return (await external()).find((r) => r.id === row.id)!;
  };
  const result = (value: NpAgentNotificationDeliveryResultV1) =>
    f.send.mockImplementation((_request, context) =>
      context.credentialLease.use(() => Promise.resolve(value)),
    );
  return {
    ...f,
    service,
    reads,
    notifications,
    writer,
    rules,
    state,
    lease,
    now,
    enqueue,
    rows,
    external,
    local,
    observe,
    process,
    result,
    advance: (seconds: number) => {
      clock = new Date(clock.getTime() + seconds * 1000);
    },
  };
}

describe.skipIf(skipIfNoTestDb())("explicit external Incident notification delivery", () => {
  beforeAll(ensureMigrated);
  beforeEach(async () => {
    priorQueue = getOptionalJobQueue();
    await truncateAll();
    registerTestCollections();
  });
  afterEach(async () => {
    for (const f of cleanup.splice(0).reverse()) await f.dispose();
    setJobQueue(priorQueue);
    vi.restoreAllMocks();
  });
  afterAll(closeTestDb);

  it("keeps default local recording provider-free and rolls source/local/outbox writes back atomically", async () => {
    const x = await setup({ external: false });
    await x.observe();
    expect(await x.local()).toHaveLength(1);
    expect(await x.external()).toEqual([]);
    expect(x.send).not.toHaveBeenCalled();
    const y = await setup({ siteId: "rollback-notifications" });
    await expect(
      y.db.transaction(async (tx) => {
        await y.writer.observe(await candidate(y.siteId, y.now()), {
          transaction: tx as typeof y.db,
        });
        throw new Error("source rollback");
      }),
    ).rejects.toThrow("source rollback");
    expect(await y.rows()).toEqual([]);
    expect(
      await y.db.select().from(npAgentIncidents).where(eq(npAgentIncidents.siteId, y.siteId)),
    ).toEqual([]);
    expect(y.send).not.toHaveBeenCalled();
  });

  it("preserves the local receipt through routing failure and recovers committed outbox work without send-on-read", async () => {
    const x = await setup();
    x.state.routeFailure = true;
    const incident = await x.observe();
    expect(await x.local()).toHaveLength(1);
    expect(await x.external()).toEqual([]);
    x.state.routeFailure = false;
    await x.service.reconcile({ siteId: x.siteId });
    expect(await x.external()).toHaveLength(1);
    const page = await x.service.list({
      siteId: x.siteId,
      actor: x.actor,
      incidentId: incident.incidentId,
    });
    expect(page.items[0]).toMatchObject({ state: "queued", outcome: "pending", attempts: 0 });
    expect(x.send).not.toHaveBeenCalled();
    expect(x.lease).not.toHaveBeenCalled();
    await x.service.reconcile({ siteId: x.siteId });
    expect(x.enqueue).toHaveBeenCalledWith("agent:notificationSend", {
      siteId: x.siteId,
      notificationId: page.items[0]!.notificationId,
      expectedAttempt: 0,
    });
  });

  it("retains a pending external delivery's local source receipt when its workflow-closed Incident ages past retention", async () => {
    const x = await setup();
    const incident = await x.observe();
    const [source] = await x.local();
    const [pending] = await x.external();
    expect(source?.deliveryResultDigest).toBeTruthy();
    expect(pending).toMatchObject({
      state: "queued",
      payloadRedacted: { sourceNotificationId: source!.id },
    });
    const workflow = createAgentIncidentWorkflowServiceV1({
      reads: x.reads,
      canReviewContainment: () => true,
      notifications: x.notifications,
      now: x.now,
    });
    const input = { siteId: x.siteId, actor: x.actor, incidentId: incident.incidentId };
    const review = await workflow.get(input);
    await workflow.transition({
      ...input,
      command: {
        schemaVersion: "np.agent-incident-transition-input.v1",
        expectedVersion: 1,
        transition: "resolved",
        resolutionCode: "NO_FURTHER_ACTION",
        note: "Reviewed closure for notification retention acceptance.",
        containmentReviewHash: review.containment.reviewHash,
        containmentDisposition: "acknowledge",
        idempotencyKey: randomUUID(),
      },
    });
    const [closed] = await x.db
      .select()
      .from(npAgentIncidents)
      .where(eq(npAgentIncidents.id, incident.incidentId));
    expect(closed?.status).toBe("resolved");
    // Advance the maintenance cutoff only: original canonical receipt times remain intact.
    const later = new Date(closed!.updatedAt.getTime() + 366 * 86_400_000);
    const pruned = await npWithAgentRuntimeControlTransactionV1(x.siteId, ({ db }) =>
      npPruneAgentIncidentRetentionV1({
        db,
        siteId: x.siteId,
        cursor: null,
        limit: 25,
        now: later,
        policy: { signalDays: 90, historyDays: 365 },
        beforeStatement: () => Promise.resolve(),
        rootIds: [source!.id, incident.incidentId].sort(),
      }),
    );
    expect(pruned).toMatchObject({ pruned: 0 });
    expect((await x.local()).find((row) => row.id === source!.id)).toEqual(source);
    expect((await x.external()).find((row) => row.id === pending!.id)).toEqual(pending);
    expect(
      await x.db.select().from(npAgentIncidents).where(eq(npAgentIncidents.id, closed!.id)),
    ).toEqual([closed]);
    expect(x.send).not.toHaveBeenCalled();
  });

  it("deduplicates concurrent queue/process replays and projects confirmed facts without private transport evidence", async () => {
    const x = await setup();
    const observed = await x.observe();
    const [local] = await x.local();
    await Promise.all([
      x.service.queue({ db: x.db, siteId: x.siteId, notificationId: local!.id }),
      x.service.queue({ db: x.db, siteId: x.siteId, notificationId: local!.id }),
    ]);
    const [row] = await x.external();
    expect(await x.external()).toHaveLength(1);
    expect(x.send).not.toHaveBeenCalled();
    await Promise.all([x.process(row!.id, 0), x.process(row!.id, 0)]);
    await x.process(row!.id, 0);
    expect(x.send).toHaveBeenCalledTimes(1);
    const stored = (await x.external())[0]!;
    expect(stored).toMatchObject({
      state: "sent",
      attempts: 1,
      providerMessageId: "fake-notification-receipt",
      lastErrorCode: null,
    });
    const proof = npRequireAgentNotificationDeliveryCanonical(stored.deliveryDigestBody);
    expect(await npDigestAgentNotificationDeliveryCanonical(proof)).toBe(
      stored.deliveryResultDigest,
    );
    expect(proof.result.state).toBe("confirmed");
    const projected = await x.service.list({
      siteId: x.siteId,
      actor: x.actor,
      incidentId: observed.incidentId,
    });
    expect(projected.items[0]).toMatchObject({ state: "sent", outcome: "confirmed", attempts: 1 });
    for (const privateValue of [
      "fake-notification-receipt",
      "fake-api-key",
      "operations-alerts",
      "destinationDescriptor",
      "deliveryDigestBody",
      "recipientFingerprint",
    ])
      expect(JSON.stringify(projected)).not.toContain(privateValue);
  });

  it("uses the fixed retry schedule and stops after five confirmed-not-sent attempts", async () => {
    const x = await setup();
    await x.observe();
    x.result({ state: "retryable_not_sent", errorCode: "SYNTHETIC_TEMPORARY" });
    const delays = [30, 120, 600, 1800];
    for (let attempt = 1; attempt <= 5; attempt++) {
      const at = x.now();
      const row = await x.process();
      expect(row.attempts).toBe(attempt);
      if (attempt < 5) {
        expect(row.state).toBe("queued");
        expect(row.nextAttemptAt).toEqual(new Date(at.getTime() + delays[attempt - 1]! * 1000));
        await x.process();
        expect(x.send).toHaveBeenCalledTimes(attempt);
        x.advance(delays[attempt - 1]!);
      } else
        expect(row).toMatchObject({
          state: "failed",
          nextAttemptAt: null,
          lastErrorCode: "SYNTHETIC_TEMPORARY",
        });
    }
    await x.process();
    expect(x.send).toHaveBeenCalledTimes(5);
  });

  it.each(["none", "enforced"] as const)(
    "retains ambiguous %s outcomes and retries only when the adapter enforces the same deduplication key",
    async (idempotency) => {
      const x = await setup({ idempotency });
      const observed = await x.observe();
      x.result({ state: "ambiguous", errorCode: "SYNTHETIC_AMBIGUOUS" });
      const first = await x.process();
      expect(first.state).toBe(idempotency === "none" ? "failed" : "queued");
      expect(
        (
          await x.service.list({
            siteId: x.siteId,
            actor: x.actor,
            incidentId: observed.incidentId,
          })
        ).items[0]!.outcome,
      ).toBe("unknown");
      x.advance(30);
      x.result({ state: "confirmed", providerMessageId: "late-dedup-receipt" });
      await x.process();
      expect(x.send).toHaveBeenCalledTimes(idempotency === "none" ? 1 : 2);
      if (idempotency === "enforced")
        expect(x.send.mock.calls[1]![0].deduplicationKey).toBe(
          x.send.mock.calls[0]![0].deduplicationKey,
        );
    },
  );

  it("recovers a crashed sending claim as unknown and fences a late confirmation from overwriting its recovery", async () => {
    const x = await setup();
    await x.observe();
    let release!: (result: NpAgentNotificationDeliveryResultV1) => void;
    let entered!: () => void;
    const reached = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const pending = new Promise<NpAgentNotificationDeliveryResultV1>((resolve) => {
      release = resolve;
    });
    x.send.mockImplementationOnce((_request, context) =>
      context.credentialLease.use(() => {
        entered();
        return pending;
      }),
    );
    const inFlight = x.process();
    try {
      await Promise.race([
        reached,
        inFlight.then(() => {
          throw new Error("Expected fake transport to enter the retained sending claim");
        }),
      ]);
      const sending = (await x.external())[0]!;
      expect(sending).toMatchObject({ state: "sending", attempts: 1 });
      x.advance(16);
      await x.process(sending.id, 1);
      expect((await x.external())[0]).toMatchObject({
        state: "queued",
        attempts: 1,
        lastErrorCode: "DELIVERY_AMBIGUOUS",
      });
    } finally {
      release({ state: "confirmed", providerMessageId: "stale-private-receipt" });
      await inFlight;
    }
    expect((await x.external())[0]).toMatchObject({
      state: "queued",
      attempts: 1,
      providerMessageId: null,
    });
    x.advance(30);
    await x.process();
    expect((await x.external())[0]!.state).toBe("sent");
    expect(x.send.mock.calls[0]![0].deduplicationKey).toBe(
      x.send.mock.calls[1]![0].deduplicationKey,
    );
  });

  it("blocks a disabled connection before opening any credential", async () => {
    const x = await setup();
    await x.observe();
    const current = await x.connections.getConnection({
      siteId: x.siteId,
      connectionId: x.connectionId,
    });
    await x.connections.disableConnection({
      siteId: x.siteId,
      connectionId: x.connectionId,
      expectedConfigVersion: current.configVersion,
    });
    const row = await x.process();
    expect(row.state).toBe("suppressed");
    expect(x.lease).not.toHaveBeenCalled();
    expect(x.send).not.toHaveBeenCalled();
  });

  it("blocks an owning config-version change before opening the retained notification credential", async () => {
    const x = await setup();
    await x.observe();
    const before = await x.connections.getConnection({
      siteId: x.siteId,
      connectionId: x.connectionId,
    });
    const update = await x.updateConfig(x.connectionConfig);
    if (update.schemaVersion !== "np.agent-connection-operation-status.v1")
      throw new Error("Expected owning config activation operation");
    expect(update.state).toBe("succeeded");
    const current = await x.connections.getConnection({
      siteId: x.siteId,
      connectionId: x.connectionId,
    });
    expect(current.configVersion).toBe(before.configVersion + 1);
    expect((await x.process()).state).toBe("suppressed");
    expect(x.lease).not.toHaveBeenCalled();
    expect(x.send).not.toHaveBeenCalled();
  });

  it("rejects corrupted account and destination snapshot bindings before opening any credential", async () => {
    for (const field of ["accountSubjectDigest", "destinationFingerprint"] as const) {
      const x = await setup({
        siteId: field === "accountSubjectDigest" ? "corrupt-account" : "corrupt-destination",
      });
      await x.observe();
      const row = (await x.external())[0]!;
      const value = row[field];
      if (!value) throw new Error("Expected installed connection binding");
      const modified = value.slice(0, -1) + (value.endsWith("A") ? "B" : "A");
      // Corruption fixture: ordinary outbox creation still belongs to the real owner.
      await x.db
        .update(npAgentNotifications)
        .set({ [field]: modified })
        .where(eq(npAgentNotifications.id, row.id));
      await x.process();
      expect(x.send).not.toHaveBeenCalled();
      expect(x.lease).not.toHaveBeenCalled();
      expect((await x.external())[0]!.state).not.toBe("sent");
    }
  });

  it("permits current secret rotation for the same account/config/destination without changing the delivery identity", async () => {
    const x = await setup();
    await x.observe();
    const before = (await x.external())[0]!;
    await x.rotateCredential();
    const after = await x.process();
    expect(after).toMatchObject({
      id: before.id,
      state: "sent",
      attempts: 1,
      deduplicationKey: before.deduplicationKey,
      destinationFingerprint: before.destinationFingerprint,
    });
    expect(x.send).toHaveBeenCalledTimes(1);
  });

  it.each(["before-lease", "after-lease"] as const)(
    "rechecks current authority %s without dispatching after revocation",
    async (phase) => {
      const x = await setup();
      await x.observe();
      if (phase === "before-lease") x.state.dispatch = false;
      else
        x.state.afterLease = () => {
          x.state.dispatch = false;
        };
      expect((await x.process()).state).toBe("suppressed");
      expect(x.lease).toHaveBeenCalledTimes(phase === "before-lease" ? 0 : 1);
      expect(x.send).not.toHaveBeenCalled();
    },
  );

  it("applies collection/category policy to the whole canonical Signal union even when primarySubject is null", async () => {
    const x = await setup();
    x.rules.resources.collections = ["posts"];
    const hidden = await x.observe(["posts", "discussions"]);
    const [incident] = await x.db
      .select()
      .from(npAgentIncidents)
      .where(eq(npAgentIncidents.id, hidden.incidentId));
    expect(incident!.primarySubject).toBeNull();
    expect(await x.local()).toHaveLength(1);
    expect(await x.external()).toEqual([]);
    x.rules.resources.collections = null;
    x.rules.resources.incidentCategories = ["availability"];
    await x.observe();
    expect(await x.external()).toEqual([]);
    x.rules.resources.incidentCategories = null;
    const allowed = await x.observe();
    expect(await x.external()).toHaveLength(1);
    x.state.afterLease = () => {
      x.rules.resources.collections = [];
    };
    expect((await x.process()).state).toBe("suppressed");
    expect(x.send).not.toHaveBeenCalled();
    x.state.visible = false;
    await expect(
      x.service.list({ siteId: x.siteId, actor: x.actor, incidentId: allowed.incidentId }),
    ).rejects.toBeDefined();
  });

  it("treats malformed adapter results as ambiguous without exposing raw receipt/error data", async () => {
    const x = await setup({ idempotency: "none" });
    const observed = await x.observe();
    const malformed: NpAgentNotificationDeliveryResultV1 & { rawBody: string } = {
      state: "confirmed",
      providerMessageId: "private-malformed-receipt",
      rawBody: "private-raw-adapter-output",
    };
    x.send.mockImplementationOnce((_request, context) =>
      context.credentialLease.use(() => Promise.resolve(malformed)),
    );
    const row = await x.process();
    expect(row).toMatchObject({
      state: "failed",
      lastErrorCode: "DELIVERY_AMBIGUOUS",
      providerMessageId: null,
    });
    const page = await x.service.list({
      siteId: x.siteId,
      actor: x.actor,
      incidentId: observed.incidentId,
    });
    expect(page.items[0]!.outcome).toBe("unknown");
    expect(JSON.stringify(page)).not.toContain("private-");
  });

  it("does not dispatch after the actual credential lease/attempt deadline expires during preflight", async () => {
    const x = await setup();
    await x.observe();
    x.state.afterLease = () => {
      x.advance(11);
    };
    const row = await x.process();
    expect(row.state).toBe("queued");
    expect(row.sentAt).toBeNull();
    expect(x.send).not.toHaveBeenCalled();
  });

  it("retries a transient vault-open failure as proven not-sent without leaking its exception", async () => {
    const x = await setup();
    const observed = await x.observe();
    x.lease.mockRejectedValueOnce(new Error("private-transient-vault-details"));
    const row = await x.process();
    expect(row).toMatchObject({ state: "queued", attempts: 1, sentAt: null });
    expect(row.nextAttemptAt).toEqual(new Date(x.now().getTime() + 30000));
    expect(x.send).not.toHaveBeenCalled();
    const page = await x.service.list({
      siteId: x.siteId,
      actor: x.actor,
      incidentId: observed.incidentId,
    });
    expect(page.items[0]!.outcome).toBe("not-sent");
    expect(JSON.stringify(page)).not.toContain("private-transient-vault-details");
    x.advance(30);
    expect((await x.process()).state).toBe("sent");
    expect(x.send).toHaveBeenCalledTimes(1);
  });

  it("does not redirect a queued receipt when current routing swaps its recipient identity", async () => {
    const x = await setup();
    await x.observe();
    const replacement = await notificationDeliveryFixture({ siteId: x.siteId, now: x.now });
    cleanup.push(replacement);
    x.state.recipient = replacement.actor;
    expect((await x.process()).state).toBe("suppressed");
    expect(x.lease).not.toHaveBeenCalled();
    expect(x.send).not.toHaveBeenCalled();
    expect(replacement.send).not.toHaveBeenCalled();
  });

  it("treats a nonfinite real-lease expiry projection as not-sent and never invokes the transport", async () => {
    const x = await setup();
    await x.observe();
    x.state.leaseExpiry = "not-a-date";
    const row = await x.process();
    expect(row).toMatchObject({ state: "queued", attempts: 1, sentAt: null });
    expect(x.lease).toHaveBeenCalledTimes(1);
    expect(x.send).not.toHaveBeenCalled();
    x.state.leaseExpiry = null;
    x.advance(30);
    expect((await x.process()).state).toBe("sent");
    expect(x.send).toHaveBeenCalledTimes(1);
  });

  it("retains a confirmed transport outcome after access is revoked during the send while protecting subsequent reads", async () => {
    const x = await setup();
    const observed = await x.observe();
    x.send.mockImplementationOnce((_request, context) =>
      context.credentialLease.use(() => {
        x.state.visible = false;
        x.state.dispatch = false;
        return Promise.resolve({
          state: "confirmed",
          providerMessageId: "private-confirmed-before-revocation",
        });
      }),
    );
    const row = await x.process();
    expect(row).toMatchObject({
      state: "sent",
      attempts: 1,
      providerMessageId: "private-confirmed-before-revocation",
    });
    const proof = npRequireAgentNotificationDeliveryCanonical(row.deliveryDigestBody);
    expect(proof.result.state).toBe("confirmed");
    await expect(
      x.service.list({ siteId: x.siteId, actor: x.actor, incidentId: observed.incidentId }),
    ).rejects.toBeDefined();
    await x.process(row.id, 0);
    expect(x.send).toHaveBeenCalledTimes(1);
    x.state.visible = true;
    const page = await x.service.list({
      siteId: x.siteId,
      actor: x.actor,
      incidentId: observed.incidentId,
    });
    expect(page.items[0]!.outcome).toBe("confirmed");
    expect(JSON.stringify(page)).not.toContain("private-confirmed-before-revocation");
  });

  it("converges a confirmed result after Runtime control state becomes unverifiable without granting another attempt", async () => {
    const x = await setup();
    const observed = await x.observe();
    x.send.mockImplementationOnce((_request, context) =>
      context.credentialLease.use(async () => {
        // Post-dispatch corruption fixture: new-work admission must now fail closed.
        await x.db
          .insert(npSettings)
          .values({ siteId: x.siteId, key: "agents.runtime.control", value: { revision: 0 } })
          .onConflictDoUpdate({
            target: [npSettings.siteId, npSettings.key],
            set: { value: { revision: 0 } },
          });
        return { state: "confirmed", providerMessageId: "confirmed-after-control-invalidation" };
      }),
    );
    const row = await x.process();
    expect(row).toMatchObject({
      state: "sent",
      attempts: 1,
      providerMessageId: "confirmed-after-control-invalidation",
    });
    expect(npRequireAgentNotificationDeliveryCanonical(row.deliveryDigestBody).result.state).toBe(
      "confirmed",
    );
    await expect(x.process(row.id, 1)).rejects.toMatchObject({ code: "RUNTIME_STATE_INVALID" });
    expect(x.send).toHaveBeenCalledTimes(1);
    const page = await x.service.list({
      siteId: x.siteId,
      actor: x.actor,
      incidentId: observed.incidentId,
    });
    expect(page.items[0]!.outcome).toBe("confirmed");
  });

  it("enforces collection limits from canonical Events when Signal subjects and Event references omit collection names", async () => {
    const x = await setup();
    x.rules.resources.collections = ["posts"];
    const forbiddenRuntime = vi.fn(() =>
      Promise.reject(new Error("Recording source evidence must not activate Runtime")),
    );
    const recorder = createAgentRuntimeEventServiceV1({
      admission: {
        admit: forbiddenRuntime,
        retry: forbiddenRuntime,
        withCurrentRun: forbiddenRuntime,
        withRunAuthority: forbiddenRuntime,
      },
      deploymentAuthority: {
        policyId: "notification-source-fixture",
        fingerprint: digest,
        scopes: ["site:read"],
      },
      now: x.now,
    });
    const base = await candidate(x.siteId, x.now(), ["posts", "discussions"]);
    const facts: NpAgentModeratorFactV1[] = [];
    for (const fact of base.facts) {
      if (fact.subject.kind !== "document") throw new Error("Expected synthetic document source");
      const event = npRequireAgentEventCanonical({
        version: "np.agent-event.v1",
        siteId: x.siteId,
        kind: "community.content.reported",
        occurredAt: fact.observedAt,
        source: { kind: "community", component: "community.document-reports" },
        subject: { ...fact.subject },
        actor: { kind: "member", memberId: randomUUID() },
        causation: null,
        correlationId: null,
        deduplicationKey: `notification-source:${randomUUID()}`,
        privacy: "internal",
        payload: {
          kind: "community.content.reported",
          targetKind: "document",
          targetId: fact.subject.documentId,
          collection: fact.subject.collection,
          authorMemberId: fact.memberId,
          verdictCode: "DOCUMENT_REPORT_FILED",
          status: "visible",
        },
      });
      const recorded = await recorder.record({ siteId: x.siteId, event });
      const eventHash = await npDigestAgentEventCanonical(event);
      facts.push({
        ...fact,
        spamVerdict: "unknown",
        profanityVerdict: "unknown",
        evidence: {
          kind: "event",
          eventId: recorded.eventId,
          eventKind: event.kind,
          observedAt: event.occurredAt,
          digest: Buffer.from(eventHash.slice("cj1:sha256:".length), "base64url").toString("hex"),
          excerpt: null,
        },
      });
    }
    const [source] = await npDetectAgentRepeatedLinkSpamV1({
      siteId: x.siteId,
      windowStartedAt: base.canonicalEvidence.window.startedAt,
      settings: {
        recipeId: "moderator.repeated-link-spam",
        recipeVersion: 1,
        collectionSlugs: ["posts", "discussions"],
        windowSeconds: 600,
        minIndependentAccounts: 3,
        minItems: 5,
        automaticConfidenceBasisPoints: 9900,
      },
      facts,
    });
    if (!source) throw new Error("Expected canonical Event-backed Signal");
    const observed = await x.writer.observe(source);
    const [incident] = await x.db
      .select()
      .from(npAgentIncidents)
      .where(eq(npAgentIncidents.id, observed.incidentId));
    expect(incident).toMatchObject({ primarySubject: null, eventCount: 5 });
    expect(await x.db.select().from(npAgentEvents)).toHaveLength(5);
    expect(await x.local()).toHaveLength(1);
    expect(await x.external()).toEqual([]);
    expect(x.lease).not.toHaveBeenCalled();
    expect(x.send).not.toHaveBeenCalled();
    expect(forbiddenRuntime).not.toHaveBeenCalled();
  });

  it("rejects foreign site work and corrupted outbox source evidence before credential access", async () => {
    const x = await setup();
    await x.observe();
    const [row] = await x.external();
    await createSite({ id: "foreign", name: "Other notification site" });
    await x.service.process({ siteId: "foreign", notificationId: row!.id, expectedAttempt: 0 });
    expect((await x.external())[0]!.attempts).toBe(0);
    // Explicit corruption fixture: rows otherwise come only from the owning outbox service.
    await x.db
      .update(npAgentNotifications)
      .set({ payloadRedacted: { ...row!.payloadRedacted, sourceNotificationId: randomUUID() } })
      .where(eq(npAgentNotifications.id, row!.id));
    await x.process();
    expect(x.send).not.toHaveBeenCalled();
    expect(x.lease).not.toHaveBeenCalled();
    expect((await x.external())[0]!.state).not.toBe("sent");
  });

  it("recovers lost enqueue in bounded fair sweeps without replaying historical pre-installation notifications", async () => {
    const x = await setup({ external: false });
    for (let i = 0; i < 26; i++) await x.observe();
    const history = await setup({ siteId: "pre-installation-notifications", external: false });
    await history.observe();
    const disabledHistory = createAgentNotificationDeliveryServiceV1({
      connections: history.connections,
      registry: history.registry,
      vault: history.vault,
      reads: createAgentIncidentServiceV1({
        cursorHmacKey: new Uint8Array(32).fill(95),
        canReadIncident: () => false,
        canReadStaffIncident: () => true,
      }).staff,
      cursorHmacKey: new Uint8Array(32).fill(96),
      notBefore: new Date(history.now().getTime() + 1000).toISOString(),
      now: history.now,
      resolveRoutes: () =>
        Promise.resolve([{ channel: "email", connectionId: history.connectionId }]),
      authorizeRoute: () =>
        Promise.resolve({
          policy: {
            autonomy: "advise",
            capabilityModes: history.rules.capabilityModes,
            layers: [history.rules],
          },
          recipient: { siteId: history.siteId, actor: history.actor },
        }),
    });
    await disabledHistory.reconcile({ siteId: history.siteId });
    expect(await history.external()).toEqual([]);
    setJobQueue({
      enqueue: x.enqueue,
      start: () => Promise.resolve(),
      stop: () => Promise.resolve(),
      countSiteEnqueues: () => Promise.resolve(0),
    });
    await x.service.reconcile({ siteId: x.siteId });
    expect(await x.external()).toHaveLength(25);
    await x.service.reconcile({ siteId: x.siteId });
    expect(await x.external()).toHaveLength(26);
    expect(x.send).not.toHaveBeenCalled();
    const beforeFailure = x.enqueue.mock.calls.length;
    x.enqueue.mockRejectedValueOnce(new Error("Synthetic queue unavailable"));
    let failed = false;
    // New outbox UUIDs may sort before a retained cursor. Reach the next fair wrap.
    for (let i = 0; i < 2 && !failed; i++) {
      try {
        await x.service.reconcile({ siteId: x.siteId });
      } catch (error) {
        expect(error).toMatchObject({ code: "NOTIFICATION_DELIVERY_UNAVAILABLE" });
        failed = true;
      }
    }
    expect(failed).toBe(true);
    const failedCall = x.enqueue.mock.calls[beforeFailure];
    if (!failedCall || failedCall[0] !== "agent:notificationSend")
      throw new Error("Expected failed notification enqueue");
    const failedPayload = npNormalizeJobPayload("agent:notificationSend", failedCall[1]);
    expect(await x.external()).toHaveLength(26);
    for (let i = 0; i < 2; i++) await x.service.reconcile({ siteId: x.siteId });
    const queued = x.enqueue.mock.calls.flatMap(([type, payload]) =>
      type === "agent:notificationSend"
        ? [npNormalizeJobPayload("agent:notificationSend", payload)]
        : [],
    );
    expect(
      queued.filter((payload) => payload.notificationId === failedPayload.notificationId).length,
    ).toBeGreaterThanOrEqual(2);
    expect(queued.length).toBeGreaterThan(25);
    expect(queued.every((payload) => payload.siteId === x.siteId)).toBe(true);
    expect((await x.external()).every((row) => row.state === "queued" && row.attempts === 0)).toBe(
      true,
    );
    expect(await history.external()).toEqual([]);
    expect(x.send).not.toHaveBeenCalled();
  });
});
