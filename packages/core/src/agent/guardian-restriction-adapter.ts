import { createHash } from "node:crypto";
import { and, asc, eq, gt, inArray, lte, or, sql } from "drizzle-orm";
import { npWithAgentRuntimeControlTransactionV1 } from "./runtime-controls.js";
import { npAssertAgentPreviewEffectsAllowed } from "./changeset-preview-overlay.js";
import { npLockSiteQuotas } from "../sites/quotas.js";
import { getDb } from "../db/runtime.js";
import { npAgentActorRestrictions, npAgentRestrictionEnforcements } from "../db/schema/agent.js";
import {
  npDigestAgentRestrictionCanonical,
  npRequireAgentRestrictionCanonical,
} from "../agent-contract/canonical-restriction.js";
import { serializeAgentCanonicalJson } from "../agent-contract/canonical-foundation.js";
import {
  npAgentRestrictionSubjectKeyV1,
  npRequireAgentRestrictionCheckV1,
  npRequireAgentRestrictionDecisionV1,
  npRequireAgentRestrictionGenerationV1,
  npRequireAgentRestrictionMutationKeyV1,
  npRequireAgentRestrictionMutationResultV1,
  npRequireAgentRestrictionVerifyResultV1,
  npSameAgentRestrictionSubjectV1,
  type NpAgentRestrictionAdapter,
  type NpAgentRestrictionMutationContext,
  type NpAgentRestrictionMutationResultV1,
} from "../agent-contract/restriction-adapter-contract.js";
import type {
  NpAgentActorBucketPurposeV1,
  NpAgentRestrictionCanonicalV1,
} from "../agent-contract/types.js";

type Db = ReturnType<typeof getDb>;
type Enforcement = typeof npAgentRestrictionEnforcements.$inferSelect;
export const npAgentPostgresRestrictionAdapterIdentityV1 = {
  id: "np-postgres-restriction",
  contractVersion: 1,
  fingerprint: "np-postgres-restriction/v1/canonical-ttl-tombstone",
} as const;
const same = (a: unknown, b: unknown) =>
  serializeAgentCanonicalJson(a) === serializeAgentCanonicalJson(b);
const resultDigest = (body: object) =>
  `cj1:sha256:${createHash("sha256").update("np.agent-restriction-adapter-result.v1\0").update(serializeAgentCanonicalJson(body)).digest("base64url")}`;
