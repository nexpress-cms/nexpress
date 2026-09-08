import { sql } from "drizzle-orm";
import { AsyncLocalStorage } from "node:async_hooks";
import type { NpTransaction } from "../collections/pipeline.js";
import type {
  NpAgentChangeSetPlanCanonicalV1,
  NpAgentChangeSetSnapshotCanonicalV1,
  NpAgentPreviewRouteCanonicalV1,
} from "../agent-contract/types.js";
import {
  npDigestAgentChangeSetPlanCanonical,
  npDigestAgentChangeSetSnapshotCanonical,
  npRequireAgentChangeSetPlanCanonical,
} from "../agent-contract/canonical-changeset.js";
import { npRequireAgentPreviewRoutesCanonical } from "../agent-contract/canonical-preview.js";
import { serializeAgentCanonicalJson } from "../agent-contract/canonical-foundation.js";
import { npAgentChangeSetLimits } from "../agent-contract/changeset-wire-contract.js";
import { NpError } from "../errors.js";
import { getCurrentSiteId, withCurrentSite } from "../sites/context.js";

type Plan = Extract<NpAgentChangeSetPlanCanonicalV1, { planKind: "changeset" }>;
export interface NpAgentChangeSetPreviewContextV1 {
  siteId: string;
  changeSetId: string;
  previewId: string;
  generation: number;
  planHash: string;
  previewContractFingerprint: string;
  route: NpAgentPreviewRouteCanonicalV1;
  /** Frozen preview creation time; timestamps of virtual documents are preview-derived. */
  createdAt: string;
  expiresAt: string;
  plan: Plan;
  snapshots: NpAgentChangeSetSnapshotCanonicalV1[];
  /** Host-owned read-only transaction. No pool or transaction is created by the overlay. */
  tx: NpTransaction;
  now: Date;
}
interface Scope extends NpAgentChangeSetPreviewContextV1 {
  active: boolean;
  clockOffset: number;
  memo: Map<string, unknown>;
  context: NpAgentChangeSetPreviewContextV1;
}
const storage = new AsyncLocalStorage<Scope>();
const unavailable = () => new NpError("Preview is unavailable.", "NOT_FOUND", 404);

/** Includes expired/completed child work so it can never escape the effect fence. */
export function npIsAgentChangeSetPreview(): boolean {
  return storage.getStore() !== undefined;
}
export function npAssertAgentPreviewEffectsAllowed(): void {
  if (storage.getStore())
    throw new NpError("Effects are unavailable during preview.", "FORBIDDEN", 403);
}
export function npGetAgentChangeSetPreviewContext(): NpAgentChangeSetPreviewContextV1 | null {
  const scope = storage.getStore();
  if (!scope) return null;
  const time = Date.now() + scope.clockOffset;
  if (!scope.active || time >= Date.parse(scope.expiresAt)) throw unavailable();
  return scope.context;
}
export async function npAgentPreviewReadTransaction(
  supplied?: NpTransaction,
): Promise<NpTransaction | undefined> {
  const scope = npGetAgentChangeSetPreviewContext();
  if (!scope) return supplied;
  if ((await getCurrentSiteId()) !== scope.siteId || (supplied && supplied !== scope.tx))
    throw unavailable();
  return scope.tx;
}
export function npAgentPreviewMemo<T>(key: string, create: () => T): T {
  const scope = storage.getStore();
  if (!scope || !npGetAgentChangeSetPreviewContext()) throw unavailable();
  if (!scope.memo.has(key)) scope.memo.set(key, create());
  return scope.memo.get(key) as T;
}
export function npAgentPreviewSettingOverride(key: string): { value: unknown } | null {
  const scope = npGetAgentChangeSetPreviewContext();
  if (!scope) return null;
  for (const { operation } of scope.plan.body.operations) {
    if (operation.kind === "theme_tokens" && key === "theme")
      return { value: structuredClone(operation.input.tokens) };
    if (operation.kind === "setting" && operation.resource.key === key)
      return {
        value: operation.operation === "remove" ? null : structuredClone(operation.input.value),
      };
  }
  return null;
}

