import { npAuthUuidPattern } from "../auth-contract/index.js";
import {
  analyzeCanonicalBody,
  canonicalBodyArray,
  canonicalBodyAscii,
  canonicalBodyEnum,
  canonicalBodyIdentifier,
  canonicalBodyInteger,
  canonicalBodyRecord,
  canonicalBodySha256Digest,
  canonicalBodySiteId,
  canonicalBodyUtc,
  canonicalBodyUuid,
  failCanonicalBody,
  type CanonicalBodyInspectionState,
} from "./canonical-body-validation.js";
import { npRequireAgentSignalEvidenceCanonical } from "./canonical-events.js";
import { serializeAgentCanonicalJson } from "./canonical-foundation.js";
import { cloneCanonicalRuntimeInput, parseAgentSubject } from "./canonical-runtime-primitives.js";
import { npRequireAgentContractResult } from "./contract.js";
import type {
  NpAgentEvidenceRef,
  NpAgentJsonObject,
  NpAgentJsonSchema,
  NpAgentJsonValue,
  NpAgentSignalEvidenceCanonicalV1,
  NpAgentSubject,
} from "./types.js";

export interface NpAgentQuarantineProposalV1 {
  incidentId: string | null;
  target: { kind: "comment" | "document"; collection: string; id: string };
  expectedVersionDigest: string;
  reasonCode: string;
}
export interface NpAgentRestoreProposalV1 {
  containmentKind: "content_quarantine";
  containmentId: string;
  expectedVersionDigest: string;
}
export type NpAgentDirectActionInput<TProposal> =
  | { mode: "propose"; proposal: TProposal }
  | { mode: "execute_approved"; actionId: string; approvalId: string; proposalHash: string };
export interface NpAgentDirectActionApprovalRequiredV1 {
  state: "approval_required";
  runId: string;
  actionId: string;
  approvalId: string;
  proposalHash: string;
  approvalResource: string;
  expiresAt: string;
}
export interface NpAgentDirectActionOutputCommonV1 {
  schemaVersion: "np.agent-direct-action.v1";
  actionId: string;
  resultDigest: string;
  verificationRefs: string[];
}
export type NpAgentContainmentCreateOutputV1 = NpAgentDirectActionOutputCommonV1 &
  (
    | { state: "succeeded"; containmentId: string }
    | { state: "failed"; containmentId: string | null }
  );
export type NpAgentContainmentRestoreOutputV1 = NpAgentDirectActionOutputCommonV1 & {
  state: "compensated" | "failed";
  containmentId: string;
};
export const npAgentModeratorFeedbackLabelsV1 = ["confirmed-spam", "false-positive"] as const;
export type NpAgentModeratorFeedbackLabelV1 = (typeof npAgentModeratorFeedbackLabelsV1)[number];
export type NpAgentModeratorSubjectV1 = Extract<NpAgentSubject, { kind: "comment" | "document" }>;
export type NpAgentModeratorEvidenceV1 = Extract<
  NpAgentEvidenceRef,
  { kind: "event" | "revision" }
