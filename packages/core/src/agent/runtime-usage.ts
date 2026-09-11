import { randomUUID } from "node:crypto";
import { and, asc, eq, lte, or, sql } from "drizzle-orm";
import type { getDb } from "../db/runtime.js";
import {
  npAgentRuns,
  npAgentProviderCalls,
  npAgentUsageReservations,
  npAgentConnectionConfigVersions,
  npAgentConnections,
} from "../db/schema/agent.js";
import { npAuditEvents } from "../db/schema/community.js";
import {
  npRequireAgentProviderRequestCanonical,
  npDigestAgentProviderRequestCanonical,
  npRequireAgentProviderResponseCanonical,
  npDigestAgentProviderResponseCanonical,
} from "../agent-contract/canonical-provider.js";
import { npDigestAgentRunLimitsCanonical } from "../agent-contract/canonical-bodies.js";
import { npDigestAgentRunAdmissionCanonical } from "../agent-contract/canonical-run-admission.js";
import { npDigestAgentBudgetSnapshotCanonical } from "../agent-contract/canonical-budget-snapshot.js";
import {
  npRequireAgentConnectionConfigCanonical,
  npDigestAgentConnectionConfigCanonical,
} from "../agent-contract/canonical-connections.js";
import {
  npComputeAgentModelCostMicrosV1,
  npSelectAgentModelPricingV1,
} from "../agent-contract/runtime-budget.js";
import { serializeAgentCanonicalJson } from "../agent-contract/canonical-foundation.js";
import { canonicalBodyRecord } from "../agent-contract/canonical-body-validation.js";
import { npAgentProviderDataClassRank } from "../agent-contract/types.js";
import type {
  NpAgentJsonObject,
  NpAgentProviderRequestCanonicalV1,
  NpAgentProviderResponseCanonicalV1,
  NpAgentProviderUsageV1,
  NpAgentRunLimitsV1,
} from "../agent-contract/types.js";
import {
  npRuntimeRunAdmissionBodyV1,
  type NpAgentRuntimeAdmissionV1,
  type NpAgentRuntimeRunContextV1,
} from "./runtime-admission.js";
import { npRequireAgentRuntimeVersionV1 } from "./runtime-service.js";
import { npVerifyAgentRuntimeAdmissionSourcesV1 } from "./runtime-admission-sources.js";
import { npWithAgentRuntimeControlTransactionV1 } from "./runtime-controls.js";
import {
  npMeasureAgentRuntimeBudgetV1,
  npRequireAgentRuntimeBudgetCapacityV1,
  npRequireAgentRuntimeUsageKnownV1,
} from "./runtime-budget.js";
import { npRequireAgentProviderSchemaValueV1 } from "./provider-auth-contract.js";
import { NpAgentGatewayError } from "./admin-admission.js";

type Db = ReturnType<typeof getDb>;
type Call = typeof npAgentProviderCalls.$inferSelect;
type Reservation = typeof npAgentUsageReservations.$inferSelect;
type Run = typeof npAgentRuns.$inferSelect;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[a-f0-9]{12}$/;
const MAXIMUM_PAGE = 100;
function fail(code = "RUNTIME_USAGE_INVALID", status = 409): never {
  throw new NpAgentGatewayError(code, status, "Agent runtime usage is unavailable.");
}
function same(a: unknown, b: unknown): boolean {
  return serializeAgentCanonicalJson(a) === serializeAgentCanonicalJson(b);
}
function nowAt(now: () => Date): Date {
  const value = now();
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) fail();
  return value;
}
function parseRequest(value: unknown): NpAgentProviderRequestCanonicalV1 {
  try {
    return npRequireAgentProviderRequestCanonical(value);
  } catch {
    return fail("RUNTIME_PROVIDER_INPUT_INVALID", 400);
  }
}
function parseResponse(value: unknown): NpAgentProviderResponseCanonicalV1 {
  try {
    return npRequireAgentProviderResponseCanonical(value);
  } catch {
    return fail("RUNTIME_PROVIDER_OUTPUT_INVALID", 400);
  }
}
function closed<T>(value: T, keys: readonly string[], required = keys): T {
  try {
    return canonicalBodyRecord(value, "agent.runtime.usage", keys, required, {
      seen: new WeakSet<object>(),
    }) as T;
  } catch {
    return fail("RUNTIME_ARGUMENT_INVALID", 400);
  }
}

export interface NpAgentRuntimeUsageReceiptV1 {
  providerCallId: string;
  reservationId: string;
  state: string;
  reservationState: string;
  replayed: boolean;
}
export interface NpAgentRuntimeUsageOptionsV1 {
  admission: NpAgentRuntimeAdmissionV1;
  /** Explicit deployment bound for unresolved work; no implicit retry or worker. */
  ambiguityWindowSeconds: number;
  /**
   * A trusted synchronous source/classification verifier is required. It verifies
   * every source digest and the classification manifest against the canonical
   * request and the current context. AP-501/AP-505 own its eventual host builder.
   * No verifier is installed by default and no asynchronous provider I/O belongs here.
   */
  verifyRequest?: (
    context: Readonly<Omit<NpAgentRuntimeRunContextV1, "db">>,
    request: NpAgentProviderRequestCanonicalV1,
  ) => boolean;
  now?: () => Date;
}

