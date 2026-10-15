import { createHash, randomUUID } from "node:crypto";
import { and, asc, eq, gt, gte, lt, sql, type SQL } from "drizzle-orm";
import { serializeAgentCanonicalJson } from "../agent-contract/canonical-foundation.js";
import {
  npRequireAgentModeratorFactV1,
  type NpAgentModeratorFactV1,
  type NpAgentModeratorSettingsV1,
} from "../agent-contract/moderator-contract.js";
import type { NpAuthUser } from "../config/types.js";
import type { getDb } from "../db/runtime.js";
import { npAgentEvents } from "../db/schema/agent.js";
import { npSettings } from "../db/schema/system.js";
import { NpAgentGatewayError } from "./admin-admission.js";
import type { NpAgentIncidentWriteServiceV1 } from "./incident-write-service.js";
import type { NpAgentModeratorCombinedCollectionResultV1 } from "./moderator-combined-collector.js";
import { npReadAgentModeratorCommentEvidenceFactV1 } from "./moderator-comment-evidence.js";
import { npReadAgentModeratorContentEvidenceFactV1 } from "./moderator-content-evidence.js";
import {
  npMergeModeratorFloodTargetV1,
  npModeratorFloodCandidateV1,
  npModeratorFloodEvidenceBatchV1,
  npModeratorFloodTargetV1,
  npModeratorFloodWitnessV1,
} from "./moderator-flood-facts.js";

type Db = ReturnType<typeof getDb>;
type Source = typeof npAgentEvents.$inferSelect;
type Phase = "scan" | "verify" | "emit" | "complete" | "expired";
interface State {
  version: 1;
  phase: Phase;
  generation: string;
  scanGeneration: string;
  windowStartedAt: string;
  staffUserId: string;
  includeDocuments: boolean;
  settings: NpAgentModeratorSettingsV1;
  sourceCount: number;
  acceptedSources: number;
  verifiedTargets: number;
  verifyCursor: string | null;
  domainCursor: string | null;
}
interface Domain {
  domainHash: string;
  witness: NpAgentModeratorFactV1[];
  cursor: string | null;
}
interface Input {
  db: Db;
  siteId: string;
  windowStartedAt: string;
  settings: NpAgentModeratorSettingsV1;
  staffUserId: string;
  includeDocuments: boolean;
  user: NpAuthUser;
  incidents: NpAgentIncidentWriteServiceV1;
  selectedSources: SQL | undefined;
  now: Date;
  initialize?: boolean;
}

/** Private checkpoint metadata, never model input, approval evidence or an activation setting.
 * Each call handles <=100 sources OR <=100 current targets OR one <=100-reference Signal.
 * All source-ledger/target/domain rows are site-scoped and share this prefix for retention. */
export const NP_MODERATOR_FLOOD_PREFIX_V1 = "agent.moderator.flood.v1:";
const digest = (value: string) => createHash("sha256").update(value).digest("hex");
const same = (a: unknown, b: unknown) =>
  serializeAgentCanonicalJson(a) === serializeAgentCanonicalJson(b);
const unavailable = (): never => {
  throw new NpAgentGatewayError(
    "MODERATOR_SOURCE_UNAVAILABLE",
    409,
    "Moderator evidence is unavailable.",
  );
};
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return unavailable();
  return value as Record<string, unknown>;
}
function stateValue(value: unknown, input: Input): State {
  const raw = record(value);
  if (
    raw.version !== 1 ||
    !["scan", "verify", "emit", "complete", "expired"].includes(String(raw.phase)) ||
    typeof raw.generation !== "string" ||
    !/^[a-f0-9-]{36}$/u.test(raw.generation) ||
    typeof raw.scanGeneration !== "string" ||
    !/^[a-f0-9-]{36}$/u.test(raw.scanGeneration) ||
    raw.windowStartedAt !== input.windowStartedAt ||
    raw.staffUserId !== input.staffUserId ||
    raw.includeDocuments !== input.includeDocuments ||
    !same(raw.settings, input.settings) ||
    ![raw.sourceCount, raw.acceptedSources, raw.verifiedTargets].every(
      (count) => Number.isSafeInteger(count) && Number(count) >= 0,
    ) ||
    ![raw.verifyCursor, raw.domainCursor].every(
      (cursor) => cursor === null || typeof cursor === "string",
    )
  )
    return unavailable();
  return raw as unknown as State;
}
function domainValue(value: unknown, domainHash: string): Domain {
  const raw = record(value);
  if (
    raw.domainHash !== domainHash ||
    !Array.isArray(raw.witness) ||
    raw.witness.length > 100 ||
    (raw.cursor !== null && typeof raw.cursor !== "string")
  )
    return unavailable();
  const witness = raw.witness.map(npRequireAgentModeratorFactV1);
  if (witness.some((fact) => !fact.domainHashes.includes(domainHash))) return unavailable();
  return { domainHash, witness, cursor: raw.cursor };
}

