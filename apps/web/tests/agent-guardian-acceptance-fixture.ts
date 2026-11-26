import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { eq } from "drizzle-orm";
import {
  npRequireAuthUser,
  type NpAuthUser,
} from "../../../packages/core/src/auth-contract/index.js";
import { npUsers } from "../../../packages/core/src/db/schema/system.js";
import { createSite } from "../../../packages/core/src/sites/registry.js";
import { withCurrentSite } from "../../../packages/core/src/sites/context.js";
import {
  saveDocument,
  withDeferredPostCommit,
} from "../../../packages/core/src/collections/pipeline.js";
import {
  resetCollectionMutationObserverV1,
  setCollectionMutationObserverV1,
} from "../../../packages/core/src/collections/mutation-observer.js";
import { createAgentRuntimeEventServiceV1 } from "../../../packages/core/src/agent/runtime-event-service.js";
import {
  createAgentGuardianObservationServiceV1,
  type NpAgentGuardianObservationV1,
} from "../../../packages/core/src/agent/guardian-observation-service.js";
import { createAgentGuardianContentObservationServiceV1 } from "../../../packages/core/src/agent/guardian-content-observation.js";
import { getTestDb, seedUser, skipIfNoTestDb } from "./harness.js";

/** Expensive, isolated acceptance only. An unset gate is a skip, never a pass.
 * Execute with workers=1 and file parallelism disabled. */
export const skipGuardianAcceptance =
  skipIfNoTestDb() || process.env.NP_TEST_GUARDIAN_ACCEPTANCE !== "1";
/** Declared before measurements; includes the full real-CMS 10k setup. */
export const guardianAcceptanceTimeoutMs = 600_000;
/** Frozen request budget. Do not adjust in response to a measured failure. */
export const guardianRequestBudgetV1 = Object.freeze({ absoluteMs: 5, baselineFraction: 0.05 });
export const guardianAcceptanceCount = 10_000;

export function guardianNetwork(index: number): string {
  const value = index + 1;
  return `2001:db8::${Math.floor(value / 65_536).toString(16)}:${(value % 65_536).toString(16)}`;
}
export function guardianQuantiles(values: readonly number[]) {
  if (!values.length) throw new Error("Cannot report an empty timing cohort");
  const sorted = [...values].sort((a, b) => a - b);
  const pick = (q: number) => sorted[Math.max(0, Math.ceil(sorted.length * q) - 1)];
  return { samples: sorted.length, p50Ms: pick(0.5), p95Ms: pick(0.95), maxMs: sorted.at(-1)! };
}
export function guardianReport(name: string, facts: object): void {
  console.info(JSON.stringify({ schemaVersion: "np.guardian-acceptance.v1", name, ...facts }));
}
/** Bounded callers, one source instance; rejects are counted by the caller. */
export async function guardianParallel<T>(
  values: readonly T[],
  concurrency: number,
  operation: (value: T, index: number) => Promise<void>,
): Promise<void> {
  let next = 0;
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      for (;;) {
        const index = next++;
        if (index >= values.length) return;
        await operation(values[index], index);
      }
    }),
  );
}

export async function guardianSourceFixture(siteIds: readonly string[], now: () => Date) {
  const db = await getTestDb();
  for (const siteId of siteIds)
    if (siteId !== "default")
      await createSite({ id: siteId, name: siteId, hostname: `${siteId}.example.test` });
  let forbiddenCalls = 0;
  const forbidden = () => {
    forbiddenCalls++;
    return Promise.reject(new Error("Acceptance source cannot admit, enqueue or call a provider"));
  };
  const events = createAgentRuntimeEventServiceV1({
    admission: {
      admit: forbidden,
      retry: forbidden,
      withCurrentRun: forbidden,
      withRunAuthority: forbidden,
    },
    deploymentAuthority: {
      policyId: "guardian-acceptance-local-source",
      fingerprint: `cj1:sha256:${"A".repeat(43)}`,
      scopes: [],
    },
    enqueueRun: forbidden,
    now,
  });
  const requestSource = createAgentGuardianObservationServiceV1({
    actorKey: { id: "guardian-acceptance-request", bytes: new Uint8Array(32).fill(103) },
    receiptKey: { id: "guardian-acceptance-request-receipt", bytes: new Uint8Array(32).fill(105) },
    isInstalledSite: async (siteId) => siteIds.includes(siteId),
    authorize: async () => {},
    events,
    now,
  });
  const contentSource = createAgentGuardianContentObservationServiceV1({
    receiptKey: { id: "guardian-acceptance-content", bytes: new Uint8Array(32).fill(104) },
    installedSiteIds: siteIds,
    authorize: async () => {},
    events,
    now,
  });
  return { db, events, requestSource, contentSource, forbiddenCalls: () => forbiddenCalls };
}
export type GuardianAcceptanceFixture = Awaited<ReturnType<typeof guardianSourceFixture>>;

export function guardianRequestInputs(siteId: string, occurredAt: string) {
  return Array.from(
    { length: guardianAcceptanceCount },
    (_, index): NpAgentGuardianObservationV1 => ({
      siteId,
      observationId: randomUUID(),
      occurredAt,
      networkAddress: guardianNetwork(Math.floor(index / 5)),
      kind: "login-failed",
      audience: "staff",
      loginIdentifier: `synthetic-account-${Math.floor(index / 5)}@example.test`,
    }),
  );
}
async function staff(): Promise<NpAuthUser> {
  const seeded = await seedUser();
  const db = await getTestDb();
  const [row] = await db.select().from(npUsers).where(eq(npUsers.id, seeded.userId));
  if (!row) throw new Error("Missing real seeded staff account");
  return npRequireAuthUser({
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role,
    tokenVersion: row.tokenVersion,
  });
}

/** Every receipt comes from an actual committed pipeline save. No receipt,
 * signature, revision, Event or Signal is constructed by the fixture.
 * Tags have versions disabled: this measures honest committed-save coverage. */
export async function guardianPrepareContent(
  fixture: GuardianAcceptanceFixture,
  cohorts: readonly { siteId: string; count: number }[],
): Promise<{
  preparationMs: number;
  committedSaves: number;
  documents: Map<string, string>;
  users: readonly NpAuthUser[];
}> {
  const started = performance.now();
  const users = [await staff(), await staff(), await staff()];
  const documents = new Map<string, string>();
  let committedSaves = 0;
  setCollectionMutationObserverV1(fixture.contentSource.mutationObserver);
  try {
    for (const cohort of cohorts) {
      let documentId: string | null = null;
      // Bounded genuine outer transactions; keep hooks/effects and same-TX capture.
      for (let first = 0; first < cohort.count; first += 250)
        await withCurrentSite(cohort.siteId, () =>
          withDeferredPostCommit(() =>
            fixture.db.transaction(async (tx) => {
              for (let index = first; index < Math.min(first + 250, cohort.count); index++) {
                const saved = await saveDocument(
                  "tags",
                  documentId,
                  { name: `Capacity ${cohort.siteId}`, description: `Committed save ${index}` },
                  users[index % users.length],
                  { tx },
                );
                if (typeof saved.doc.id !== "string") throw new Error("Missing committed document");
                documentId = saved.doc.id;
                committedSaves++;
              }
            }),
          ),
        );
      if (!documentId) throw new Error("Expected a nonempty content cohort");
      documents.set(cohort.siteId, documentId);
    }
  } finally {
    resetCollectionMutationObserverV1();
  }
  return { preparationMs: performance.now() - started, committedSaves, documents, users };
}