>;
/** Host-observed durable facts. Never accept this projection from a model or public caller. */
export interface NpAgentModeratorFactV1 {
  schemaVersion: "np.agent-moderator-fact.v1";
  siteId: string;
  observedAt: string;
  subject: NpAgentModeratorSubjectV1;
  memberId: string | null;
  targetVersionDigest: string;
  domainHashes: string[];
  spamVerdict: "pass" | "flag" | "reject";
  profanityVerdict: "pass" | "flag" | "reject";
  evidence: NpAgentModeratorEvidenceV1;
}
export interface NpAgentModeratorSettingsV1 {
  recipeId: "moderator.repeated-link-spam";
  recipeVersion: 1;
  collectionSlugs: string[];
  windowSeconds: 600;
  minIndependentAccounts: number;
  minItems: number;
  automaticConfidenceBasisPoints: number;
}
/** A rule score is not a calibrated probability and never authorizes quarantine. */
export interface NpAgentModeratorSignalCandidateV1 {
  canonicalEvidence: NpAgentSignalEvidenceCanonicalV1;
  evidenceDigest: string;
  fingerprint: string;
  severity: "medium";
  confidenceBasis: "exact-rule";
  scoreBasisPoints: number;
  title: string;
  summary: string;
  domainHash: string;
  facts: NpAgentModeratorFactV1[];
  advisory: true;
}
const state = (): CanonicalBodyInspectionState => ({ seen: new WeakSet<object>() });
const record = (
  value: unknown,
  path: string,
  keys: readonly string[],
  inspection: CanonicalBodyInspectionState,
) => canonicalBodyRecord(value, path, keys, keys, inspection);
const inspect = <T>(
  value: unknown,
  path: string,
  maximum: number,
  parser: (value: unknown, path: string, inspection: CanonicalBodyInspectionState) => T,
): T =>
  npRequireAgentContractResult(
    analyzeCanonicalBody(path, () =>
      parser(cloneCanonicalRuntimeInput(value, path, maximum), path, state()),
    ),
  );
const distinct = <T>(values: T[], path: string): T[] => {
  if (new Set(values).size !== values.length)
    failCanonicalBody("duplicate", path, "must contain distinct entries");
  return values;
};
const literal = <T extends string | number>(value: unknown, expected: T, path: string): T => {
  if (value !== expected)
    failCanonicalBody("invalid-field", path, `must equal ${String(expected)}`);
  return expected;
};
const stableCode = (value: unknown, path: string): string => {
  if (typeof value !== "string" || !/^[A-Z][A-Z0-9_]{0,63}$/u.test(value))
    failCanonicalBody("invalid-field", path, "must be an uppercase stable reason code");
  return value;
};
const hexDigest = (value: unknown, path: string): string => {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/u.test(value))
    failCanonicalBody("invalid-field", path, "must be a lowercase SHA-256 digest");
  return value;
};
function quarantine(
  value: unknown,
  path: string,
  inspection: CanonicalBodyInspectionState,
): NpAgentQuarantineProposalV1 {
  const raw = record(
    value,
    path,
    ["incidentId", "target", "expectedVersionDigest", "reasonCode"],
    inspection,
  );
  const target = record(raw.target, `${path}.target`, ["kind", "collection", "id"], inspection);
  return {
    incidentId:
      raw.incidentId === null ? null : canonicalBodyUuid(raw.incidentId, `${path}.incidentId`),
    target: {
      kind: canonicalBodyEnum(
        target.kind,
        `${path}.target.kind`,
        new Set(["comment", "document"] as const),
      ),
      collection: canonicalBodyIdentifier(target.collection, `${path}.target.collection`, 96),
      id: canonicalBodyAscii(target.id, `${path}.target.id`, 128),
    },
    expectedVersionDigest: canonicalBodySha256Digest(
      raw.expectedVersionDigest,
      `${path}.expectedVersionDigest`,
    ),
    reasonCode: stableCode(raw.reasonCode, `${path}.reasonCode`),
  };
}
function restore(
  value: unknown,
  path: string,
  inspection: CanonicalBodyInspectionState,
): NpAgentRestoreProposalV1 {
  const raw = record(
    value,
    path,
    ["containmentKind", "containmentId", "expectedVersionDigest"],
    inspection,
  );
  return {
    containmentKind: literal(raw.containmentKind, "content_quarantine", `${path}.containmentKind`),
    containmentId: canonicalBodyUuid(raw.containmentId, `${path}.containmentId`),
    expectedVersionDigest: canonicalBodySha256Digest(
      raw.expectedVersionDigest,
      `${path}.expectedVersionDigest`,
    ),
  };
}
function directInput<T>(
  parser: (value: unknown, path: string, inspection: CanonicalBodyInspectionState) => T,
) {
  return (
    value: unknown,
    path: string,
    inspection: CanonicalBodyInspectionState,
  ): NpAgentDirectActionInput<T> => {
    // Inspect the discriminator without invoking a getter before exact object validation.
    const mode =
      typeof value === "object" && value !== null
        ? (Object.getOwnPropertyDescriptor(value, "mode")?.value as unknown)
        : undefined;
    if (mode === "propose") {
      const raw = record(value, path, ["mode", "proposal"], inspection);
      return { mode, proposal: parser(raw.proposal, `${path}.proposal`, inspection) };
    }
    const raw = record(value, path, ["mode", "actionId", "approvalId", "proposalHash"], inspection);
    return {
      mode: literal(raw.mode, "execute_approved", `${path}.mode`),
      actionId: canonicalBodyUuid(raw.actionId, `${path}.actionId`),
      approvalId: canonicalBodyUuid(raw.approvalId, `${path}.approvalId`),
      proposalHash: canonicalBodySha256Digest(raw.proposalHash, `${path}.proposalHash`),
    };
  };
}
function directOutput(
  value: unknown,
  path: string,
  inspection: CanonicalBodyInspectionState,
  restoring: boolean,
) {
  const raw = record(
    value,
    path,
    ["schemaVersion", "actionId", "resultDigest", "verificationRefs", "state", "containmentId"],
    inspection,
  );
  const resultState = canonicalBodyEnum(
    raw.state,
    `${path}.state`,
    restoring
      ? new Set(["compensated", "failed"] as const)
      : new Set(["succeeded", "failed"] as const),
  );
  const containmentId =
    raw.containmentId === null && !restoring && resultState === "failed"
      ? null
      : canonicalBodyUuid(raw.containmentId, `${path}.containmentId`);
  return {
    schemaVersion: literal(raw.schemaVersion, "np.agent-direct-action.v1", `${path}.schemaVersion`),
    actionId: canonicalBodyUuid(raw.actionId, `${path}.actionId`),
    resultDigest: canonicalBodySha256Digest(raw.resultDigest, `${path}.resultDigest`),
    verificationRefs: distinct(
      canonicalBodyArray(raw.verificationRefs, `${path}.verificationRefs`, 100, inspection).map(
        (entry, index) => canonicalBodyAscii(entry, `${path}.verificationRefs[${index}]`, 128),
      ),
      `${path}.verificationRefs`,
    ),
    state: resultState,
    containmentId,
  };
}
export const npRequireAgentQuarantineProposalV1 = (value: unknown): NpAgentQuarantineProposalV1 =>
  inspect(value, "agent.quarantine", 4096, quarantine);
