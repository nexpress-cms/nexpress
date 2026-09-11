import { createHash } from "node:crypto";
import {
  canonicalBodyInteger,
  canonicalBodyRecord,
} from "../agent-contract/canonical-body-validation.js";
import { serializeAgentCanonicalJson } from "../agent-contract/canonical-foundation.js";
import { npDigestAgentPolicyCanonical } from "../agent-contract/canonical-notification-policy.js";
import {
  npDigestAgentBudgetSnapshotCanonical,
  npRequireAgentBudgetSnapshotCanonical,
} from "../agent-contract/canonical-budget-snapshot.js";
import { npRequireAgentRunAdmissionCanonical } from "../agent-contract/canonical-run-admission.js";
import { npDigestAgentRunLimitsCanonical } from "../agent-contract/canonical-bodies.js";
import {
  npRequireAgentRuntimeAdmissionSourcesV1,
  type NpAgentRuntimeAdmissionSourcesV1,
} from "../agent-contract/runtime-contract.js";
import type {
  NpAgentBudgetSnapshotSourceRefV1,
  NpAgentRunAdmissionPolicyRefV1,
} from "../agent-contract/types.js";
import { NpAgentGatewayError } from "./admin-admission.js";

export interface NpAgentRuntimeAdmissionSourceRefsV1 {
  /** Sorted feature-setting/framework refs; combine with retained site/Agent policy refs. */
  policyRefs: NpAgentRunAdmissionPolicyRefV1[];
  /** Sorted deployment/site refs; combine with the existing Agent/recipe source refs. */
  budgetSourceRefs: NpAgentBudgetSnapshotSourceRefV1[];
}

function invalid(): never {
  throw new NpAgentGatewayError(
    "RUNTIME_ADMISSION_INVALID",
    409,
    "Agent runtime admission source evidence is unavailable.",
  );
}

/** Existing private budget domains; neither is a new canonical purpose. */
function budgetDigest(kind: "deployment" | "site", value: unknown): string {
  return `cj1:sha256:${createHash("sha256")
    .update(`np.agent-runtime-${kind}-budget.v1`)
    .update("\0")
    .update(serializeAgentCanonicalJson(value))
    .digest("base64url")}`;
}

export async function npDeriveAgentRuntimeAdmissionSourceRefsV1(input: {
  sources: unknown;
  settingsRevision: number;
}): Promise<NpAgentRuntimeAdmissionSourceRefsV1> {
  try {
    const keys = ["sources", "settingsRevision"];
    const row = canonicalBodyRecord(input, "agent.runtimeSourceRefs", keys, keys, {
      seen: new WeakSet<object>(),
    });
    const sources = npRequireAgentRuntimeAdmissionSourcesV1(row.sources);
    const settingsRevision = canonicalBodyInteger(
      row.settingsRevision,
      "agent.runtimeSourceRefs.settingsRevision",
      1,
      2_147_483_647,
    );
    const [frameworkDigest, siteDigest] = await Promise.all([
      npDigestAgentPolicyCanonical(sources.frameworkPolicy),
      npDigestAgentPolicyCanonical(sources.sitePolicy),
    ]);
    return {
      policyRefs: [
        { kind: "feature-setting", id: null, version: settingsRevision, digest: siteDigest },
        {
          kind: "framework",
          id: null,
          version: sources.frameworkPolicyVersion,
          digest: frameworkDigest,
        },
      ],
      budgetSourceRefs: [
        {
          kind: "deployment",
          id: null,
          version: 1,
          digest: budgetDigest("deployment", sources.deploymentBudget),
        },
        {
          kind: "site",
          id: null,
          version: settingsRevision,
          digest: budgetDigest("site", sources.siteBudget),
        },
      ],
    };
  } catch {
    return invalid();
  }
}

/** Verify retained source bytes through the existing admission and budget canonical owners. */
export async function npVerifyAgentRuntimeAdmissionSourcesV1(input: {
  sources: unknown;
  admission: unknown;
  budgetSnapshot: unknown;
}): Promise<NpAgentRuntimeAdmissionSourcesV1> {
  try {
    const keys = ["sources", "admission", "budgetSnapshot"];
    const row = canonicalBodyRecord(input, "agent.runtimeSourceEvidence", keys, keys, {
      seen: new WeakSet<object>(),
    });
    const sources = npRequireAgentRuntimeAdmissionSourcesV1(row.sources);
    const admission = npRequireAgentRunAdmissionCanonical(row.admission);
    const budget = npRequireAgentBudgetSnapshotCanonical(row.budgetSnapshot);
    if (
      admission.origin !== "runtime" ||
      !admission.agent ||
      !admission.recipe ||
      budget.siteId !== admission.siteId ||
      budget.principalId !== admission.principalId ||
      budget.agentId !== admission.agent.id ||
      budget.recipe?.id !== admission.recipe.id ||
      budget.recipe.version !== admission.recipe.version ||
      budget.recipe.fingerprint !== admission.recipe.fingerprint ||
      budget.capturedAt !== admission.admittedAt ||
      (await npDigestAgentRunLimitsCanonical(budget.limits)) !== admission.runLimitsHash ||
      (await npDigestAgentBudgetSnapshotCanonical(budget)) !== admission.budgetSnapshotHash
    )
      invalid();
    if (
      admission.policyRefs.length > 4 ||
      new Set(admission.policyRefs.map((ref) => ref.kind)).size !== admission.policyRefs.length ||
      budget.sourceRefs.length !== 4 ||
      new Set(budget.sourceRefs.map((ref) => ref.kind)).size !== 4
    )
      invalid();
    const feature = admission.policyRefs.find((ref) => ref.kind === "feature-setting");
    if (!feature) invalid();
    const derived = await npDeriveAgentRuntimeAdmissionSourceRefsV1({
      sources,
      settingsRevision: feature.version,
    });
    for (const expected of derived.policyRefs) {
      const actual = admission.policyRefs.find((ref) => ref.kind === expected.kind);
      if (serializeAgentCanonicalJson(actual ?? null) !== serializeAgentCanonicalJson(expected))
        invalid();
    }
    for (const expected of derived.budgetSourceRefs) {
      const actual = budget.sourceRefs.find((ref) => ref.kind === expected.kind);
      if (serializeAgentCanonicalJson(actual ?? null) !== serializeAgentCanonicalJson(expected))
        invalid();
    }
    const agent = budget.sourceRefs.find((ref) => ref.kind === "agent");
    const recipe = budget.sourceRefs.find((ref) => ref.kind === "recipe");
    if (
      agent?.id !== admission.agent.id ||
      agent.digest !== admission.agent.configHash ||
      recipe?.id !== admission.recipe.id ||
      recipe.version !== admission.recipe.version ||
      recipe.digest !== admission.recipe.fingerprint
    )
      invalid();
    return sources;
  } catch {
    return invalid();
  }
}
