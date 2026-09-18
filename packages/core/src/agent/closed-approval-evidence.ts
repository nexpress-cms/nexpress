import { createHash } from "node:crypto";
import type {
  npAgentApprovals,
  npAgentChangesets,
  npAgentChangesetPreviews,
} from "../db/schema/agent.js";
import { serializeAgentCanonicalJson } from "../agent-contract/canonical-foundation.js";
import {
  npRequireAgentApprovalStatementCanonical,
  npRequireAgentApprovalDecisionCanonicalForStatement,
  npDigestAgentApprovalStatementCanonical,
  npDigestAgentApprovalDecisionCanonical,
} from "../agent-contract/canonical-approval.js";
import { npDigestAgentChangeSetPlanCanonical } from "../agent-contract/canonical-changeset.js";

type Approval = typeof npAgentApprovals.$inferSelect;
const same = (a: unknown, b: unknown) =>
  serializeAgentCanonicalJson(a) === serializeAgentCanonicalJson(b);
const staffFingerprint = (siteId: string, userId: string) =>
  `cj1:sha256:${createHash("sha256").update("np.agent-staff-actor.v1\0").update(serializeAgentCanonicalJson({ siteId, userId })).digest("base64url")}`;
const macKey = (mac: string | null) =>
  mac === null
    ? null
    : (/^cj1:hmac-sha256:([A-Za-z0-9][A-Za-z0-9._-]{0,127}):[A-Za-z0-9_-]{43}$/u.exec(mac)?.[1] ??
      null);

/**
 * Structural historical evidence only: this does NOT authenticate MACs or grant authority.
 * The approval owner alone holds integrity keys. Callers must prove the original request
 * producer, retain every original MAC and bind the full immutable row into release evidence.
 * Current plan integrity, preview cleanup, absence of execution and reference closure are
 * independently required by the caller. Live approval reads still use the approval owner.
 */