export const npRequireAgentRestoreProposalV1 = (value: unknown): NpAgentRestoreProposalV1 =>
  inspect(value, "agent.restore", 1024, restore);
export const npRequireAgentQuarantineInputV1 = (
  value: unknown,
): NpAgentDirectActionInput<NpAgentQuarantineProposalV1> =>
  inspect(value, "agent.quarantine", 8192, directInput(quarantine));
export const npRequireAgentRestoreInputV1 = (
  value: unknown,
): NpAgentDirectActionInput<NpAgentRestoreProposalV1> =>
  inspect(value, "agent.restore", 2048, directInput(restore));
export const npRequireAgentContainmentCreateOutputV1 = (
  value: unknown,
): NpAgentContainmentCreateOutputV1 => {
  const output = inspect(value, "agent.quarantine.output", 32768, (raw, path, inspection) =>
    directOutput(raw, path, inspection, false),
  );
  if (output.state === "failed") return { ...output, state: "failed" };
  return {
    ...output,
    state: "succeeded",
    containmentId: canonicalBodyUuid(output.containmentId, "agent.quarantine.output.containmentId"),
  };
};
export const npRequireAgentContainmentRestoreOutputV1 = (
  value: unknown,
): NpAgentContainmentRestoreOutputV1 => {
  const output = inspect(value, "agent.restore.output", 32768, (raw, path, inspection) =>
    directOutput(raw, path, inspection, true),
  );
  return {
    ...output,
    state: output.state === "compensated" ? "compensated" : "failed",
    containmentId: canonicalBodyUuid(output.containmentId, "agent.restore.output.containmentId"),
  };
};
export const npRequireAgentDirectActionApprovalRequiredV1 = (
  value: unknown,
): NpAgentDirectActionApprovalRequiredV1 =>
  inspect(value, "agent.directAction.approval", 4096, (value, path, inspection) => {
    const raw = record(
      value,
      path,
      ["state", "runId", "actionId", "approvalId", "proposalHash", "approvalResource", "expiresAt"],
      inspection,
    );
    const approvalId = canonicalBodyUuid(raw.approvalId, `${path}.approvalId`);
    if (raw.approvalResource !== `/admin/agents/approvals/${approvalId}`)
      failCanonicalBody(
        "invalid-field",
        `${path}.approvalResource`,
        "must reference the exact current-site approval page",
      );
    return {
      state: literal(raw.state, "approval_required", `${path}.state`),
      runId: canonicalBodyUuid(raw.runId, `${path}.runId`),
      actionId: canonicalBodyUuid(raw.actionId, `${path}.actionId`),
      approvalId,
      proposalHash: canonicalBodySha256Digest(raw.proposalHash, `${path}.proposalHash`),
      approvalResource: canonicalBodyAscii(raw.approvalResource, `${path}.approvalResource`, 512),
      expiresAt: canonicalBodyUtc(raw.expiresAt, `${path}.expiresAt`),
    };
  });
