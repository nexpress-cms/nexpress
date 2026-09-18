import type {
  npAgentChangesets,
  npAgentChangesetPreviews,
  npAgentPreviewArtifacts,
  npAgentPreviewArtifactUploads,
  npAgentPreviewViewerLaunches,
  npAgentPreviewRenderSessions,
} from "../db/schema/agent.js";
import { serializeAgentCanonicalJson } from "../agent-contract/canonical-foundation.js";
import {
  npDigestAgentPreviewContractCanonical,
  npDigestAgentPreviewRoutesCanonical,
} from "../agent-contract/canonical-preview.js";
import {
  npRequireAgentPreviewArtifactManifestCanonical,
  npDigestAgentPreviewArtifactManifestCanonical,
} from "../agent-contract/canonical-preview-artifact.js";
import { npDigestAgentChangeSetPlanCanonical } from "../agent-contract/canonical-changeset.js";
import {
  npRequireAgentPreviewArtifactUploadRequestV1,
  npDigestAgentPreviewArtifactUploadRequestV1,
  npDigestAgentPreviewArtifactUploadSetV1,
  npDigestAgentPreviewArtifactUploadReceiptV1,
  npDigestAgentPreviewArtifactDeleteReceiptV1,
  npAgentPreviewArtifactUploadIdempotencyV1,
  type NpAgentPreviewArtifactUploadRequestV1,
} from "./preview-artifact-contract.js";
type Preview = typeof npAgentChangesetPreviews.$inferSelect;
type Artifact = typeof npAgentPreviewArtifacts.$inferSelect;
type Upload = typeof npAgentPreviewArtifactUploads.$inferSelect;
const same = (a: unknown, b: unknown) =>
  serializeAgentCanonicalJson(a) === serializeAgentCanonicalJson(b);
