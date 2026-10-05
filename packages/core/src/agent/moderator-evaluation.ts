import {
  canonicalBodyRecord,
  canonicalBodyUtc,
} from "../agent-contract/canonical-body-validation.js";
import { cloneCanonicalRuntimeInput } from "../agent-contract/canonical-runtime-primitives.js";
import { serializeAgentCanonicalJson } from "../agent-contract/canonical-foundation.js";
import { npDigestAgentEvaluationValueV1 } from "../agent-contract/evaluation-contract.js";
import {
  npRequireAgentModeratorFeedbackLabelV1,
  npRequireAgentModeratorSignalCandidateV1,
} from "../agent-contract/moderator-contract.js";
import {
  npAgentModeratorEvaluationArtifactMaxBytesV1,
  type NpAgentModeratorEvaluationArtifactV1,
  type NpAgentModeratorEvaluationCaseV1,
  type NpAgentModeratorEvaluationCaseResultV1,
  type NpAgentModeratorEvaluationComparisonV1,
  type NpAgentModeratorEvaluationSummaryV1,
} from "../agent-contract/moderator-evaluation-contract.js";
import type {
  NpAgentModeratorEvaluationReviewArtifactV1,
  NpAgentModeratorEvaluationReviewComparisonV1,
  NpAgentModeratorEvaluationReviewEntryV1,
  NpAgentModeratorEvaluationReviewSummaryV1,
} from "../agent-contract/moderator-evaluation-review-contract.js";
import { npDetectAgentRepeatedLinkSpamV1 } from "./moderator-detector.js";
import { createAgentModeratorEvaluationCasesV1 } from "./moderator-evaluation-fixtures.js";

const path = "agent.moderatorEvaluation";
const fail = (): never => {
  throw new Error("Invalid bounded Moderator offline evaluation.");
};
const clone = (value: unknown) =>
  cloneCanonicalRuntimeInput(value, path, npAgentModeratorEvaluationArtifactMaxBytesV1, {
    maximumNodes: 100_000,
  });
const equal = (a: unknown, b: unknown) =>
  serializeAgentCanonicalJson(a) === serializeAgentCanonicalJson(b);
const record = (value: unknown, keys: string[]) =>
  canonicalBodyRecord(value, path, keys, keys, { seen: new WeakSet() });
const rate = (numerator: number, denominator: number) =>
  denominator === 0 ? null : Math.round((numerator * 10_000) / denominator);

function summarize(
  cases: NpAgentModeratorEvaluationCaseV1[],
  results: NpAgentModeratorEvaluationCaseResultV1[],
): NpAgentModeratorEvaluationSummaryV1 {
  let truePositive = 0,
    falsePositive = 0,
    trueNegative = 0,
    falseNegative = 0;
  let missingExpectedSignals = 0,
    unexpectedSignals = 0;
  for (let i = 0; i < cases.length; i++) {
    const fixture = cases[i],
      result = results[i];
    const predicted = result.signals.map((s) => s.domainHash);
    missingExpectedSignals += fixture.expectedDomainHashes.filter(
      (d) => !predicted.includes(d),
    ).length;
    unexpectedSignals += predicted.filter((d) => !fixture.expectedDomainHashes.includes(d)).length;
    if (result.signals.length > 0) {
      if (fixture.referenceLabel === "spam") truePositive++;
      else falsePositive++;
    } else if (fixture.referenceLabel === "spam") falseNegative++;
    else trueNegative++;
  }
  return {
    cases: cases.length,
    matchedSignalExpectations: results.filter((r) => r.expectedSignalsMatched).length,
    missingExpectedSignals,
    unexpectedSignals,
    syntheticClassification: {
      truePositive,
      falsePositive,
      trueNegative,
      falseNegative,
      precisionBasisPoints: rate(truePositive, truePositive + falsePositive),
      recallBasisPoints: rate(truePositive, truePositive + falseNegative),
    },
  };
}