export const npRequireAgentModeratorFeedbackLabelV1 = (
  value: unknown,
): NpAgentModeratorFeedbackLabelV1 =>
  npRequireAgentContractResult(
    analyzeCanonicalBody("agent.moderator.feedback", () =>
      canonicalBodyEnum(
        value,
        "agent.moderator.feedback",
        new Set(npAgentModeratorFeedbackLabelsV1),
      ),
    ),
  );
export const npRequireAgentModeratorSettingsV1 = (value: unknown): NpAgentModeratorSettingsV1 =>
  inspect(value, "agent.moderator.settings", 16384, (value, path, inspection) => {
    const raw = record(
      value,
      path,
      [
        "recipeId",
        "recipeVersion",
        "collectionSlugs",
        "windowSeconds",
        "minIndependentAccounts",
        "minItems",
        "automaticConfidenceBasisPoints",
      ],
      inspection,
    );
    const collectionSlugs = distinct(
      canonicalBodyArray(raw.collectionSlugs, `${path}.collectionSlugs`, 64, inspection).map(
        (item, index) => canonicalBodyIdentifier(item, `${path}.collectionSlugs[${index}]`, 96),
      ),
      `${path}.collectionSlugs`,
    );
    if (collectionSlugs.length === 0)
      failCanonicalBody(
        "invalid-field",
        `${path}.collectionSlugs`,
        "must select at least one collection",
      );
    return {
      recipeId: literal(raw.recipeId, "moderator.repeated-link-spam", `${path}.recipeId`),
      recipeVersion: literal(raw.recipeVersion, 1, `${path}.recipeVersion`),
      collectionSlugs,
      windowSeconds: literal(raw.windowSeconds, 600, `${path}.windowSeconds`),
      minIndependentAccounts: canonicalBodyInteger(
        raw.minIndependentAccounts,
        `${path}.minIndependentAccounts`,
        2,
        100,
      ),
      minItems: canonicalBodyInteger(raw.minItems, `${path}.minItems`, 2, 100),
      automaticConfidenceBasisPoints: canonicalBodyInteger(
        raw.automaticConfidenceBasisPoints,
        `${path}.automaticConfidenceBasisPoints`,
        0,
        10000,
      ),
    };
  });