export function npModeratorFloodScopeV1(
  input: Pick<Input, "windowStartedAt" | "settings" | "staffUserId" | "includeDocuments">,
): string {
  return `${NP_MODERATOR_FLOOD_PREFIX_V1}${digest(
    serializeAgentCanonicalJson({
      windowStartedAt: input.windowStartedAt,
      settings: input.settings,
      staffUserId: input.staffUserId,
      includeDocuments: input.includeDocuments,
    }),
  )}:`;
}

export async function npCollectAgentModeratorFloodPageV1(
  input: Input,
): Promise<NpAgentModeratorCombinedCollectionResultV1 | null> {
  const { db, siteId } = input;
  const scope = npModeratorFloodScopeV1(input);
  const stateKey = `${scope}state`;
  const read = async (key: string): Promise<unknown> => {
    const [row] = await db
      .select({ value: npSettings.value })
      .from(npSettings)
      .where(and(eq(npSettings.siteId, siteId), eq(npSettings.key, key)))
      .limit(1);
    return row?.value;
  };
  const write = async (key: string, value: unknown) => {
    await db
      .insert(npSettings)
      .values({ siteId, key, value, updatedAt: input.now, updatedBy: null })
      .onConflictDoUpdate({
        target: [npSettings.siteId, npSettings.key],
        set: { value, updatedAt: input.now, updatedBy: null },
      });
  };
  const rawState = await read(stateKey);
  if (rawState === undefined && !input.initialize) return null;
  const state: State =
    rawState === undefined
      ? {
          version: 1,
          phase: "scan",
          generation: randomUUID(),
          scanGeneration: randomUUID(),
          windowStartedAt: input.windowStartedAt,
          settings: input.settings,
          staffUserId: input.staffUserId,
          includeDocuments: input.includeDocuments,
          sourceCount: 0,
          acceptedSources: 0,
          verifiedTargets: 0,
          verifyCursor: null,
          domainCursor: null,
        }
      : stateValue(rawState, input);
  if (state.phase === "expired")
    throw new NpAgentGatewayError(
      "MODERATOR_SOURCE_EXPIRED",
      409,
      "Moderator source collection has expired.",
    );
  const sourcePrefix = `${scope}scan:${state.scanGeneration}:source:`;
  const targetPrefix = `${scope}scan:${state.scanGeneration}:target:`;
  const generationPrefix = () => `${scope}generation:${state.generation}:`;
  const pending = async (
    inspectedEvents = 0,
    acceptedFacts = 0,
  ): Promise<NpAgentModeratorCombinedCollectionResultV1> => {
    await write(stateKey, state);
    return { inspectedEvents, acceptedFacts, observations: [], complete: false };
  };
  const sources = await db
    .select()
    .from(npAgentEvents)
    .where(
      and(
        input.selectedSources,
        sql`not exists (select 1 from ${npSettings} as checkpoint_source where checkpoint_source.site_id=${siteId} and checkpoint_source.key=${sourcePrefix} || ${npAgentEvents.id}::text)`,
      ),
    )
    .orderBy(asc(npAgentEvents.occurredAt), asc(npAgentEvents.id))
    .limit(100);
  const resolve = async (source: Source) =>
    input.includeDocuments
      ? npReadAgentModeratorContentEvidenceFactV1(db, source, input.user)
      : npReadAgentModeratorCommentEvidenceFactV1(db, source, input.user);
  const current = async (
    expected: NpAgentModeratorFactV1,
  ): Promise<NpAgentModeratorFactV1 | null> => {
    if (expected.evidence.kind !== "event") return unavailable();
    const [source] = await db
      .select()
      .from(npAgentEvents)
      .where(and(eq(npAgentEvents.siteId, siteId), eq(npAgentEvents.id, expected.evidence.eventId)))
      .limit(1);
    // Missing retained refs cannot establish complete collection. Retention preserves pending ledgers.
    if (!source) return unavailable();
    const fact = await resolve(source);
    return fact && same(fact, expected) ? fact : null;
  };
  if (sources.length) {
    // An anti-join ledger, rather than a timestamp/UUID high-water assumption,
    // includes late recorded Events even when their occurredAt sorts behind a prior page.
    if (state.phase !== "scan") {
      state.generation = randomUUID();
      state.verifyCursor = null;
      state.domainCursor = null;
      state.verifiedTargets = 0;
      state.phase = "scan";
    }
    let accepted = 0;
    for (const source of sources) {
      const fact = await resolve(source);
      if (fact) {
        accepted++;
        const key = `${targetPrefix}${digest(npModeratorFloodTargetV1(fact))}`;
        const previous = await read(key);
        await write(
          key,
          npMergeModeratorFloodTargetV1(
            previous === undefined ? null : npRequireAgentModeratorFactV1(previous),
            fact,
          ),
        );
      }
      await write(`${sourcePrefix}${source.id}`, {
        eventId: source.id,
        eventHash: source.eventHash,
      });
    }
    state.sourceCount += sources.length;
    state.acceptedSources += accepted;
    return pending(sources.length, accepted);
  }
  if (state.phase === "complete") {
    // Completion belongs to that finished attempt, not permanent source/ACL
    // authority. A fresh explicit collection must re-resolve even sources which
    // were unavailable during the prior attempt. Existing Runtime Run replays
    // bypass collection through their retained-authority owner instead.
    state.scanGeneration = randomUUID();
    state.generation = randomUUID();
    state.phase = "scan";
    state.verifyCursor = null;
    state.domainCursor = null;
    state.sourceCount = 0;
    state.acceptedSources = 0;
    state.verifiedTargets = 0;
    return pending();
  }
  if (state.phase === "scan") state.phase = "verify";
  if (state.phase === "verify") {
    const targets = await db
      .select({ key: npSettings.key, value: npSettings.value })
      .from(npSettings)
      .where(
        and(
          eq(npSettings.siteId, siteId),
          gte(npSettings.key, targetPrefix),
          lt(npSettings.key, `${targetPrefix}\uffff`),
          state.verifyCursor ? gt(npSettings.key, state.verifyCursor) : undefined,
        ),
      )
      .orderBy(asc(npSettings.key))
      .limit(100);
    for (const target of targets) {
      const fact = await current(npRequireAgentModeratorFactV1(target.value));
      if (
        fact &&
        fact.memberId !== null &&
        fact.spamVerdict !== "reject" &&
        fact.profanityVerdict !== "reject"
      ) {
        state.verifiedTargets++;
        for (const domainHash of fact.domainHashes) {
          const domainKey = `${generationPrefix()}domain:${domainHash}`;
          const previous = await read(domainKey);
          const domain =
            previous === undefined
              ? { domainHash, witness: [], cursor: null }
              : domainValue(previous, domainHash);
          domain.witness = npModeratorFloodWitnessV1([...domain.witness, fact]);
          await write(domainKey, domain);
          await write(
            `${generationPrefix()}member:${domainHash}:${target.key.slice(targetPrefix.length)}`,
            fact,
          );
        }
      }
      state.verifyCursor = target.key;
    }
    if (targets.length < 100) state.phase = "emit";
    return pending();
  }
  const domainPrefix = `${generationPrefix()}domain:`;
  const [row] = await db
    .select({ key: npSettings.key, value: npSettings.value })
    .from(npSettings)
    .where(
      and(
        eq(npSettings.siteId, siteId),
        gte(npSettings.key, domainPrefix),
        lt(npSettings.key, `${domainPrefix}\uffff`),
        state.domainCursor ? gt(npSettings.key, state.domainCursor) : undefined,
      ),
    )
    .orderBy(asc(npSettings.key))
    .limit(1);
  if (!row) {
    state.phase = "complete";
    await write(stateKey, state);
    return { inspectedEvents: 0, acceptedFacts: 0, observations: [], complete: true };
  }
  const domainHash = row.key.slice(domainPrefix.length);
  const domain = domainValue(row.value, domainHash);
  const qualifies =
    domain.witness.length >= input.settings.minItems &&
    new Set(domain.witness.map((fact) => fact.memberId)).size >=
      input.settings.minIndependentAccounts;
  if (!qualifies) {
    state.domainCursor = row.key;
    return pending();
  }
  // A changed current source must rebuild all memberships, never turn a stale
  // capped witness into a negative or a successful whole-window completion.
  for (const fact of domain.witness)
    if (!(await current(fact))) {
      state.generation = randomUUID();
      state.phase = "verify";
      state.verifyCursor = null;
      state.domainCursor = null;
      state.verifiedTargets = 0;
      return pending();
    }
  const memberPrefix = `${generationPrefix()}member:${domainHash}:`;
  const members = await db
    .select({ key: npSettings.key, value: npSettings.value })
    .from(npSettings)
    .where(
      and(
        eq(npSettings.siteId, siteId),
        gte(npSettings.key, memberPrefix),
        lt(npSettings.key, `${memberPrefix}\uffff`),
        domain.cursor ? gt(npSettings.key, domain.cursor) : undefined,
      ),
    )
    .orderBy(asc(npSettings.key))
    .limit(100);
  if (!members.length) {
    state.domainCursor = row.key;
    return pending();
  }
  const facts: NpAgentModeratorFactV1[] = [];
  for (const member of members) {
    const expected = npRequireAgentModeratorFactV1(member.value);
    const fact = await current(expected);
    if (!fact) {
      state.generation = randomUUID();
      state.phase = "verify";
      state.verifyCursor = null;
      state.domainCursor = null;
      state.verifiedTargets = 0;
      return pending();
    }
    facts.push(fact);
  }
  const batch = npModeratorFloodEvidenceBatchV1({
    facts,
    witness: domain.witness,
    settings: input.settings,
  });
  if (!batch) return unavailable();
  const candidate = await npModeratorFloodCandidateV1({
    siteId,
    windowStartedAt: input.windowStartedAt,
    domainHash,
    facts: batch.facts,
  });
  const observation = await input.incidents.observe(candidate, { transaction: db });
  domain.cursor = members[batch.consumed - 1]?.key ?? unavailable();
  await write(row.key, domain);
  await write(stateKey, state);
  return { inspectedEvents: 0, acceptedFacts: 0, observations: [observation], complete: false };
}