function verificationCopy<T>(value: T): T {
  const copy = structuredClone(value);
  const freeze = (entry: unknown): void => {
    if (typeof entry !== "object" || entry === null) return;
    for (const child of Object.values(entry)) freeze(child);
    Object.freeze(entry);
  };
  freeze(copy);
  return copy;
}
export interface NpAgentRuntimeUsageV1 {
  reserve(input: {
    siteId: string;
    runId: string;
    request: unknown;
  }): Promise<NpAgentRuntimeUsageReceiptV1>;
  /** Only the pre-invoke ledger fence. It never leases a secret or invokes a provider. */
  beginDispatch(input: {
    siteId: string;
    runId: string;
    request: unknown;
  }): Promise<NpAgentRuntimeUsageReceiptV1>;
  reconcile(input: {
    siteId: string;
    providerCallId: string;
    response: unknown;
  }): Promise<NpAgentRuntimeUsageReceiptV1>;
  expire(input: {
    siteId: string;
    limit?: number;
  }): Promise<{ examined: number; released: number; expired: number }>;
}

function receipt(
  call: Call,
  reservation: Reservation,
  replayed: boolean,
): NpAgentRuntimeUsageReceiptV1 {
  return {
    providerCallId: call.id,
    reservationId: reservation.id,
    state: call.state,
    reservationState: reservation.state,
    replayed,
  };
}

/** No text, source bodies, credentials, locators or diagnostic bodies are retained. */
function manifest(request: NpAgentProviderRequestCanonicalV1): NpAgentJsonObject {
  return {
    components: [
      {
        id: request.instruction.templateId,
        kind: "instruction",
        ...request.instruction.classification,
      },
      ...request.trustedContext.map(({ id, kind, classification }) => ({
        id,
        kind,
        ...classification,
      })),
      ...request.untrustedEvidence.map(({ id, kind, classification }) => ({
        id,
        kind,
        ...classification,
      })),
      { id: "response-schema", kind: "schema", ...request.responseSchemaClassification },
      ...request.tools.map(({ capabilityId, classification }) => ({
        id: capabilityId,
        kind: "tool",
        ...classification,
      })),
    ],
  };
}

/** Upper bound includes the extra ceil caused by splitting cached/uncached input. */
function maximumCost(request: NpAgentProviderRequestCanonicalV1): number {
  const p = request.pricing;
  const input = BigInt(request.limits.maxInputTokens),
    output = BigInt(request.limits.maxOutputTokens);
  const unit = BigInt(p.unitTokens);
  const ceil = (value: bigint) => (value + unit - BigInt(1)) / unit;
  let value =
    ceil(input * BigInt(Math.max(p.inputMicrosPerUnit, p.cachedInputMicrosPerUnit))) +
    ceil(output * BigInt(p.outputMicrosPerUnit));
  if (input > BigInt(1) && p.inputMicrosPerUnit > 0 && p.cachedInputMicrosPerUnit > 0)
    value += BigInt(1);
  if (value < BigInt(p.minimumRequestMicros)) value = BigInt(p.minimumRequestMicros);
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) fail("RUNTIME_BUDGET_UNAVAILABLE");
  return Number(value);
}

function validateCurrentRequest(
  context: NpAgentRuntimeRunContextV1,
  request: NpAgentProviderRequestCanonicalV1,
  verify: NpAgentRuntimeUsageOptionsV1["verifyRequest"],
): void {
  const { run, connection, connectionSnapshot: snapshot, pricing, evidence } = context;
  const recipe = evidence.registry.recipes.find(
    (entry) => entry.id === run.recipeId && entry.version === run.recipeVersion,
  );
  if (
    !connection ||
    !snapshot ||
    !pricing ||
    !recipe ||
    recipe.providerMode === "forbidden" ||
    !recipe.instruction
  )
    fail("RUNTIME_PROVIDER_UNAVAILABLE");
  if (request.task !== "interactive-capability" || recipe.task !== request.task)
    fail("RUNTIME_TARGET_ADMISSION_UNAVAILABLE");
  const expectedConnection = {
    id: connection.id,
    configSnapshotId: snapshot.id,
    configVersion: snapshot.version,
    configHash: snapshot.configHash,
    secretVersionId: connection.activeSecretVersionId,
    credentialVersion: connection.credentialVersion,
    adapterId: snapshot.adapterId,
    adapterContractVersion: snapshot.adapterContractVersion,
    adapterFingerprint: snapshot.adapterFingerprint,
  };
  if (
    request.siteId !== context.siteId ||
    request.runId !== run.id ||
    !same(request.connection, expectedConnection) ||
    request.provider !== connection.provider ||
    request.model !== evidence.definition.model ||
    request.recipe.id !== run.recipeId ||
    request.recipe.version !== run.recipeVersion ||
    request.recipe.fingerprint !== run.recipeFingerprint ||
    request.instruction.templateId !== run.instructionTemplateId ||
    request.instruction.templateVersion !== run.instructionTemplateVersion ||
    request.instruction.digest !== run.instructionDigest ||
    request.instruction.text !== recipe.instruction.text ||
    request.responseSchemaDigest !== run.responseSchemaDigest ||
    !same(request.responseSchema, recipe.responseSchema) ||
    !same(request.pricing, pricing) ||
    request.dataClassCeiling !== run.providerDataClassCeiling ||
    npAgentProviderDataClassRank[request.dataClass] >
      npAgentProviderDataClassRank[context.policy.effective.providerDataMaximum] ||
    request.limits.timeoutSeconds * 1000 > run.deadlineAt.getTime() - context.now.getTime()
  )
    fail("RUNTIME_PROVIDER_INPUT_INVALID");
  const runLimits = context.limits;
  if (
    request.limits.maxInputTokens > runLimits.maxInputTokens ||
    request.limits.maxOutputTokens > runLimits.maxOutputTokens
  )
    fail("RUNTIME_BUDGET_BLOCKED");
  // Provider tools/actions are a later typed planning surface. An empty list is
  // the only honest foundation request until that admission is installed.
  if (request.tools.length) fail("RUNTIME_TARGET_ADMISSION_UNAVAILABLE");
  try {
    const { db: _db, ...evidence } = context;
    if (!verify || verify(verificationCopy(evidence), verificationCopy(request)) !== true)
      fail("RUNTIME_PROVIDER_INPUT_UNAVAILABLE");
  } catch {
    fail("RUNTIME_PROVIDER_INPUT_UNAVAILABLE");
  }
}