export const npRequireAgentModeratorFactV1 = (value: unknown): NpAgentModeratorFactV1 =>
  inspect(value, "agent.moderator.fact", 16384, (value, path, inspection) => {
    const raw = record(
      value,
      path,
      [
        "schemaVersion",
        "siteId",
        "observedAt",
        "subject",
        "memberId",
        "targetVersionDigest",
        "domainHashes",
        "spamVerdict",
        "profanityVerdict",
        "evidence",
      ],
      inspection,
    );
    const siteId = canonicalBodySiteId(raw.siteId, `${path}.siteId`);
    const observedAt = canonicalBodyUtc(raw.observedAt, `${path}.observedAt`);
    const subject = parseAgentSubject(raw.subject, `${path}.subject`, inspection);
    if (subject.kind !== "comment" && subject.kind !== "document")
      failCanonicalBody("invalid-field", `${path}.subject`, "must identify a document or comment");
    const canonical = npRequireAgentSignalEvidenceCanonical({
      schemaVersion: "np.agent-signal-evidence.v1",
      siteId,
      detectorId: "moderator.repeated-link-spam",
      detectorVersion: 1,
      category: "spam",
      window: { startedAt: observedAt, endedAt: observedAt },
      subject: null,
      evidence: [raw.evidence],
    });
    const evidence = canonical.evidence[0];
    if (
      !evidence ||
      (evidence.kind !== "event" && evidence.kind !== "revision") ||
      evidence.excerpt !== null
    )
      failCanonicalBody(
        "invalid-field",
        `${path}.evidence`,
        "must be an immutable event or revision reference without prose",
      );
    if (
      evidence.kind === "event" &&
      ![
        "community.content.created",
        "community.content.reported",
        "community.content.moderated",
      ].includes(evidence.eventKind)
    )
      failCanonicalBody(
        "invalid-field",
        `${path}.evidence`,
        "must reference a durable community event",
      );
    if (
      evidence.kind === "revision" &&
      (evidence.collection !== subject.collection ||
        evidence.documentId !== subject.documentId ||
        subject.kind !== "document")
    )
      failCanonicalBody(
        "invalid-field",
        `${path}.evidence`,
        "must reference the exact document revision",
      );
    return {
      schemaVersion: literal(
        raw.schemaVersion,
        "np.agent-moderator-fact.v1",
        `${path}.schemaVersion`,
      ),
      siteId,
      observedAt,
      subject,
      memberId: raw.memberId === null ? null : canonicalBodyUuid(raw.memberId, `${path}.memberId`),
      targetVersionDigest: canonicalBodySha256Digest(
        raw.targetVersionDigest,
        `${path}.targetVersionDigest`,
      ),
      domainHashes: distinct(
        canonicalBodyArray(raw.domainHashes, `${path}.domainHashes`, 16, inspection).map(
          (item, index) => hexDigest(item, `${path}.domainHashes[${index}]`),
        ),
        `${path}.domainHashes`,
      ).sort(),
      spamVerdict: canonicalBodyEnum(
        raw.spamVerdict,
        `${path}.spamVerdict`,
        new Set(["pass", "flag", "reject"] as const),
      ),
      profanityVerdict: canonicalBodyEnum(
        raw.profanityVerdict,
        `${path}.profanityVerdict`,
        new Set(["pass", "flag", "reject"] as const),
      ),
      evidence,
    };
  });