const conflict = (): never => {
  throw new Error("GUARDIAN_RESTRICTION_ADAPTER_CONFLICT");
};
const aborted = (signal: AbortSignal) => {
  if (signal.aborted) throw new Error("GUARDIAN_RESTRICTION_ADAPTER_ABORTED");
};
async function verifiedRow(row: Enforcement): Promise<NpAgentRestrictionCanonicalV1> {
  const descriptor = npRequireAgentRestrictionCanonical(row.descriptor);
  if (
    descriptor.restrictionId !== row.id ||
    descriptor.siteId !== row.siteId ||
    (await npDigestAgentRestrictionCanonical(descriptor)) !== row.restrictionHash ||
    npAgentRestrictionSubjectKeyV1(descriptor.subject) !== row.subjectKey ||
    !same(descriptor.actionScopes, row.actionScopes) ||
    descriptor.startsAt !== row.startsAt.toISOString() ||
    descriptor.expiresAt !== row.expiresAt.toISOString()
  )
    conflict();
  return descriptor;
}
async function boundedRead<T>(db: Db, read: (tx: Db) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`set local lock_timeout='100ms'`);
    await tx.execute(sql`set local statement_timeout='500ms'`);
    return read(tx);
  });
}
export interface NpAgentPostgresRestrictionAdapterOptionsV1 {
  /** Existing host DB handle, including a separately initialized proxy runtime. Never opens a pool. */
  db?: () => Db;
  now?: () => Date;
}
/** Explicit shared reference adapter. Tombstones permanently prevent delayed install resurrection. */
export function createAgentPostgresRestrictionAdapterV1(
  options: NpAgentPostgresRestrictionAdapterOptionsV1 = {},
): NpAgentRestrictionAdapter {
  const db = options.db ?? getDb,
    now = options.now ?? (() => new Date());
  async function mutate(
    value: NpAgentRestrictionCanonicalV1,
    context: NpAgentRestrictionMutationContext,
    operation: "install" | "remove",
  ): Promise<NpAgentRestrictionMutationResultV1> {
    npAssertAgentPreviewEffectsAllowed();
    aborted(context.signal);
    const descriptor = npRequireAgentRestrictionCanonical(value),
      hash = await npDigestAgentRestrictionCanonical(descriptor);
    const key = npRequireAgentRestrictionMutationKeyV1(context.idempotencyKey),
      generation = npRequireAgentRestrictionGenerationV1(context.expectedRowVersion);
    return db().transaction(async (tx) => {
      await tx.execute(sql`set local lock_timeout='100ms'`);
      await tx.execute(sql`set local statement_timeout='500ms'`);
      if (operation === "install")
        await npWithAgentRuntimeControlTransactionV1(
          descriptor.siteId,
          () => Promise.resolve(undefined),
          tx as Db,
        );
      else
        await npLockSiteQuotas(
          tx as unknown as Parameters<typeof npLockSiteQuotas>[0],
          descriptor.siteId,
        );
      const time = now();
      if (
        operation === "install" &&
        (time.getTime() < Date.parse(descriptor.startsAt) ||
          time.getTime() >= Date.parse(descriptor.expiresAt))
      )
        conflict();
      if (operation === "install" && descriptor.subject.kind === "opaque_actor_bucket") {
        const refs = await npReadAgentActiveRestrictionProjectionRefsV1({
          db: tx,
          siteId: descriptor.siteId,
          now: time,
        });
        const subject = descriptor.subject;
        if (
          refs.length >= 8 &&
          !refs.some(
            (ref) =>
              ref.purpose === subject.purpose &&
              ref.projectionVersion === subject.projectionVersion &&
              ref.projectionFingerprint === subject.projectionFingerprint &&
              ref.keyId === subject.keyId,
          )
        )
          conflict();
      }
      aborted(context.signal);
      const inserted = await tx
        .insert(npAgentRestrictionEnforcements)
        .values({
          id: descriptor.restrictionId,
          siteId: descriptor.siteId,
          descriptor,
          restrictionHash: hash,
          subjectKey: npAgentRestrictionSubjectKeyV1(descriptor.subject),
          actionScopes: descriptor.actionScopes,
          installKey: key,
          removeKey: operation === "remove" ? key : null,
          expectedRowVersion: generation,
          state: operation === "install" ? "installed" : "removed",
          startsAt: new Date(descriptor.startsAt),
          expiresAt: new Date(descriptor.expiresAt),
          createdAt: time,
          updatedAt: time,
        })
        .onConflictDoNothing()
        .returning({ id: npAgentRestrictionEnforcements.id });
      const [row] = await tx
        .select()
        .from(npAgentRestrictionEnforcements)
        .where(
          and(
            eq(npAgentRestrictionEnforcements.id, descriptor.restrictionId),
            eq(npAgentRestrictionEnforcements.siteId, descriptor.siteId),
          ),
        )
        .for("update");
      if (
        !row ||
        row.restrictionHash !== hash ||
        row.expectedRowVersion !== generation ||
        !same(await verifiedRow(row), descriptor)
      )
        conflict();
      if (
        operation === "install" &&
        (row.state !== "installed" ||
          row.installKey !== key ||
          now().getTime() >= row.expiresAt.getTime())
      )
        conflict();
      let status: NpAgentRestrictionMutationResultV1["status"];
      if (operation === "install") status = inserted.length ? "installed" : "already_installed";
      else {
        status = !inserted.length && row.state === "installed" ? "removed" : "already_absent";
        if (row.state === "installed")
          await tx
            .update(npAgentRestrictionEnforcements)
            .set({ state: "removed", removeKey: key, updatedAt: time })
            .where(
              and(
                eq(npAgentRestrictionEnforcements.id, row.id),
                eq(npAgentRestrictionEnforcements.state, "installed"),
              ),
            );
      }
      const body = {
        schemaVersion: "np.agent-restriction-mutation-result.v1" as const,
        status,
        restrictionId: descriptor.restrictionId,
        enforcementRef: `postgres:${descriptor.restrictionId}`,
        effectiveExpiresAt: operation === "install" ? descriptor.expiresAt : null,
      };
      // An abort after the transaction commits remains a caller-visible unknown effect.
      aborted(context.signal);
      return npRequireAgentRestrictionMutationResultV1({
        ...body,
        resultDigest: resultDigest(body),
      });
    });
  }
  return {
    ...npAgentPostgresRestrictionAdapterIdentityV1,
    sharedAcrossReplicas: true,
    install: (descriptor, context) => mutate(descriptor, context, "install"),
    remove: (descriptor, context) => mutate(descriptor, context, "remove"),
    async verify(value, { signal }) {
      aborted(signal);
      const descriptor = npRequireAgentRestrictionCanonical(value),
        hash = await npDigestAgentRestrictionCanonical(descriptor);
      const [row] = await boundedRead(db(), async (tx) =>
        tx
          .select()
          .from(npAgentRestrictionEnforcements)
          .where(
            and(
              eq(npAgentRestrictionEnforcements.id, descriptor.restrictionId),
              eq(npAgentRestrictionEnforcements.siteId, descriptor.siteId),
            ),
          ),
      );
      if (row && (row.restrictionHash !== hash || !same(await verifiedRow(row), descriptor)))
        conflict();
      const state =
        !row || row.state === "removed"
          ? "absent"
          : now().getTime() >= row.expiresAt.getTime()
            ? "expired"
            : "installed";
      const body = {
        schemaVersion: "np.agent-restriction-verify-result.v1" as const,
        state,
        restrictionId: descriptor.restrictionId,
        effectiveExpiresAt:
          state === "installed" || state === "expired" ? descriptor.expiresAt : null,
      };
      aborted(signal);
      return npRequireAgentRestrictionVerifyResultV1({ ...body, resultDigest: resultDigest(body) });
    },
    async check(value, { signal }) {
      aborted(signal);
      const request = npRequireAgentRestrictionCheckV1(value),
        time = now();
      if (Math.abs(time.getTime() - Date.parse(request.observedAt)) > 60000) conflict();
      const rows = await boundedRead(db(), async (tx) =>
        tx
          .select()
          .from(npAgentRestrictionEnforcements)
          .where(
            and(
              eq(npAgentRestrictionEnforcements.siteId, request.siteId),
              eq(npAgentRestrictionEnforcements.state, "installed"),
              inArray(
                npAgentRestrictionEnforcements.subjectKey,
                request.subjects.map(npAgentRestrictionSubjectKeyV1),
              ),
              lte(npAgentRestrictionEnforcements.startsAt, time),
              gt(npAgentRestrictionEnforcements.expiresAt, time),
              sql`${npAgentRestrictionEnforcements.actionScopes} @> ARRAY[${request.actionScope}]::text[]`,
              or(
                ...request.subjects.map(
                  (subject) =>
                    sql`${npAgentRestrictionEnforcements.descriptor}->'subject'=${serializeAgentCanonicalJson(subject)}::jsonb`,
                ),
              ),
            ),
          )
          .orderBy(asc(npAgentRestrictionEnforcements.id))
          .limit(1),
      );
      let matched: Enforcement | undefined;
      for (const row of rows) {
        const descriptor = await verifiedRow(row);
        if (request.subjects.some((s) => npSameAgentRestrictionSubjectV1(s, descriptor.subject)))
          matched ??= row;
      }
      const body = {
        schemaVersion: "np.agent-restriction-decision.v1" as const,
        decision: matched ? "deny" : "allow",
        restrictionId: matched?.id ?? null,
        matchedSubjectKey: matched?.subjectKey ?? null,
        expiresAt: matched?.expiresAt.toISOString() ?? null,
      };
      aborted(signal);
      return npRequireAgentRestrictionDecisionV1(
        { ...body, resultDigest: resultDigest(body) },
        { ...request, observedAt: time.toISOString() },
      );
    },
    async healthCheck() {
      const checkedAt = now().toISOString();
      try {
        await boundedRead(db(), async (tx) =>
          tx
            .select({ id: npAgentRestrictionEnforcements.id })
            .from(npAgentRestrictionEnforcements)
            .limit(1),
        );
        return {
          schemaVersion: "np.agent-restriction-health.v1",
          status: "ready",
          sharedAcrossReplicas: true,
          checkedAt,
          safeCodes: [],
        };
      } catch {
        return {
          schemaVersion: "np.agent-restriction-health.v1",
          status: "unavailable",
          sharedAcrossReplicas: true,
          checkedAt,
          safeCodes: ["RESTRICTION_STORAGE_UNAVAILABLE"],
        };
      }
    },
  };
}

