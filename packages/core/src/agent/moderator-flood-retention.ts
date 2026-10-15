import { and, asc, eq, gt, gte, inArray, lt, ne, sql } from "drizzle-orm";
import {
  canonicalBodyInteger,
  canonicalBodySiteId,
  canonicalBodyUuid,
} from "../agent-contract/canonical-body-validation.js";
import { NpAgentContractError } from "../agent-contract/contract.js";
import { npRequireAgentModeratorSettingsV1 } from "../agent-contract/moderator-contract.js";
import type { getDb } from "../db/runtime.js";
import { npSettings } from "../db/schema/system.js";
import { npAgentModeratorWindowStartedAtV1 } from "./moderator-detector.js";
import {
  NP_MODERATOR_FLOOD_PREFIX_V1,
  npModeratorFloodScopeV1,
} from "./moderator-flood-collection.js";
import { NpAgentGatewayError } from "./admin-admission.js";
import { npLockAgentSourceReleaseFenceV1 } from "./source-release.js";
import { npAssertAgentPreviewEffectsAllowed } from "./changeset-preview-overlay.js";

const CURSOR_KEY = "agent.moderator.flood.retention.v1";
const STATE_KEY = /^agent\.moderator\.flood\.v1:[a-f0-9]{64}:state$/u;
const UUID = "[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}";
const OWNED_CHILD = new RegExp(
  `^(?:scan:${UUID}:(?:source:${UUID}|target:[a-f0-9]{64})|generation:${UUID}:(?:domain:[a-f0-9]{64}|member:[a-f0-9]{64}:[a-f0-9]{64}))$`,
  "u",
);
const object = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
const invalid = (): never => {
  throw new NpAgentGatewayError(
    "RUNTIME_MAINTENANCE_INVALID",
    409,
    "Agent maintenance is unavailable.",
  );
};

/** Expire completed collection metadata, never its original Events or Signals.
 * The stable tiny tombstone prevents reconstructing a partially retained old
 * window. Partial scans stay pinned; required history has independent references.
 * Caller owns the site transaction, explicit policy and total statement budget. */