/** Runs only the shipped synthetic suite through the actual advisory detector. No host bootstrap. */
export async function runAgentModeratorEvaluationV1(): Promise<NpAgentModeratorEvaluationArtifactV1> {
  const cases = await createAgentModeratorEvaluationCasesV1();
  const caseResults: NpAgentModeratorEvaluationCaseResultV1[] = [];
  for (const fixture of cases) {
    const signals = (
      await npDetectAgentRepeatedLinkSpamV1({
        siteId: fixture.siteId,
        windowStartedAt: fixture.windowStartedAt,
        settings: fixture.settings,
        facts: fixture.observations.map((o) => o.fact),
      })
    ).map(npRequireAgentModeratorSignalCandidateV1);
    caseResults.push({
      caseId: fixture.id,
      caseVersion: fixture.caseVersion,
      caseHash: await npDigestAgentEvaluationValueV1(fixture),
      predictionHash: await npDigestAgentEvaluationValueV1(signals),
      signals,
      expectedSignalsMatched: equal(
        signals.map((s) => s.domainHash).sort(),
        fixture.expectedDomainHashes,
      ),
    });
  }
  const byLocale = (locale: "en" | "ko") =>
    summarize(
      cases.filter((c) => c.locale === locale),
      caseResults.filter((_, i) => cases[i].locale === locale),
    );
  const body = {
    schemaVersion: "np.agent-moderator-eval.v1" as const,
    dataset: "moderator.v1" as const,
    mode: "deterministic-offline" as const,
    authority: "advisory-no-activation" as const,
    suiteHash: await npDigestAgentEvaluationValueV1(cases),
    cases,
    caseResults,
    summary: summarize(cases, caseResults),
    byLocale: { en: byLocale("en"), ko: byLocale("ko") },
    ok: caseResults.every((r) => r.expectedSignalsMatched),
  };
  const artifact = { ...body, artifactHash: await npDigestAgentEvaluationValueV1(body) };
  clone(artifact);
  return artifact;
}

/** Replays the fixed versioned suite independently; caller-authored expectations are never trusted. */
export async function npRequireAgentModeratorEvaluationArtifactV1(
  value: unknown,
): Promise<NpAgentModeratorEvaluationArtifactV1> {
  const input = clone(value);
  const actual = await runAgentModeratorEvaluationV1();
  if (!equal(input, actual)) fail();
  return actual;
}
export async function npCompareAgentModeratorEvaluationArtifactsV1(
  currentValue: unknown,
  baselineValue: unknown,
): Promise<NpAgentModeratorEvaluationComparisonV1> {
  const current = await npRequireAgentModeratorEvaluationArtifactV1(currentValue);
  const baseline = await npRequireAgentModeratorEvaluationArtifactV1(baselineValue);
  const comparable = current.suiteHash === baseline.suiteHash;
  return {
    comparable,
    reason: comparable ? null : "INCOMPATIBLE_SUITE",
    current: comparable ? current.summary : null,
    baseline: comparable ? baseline.summary : null,
    matchedSignalExpectationsDelta: comparable
      ? current.summary.matchedSignalExpectations - baseline.summary.matchedSignalExpectations
      : null,
  };
}