/** Validates bounded candidate consistency; the writer additionally recomputes its digest and resolves actual source facts. */
export const npRequireAgentModeratorSignalCandidateV1 = (
  value: unknown,
): NpAgentModeratorSignalCandidateV1 =>
  inspect(value, "agent.moderator.candidate", 2_097_152, (value, path, inspection) => {
    const raw = record(
      value,
      path,
      [
        "canonicalEvidence",
        "evidenceDigest",
        "fingerprint",
        "severity",
        "confidenceBasis",
        "scoreBasisPoints",
        "title",
        "summary",
        "domainHash",
        "facts",
        "advisory",
      ],
      inspection,
    );
    const canonicalEvidence = npRequireAgentSignalEvidenceCanonical(raw.canonicalEvidence);
    if (
      canonicalEvidence.detectorId !== "moderator.repeated-link-spam" ||
      canonicalEvidence.detectorVersion !== 1 ||
      canonicalEvidence.category !== "spam" ||
      canonicalEvidence.subject !== null ||
      Date.parse(canonicalEvidence.window.startedAt) % 600_000 !== 0 ||
      Date.parse(canonicalEvidence.window.endedAt) -
        Date.parse(canonicalEvidence.window.startedAt) !==
        599_999
    )
      failCanonicalBody(
        "invalid-field",
        `${path}.canonicalEvidence`,
        "must describe the versioned ten-minute Moderator campaign",
      );
    const domainHash = hexDigest(raw.domainHash, `${path}.domainHash`);
    const facts = canonicalBodyArray(raw.facts, `${path}.facts`, 100, inspection).map(
      npRequireAgentModeratorFactV1,
    );
    if (
      facts.length < 2 ||
      facts.length !== canonicalEvidence.evidence.length ||
      facts.some(
        (fact, index) =>
          fact.siteId !== canonicalEvidence.siteId ||
          fact.memberId === null ||
          fact.spamVerdict === "reject" ||
          fact.profanityVerdict === "reject" ||
          !fact.domainHashes.includes(domainHash) ||
          serializeAgentCanonicalJson(fact.evidence) !==
            serializeAgentCanonicalJson(canonicalEvidence.evidence[index]),
      )
    )
      failCanonicalBody(
        "invalid-field",
        `${path}.facts`,
        "must match the canonical campaign evidence exactly",
      );
    distinct(
      facts.map(
        (fact) =>
          `${fact.subject.kind}:${fact.subject.collection}:${fact.subject.kind === "comment" ? fact.subject.commentId : fact.subject.documentId}`,
      ),
      `${path}.facts`,
    );
    const members = new Set(facts.map((fact) => fact.memberId)).size;
    if (
      members < 2 ||
      raw.scoreBasisPoints !== Math.min(9500, 5000 + members * 500 + facts.length * 100)
    )
      failCanonicalBody(
        "invalid-field",
        `${path}.scoreBasisPoints`,
        "must equal the code-owned advisory count score",
      );
    if (raw.advisory !== true)
      failCanonicalBody(
        "invalid-field",
        `${path}.advisory`,
        "a detector candidate never authorizes execution",
      );
    return {
      canonicalEvidence,
      evidenceDigest: canonicalBodySha256Digest(raw.evidenceDigest, `${path}.evidenceDigest`),
      fingerprint: canonicalBodyAscii(raw.fingerprint, `${path}.fingerprint`, 256),
      severity: literal(raw.severity, "medium", `${path}.severity`),
      confidenceBasis: literal(raw.confidenceBasis, "exact-rule", `${path}.confidenceBasis`),
      scoreBasisPoints: canonicalBodyInteger(
        raw.scoreBasisPoints,
        `${path}.scoreBasisPoints`,
        0,
        10000,
      ),
      title: literal(raw.title, "Repeated-link activity", `${path}.title`),
      summary: literal(
        raw.summary,
        "Independent member accounts posted the same link domain within ten minutes. Human review is required.",
        `${path}.summary`,
      ),
      domainHash,
      facts,
      advisory: true,
    };
  });

const objectNode = (properties: Record<string, NpAgentJsonValue>): NpAgentJsonObject => ({
  type: "object",
  additionalProperties: false,
  properties,
  required: Object.keys(properties),
});
const uuidNode: NpAgentJsonObject = {
  type: "string",
  minLength: 36,
  maxLength: 36,
  pattern: npAuthUuidPattern,
};
const digestNode: NpAgentJsonObject = {
  type: "string",
  minLength: 54,
  maxLength: 54,
  pattern: "^cj1:sha256:[A-Za-z0-9_-]{43}$",
};
const asciiNode = (maximum: number): NpAgentJsonObject => ({
  type: "string",
  minLength: 1,
  maxLength: maximum,
  pattern: "^[\\x21-\\x7e]+$",
});
const nullable = (node: NpAgentJsonValue): NpAgentJsonObject => ({
  oneOf: [node, { type: "null" }],
});
const quarantineNode = () =>
  objectNode({
    incidentId: nullable(uuidNode),
    target: objectNode({
      kind: { type: "string", maxLength: 8, enum: ["comment", "document"] },
      collection: {
        type: "string",
        minLength: 1,
        maxLength: 96,
        pattern: "^[a-z][a-z0-9_-]{0,39}(?:\\.[a-z][a-z0-9_-]{0,39})*$",
      },
      id: asciiNode(128),
    }),
    expectedVersionDigest: digestNode,
    reasonCode: { type: "string", minLength: 1, maxLength: 64, pattern: "^[A-Z][A-Z0-9_]{0,63}$" },
  });