async function findCall(db: Db, siteId: string, id: string): Promise<Call> {
  if (!UUID.test(id)) fail("RUNTIME_RESOURCE_UNAVAILABLE", 404);
  const [call] = await db
    .select()
    .from(npAgentProviderCalls)
    .where(and(eq(npAgentProviderCalls.siteId, siteId), eq(npAgentProviderCalls.id, id)))
    .for("update")
    .limit(1);
  if (!call) fail("RUNTIME_RESOURCE_UNAVAILABLE", 404);
  return call;
}

async function retained(db: Db, call: Call) {
  const [run] = await db
    .select()
    .from(npAgentRuns)
    .where(and(eq(npAgentRuns.siteId, call.siteId), eq(npAgentRuns.id, call.runId)))
    .for("update")
    .limit(1);
  const [reservation] = await db
    .select()
    .from(npAgentUsageReservations)
    .where(
      and(
        eq(npAgentUsageReservations.siteId, call.siteId),
        eq(npAgentUsageReservations.id, call.usageReservationId),
      ),
    )
    .for("update")
    .limit(1);
  if (!run || !reservation || run.origin !== "runtime" || !run.agentId || !run.agentVersionId)
    fail();
  const evidence = await npRequireAgentRuntimeVersionV1({
    db,
    siteId: call.siteId,
    agentId: run.agentId,
    versionId: run.agentVersionId,
    active: false,
  });
  if (
    run.agentConfigHash !== evidence.version.configHash ||
    run.principalId !== evidence.principal.id ||
    (await npDigestAgentRunAdmissionCanonical(npRuntimeRunAdmissionBodyV1(run))) !==
      run.admissionFingerprint ||
    (await npDigestAgentRunLimitsCanonical(run.runLimits)) !== run.runLimitsHash ||
    (await npDigestAgentBudgetSnapshotCanonical(run.budgetSnapshot)) !== run.budgetSnapshotHash
  )
    fail();
  await npVerifyAgentRuntimeAdmissionSourcesV1({
    sources: run.runtimeAdmissionSources,
    admission: npRuntimeRunAdmissionBodyV1(run),
    budgetSnapshot: run.budgetSnapshot,
  });
  const [snapshot] = await db
    .select()
    .from(npAgentConnectionConfigVersions)
    .where(
      and(
        eq(npAgentConnectionConfigVersions.siteId, call.siteId),
        eq(npAgentConnectionConfigVersions.id, call.connectionConfigSnapshotId),
      ),
    )
    .limit(1);
  if (
    !snapshot ||
    snapshot.connectionId !== call.connectionId ||
    snapshot.configHash !== call.connectionConfigHash ||
    snapshot.version !== call.connectionConfigVersion
  )
    fail();
  const [connection] = await db
    .select()
    .from(npAgentConnections)
    .where(
      and(eq(npAgentConnections.siteId, call.siteId), eq(npAgentConnections.id, call.connectionId)),
    )
    .limit(1);
  if (
    !connection ||
    connection.kind !== "model" ||
    connection.provider !== call.provider ||
    evidence.definition.model !== call.model
  )
    fail();
  const canonicalConfig = npRequireAgentConnectionConfigCanonical({
    schemaVersion: "np.agent-connection-config.v1",
    siteId: call.siteId,
    connectionId: connection.id,
    kind: connection.kind,
    provider: connection.provider,
    authKind: connection.authKind,
    adapterId: snapshot.adapterId,
    adapterContractVersion: snapshot.adapterContractVersion,
    adapterFingerprint: snapshot.adapterFingerprint,
    configVersion: snapshot.version,
    config: snapshot.config,
    pricingCatalog: snapshot.pricingCatalog,
    dataProcessingCeiling: snapshot.dataProcessingCeiling,
  });
  if ((await npDigestAgentConnectionConfigCanonical(canonicalConfig)) !== call.connectionConfigHash)
    fail();
  const pricing = npSelectAgentModelPricingV1({
    catalog: snapshot.pricingCatalog,
    model: call.model,
    at: call.pricingEffectiveAt.toISOString(),
  });
  if (
    reservation.agentId !== run.agentId ||
    reservation.runId !== run.id ||
    reservation.connectionId !== call.connectionId ||
    reservation.connectionConfigSnapshotId !== call.connectionConfigSnapshotId ||
    reservation.reservedCalls !== 1 ||
    reservation.idempotencyKey !== call.idempotencyKey ||
    reservation.model !== call.model ||
    call.connectionId !== run.connectionId ||
    call.connectionConfigSnapshotId !== run.connectionConfigSnapshotId ||
    call.connectionConfigVersion !== run.connectionConfigVersion ||
    call.connectionConfigHash !== run.connectionConfigHash ||
    call.recipeId !== run.recipeId ||
    call.recipeVersion !== run.recipeVersion ||
    call.recipeFingerprint !== run.recipeFingerprint ||
    call.instructionTemplateId !== run.instructionTemplateId ||
    call.instructionTemplateVersion !== run.instructionTemplateVersion ||
    call.instructionDigest !== run.instructionDigest ||
    call.responseSchemaDigest !== run.responseSchemaDigest ||
    call.providerDataClassCeiling !== run.providerDataClassCeiling ||
    call.pricingId !== run.pricingId ||
    call.pricingVersion !== run.pricingVersion ||
    call.pricingFingerprint !== run.pricingFingerprint ||
    call.pricingId !== reservation.pricingId ||
    call.pricingVersion !== reservation.pricingVersion ||
    call.pricingFingerprint !== reservation.pricingFingerprint ||
    call.pricingEffectiveAt.getTime() !== reservation.pricingEffectiveAt.getTime() ||
    call.pricingEffectiveAt.getTime() !== run.pricingEffectiveAt?.getTime() ||
    pricing.pricingId !== call.pricingId ||
    pricing.version !== call.pricingVersion ||
    pricing.fingerprint !== call.pricingFingerprint
  )
    fail();
  const recipe = evidence.registry.recipes.find(
    (entry) => entry.id === run.recipeId && entry.version === run.recipeVersion,
  );
  if (!recipe) fail();
  return { run, reservation, pricing, recipe };
}