function request(p: Preview, a: Artifact): NpAgentPreviewArtifactUploadRequestV1 {
  return npRequireAgentPreviewArtifactUploadRequestV1({
    schemaVersion: "np.agent-preview-artifact-upload-request.v1",
    siteId: p.siteId,
    changeSetId: p.changesetId,
    previewId: p.id,
    generation: p.generation,
    planHash: p.planHash,
    previewContractFingerprint: p.previewContractFingerprint,
    artifactId: a.id,
    ordinal: a.ordinal,
    kind: a.kind,
    route: a.route,
    locale: a.locale,
    viewport: a.viewport,
    reportPart: a.reportPart,
    reportTotalParts: a.reportTotalParts,
    contentDigest: a.contentDigest,
    mime: a.mime,
    bytes: a.bytes,
    storageAdapterId: a.storageAdapterId,
    storageAdapterContractVersion: a.storageAdapterContractVersion,
    storageAdapterFingerprint: a.storageAdapterFingerprint,
    storageKey: a.storageKey,
  });
}
function setBody(p: Preview, rows: Array<{ a: Artifact; u: Upload }>) {
  return {
    schemaVersion: "np.agent-preview-artifact-upload-set.v1",
    siteId: p.siteId,
    changeSetId: p.changesetId,
    previewId: p.id,
    generation: p.generation,
    planHash: p.planHash,
    previewContractFingerprint: p.previewContractFingerprint,
    uploads: rows.map(({ a, u }) => ({
      ordinal: a.ordinal,
      artifactId: a.id,
      uploadRequestDigest: u.uploadRequestDigest,
    })),
  };
}
function manifest(p: Preview, rows: Artifact[], expiresAt: Date) {
  return npRequireAgentPreviewArtifactManifestCanonical({
    schemaVersion: "np.agent-preview-artifact-manifest.v1",
    siteId: p.siteId,
    changeSetId: p.changesetId,
    previewId: p.id,
    generation: p.generation,
    planHash: p.planHash,
    previewContractFingerprint: p.previewContractFingerprint,
    artifacts: rows.map((a) => ({
      artifactId: a.id,
      ordinal: a.ordinal,
      kind: a.kind,
      route: a.route,
      locale: a.locale,
      viewport: a.viewport,
      reportPart: a.reportPart,
      reportTotalParts: a.reportTotalParts,
      contentDigest: a.contentDigest,
      mime: a.mime,
      bytes: a.bytes,
      createdAt: a.createdAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
    })),
  });
}
/** Frozen terminal preview proof. Never resolves live authority or accesses artifact storage. */
export async function npVerifyCancelledPreviewEvidenceV1(input: {
  changeSet: typeof npAgentChangesets.$inferSelect;
  preview: Preview;
  artifacts: Artifact[];
  uploads: Upload[];
  viewerLaunches: (typeof npAgentPreviewViewerLaunches.$inferSelect)[];
  renderSessions: (typeof npAgentPreviewRenderSessions.$inferSelect)[];
  releasedAt: Date;
}): Promise<boolean> {
  const {
    changeSet: c,
    preview: p,
    artifacts,
    uploads,
    viewerLaunches,
    renderSessions,
    releasedAt,
  } = input;
  const stamp = releasedAt.getTime();
  const elapsed = (date: Date | null, skew = 0) =>
    date !== null && Number.isFinite(date.getTime()) && date.getTime() + skew <= stamp;
  const identity = (row: { siteId: string; previewId: string }) =>
    row.siteId === p.siteId && row.previewId === p.id;
  try {
    if (
      !Number.isFinite(stamp) ||
      c.state !== "cancelled" ||
      c.siteId !== p.siteId ||
      c.id !== p.changesetId ||
      !c.sealedPlanBody ||
      c.sealedPlanBody.planKind !== "changeset" ||
      c.planHash !== p.planHash ||
      (await npDigestAgentChangeSetPlanCanonical(c.sealedPlanBody)) !== p.planHash ||
      !same(p.riskSummary, c.riskSummary) ||
      !same(p.riskSummary, c.sealedPlanBody.body.risk) ||
      !["failed", "expired"].includes(p.state) ||
      p.runId !== null ||
      p.jobId !== null ||
      !elapsed(p.completedAt) ||
      p.completedAt! < p.createdAt ||
      !elapsed(p.createdAt) ||
      (await npDigestAgentPreviewContractCanonical(p.previewContractBody)) !==
        p.previewContractFingerprint ||
      (await npDigestAgentPreviewRoutesCanonical({
        schemaVersion: "np.agent-preview-routes.v1",
        siteId: p.siteId,
        changeSetId: p.changesetId,
        previewId: p.id,
        generation: p.generation,
        planHash: p.planHash,
        routes: p.allowedRoutes,
      })) !== p.allowedRoutesDigest
    )
      return false;
    if (p.renderBootstrapExpiresAt !== null && !elapsed(p.renderBootstrapExpiresAt, 60_000))
      return false;
    if (
      new Set(viewerLaunches.map((v) => v.id)).size !== viewerLaunches.length ||
      new Set(renderSessions.map((r) => r.id)).size !== renderSessions.length
    )
      return false;
    if (
      viewerLaunches.some(
        (v) =>
          !identity(v) ||
          !["superseded", "expired"].includes(v.state) ||
          !Number.isFinite(v.exp) ||
          v.exp * 1000 + 60_000 > stamp ||
          !elapsed(v.exchangeExpiresAt, 60_000) ||
          v.allowedRoutesDigest !== p.allowedRoutesDigest ||
          !elapsed(v.state === "expired" ? v.expiredAt : v.supersededAt),
      )
    )
      return false;
    if (
      renderSessions.some(
        (r) =>
          !identity(r) ||
          !["completed", "failed", "cancelled", "expired"].includes(r.state) ||
          !elapsed(r.closedAt) ||
          !elapsed(r.expiresAt, 60_000) ||
          r.generation !== p.generation ||
          r.planHash !== p.planHash ||
          r.previewContractFingerprint !== p.previewContractFingerprint ||
          r.allowedRoutesDigest !== p.allowedRoutesDigest ||
          r.id !== p.renderSessionId ||
          r.renderAttemptId !== p.renderAttemptId ||
          (r.state === "completed" && r.consumedOrdinals.some((value) => !value)),
      )
    )
      return false;
    if (
      (p.renderSessionId === null && renderSessions.length !== 0) ||
      (p.renderSessionId !== null && renderSessions.length !== 1)
    )
      return false;
    if (p.expectedArtifactCount === null) {
      return (
        artifacts.length === 0 &&
        uploads.length === 0 &&
        p.uploadSetDigest === null &&
        p.artifactReservedAt === null &&
        p.digest === null &&
        p.expiresAt === null &&
        (p.state !== "failed" || p.errorCode !== null)
      );
    }
    // A reserved generation without its successful manifest remains outside this owner.
    if (
      p.state !== "expired" ||
      p.digest === null ||
      p.errorCode !== null ||
      !elapsed(p.expiresAt) ||
      !elapsed(p.artifactReservedAt) ||
      !elapsed(p.renderingStartedAt) ||
      p.expiresAt! <= p.completedAt! ||
      p.expectedArtifactCount !== artifacts.length ||
      artifacts.length > 24 ||
      uploads.length !== artifacts.length ||
      new Set(artifacts.map((a) => a.id)).size !== artifacts.length ||
      new Set(uploads.map((u) => u.id)).size !== uploads.length ||
      new Set(uploads.map((u) => u.artifactId)).size !== uploads.length
    )
      return false;
    const sorted = [...artifacts].sort((a, b) => a.ordinal - b.ordinal);
    const rows: Array<{ a: Artifact; u: Upload }> = [];
    for (const [index, a] of sorted.entries()) {
      const u = uploads.find((u) => u.artifactId === a.id);
      if (
        !u ||
        !identity(a) ||
        !identity(u) ||
        a.ordinal !== index + 1 ||
        a.previewContractFingerprint !== p.previewContractFingerprint ||
        a.objectState !== "absent" ||
        a.objectExpiresAt?.getTime() !== p.expiresAt!.getTime() ||
        a.createdAt.getTime() !== p.artifactReservedAt!.getTime() ||
        !elapsed(a.createdAt) ||
        a.deleteErrorCode !== null ||
        !elapsed(a.deletedAt) ||
        a.deleteAttempt < 1 ||
        a.deleteReceiptDigest === null ||
        !["deleted", "already_absent"].includes(a.deleteStatus ?? "") ||
        u.state !== "succeeded" ||
        u.adapterOperationStatus !== "committed" ||
        u.observedObjectState !== "present" ||
        !u.everObservedPresent ||
        u.leaseUntil !== null ||
        !elapsed(u.callDeadlineAt) ||
        !elapsed(u.finishedAt) ||
        !elapsed(u.verifiedAt) ||
        !elapsed(u.adapterOperationResolvedAt) ||
        !u.adapterOperationReceiptDigest ||
        u.uploadSetDigest !== p.uploadSetDigest ||
        u.uploadRequestDigest !== npDigestAgentPreviewArtifactUploadRequestV1(request(p, a)) ||
        u.idempotencyKey !== npAgentPreviewArtifactUploadIdempotencyV1(u.uploadRequestDigest)
      )
        return false;
      if (
        npDigestAgentPreviewArtifactUploadReceiptV1({
          schemaVersion: "np.agent-preview-artifact-upload-operation-receipt.v1",
          siteId: p.siteId,
          previewId: p.id,
          artifactId: a.id,
          uploadRequestDigest: u.uploadRequestDigest,
          idempotencyKey: u.idempotencyKey,
          storageAdapterId: a.storageAdapterId,
          storageAdapterContractVersion: a.storageAdapterContractVersion,
          storageAdapterFingerprint: a.storageAdapterFingerprint,
          status: u.adapterOperationStatus,
          safeCode: null,
          resolvedAt: u.adapterOperationResolvedAt!.toISOString(),
        }) !== u.adapterOperationReceiptDigest ||
        npDigestAgentPreviewArtifactDeleteReceiptV1({
          schemaVersion: "np.agent-artifact-delete-receipt.v1",
          siteId: p.siteId,
          previewId: p.id,
          artifactId: a.id,
          contentDigest: a.contentDigest,
          storageAdapterId: a.storageAdapterId,
          storageAdapterContractVersion: a.storageAdapterContractVersion,
          storageAdapterFingerprint: a.storageAdapterFingerprint,
          deleteAttempt: a.deleteAttempt,
          status: a.deleteStatus,
          deletedAt: a.deletedAt!.toISOString(),
        }) !== a.deleteReceiptDigest
      )
        return false;
      if (a.kind === "screenshot" && renderSessions[0]?.state !== "completed") return false;
      rows.push({ a, u });
    }
    return (
      npDigestAgentPreviewArtifactUploadSetV1(setBody(p, rows)) === p.uploadSetDigest &&
      (await npDigestAgentPreviewArtifactManifestCanonical(manifest(p, sorted, p.expiresAt!))) ===
        p.digest
    );
  } catch {
    return false;
  }
}
