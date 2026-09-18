import { createHash } from "node:crypto";
import type {
  npAgentChangesets,
  npAgentChangesetOperations,
  npAgentChangesetValidationAttempts,
} from "../db/schema/agent.js";
import { serializeAgentCanonicalJson } from "../agent-contract/canonical-foundation.js";
import {
  npRequireAgentChangeSetProposalCanonical,
  npDigestAgentChangeSetProposalCanonical,
  npRequireAgentChangeSetPlanCanonical,
  npDigestAgentChangeSetPlanCanonical,
  npDigestAgentChangeSetSnapshotCanonical,
} from "../agent-contract/canonical-changeset.js";
import { npAgentChangeSetLimits } from "../agent-contract/changeset-wire-contract.js";

const hash = (domain: string, value: unknown) =>
  `cj1:sha256:${createHash("sha256").update(`${domain}\0`).update(serializeAgentCanonicalJson(value)).digest("base64url")}`;

/** Shared stored proposal/plan proof. Authorization and invocation attribution remain with callers. */
export async function npVerifyAgentChangeSetPlanEvidenceV1(input: {
  changeSet: typeof npAgentChangesets.$inferSelect;
  operations: (typeof npAgentChangesetOperations.$inferSelect)[];
  attempt: typeof npAgentChangesetValidationAttempts.$inferSelect | null | undefined;
  execution?: { committedAt: Date | null; verificationState: string | null } | null;
}): Promise<boolean> {
  const { changeSet: row, operations: ops, attempt, execution } = input;
  try {
    if (ops.length > 500 || ops.some((op, index) => op.ordinal !== index + 1)) return false;
    const proposal = npRequireAgentChangeSetProposalCanonical({
      schemaVersion: "np.agent-changeset-proposal.v1",
      siteId: row.siteId,
      changeSetId: row.id,
      draftVersion: row.draftVersion,
      title: row.title,
      summary: row.summary,
      operations: ops.map((op) => ({
        ordinal: op.ordinal,
        operation: op.input,
        canonicalResourceKey: op.resourceKey,
      })),
    });
    if ((await npDigestAgentChangeSetProposalCanonical(proposal)) !== row.draftHash) return false;
    if (attempt) {
      if (attempt.state === "invalid") {
        if (
          attempt.resultDigest !==
          hash("np.agent-changeset-validation-result.v1", {
            generation: attempt.generation,
            draftHash: attempt.draftHash,
            issues: attempt.issues,
          })
        )
          return false;
        for (const op of ops) {
          const relevant = attempt.issues.filter(
            (issue) => issue.operationOrdinal === null || issue.operationOrdinal === op.ordinal,
          );
          if (
            serializeAgentCanonicalJson(op.issues) !== serializeAgentCanonicalJson(relevant) ||
            op.state !== (relevant.length ? "invalid" : "draft")
          )
            return false;
        }
      }
    }
    if (row.sealedPlanBody !== null) {
      const sealed = npRequireAgentChangeSetPlanCanonical(row.sealedPlanBody);
      if (
        sealed.planKind !== "changeset" ||
        sealed.siteId !== row.siteId ||
        sealed.changeSetId !== row.id ||
        !attempt ||
        attempt.state !== "ready" ||
        ![
          "ready",
          "approval_pending",
          "approved",
          "rejected",
          "cancelled",
          "scheduled",
          "applying",
          "applied",
          "apply_failed",
          "verifying",
          "verified",
          "verification_failed",
          "rolling_back",
          "rolled_back",
          "rollback_failed",
        ].includes(row.state)
      )
        return false;
      const body = sealed.body;
      if (
        (await npDigestAgentChangeSetPlanCanonical(sealed)) !== row.planHash ||
        body.draftVersion !== row.draftVersion ||
        body.draftHash !== row.draftHash ||
        body.validationGeneration !== row.validationGeneration ||
        body.baseFingerprint !== row.baseFingerprint ||
        body.expiresAt !== row.expiresAt.toISOString() ||
        body.rollbackWindowSeconds !== row.rollbackWindowSeconds ||
        body.operations.length !== ops.length ||
        serializeAgentCanonicalJson(body.risk) !== serializeAgentCanonicalJson(row.riskSummary) ||
        serializeAgentCanonicalJson(body.risk) !==
          serializeAgentCanonicalJson(attempt.riskSummary) ||
        attempt.issues.length !== 0 ||
        attempt.resultDigest !==
          hash("np.agent-changeset-validation-result.v1", {
            generation: attempt.generation,
            draftHash: attempt.draftHash,
            planHash: row.planHash,
            issues: [],
          })
      )
        return false;
      let bytes = 0;
      const bases = [];
      for (let index = 0; index < ops.length; index++) {
        const op = ops[index];
        const planned = body.operations[index];
        const snapshot = op.beforeSnapshot;
        if (
          op.state !==
            (execution?.committedAt
              ? execution.verificationState === "passed"
                ? "verified"
                : "applied"
              : "valid") ||
          op.issues.length !== 0 ||
          (!execution?.committedAt && (op.afterHash !== null || op.resultDigest !== null)) ||
          planned.ordinal !== op.ordinal ||
          serializeAgentCanonicalJson(planned.operation) !==
            serializeAgentCanonicalJson(op.input) ||
          serializeAgentCanonicalJson(planned.canonicalResourceKey) !==
            serializeAgentCanonicalJson(op.resourceKey) ||
          serializeAgentCanonicalJson(op.baseVersion) !==
            serializeAgentCanonicalJson(op.input.base) ||
          op.beforeHash !== planned.beforeHash ||
          op.snapshotHash !== planned.snapshotHash ||
          !snapshot ||
          snapshot.siteId !== row.siteId ||
          snapshot.changeSetId !== row.id ||
          snapshot.operationOrdinal !== op.ordinal ||
          serializeAgentCanonicalJson(snapshot.canonicalResourceKey) !==
            serializeAgentCanonicalJson(op.resourceKey) ||
          (await npDigestAgentChangeSetSnapshotCanonical(snapshot)) !== planned.snapshotHash
        )
          return false;
        bytes += Buffer.byteLength(serializeAgentCanonicalJson(snapshot));
        if (bytes > npAgentChangeSetLimits.aggregateSnapshotBytes) return false;
        const absentCreate =
          planned.operation.kind === "document" && planned.operation.operation === "create";
        if (
          snapshot.presence === "present" &&
          serializeAgentCanonicalJson(snapshot.base) !==
            serializeAgentCanonicalJson(planned.operation.base)
        )
          return false;
        if (
          snapshot.presence === "absent" &&
          !absentCreate &&
          !(
            planned.operation.kind === "setting" &&
            planned.operation.operation === "replace" &&
            planned.operation.base === null
          ) &&
          !(
            planned.operation.kind === "theme_tokens" &&
            planned.operation.base?.version === "absent" &&
            planned.operation.base.digest === planned.beforeHash
          )
        )
          return false;
        if (
          snapshot.presence === "present"
            ? snapshot.base?.digest !== planned.beforeHash
            : absentCreate
              ? planned.beforeHash !== null
              : planned.beforeHash !==
                hash("np.agent-changeset-resource.v1", {
                  siteId: row.siteId,
                  canonicalResourceKey: op.resourceKey,
                  presence: "absent",
                  value: null,
                })
        )
          return false;
        bases.push({
          ordinal: op.ordinal,
          canonicalResourceKey: op.resourceKey,
          presence: snapshot.presence,
          base: snapshot.base,
          snapshotHash: op.snapshotHash,
        });
      }
      if (
        body.baseFingerprint !== hash("np.agent-changeset-bases.v1", { siteId: row.siteId, bases })
      )
        return false;
    } else {
      if (
        row.planHash !== null ||
        row.baseFingerprint !== null ||
        row.riskSummary !== null ||
        row.rollbackWindowSeconds !== null ||
        row.state === "ready" ||
        attempt?.state === "ready"
      )
        return false;
      if (
        ops.some(
          (op) =>
            op.beforeSnapshot !== null ||
            op.snapshotHash !== null ||
            op.beforeHash !== null ||
            op.afterHash !== null ||
            op.resultDigest !== null,
        )
      )
        return false;
      if (
        ["draft", "validating"].includes(row.state) &&
        ops.some((op) => op.state !== "draft" || op.issues.length !== 0)
      )
        return false;
    }
    return true;
  } catch {
    return false;
  }
}