async function perRunCapacity(
  db: Db,
  run: Run,
  request: NpAgentProviderRequestCanonicalV1,
  cost: number,
  limits: NpAgentRunLimitsV1,
  includeNew = true,
): Promise<void> {
  const rows = await db.execute<Record<string, string>>(sql`
    select count(*)::text as turns,
      coalesce(sum(case when state='reconciled' then actual_input_tokens when state='released' then 0 else reserved_input_tokens end),0)::text as input,
      coalesce(sum(case when state='reconciled' then actual_output_tokens when state='released' then 0 else reserved_output_tokens end),0)::text as output,
      coalesce(sum(case when state='reconciled' then actual_cost_micros when state='released' then 0 else reserved_cost_micros end),0)::text as cost
    from public.np_agent_usage_reservations where site_id=${run.siteId} and run_id=${run.id}
  `);
  const row = rows.rows[0];
  if (!row) fail("RUNTIME_BUDGET_UNAVAILABLE");
  for (const [value, additional, ceiling] of [
    [row.turns, includeNew ? 1 : 0, limits.maxProviderCalls],
    [row.input, includeNew ? request.limits.maxInputTokens : 0, limits.maxInputTokens],
    [row.output, includeNew ? request.limits.maxOutputTokens : 0, limits.maxOutputTokens],
    [row.cost, includeNew ? cost : 0, limits.maxCostMicros],
  ] as const) {
    if (!/^\d+$/.test(value)) fail("RUNTIME_BUDGET_UNAVAILABLE");
    if (BigInt(value) + BigInt(additional) > BigInt(ceiling)) fail("RUNTIME_BUDGET_BLOCKED");
  }
}

async function audit(db: Db, call: Call, responseDigest: string, transition: string, now: Date) {
  await db.insert(npAuditEvents).values({
    siteId: call.siteId,
    actorKind: "system",
    action: "agent.runtime.usage",
    targetType: "agent-provider-call",
    targetId: call.id,
    payload: { reservationId: call.usageReservationId, responseDigest, transition },
    createdAt: now,
  });
}