const restoreNode = () =>
  objectNode({
    containmentKind: { const: "content_quarantine" },
    containmentId: uuidNode,
    expectedVersionDigest: digestNode,
  });
const inputNode = (proposal: NpAgentJsonValue): NpAgentJsonObject => ({
  oneOf: [
    objectNode({ mode: { const: "propose" }, proposal }),
    objectNode({
      mode: { const: "execute_approved" },
      actionId: uuidNode,
      approvalId: uuidNode,
      proposalHash: digestNode,
    }),
  ],
});
const outputNode = (restoring: boolean): NpAgentJsonObject => ({
  oneOf: (restoring ? ["compensated", "failed"] : ["succeeded", "failed"]).map((resultState) =>
    objectNode({
      schemaVersion: { const: "np.agent-direct-action.v1" },
      actionId: uuidNode,
      resultDigest: digestNode,
      verificationRefs: { type: "array", maxItems: 100, uniqueItems: true, items: asciiNode(128) },
      state: { const: resultState },
      containmentId: !restoring && resultState === "failed" ? nullable(uuidNode) : uuidNode,
    }),
  ),
});
const schema = (value: NpAgentJsonObject): NpAgentJsonSchema => {
  const union = Array.isArray(value.oneOf) ? value.oneOf : null;
  const properties: NpAgentJsonObject = {};
  if (union)
    for (const branch of union) {
      if (
        branch !== null &&
        typeof branch === "object" &&
        !Array.isArray(branch) &&
        branch.properties !== null &&
        typeof branch.properties === "object" &&
        !Array.isArray(branch.properties)
      )
        for (const [key, node] of Object.entries(branch.properties)) {
          const previous = properties[key];
          properties[key] =
            previous === undefined || JSON.stringify(previous) === JSON.stringify(node)
              ? node
              : { anyOf: [previous, node] };
        }
    }
  return JSON.parse(
    JSON.stringify({
      $schema: "https://json-schema.org/draft/2020-12/schema",
      ...(union ? { type: "object", additionalProperties: false, properties } : {}),
      ...value,
    }),
  ) as NpAgentJsonSchema;
};
export const npAgentQuarantineProposalSchemaV1 = (): NpAgentJsonSchema => schema(quarantineNode());
export const npAgentRestoreProposalSchemaV1 = (): NpAgentJsonSchema => schema(restoreNode());
export const npAgentQuarantineInputSchemaV1 = (): NpAgentJsonSchema =>
  schema(inputNode(quarantineNode()));
export const npAgentRestoreInputSchemaV1 = (): NpAgentJsonSchema =>
  schema(inputNode(restoreNode()));
export const npAgentContainmentCreateOutputSchemaV1 = (): NpAgentJsonSchema =>
  schema(outputNode(false));
export const npAgentContainmentRestoreOutputSchemaV1 = (): NpAgentJsonSchema =>
  schema(outputNode(true));
export const npAgentDirectActionApprovalRequiredSchemaV1 = (): NpAgentJsonSchema =>
  schema(
    objectNode({
      state: { const: "approval_required" },
      runId: uuidNode,
      actionId: uuidNode,
      approvalId: uuidNode,
      proposalHash: digestNode,
      approvalResource: {
        type: "string",
        minLength: "/admin/agents/approvals/".length + 36,
        maxLength: "/admin/agents/approvals/".length + 36,
        pattern: "^/admin/agents/approvals/[a-f0-9-]{36}$",
      },
      expiresAt: {
        type: "string",
        minLength: 24,
        maxLength: 24,
        pattern: "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$",
      },
    }),
  );