export interface NpAgentRestrictionProjectionRefV1 {
  purpose: NpAgentActorBucketPurposeV1;
  projectionVersion: number;
  projectionFingerprint: string;
  keyId: string;
}
/** Include pending/cleanup work and independently committed effects; never recover raw actors. */
export async function npReadAgentActiveRestrictionProjectionRefsV1(input: {
  db: Db;
  siteId: string;
  now?: Date;
}): Promise<NpAgentRestrictionProjectionRefV1[]> {
  return boundedRead(input.db, async (db) => {
    const time = input.now ?? new Date();
    const workflowProjection = sql`(${npAgentActorRestrictions.descriptor}->'subject') - 'bucket'`;
    const effectProjection = sql`(${npAgentRestrictionEnforcements.descriptor}->'subject') - 'bucket'`;
    const workflows = await db
      .selectDistinctOn([workflowProjection])
      .from(npAgentActorRestrictions)
      .where(
        and(
          eq(npAgentActorRestrictions.siteId, input.siteId),
          inArray(npAgentActorRestrictions.state, ["pending", "active", "removing"]),
          gt(npAgentActorRestrictions.expiresAt, time),
          sql`${npAgentActorRestrictions.descriptor}->'subject'->>'kind'='opaque_actor_bucket'`,
        ),
      )
      .orderBy(workflowProjection, asc(npAgentActorRestrictions.id))
      .limit(9);
    const effects = await db
      .selectDistinctOn([effectProjection])
      .from(npAgentRestrictionEnforcements)
      .where(
        and(
          eq(npAgentRestrictionEnforcements.siteId, input.siteId),
          eq(npAgentRestrictionEnforcements.state, "installed"),
          gt(npAgentRestrictionEnforcements.expiresAt, time),
          sql`${npAgentRestrictionEnforcements.descriptor}->'subject'->>'kind'='opaque_actor_bucket'`,
        ),
      )
      .orderBy(effectProjection, asc(npAgentRestrictionEnforcements.id))
      .limit(9);
    if (workflows.length > 8 || effects.length > 8) conflict();
    const descriptors: NpAgentRestrictionCanonicalV1[] = [];
    for (const row of workflows) {
      const d = npRequireAgentRestrictionCanonical(row.descriptor);
      if (
        d.siteId !== input.siteId ||
        d.restrictionId !== row.id ||
        (await npDigestAgentRestrictionCanonical(d)) !== row.restrictionHash ||
        d.expiresAt !== row.expiresAt.toISOString() ||
        npAgentRestrictionSubjectKeyV1(d.subject) !== row.subjectKey ||
        row.adapterId !== npAgentPostgresRestrictionAdapterIdentityV1.id ||
        row.adapterContractVersion !==
          npAgentPostgresRestrictionAdapterIdentityV1.contractVersion ||
        row.adapterFingerprint !== npAgentPostgresRestrictionAdapterIdentityV1.fingerprint
      )
        conflict();
      descriptors.push(d);
    }
    for (const row of effects) descriptors.push(await verifiedRow(row));
    const refs = new Map<string, NpAgentRestrictionProjectionRefV1>();
    for (const d of descriptors)
      if (d.subject.kind === "opaque_actor_bucket") {
        const { purpose, projectionVersion, projectionFingerprint, keyId } = d.subject;
        const ref = { purpose, projectionVersion, projectionFingerprint, keyId };
        refs.set(serializeAgentCanonicalJson(ref), ref);
      }
    if (refs.size > 8) conflict();
    return [...refs.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([, v]) => v);
  });
}