/** Apply only finalized reservation deltas; source buckets never derive from prose. */
async function daily(
  db: Db,
  reservation: Reservation,
  usage: NpAgentProviderUsageV1 | null,
  expired: boolean,
): Promise<void> {
  const previousExpired = reservation.state === "expired";
  const providerCalls = (usage || expired ? 1 : 0) - (previousExpired ? 1 : 0);
  const unknown = (expired ? 1 : 0) - (previousExpired ? 1 : 0);
  const charge =
    (usage?.costMicros ?? (expired ? reservation.reservedCostMicros : 0)) -
    (previousExpired ? reservation.reservedCostMicros : 0);
  if (!usage && !expired && !previousExpired) return;
  const reported = usage?.tokenSource === "provider",
    estimated = usage?.tokenSource === "adapter-estimate";
  const counts = [
    providerCalls,
    reported ? usage.inputTokens : 0,
    reported ? usage.cachedInputTokens : 0,
    reported ? usage.outputTokens : 0,
    estimated ? usage.inputTokens : 0,
    estimated ? usage.cachedInputTokens : 0,
    estimated ? usage.outputTokens : 0,
    usage?.costSource === "provider" ? usage.costMicros : 0,
    usage?.costSource === "adapter-estimate" ? usage.costMicros : 0,
    charge,
    unknown,
  ];
  // Negative compensation is valid only over an already-existing expired bucket.
  if (previousExpired) {
    const result = await db.execute(sql`
      update public.np_agent_usage_daily set provider_calls=provider_calls+${counts[0]},
      reported_input_tokens=reported_input_tokens+${counts[1]},reported_cached_input_tokens=reported_cached_input_tokens+${counts[2]},reported_output_tokens=reported_output_tokens+${counts[3]},
      estimated_input_tokens=estimated_input_tokens+${counts[4]},estimated_cached_input_tokens=estimated_cached_input_tokens+${counts[5]},estimated_output_tokens=estimated_output_tokens+${counts[6]},
      reported_cost_micros=reported_cost_micros+${counts[7]},estimated_cost_micros=estimated_cost_micros+${counts[8]},budget_charge_cost_micros=budget_charge_cost_micros+${counts[9]},unknown_calls=unknown_calls+${counts[10]}
      where site_id=${reservation.siteId} and agent_id=${reservation.agentId} and connection_id=${reservation.connectionId}
      and usage_date=${reservation.reservedAt.toISOString().slice(0, 10)}::date returning id
    `);
    if (result.rows.length !== 1) fail("RUNTIME_BUDGET_UNAVAILABLE");
  } else
    await db.execute(sql`
    insert into public.np_agent_usage_daily (id,site_id,agent_id,connection_id,usage_date,provider_calls,reported_input_tokens,reported_cached_input_tokens,reported_output_tokens,estimated_input_tokens,estimated_cached_input_tokens,estimated_output_tokens,reported_cost_micros,estimated_cost_micros,budget_charge_cost_micros,unknown_calls)
    values (${randomUUID()},${reservation.siteId},${reservation.agentId},${reservation.connectionId},${reservation.reservedAt.toISOString().slice(0, 10)}::date,${counts[0]},${counts[1]},${counts[2]},${counts[3]},${counts[4]},${counts[5]},${counts[6]},${counts[7]},${counts[8]},${counts[9]},${counts[10]})
    on conflict (site_id,agent_id,connection_id,usage_date) do update set
      provider_calls=np_agent_usage_daily.provider_calls+excluded.provider_calls,
      reported_input_tokens=np_agent_usage_daily.reported_input_tokens+excluded.reported_input_tokens,
      reported_cached_input_tokens=np_agent_usage_daily.reported_cached_input_tokens+excluded.reported_cached_input_tokens,
      reported_output_tokens=np_agent_usage_daily.reported_output_tokens+excluded.reported_output_tokens,
      estimated_input_tokens=np_agent_usage_daily.estimated_input_tokens+excluded.estimated_input_tokens,
      estimated_cached_input_tokens=np_agent_usage_daily.estimated_cached_input_tokens+excluded.estimated_cached_input_tokens,
      estimated_output_tokens=np_agent_usage_daily.estimated_output_tokens+excluded.estimated_output_tokens,
      reported_cost_micros=np_agent_usage_daily.reported_cost_micros+excluded.reported_cost_micros,
      estimated_cost_micros=np_agent_usage_daily.estimated_cost_micros+excluded.estimated_cost_micros,
      budget_charge_cost_micros=np_agent_usage_daily.budget_charge_cost_micros+excluded.budget_charge_cost_micros,
      unknown_calls=np_agent_usage_daily.unknown_calls+excluded.unknown_calls
  `);
}