const boundedText = (value: unknown, maximum: number, required = false): string => {
  if (
    typeof value !== "string" ||
    value.length > maximum ||
    (required && !value.trim()) ||
    Array.from(value).some((character) => {
      const code = character.charCodeAt(0);
      return (code < 32 && code !== 9 && code !== 10 && code !== 13) || code === 127;
    })
  )
    fail();
  return value as string;
};
function reviewSummary(
  entries: NpAgentModeratorEvaluationReviewEntryV1[],
): NpAgentModeratorEvaluationReviewSummaryV1 {
  const eligible = entries.filter((e) => e.eligible).length;
  const confirmedSpam = entries.filter((e) => e.review?.label === "confirmed-spam").length;
  const falsePositive = entries.filter((e) => e.review?.label === "false-positive").length;
  const reviewed = confirmedSpam + falsePositive;
  return {
    eligible,
    ineligible: entries.length - eligible,
    reviewed,
    unreviewed: eligible - reviewed,
    confirmedSpam,
    falsePositive,
    confirmedSpamBasisPoints: rate(confirmedSpam, reviewed),
    falsePositiveBasisPoints: rate(falsePositive, reviewed),
  };
}
/** Offline labels reuse the Incident vocabulary but never write an Incident or authorize containment. */
export async function npBuildAgentModeratorEvaluationReviewArtifactV1(
  sourceValue: unknown,
  labelsValue: unknown = [],
): Promise<NpAgentModeratorEvaluationReviewArtifactV1> {
  const source = await npRequireAgentModeratorEvaluationArtifactV1(sourceValue);
  const sourceHash = await npDigestAgentEvaluationValueV1(source);
  const labels = clone(labelsValue);
  if (!Array.isArray(labels) || labels.length > source.cases.length) fail();
  const entries: NpAgentModeratorEvaluationReviewEntryV1[] = source.caseResults.map((r) => ({
    caseId: r.caseId,
    caseVersion: r.caseVersion,
    caseHash: r.caseHash,
    predictionHash: r.predictionHash,
    sourceHash,
    eligible: r.signals.length === 1,
    review: null,
  }));
  for (const label of labels as unknown[]) {
    const raw = record(label, [
      "caseId",
      "caseHash",
      "predictionHash",
      "sourceHash",
      "label",
      "reviewer",
      "reviewedAt",
      "notes",
    ]);
    const entry = entries.find((e) => e.caseId === raw.caseId && e.caseHash === raw.caseHash);
    if (
      !entry ||
      !entry.eligible ||
      entry.review ||
      raw.predictionHash !== entry.predictionHash ||
      raw.sourceHash !== sourceHash
    )
      fail();
    const target = entry as NpAgentModeratorEvaluationReviewEntryV1;
    target.review = {
      caseId: target.caseId,
      caseHash: target.caseHash,
      predictionHash: target.predictionHash,
      sourceHash,
      label: npRequireAgentModeratorFeedbackLabelV1(raw.label),
      reviewer: boundedText(raw.reviewer, 128, true),
      reviewedAt: canonicalBodyUtc(raw.reviewedAt, path),
      notes: boundedText(raw.notes, 2000),
    };
  }
  const body = {
    schemaVersion: "np.agent-moderator-eval-review.v1" as const,
    authority: "offline-self-reported-no-approval" as const,
    source,
    sourceHash,
    labels: entries.flatMap((e) => (e.review ? [structuredClone(e.review)] : [])),
    entries,
    summary: reviewSummary(entries),
  };
  const artifact = { ...body, artifactHash: await npDigestAgentEvaluationValueV1(body) };
  clone(artifact);
  return artifact;
}
export async function npRequireAgentModeratorEvaluationReviewArtifactV1(
  value: unknown,
): Promise<NpAgentModeratorEvaluationReviewArtifactV1> {
  const input = record(clone(value), [
    "schemaVersion",
    "authority",
    "source",
    "sourceHash",
    "labels",
    "entries",
    "summary",
    "artifactHash",
  ]);
  const actual = await npBuildAgentModeratorEvaluationReviewArtifactV1(input.source, input.labels);
  if (!equal(input, actual)) fail();
  return actual;
}
const caseKey = (entry: NpAgentModeratorEvaluationReviewEntryV1) =>
  `${entry.caseId}@${entry.caseVersion}`;
export async function npCompareAgentModeratorEvaluationReviewArtifactsV1(
  currentValue: unknown,
  baselineValue: unknown,
): Promise<NpAgentModeratorEvaluationReviewComparisonV1> {
  const current = await npRequireAgentModeratorEvaluationReviewArtifactV1(currentValue);
  const baseline = await npRequireAgentModeratorEvaluationReviewArtifactV1(baselineValue);
  const compatible = current.source.suiteHash === baseline.source.suiteHash;
  const matched = compatible
    ? current.entries.filter(
        (e) =>
          e.review &&
          baseline.entries.some(
            (b) =>
              b.review &&
              b.caseId === e.caseId &&
              b.caseHash === e.caseHash &&
              b.predictionHash === e.predictionHash,
          ),
      )
    : [];
  const keys = matched.map(caseKey);
  const currentSummary = keys.length ? reviewSummary(matched) : null;
  const baselineSummary = keys.length
    ? reviewSummary(baseline.entries.filter((e) => keys.includes(caseKey(e))))
    : null;
  const delta = (a: number | null | undefined, b: number | null | undefined) =>
    a == null || b == null ? null : a - b;
  return {
    comparable: keys.length > 0,
    reason: !compatible ? "INCOMPATIBLE_SUITE" : keys.length ? null : "NO_MATCHED_REVIEW_COHORT",
    matchedCaseKeys: keys,
    unmatchedCurrentCaseKeys: current.entries
      .filter((e) => e.review && !keys.includes(caseKey(e)))
      .map(caseKey),
    unmatchedBaselineCaseKeys: baseline.entries
      .filter((e) => e.review && !keys.includes(caseKey(e)))
      .map(caseKey),
    current: currentSummary,
    baseline: baselineSummary,
    confirmedSpamBasisPointsDelta: delta(
      currentSummary?.confirmedSpamBasisPoints,
      baselineSummary?.confirmedSpamBasisPoints,
    ),
    falsePositiveBasisPointsDelta: delta(
      currentSummary?.falsePositiveBasisPoints,
      baselineSummary?.falsePositiveBasisPoints,
    ),
  };
}