export async function npVerifyClosedApprovalEvidenceV1(input: {
  changeSet: Pick<
    typeof npAgentChangesets.$inferSelect,
    "id" | "siteId" | "planHash" | "sealedPlanBody" | "expiresAt"
  >;
  approval: Approval;
  previews: Pick<
    typeof npAgentChangesetPreviews.$inferSelect,
    | "id"
    | "siteId"
    | "changesetId"
    | "planHash"
    | "digest"
    | "createdAt"
    | "completedAt"
    | "expiresAt"
  >[];
  releasedAt: Date;
}): Promise<boolean> {
  const { changeSet: c, approval: a, previews, releasedAt } = input;
  const stamp = releasedAt.getTime();
  const elapsed = (date: Date | null) =>
    date !== null && Number.isFinite(date.getTime()) && date.getTime() <= stamp;
  try {
    if (
      !Number.isFinite(stamp) ||
      !["rejected", "expired"].includes(a.state) ||
      a.targetKind !== "changeset" ||
      a.targetId !== c.id ||
      a.targetChangesetId !== c.id ||
      a.siteId !== c.siteId ||
      a.targetActionId !== null ||
      a.targetRollbackPlanId !== null ||
      a.planHash !== c.planHash ||
      !c.sealedPlanBody ||
      c.sealedPlanBody.planKind !== "changeset" ||
      c.sealedPlanBody.siteId !== c.siteId ||
      c.sealedPlanBody.changeSetId !== c.id ||
      (await npDigestAgentChangeSetPlanCanonical(c.sealedPlanBody)) !== c.planHash ||
      !elapsed(a.requestedAt) ||
      !elapsed(a.expiresAt) ||
      a.expiresAt <= a.requestedAt ||
      a.expiresAt > c.expiresAt ||
      !Number.isSafeInteger(a.generation) ||
      a.generation < 1 ||
      !Number.isSafeInteger(a.version) ||
      a.version < 2 ||
      !Number.isSafeInteger(a.challengeGeneration) ||
      a.challengeGeneration < 0 ||
      a.consumedAt !== null ||
      [
        a.revocationKind,
        a.revokedByUserId,
        a.revokerFingerprint,
        a.revocationCode,
        a.revocationReason,
        a.revocationBody,
        a.revocationHash,
        a.revocationMac,
        a.revocationIntegrityKeyId,
        a.revokedAt,
      ].some((v) => v !== null) ||
      [
        a.challengePurpose,
        a.challengeHash,
        a.challengeHashKeyId,
        a.challengeIssuedToUserId,
        a.challengeSessionFingerprint,
        a.challengeExpiresAt,
      ].some((v) => v !== null) ||
      (a.challengeConsumedAt !== null &&
        (!elapsed(a.challengeConsumedAt) ||
          a.challengeConsumedAt < a.requestedAt ||
          a.challengeConsumedAt > a.expiresAt))
    )
      return false;
    const s = npRequireAgentApprovalStatementCanonical(a.statementBody);
    if (
      s.target.kind !== "changeset" ||
      s.siteId !== a.siteId ||
      s.approvalId !== a.id ||
      s.target.changeSetId !== c.id ||
      s.target.planHash !== a.planHash ||
      !["changeset.apply", "changeset.schedule"].includes(s.capabilityId) ||
      (s.capabilityId === "changeset.apply"
        ? s.target.scheduledFor !== null
        : s.target.scheduledFor === null) ||
      (s.target.scheduledFor !== null &&
        (Date.parse(s.target.scheduledFor) <= a.requestedAt.getTime() ||
          Date.parse(s.target.scheduledFor) >= a.expiresAt.getTime())) ||
      s.capabilityId !== a.capabilityId ||
      s.capabilityContractVersion !== a.capabilityContractVersion ||
      s.capabilityFingerprint !== a.capabilityFingerprint ||
      !same(s.requiredScopes, a.requiredScopes) ||
      !same(s.requiredHumanCapabilities, a.requiredHumanCapabilities) ||
      !same(s.requiredHumanPredicates, a.requiredHumanPredicates) ||
      !same(s.policyHashes, a.policyHashes) ||
      s.requiresLivePreview !== a.requiresLivePreview ||
      s.previewId !== a.previewId ||
      s.previewDigest !== a.previewDigest ||
      s.risk !== a.risk ||
      s.requester.kind !== a.requesterKind ||
      s.requester.fingerprint !== a.requesterFingerprint ||
      s.createdAt !== a.requestedAt.toISOString() ||
      s.expiresAt !== a.expiresAt.toISOString() ||
      macKey(a.statementMac) !== a.integrityKeyId ||
      !macKey(a.statementMac) ||
      (await npDigestAgentApprovalStatementCanonical(s)) !== a.statementHash ||
      (s.reauthentication.mode === "none"
        ? a.requiredReauthMode !== "none" || a.requiredReauthMaxAgeSeconds !== null
        : a.requiredReauthMode !== "recent-staff-primary" ||
          a.requiredReauthMaxAgeSeconds !== s.reauthentication.maxAgeSeconds) ||
      (s.requester.kind === "principal"
        ? s.requester.principalId !== a.requestedByPrincipalId || a.requestedByUserId !== null
        : a.requestedByPrincipalId !== null ||
          (a.requestedByUserId !== null && s.requester.userId !== a.requestedByUserId)) ||
      (s.requester.kind === "staff" &&
        s.requester.userId !== null &&
        s.requester.fingerprint !== staffFingerprint(a.siteId, s.requester.userId))
    )
      return false;
    const plan = c.sealedPlanBody.body;
    if (
      ((plan.risk.level === "critical" || !plan.risk.reversible) && s.risk !== "destructive") ||
      (plan.risk.level !== "low" && s.risk === "reversible") ||
      (s.risk !== "reversible" && !s.requiresLivePreview) ||
      !plan.requiredScopes.every((v) => s.requiredScopes.includes(v)) ||
      !plan.requiredHumanCapabilities.every((v) => s.requiredHumanCapabilities.includes(v)) ||
      !same(plan.requiredHumanPredicates, s.requiredHumanPredicates) ||
      !plan.policyHashes.every((v) => s.policyHashes.includes(v))
    )
      return false;
    if (s.requiresLivePreview) {
      const matches = previews.filter((p) => p.id === s.previewId);
      if (matches.length !== 1) return false;
      const p = matches[0];
      if (
        p.siteId !== c.siteId ||
        p.changesetId !== c.id ||
        p.planHash !== c.planHash ||
        p.digest !== s.previewDigest ||
        !p.digest ||
        !p.expiresAt ||
        !p.completedAt ||
        !elapsed(p.createdAt) ||
        p.completedAt < p.createdAt ||
        p.completedAt > a.requestedAt ||
        p.expiresAt < a.expiresAt
      )
        return false;
    } else if (s.previewId !== null || s.previewDigest !== null) return false;
    if (a.state === "expired")
      return [
        a.decisionBody,
        a.decisionHash,
        a.decisionMac,
        a.decidedByUserId,
        a.deciderFingerprint,
        a.decidedAt,
        a.reason,
        a.decisionReauthFingerprint,
        a.decisionReauthenticatedAt,
        a.challengeConsumedAt,
      ].every((v) => v === null);
    if (
      !a.decisionBody ||
      !a.decisionHash ||
      !macKey(a.decisionMac) ||
      !elapsed(a.decidedAt) ||
      a.decidedAt! < a.requestedAt ||
      a.decidedAt! >= a.expiresAt ||
      a.challengeGeneration < 1 ||
      a.challengeConsumedAt?.getTime() !== a.decidedAt!.getTime()
    )
      return false;
    const binding = {
      statement: s,
      statementHash: a.statementHash,
      approvalGeneration: a.generation,
    };
    const d = await npRequireAgentApprovalDecisionCanonicalForStatement(a.decisionBody, binding);
    return (
      d.decision === "reject" &&
      (await npDigestAgentApprovalDecisionCanonical(d, binding)) === a.decisionHash &&
      d.deciderFingerprint === a.deciderFingerprint &&
      d.decidedAt === a.decidedAt!.toISOString() &&
      d.reason === a.reason &&
      (a.decidedByUserId === null ||
        a.deciderFingerprint === staffFingerprint(a.siteId, a.decidedByUserId)) &&
      (d.reauthentication.mode === "none"
        ? a.decisionReauthFingerprint === null && a.decisionReauthenticatedAt === null
        : d.reauthentication.sessionFactFingerprint === a.decisionReauthFingerprint &&
          d.reauthentication.reauthenticatedAt === a.decisionReauthenticatedAt?.toISOString())
    );
  } catch {
    return false;
  }
}