export async function npPruneAgentModeratorFloodCheckpointsV1(options: {
  db: ReturnType<typeof getDb>;
  siteId: string;
  now: Date;
  signalDays: number;
  limit: number;
  maximumRows: number;
  beforeStatement: () => Promise<void>;
}): Promise<{ pruned: number }> {
  npAssertAgentPreviewEffectsAllowed();
  const { db, siteId, now, beforeStatement } = options;
  canonicalBodySiteId(siteId, "moderator.retention.siteId");
  const limit = canonicalBodyInteger(options.limit, "moderator.retention.limit", 1, 25);
  const maximumRows = canonicalBodyInteger(
    options.maximumRows,
    "moderator.retention.maximumRows",
    0,
    10000,
  );
  const days = canonicalBodyInteger(options.signalDays, "moderator.retention.signalDays", 1, 90);
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) invalid();
  if (!maximumRows) return { pruned: 0 };
  const before = new Date(now.getTime() - days * 86_400_000 - 600_000).toISOString();
  await npLockAgentSourceReleaseFenceV1(db, beforeStatement);
  await beforeStatement();
  await db.execute(sql`lock table np_settings in share mode nowait`);
  await beforeStatement();
  const [saved] = await db
    .select({ value: npSettings.value })
    .from(npSettings)
    .where(and(eq(npSettings.siteId, siteId), eq(npSettings.key, CURSOR_KEY)))
    .limit(1);
  const prior = saved ? object(saved.value) : { cursor: null };
  if (!prior) return invalid();
  const cursor = prior.cursor;
  if (cursor !== null && (typeof cursor !== "string" || !STATE_KEY.test(cursor))) return invalid();
  await beforeStatement();
  const states = await db
    .select({ key: npSettings.key, value: npSettings.value })
    .from(npSettings)
    .where(
      and(
        eq(npSettings.siteId, siteId),
        gte(npSettings.key, NP_MODERATOR_FLOOD_PREFIX_V1),
        lt(npSettings.key, `${NP_MODERATOR_FLOOD_PREFIX_V1}\uffff`),
        sql`${npSettings.key} like '%:state'`,
        sql`${npSettings.value}->>'phase' in ('complete','expired')`,
        sql`coalesce(${npSettings.value}->>'cleanupComplete','false')<>'true'`,
        sql`${npSettings.value}->>'windowStartedAt'<=${before}`,
        cursor ? gt(npSettings.key, cursor) : undefined,
      ),
    )
    .orderBy(asc(npSettings.key))
    .limit(limit)
    .for("update", { noWait: true });
  let pruned = 0;
  let last = cursor;
  for (const entry of states) {
    if (pruned >= maximumRows) break;
    last = entry.key;
    if (!STATE_KEY.test(entry.key)) continue;
    const state = object(entry.value);
    if (
      !state ||
      state.version !== 1 ||
      typeof state.windowStartedAt !== "string" ||
      typeof state.includeDocuments !== "boolean" ||
      !["complete", "expired"].includes(String(state.phase))
    )
      continue;
    let scope: string;
    try {
      if (
        npAgentModeratorWindowStartedAtV1(state.windowStartedAt) !== state.windowStartedAt ||
        state.windowStartedAt > before
      )
        continue;
      const settings = npRequireAgentModeratorSettingsV1(state.settings);
      const staffUserId = canonicalBodyUuid(state.staffUserId, "moderator.retention.staffUserId");
      canonicalBodyUuid(state.generation, "moderator.retention.generation");
      canonicalBodyUuid(state.scanGeneration, "moderator.retention.scanGeneration");
      scope = npModeratorFloodScopeV1({
        windowStartedAt: state.windowStartedAt,
        settings,
        staffUserId,
        includeDocuments: state.includeDocuments,
      });
      if (
        `${scope}state` !== entry.key ||
        (state.cleanupAfter !== undefined &&
          state.cleanupAfter !== null &&
          (typeof state.cleanupAfter !== "string" || !state.cleanupAfter.startsWith(scope)))
      )
        continue;
    } catch (error) {
      if (error instanceof NpAgentContractError) continue;
      throw error;
    }
    // Expiration commits before source rows can be released by later maintenance.
    // It never authorizes a model action and is not an audit/source-release receipt.
    const updated = { ...state, phase: "expired", cleanupComplete: false };
    await beforeStatement();
    await db
      .update(npSettings)
      .set({ value: updated, updatedAt: now })
      .where(and(eq(npSettings.siteId, siteId), eq(npSettings.key, entry.key)));
    const pageLimit = Math.min(100, maximumRows - pruned);
    await beforeStatement();
    const children = await db
      .select({ key: npSettings.key })
      .from(npSettings)
      .where(
        and(
          eq(npSettings.siteId, siteId),
          gte(npSettings.key, scope),
          lt(npSettings.key, `${scope}\uffff`),
          ne(npSettings.key, entry.key),
          typeof state.cleanupAfter === "string"
            ? gt(npSettings.key, state.cleanupAfter)
            : undefined,
        ),
      )
      .orderBy(asc(npSettings.key))
      .limit(pageLimit + 1)
      .for("update", { noWait: true });
    const page = children.slice(0, pageLimit);
    const keys = page
      .filter((child) => OWNED_CHILD.test(child.key.slice(scope.length)))
      .map((child) => child.key);
    if (keys.length) {
      await beforeStatement();
      const deleted = await db
        .delete(npSettings)
        .where(and(eq(npSettings.siteId, siteId), inArray(npSettings.key, keys)))
        .returning({ key: npSettings.key });
      if (deleted.length !== keys.length) invalid();
      pruned += deleted.length;
    }
    await beforeStatement();
    await db
      .update(npSettings)
      .set({
        value: {
          ...updated,
          cleanupAfter: page.at(-1)?.key ?? state.cleanupAfter ?? null,
          cleanupComplete: children.length <= pageLimit,
        },
        updatedAt: now,
      })
      .where(and(eq(npSettings.siteId, siteId), eq(npSettings.key, entry.key)));
  }
  const next = states.length === limit ? last : null;
  await beforeStatement();
  await db
    .insert(npSettings)
    .values({ siteId, key: CURSOR_KEY, value: { cursor: next }, updatedAt: now, updatedBy: null })
    .onConflictDoUpdate({
      target: [npSettings.siteId, npSettings.key],
      set: { value: { cursor: next }, updatedAt: now, updatedBy: null },
    });
  return { pruned };
}