/**
 * The host first verifies current actor/resource authority and plan/base identity. Its callback
 * must include the complete render and stream consumption, not only construction of a JSX tree.
 */
export async function withAgentChangeSetPreview<T>(
  input: NpAgentChangeSetPreviewContextV1,
  callback: () => Promise<T>,
): Promise<T> {
  const mode = (await input.tx.execute(sql`show transaction_read_only`)) as {
    rows?: Array<{ transaction_read_only?: string }>;
  };
  if (mode.rows?.length !== 1 || mode.rows[0]?.transaction_read_only !== "on") throw unavailable();
  const plan = npRequireAgentChangeSetPlanCanonical(input.plan);
  if (
    plan.planKind !== "changeset" ||
    plan.siteId !== input.siteId ||
    plan.changeSetId !== input.changeSetId ||
    (await npDigestAgentChangeSetPlanCanonical(plan)) !== input.planHash ||
    !Number.isFinite(input.now.getTime()) ||
    !Number.isFinite(Date.parse(input.createdAt)) ||
    new Date(input.createdAt).toISOString() !== input.createdAt ||
    !Number.isFinite(Date.parse(input.expiresAt)) ||
    new Date(input.expiresAt).toISOString() !== input.expiresAt ||
    Date.parse(input.expiresAt) <= input.now.getTime() ||
    Date.parse(input.createdAt) > input.now.getTime() ||
    Date.parse(input.expiresAt) > Date.parse(plan.body.expiresAt) ||
    !/^cj1:sha256:[A-Za-z0-9_-]{43}$/u.test(input.previewContractFingerprint)
  )
    throw unavailable();
  npRequireAgentPreviewRoutesCanonical({
    schemaVersion: "np.agent-preview-routes.v1",
    siteId: input.siteId,
    changeSetId: input.changeSetId,
    previewId: input.previewId,
    generation: input.generation,
    planHash: input.planHash,
    routes: [input.route],
  });
  if (input.snapshots.length !== plan.body.operations.length) throw unavailable();
  let bytes = 0;
  for (const [index, snapshot] of input.snapshots.entries()) {
    const operation = plan.body.operations[index];
    if (
      snapshot.siteId !== input.siteId ||
      snapshot.changeSetId !== input.changeSetId ||
      snapshot.operationOrdinal !== operation.ordinal ||
      serializeAgentCanonicalJson(snapshot.canonicalResourceKey) !==
        serializeAgentCanonicalJson(operation.canonicalResourceKey) ||
      (await npDigestAgentChangeSetSnapshotCanonical(snapshot)) !== operation.snapshotHash
    )
      throw unavailable();
    bytes += Buffer.byteLength(serializeAgentCanonicalJson(snapshot));
  }
  if (bytes > npAgentChangeSetLimits.aggregateSnapshotBytes) throw unavailable();
  const startedAt = Date.now();
  const context = {
    ...input,
    plan: JSON.parse(serializeAgentCanonicalJson(plan)) as Plan,
    snapshots: JSON.parse(
      serializeAgentCanonicalJson(input.snapshots),
    ) as NpAgentChangeSetSnapshotCanonicalV1[],
    route: { ...input.route },
  };
  const freeze = (value: unknown): void => {
    if (!value || typeof value !== "object" || Object.isFrozen(value)) return;
    for (const nested of Object.values(value)) freeze(nested);
    Object.freeze(value);
  };
  freeze(context.plan);
  freeze(context.snapshots);
  freeze(context.route);
  Object.freeze(context);
  const scope: Scope = {
    ...context,
    context,
    active: true,
    clockOffset: input.now.getTime() - startedAt,
    memo: new Map(),
  };
  try {
    return await withCurrentSite(input.siteId, () =>
      storage.run(scope, async () => {
        const result = await callback();
        npGetAgentChangeSetPreviewContext();
        return result;
      }),
    );
  } finally {
    scope.active = false;
    scope.memo.clear();
  }
}
