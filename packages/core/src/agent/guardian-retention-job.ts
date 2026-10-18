import { and, eq, sql } from "drizzle-orm";
import {
  canonicalBodyInteger,
  canonicalBodyRecord,
  canonicalBodySiteId,
  canonicalBodyUuid,
} from "../agent-contract/canonical-body-validation.js";
import { serializeAgentCanonicalJson } from "../agent-contract/canonical-foundation.js";
import { npSettings } from "../db/schema/system.js";
import type { getDb } from "../db/runtime.js";
import { npWithAgentRuntimeRetentionBudgetV1 } from "./runtime-retention-budget.js";
import { npWithAgentRuntimeControlTransactionV1 } from "./runtime-controls.js";
import type { NpAgentGuardianRetentionServiceV1 } from "./guardian-retention-service.js";

const key = "guardian.retention.cursor";
function state(value: unknown, siteId: string) {
  const keys = ["schemaVersion", "siteId", "revision", "cursor"];
  const r = canonicalBodyRecord(value, key, keys, keys, { seen: new WeakSet() });
  if (r.schemaVersion !== "np.agent-guardian-retention-cursor.v1" || r.siteId !== siteId)
    throw new Error("Invalid Guardian retention cursor");
  return {
    schemaVersion: "np.agent-guardian-retention-cursor.v1" as const,
    siteId: canonicalBodySiteId(r.siteId, key),
    revision: canonicalBodyInteger(r.revision, key, 0, 2147483647),
    cursor: r.cursor === null ? null : canonicalBodyUuid(r.cursor, key),
  };
}
async function read(db: ReturnType<typeof getDb>, siteId: string) {
  const [row] = await db
    .select({
      value: sql<unknown>`case when octet_length(${npSettings.value}::text)<=2048 then ${npSettings.value} else null end`,
    })
    .from(npSettings)
    .where(and(eq(npSettings.siteId, siteId), eq(npSettings.key, key)))
    .limit(1);
  return state(
    row
      ? row.value
      : {
          schemaVersion: "np.agent-guardian-retention-cursor.v1",
          siteId,
          revision: 0,
          cursor: null,
        },
    siteId,
  );
}
/** Explicit existing maintenance owner only. Cursor CAS never holds a Runtime lock across prune. */
export async function npPruneAgentGuardianJobV1(
  siteId: string,
  owner: Pick<NpAgentGuardianRetentionServiceV1, "prune">,
  now: () => Date,
) {
  const previous = await npWithAgentRuntimeRetentionBudgetV1((db) =>
    npWithAgentRuntimeControlTransactionV1(siteId, ({ db }) => read(db, siteId), db),
  );
  const result = await owner.prune({ siteId, cursor: previous.cursor, limit: 25 });
  const cursor = result.nextCursor === null ? null : canonicalBodyUuid(result.nextCursor, key);
  if (cursor === previous.cursor && result.examined === 0) return;
  await npWithAgentRuntimeRetentionBudgetV1((db, before) =>
    npWithAgentRuntimeControlTransactionV1(
      siteId,
      async ({ db }) => {
        await before();
        const current = await read(db, siteId);
        if (serializeAgentCanonicalJson(current) !== serializeAgentCanonicalJson(previous)) return;
        const next = state({ ...current, revision: current.revision + 1, cursor }, siteId);
        await before();
        const at = now();
        if (!Number.isFinite(at.getTime())) throw new Error("Invalid Guardian retention time");
        await db
          .insert(npSettings)
          .values({ siteId, key, value: next, updatedAt: at, updatedBy: null })
          .onConflictDoUpdate({
            target: [npSettings.siteId, npSettings.key],
            set: { value: next, updatedAt: at, updatedBy: null },
          });
      },
      db,
    ),
  );
}