export function createAgentRuntimeUsageV1(
  options: NpAgentRuntimeUsageOptionsV1,
): NpAgentRuntimeUsageV1 {
  if (
    !Number.isInteger(options.ambiguityWindowSeconds) ||
    options.ambiguityWindowSeconds < 1 ||
    options.ambiguityWindowSeconds > 86_400
  )
    fail("RUNTIME_ARGUMENT_INVALID", 400);
  const { admission, ambiguityWindowSeconds, verifyRequest } = options;
  const now = options.now ?? (() => new Date());
  const admit = async (
    input: { siteId: string; runId: string; request: unknown },
    dispatch: boolean,
  ) => {
    input = closed(input, ["siteId", "runId", "request"]);
    const request = parseRequest(input.request);
    const requestDigest = await npDigestAgentProviderRequestCanonical(request);
    if (request.siteId !== input.siteId || request.runId !== input.runId)
      fail("RUNTIME_RESOURCE_UNAVAILABLE", 404);
    return admission.withCurrentRun(
      { siteId: input.siteId, runId: input.runId },
      async (context) => {
        validateCurrentRequest(context, request, verifyRequest);
        const { db, run } = context;
        const existing = await db
          .select()
          .from(npAgentProviderCalls)
          .where(
            and(
              eq(npAgentProviderCalls.siteId, input.siteId),
              eq(npAgentProviderCalls.runId, run.id),
              or(
                eq(npAgentProviderCalls.id, request.providerCallId),
                eq(npAgentProviderCalls.idempotencyKey, request.idempotencyKey),
              ),
            ),
          )
          .for("update");
        if (existing.length) {
          const call = existing[0];
          if (
            existing.length !== 1 ||
            call.id !== request.providerCallId ||
            call.requestDigest !== requestDigest
          )
            fail("RUNTIME_IDEMPOTENCY_CONFLICT");
          const { reservation } = await retained(db, call);
          if (!dispatch) return receipt(call, reservation, true);
          if (
            call.state !== "reserved" ||
            reservation.state !== "reserved" ||
            reservation.expiresAt <= context.now
          )
            fail("RUNTIME_DISPATCH_UNAVAILABLE");
          await npRequireAgentRuntimeUsageKnownV1({ db, siteId: input.siteId });
          await perRunCapacity(db, run, request, 0, context.limits, false);
          for (const agentId of [undefined, run.agentId!]) {
            const counters = await npMeasureAgentRuntimeBudgetV1({
              db,
              siteId: input.siteId,
              agentId,
              now: context.now,
            });
            npRequireAgentRuntimeBudgetCapacityV1({
              budget: agentId ? context.agentBudget : context.siteBudget,
              counters,
              reservation: {
                runs: 0,
                providerCalls: 0,
                inputTokens: 0,
                outputTokens: 0,
                costMicros: 0,
              },
            });
          }
          await db
            .update(npAgentProviderCalls)
            .set({ state: "in_flight", dispatchState: "unknown", startedAt: context.now })
            .where(
              and(
                eq(npAgentProviderCalls.siteId, input.siteId),
                eq(npAgentProviderCalls.id, call.id),
                eq(npAgentProviderCalls.state, "reserved"),
              ),
            );
          return receipt(
            { ...call, state: "in_flight", dispatchState: "unknown", startedAt: context.now },
            reservation,
            false,
          );
        }
        if (dispatch) fail("RUNTIME_RESOURCE_UNAVAILABLE", 404);
        await npRequireAgentRuntimeUsageKnownV1({ db, siteId: input.siteId });
        const previous = await db
          .select()
          .from(npAgentProviderCalls)
          .where(
            and(
              eq(npAgentProviderCalls.siteId, input.siteId),
              eq(npAgentProviderCalls.runId, run.id),
            ),
          )
          .orderBy(sql`${npAgentProviderCalls.sequence} desc`)
          .limit(1);
        if (request.sequence !== (previous[0]?.sequence ?? 0) + 1) fail("RUNTIME_SEQUENCE_INVALID");
        if (request.retryOfId !== null) {
          const retry = await findCall(db, input.siteId, request.retryOfId);
          if (
            retry.runId !== run.id ||
            retry.sequence >= request.sequence ||
            retry.state !== "failed" ||
            !retry.retryable
          )
            fail("RUNTIME_RETRY_UNAVAILABLE");
        }
        const cost = maximumCost(request);
        await perRunCapacity(db, run, request, cost, context.limits);
        const amount = {
          runs: 0,
          providerCalls: 1,
          inputTokens: request.limits.maxInputTokens,
          outputTokens: request.limits.maxOutputTokens,
          costMicros: cost,
        };
        for (const agentId of [undefined, run.agentId!]) {
          const counters = await npMeasureAgentRuntimeBudgetV1({
            db,
            siteId: input.siteId,
            agentId,
            now: context.now,
          });
          npRequireAgentRuntimeBudgetCapacityV1({
            budget: agentId ? context.agentBudget : context.siteBudget,
            counters,
            reservation: amount,
          });
        }
        const [reservation] = await db
          .insert(npAgentUsageReservations)
          .values({
            id: randomUUID(),
            siteId: input.siteId,
            agentId: run.agentId!,
            runId: run.id,
            connectionId: request.connection.id,
            connectionConfigSnapshotId: request.connection.configSnapshotId,
            model: request.model,
            pricingId: request.pricing.pricingId,
            pricingVersion: request.pricing.version,
            pricingFingerprint: request.pricing.fingerprint,
            pricingEffectiveAt: run.pricingEffectiveAt!,
            idempotencyKey: request.idempotencyKey,
            state: "reserved",
            reservedCalls: 1,
            reservedInputTokens: request.limits.maxInputTokens,
            reservedOutputTokens: request.limits.maxOutputTokens,
            reservedCostMicros: cost,
            reservedAt: context.now,
            expiresAt: new Date(context.now.getTime() + ambiguityWindowSeconds * 1000),
          })
          .returning();
        if (!reservation) fail();
        const [call] = await db
          .insert(npAgentProviderCalls)
          .values({
            id: request.providerCallId,
            siteId: input.siteId,
            runId: run.id,
            sequence: request.sequence,
            retryOfId: request.retryOfId,
            connectionId: request.connection.id,
            connectionConfigSnapshotId: request.connection.configSnapshotId,
            secretVersionId: request.connection.secretVersionId,
            credentialVersion: request.connection.credentialVersion,
            connectionConfigVersion: request.connection.configVersion,
            connectionConfigHash: request.connection.configHash,
            providerDataClassCeiling: request.dataClassCeiling,
            requestDataClass: request.dataClass,
            classificationManifest: manifest(request),
            classificationManifestDigest: request.classificationManifestDigest,
            recipeId: request.recipe.id,
            recipeVersion: request.recipe.version,
            recipeFingerprint: request.recipe.fingerprint,
            instructionTemplateId: request.instruction.templateId,
            instructionTemplateVersion: request.instruction.templateVersion,
            instructionDigest: request.instruction.digest,
            responseSchemaDigest: request.responseSchemaDigest,
            provider: request.provider,
            model: request.model,
            pricingId: request.pricing.pricingId,
            pricingVersion: request.pricing.version,
            pricingFingerprint: request.pricing.fingerprint,
            pricingEffectiveAt: run.pricingEffectiveAt!,
            state: "reserved",
            dispatchState: "not-dispatched",
            usageReservationId: reservation.id,
            requestDigest,
            idempotencyKey: request.idempotencyKey,
            createdAt: context.now,
          })
          .returning();
        if (!call) fail();
        // The legacy v1 Activity usage object cannot represent reserved/unknown
        // spend. Keep runtime evidence unprojectable until the later runtime wire
        // owns those states; only the exact ledger and daily buckets own usage.
        await db
          .update(npAgentRuns)
          .set({ usage: {} })
          .where(and(eq(npAgentRuns.siteId, run.siteId), eq(npAgentRuns.id, run.id)));
        return receipt(call, reservation, false);
      },
    );
  };
  return {
    reserve: (input) => admit(input, false),
    beginDispatch: (input) => admit(input, true),
    reconcile: async (input) => {
      input = closed(input, ["siteId", "providerCallId", "response"]);
      const response = parseResponse(input.response);
      if (response.siteId !== input.siteId || response.providerCallId !== input.providerCallId)
        fail("RUNTIME_RESOURCE_UNAVAILABLE", 404);
      const responseDigest = await npDigestAgentProviderResponseCanonical(response);
      return npWithAgentRuntimeControlTransactionV1(input.siteId, async ({ db }) => {
        const call = await findCall(db, input.siteId, input.providerCallId);
        const { reservation, pricing, recipe } = await retained(db, call);
        const observedAt = new Date(response.observedAt),
          current = nowAt(now);
        if (
          response.runId !== call.runId ||
          response.requestDigest !== call.requestDigest ||
          response.outcome.provider !== call.provider ||
          response.outcome.model !== call.model ||
          observedAt < (call.startedAt ?? call.createdAt) ||
          observedAt > current
        )
          fail("RUNTIME_PROVIDER_OUTPUT_INVALID");
        if (call.responseDigest === responseDigest) return receipt(call, reservation, true);
        const late = call.state === "ambiguous" && response.outcome.status !== "ambiguous";
        if (late && (reservation.state === "reconciled" || reservation.state === "released")) {
          const rows = await db
            .select({ payload: npAuditEvents.payload })
            .from(npAuditEvents)
            .where(
              and(
                eq(npAuditEvents.siteId, call.siteId),
                eq(npAuditEvents.targetType, "agent-provider-call"),
                eq(npAuditEvents.targetId, call.id),
                eq(npAuditEvents.action, "agent.runtime.usage"),
                sql`${npAuditEvents.payload}->>'transition'='late-reconciled'`,
              ),
            )
            .limit(2);
          if (rows.length === 1 && rows[0].payload.responseDigest === responseDigest)
            return receipt(call, reservation, true);
          fail("RUNTIME_IDEMPOTENCY_CONFLICT");
        }
        if (
          (!late && call.state !== "reserved" && call.state !== "in_flight") ||
          (reservation.state !== "reserved" && !(late && reservation.state === "expired"))
        )
          fail("RUNTIME_IDEMPOTENCY_CONFLICT");
        if (call.state === "reserved" && response.dispatchState !== "not-dispatched")
          fail("RUNTIME_DISPATCH_UNAVAILABLE");
        const usage = response.outcome.usage;
        if (
          usage?.costSource === "adapter-estimate" &&
          npComputeAgentModelCostMicrosV1({
            pricing,
            inputTokens: usage.inputTokens,
            cachedInputTokens: usage.cachedInputTokens,
            outputTokens: usage.outputTokens,
          }) !== usage.costMicros
        )
          fail("RUNTIME_PROVIDER_OUTPUT_INVALID");
        if (response.outcome.status === "succeeded") {
          if (response.decision?.task !== recipe.task) fail("RUNTIME_PROVIDER_OUTPUT_INVALID");
          try {
            npRequireAgentProviderSchemaValueV1(recipe.responseSchema, response.outcome.output);
          } catch {
            fail("RUNTIME_PROVIDER_OUTPUT_INVALID");
          }
        }
        const state =
          response.outcome.status === "failed" && response.outcome.errorClass === "cancelled"
            ? "cancelled"
            : response.outcome.status;
        let nextCall = call;
        if (!late) {
          const patch = {
            state,
            dispatchState: response.dispatchState,
            responseDigest,
            decision: response.decision,
            providerRequestId: response.outcome.providerRequestId,
            errorClass:
              response.outcome.status === "succeeded" ? null : response.outcome.errorClass,
            retryable: response.outcome.status === "failed" && response.outcome.retryable,
            inputTokens: usage?.inputTokens ?? null,
            cachedInputTokens: usage?.cachedInputTokens ?? null,
            outputTokens: usage?.outputTokens ?? null,
            usageSource: usage?.tokenSource ?? (state === "ambiguous" ? "unknown" : null),
            costMicros: usage?.costMicros ?? null,
            costSource: usage?.costSource ?? (state === "ambiguous" ? "unknown" : null),
            costCurrency: usage ? "USD" : null,
            finishReason: response.outcome.finishReason,
            latencyMs: response.outcome.latencyMs,
            finishedAt: observedAt,
          };
          await db
            .update(npAgentProviderCalls)
            .set(patch)
            .where(
              and(
                eq(npAgentProviderCalls.siteId, call.siteId),
                eq(npAgentProviderCalls.id, call.id),
              ),
            );
          nextCall = { ...call, ...patch };
        }
        if (state === "ambiguous") return receipt(nextCall, reservation, false);
        if (response.dispatchState === "dispatched" && !usage)
          fail("RUNTIME_PROVIDER_OUTPUT_INVALID");
        await daily(db, reservation, usage, false);
        const patch = usage
          ? {
              state: "reconciled",
              actualInputTokens: usage.inputTokens,
              actualCachedInputTokens: usage.cachedInputTokens,
              actualOutputTokens: usage.outputTokens,
              actualCostMicros: usage.costMicros,
              actualUsageSource: usage.tokenSource,
              actualCostSource: usage.costSource,
              unpriced: false,
              budgetChargeCostMicros: usage.costMicros,
              finalizedAt: current,
            }
          : {
              state: "released",
              actualInputTokens: null,
              actualCachedInputTokens: null,
              actualOutputTokens: null,
              actualCostMicros: null,
              actualUsageSource: null,
              actualCostSource: null,
              unpriced: false,
              budgetChargeCostMicros: 0,
              finalizedAt: current,
            };
        await db
          .update(npAgentUsageReservations)
          .set(patch)
          .where(
            and(
              eq(npAgentUsageReservations.siteId, call.siteId),
              eq(npAgentUsageReservations.id, reservation.id),
            ),
          );
        await audit(db, call, responseDigest, late ? "late-reconciled" : "reconciled", current);
        return receipt(nextCall, { ...reservation, ...patch }, false);
      });
    },
    expire: (input) => {
      input = closed(input, ["siteId", "limit"], ["siteId"]);
      return npWithAgentRuntimeControlTransactionV1(input.siteId, async ({ db }) => {
        const limit = input.limit ?? MAXIMUM_PAGE;
        if (!Number.isInteger(limit) || limit < 1 || limit > MAXIMUM_PAGE)
          fail("RUNTIME_ARGUMENT_INVALID", 400);
        const current = nowAt(now);
        const rows = await db
          .select()
          .from(npAgentUsageReservations)
          .where(
            and(
              eq(npAgentUsageReservations.siteId, input.siteId),
              eq(npAgentUsageReservations.state, "reserved"),
              lte(npAgentUsageReservations.expiresAt, current),
            ),
          )
          .orderBy(asc(npAgentUsageReservations.expiresAt), asc(npAgentUsageReservations.id))
          .limit(limit)
          .for("update");
        let released = 0,
          expired = 0;
        for (const row of rows) {
          const [found] = await db
            .select({ id: npAgentProviderCalls.id })
            .from(npAgentProviderCalls)
            .where(
              and(
                eq(npAgentProviderCalls.siteId, input.siteId),
                eq(npAgentProviderCalls.usageReservationId, row.id),
              ),
            )
            .limit(1);
          if (!found) fail();
          const call = await findCall(db, input.siteId, found.id);
          const { reservation } = await retained(db, call);
          if (!["reserved", "in_flight", "ambiguous"].includes(call.state)) fail();
          const undispatched = call.state === "reserved" && call.dispatchState === "not-dispatched";
          if (call.state !== "ambiguous") {
            const outcome = undispatched
              ? {
                  schemaVersion: "np.agent-provider-invoke-outcome.v1",
                  status: "failed",
                  provider: call.provider,
                  model: call.model,
                  providerRequestId: null,
                  output: null,
                  errorClass: "cancelled",
                  safeCode: "RESERVATION_EXPIRED",
                  retryable: false,
                  dispatchState: "not-dispatched",
                  usage: null,
                  finishReason: null,
                  latencyMs: 0,
                }
              : {
                  schemaVersion: "np.agent-provider-invoke-outcome.v1",
                  status: "ambiguous",
                  provider: call.provider,
                  model: call.model,
                  providerRequestId: null,
                  output: null,
                  errorClass: "timeout",
                  safeCode: "RESERVATION_EXPIRED",
                  retryable: false,
                  dispatchState: "unknown",
                  usage: null,
                  finishReason: null,
                  latencyMs: 0,
                };
            const response = parseResponse({
              schemaVersion: "np.agent-provider-response.v1",
              siteId: call.siteId,
              providerCallId: call.id,
              runId: call.runId,
              requestDigest: call.requestDigest,
              dispatchState: outcome.dispatchState,
              outcome,
              decision: null,
              observedAt: current.toISOString(),
            });
            const responseDigest = await npDigestAgentProviderResponseCanonical(response);
            await db
              .update(npAgentProviderCalls)
              .set({
                state: undispatched ? "cancelled" : "ambiguous",
                dispatchState: response.dispatchState,
                responseDigest,
                errorClass: undispatched ? "cancelled" : "timeout",
                latencyMs: 0,
                usageSource: undispatched ? null : "unknown",
                costSource: undispatched ? null : "unknown",
                finishedAt: current,
              })
              .where(
                and(
                  eq(npAgentProviderCalls.siteId, call.siteId),
                  eq(npAgentProviderCalls.id, call.id),
                ),
              );
            await audit(
              db,
              call,
              responseDigest,
              undispatched ? "expired-unsent" : "expired-unknown",
              current,
            );
          }
          await daily(db, reservation, null, !undispatched);
          await db
            .update(npAgentUsageReservations)
            .set({
              state: undispatched ? "released" : "expired",
              actualUsageSource: undispatched ? null : "unknown",
              actualCostSource: undispatched ? null : "unknown",
              unpriced: !undispatched,
              budgetChargeCostMicros: undispatched ? 0 : reservation.reservedCostMicros,
              finalizedAt: current,
            })
            .where(
              and(
                eq(npAgentUsageReservations.siteId, input.siteId),
                eq(npAgentUsageReservations.id, reservation.id),
              ),
            );
          if (undispatched) released++;
          else expired++;
        }
        return { examined: rows.length, released, expired };
      });
    },
  };
}
