import { createHash, randomUUID } from "node:crypto";
import { and, asc, eq, sql } from "drizzle-orm";
import { getDb } from "../db/runtime.js";
import {
  npAgentChangesetPreviews as previews,
  npAgentPreviewArtifacts as artifacts,
  npAgentPreviewArtifactUploads as uploads,
  npAgentChangesets as changesets,
  npAgentPreviewRenderSessions as renderSessions,
  npAgentPreviewViewerLaunches as launches,
} from "../db/schema/agent.js";
import { serializeAgentCanonicalJson } from "../agent-contract/canonical-foundation.js";
import {
  npRequireAgentPreviewContractCanonical,
  npDigestAgentPreviewContractCanonical,
} from "../agent-contract/canonical-preview.js";
import {
  npRequireAgentPreviewArtifactManifestCanonical,
  npDigestAgentPreviewArtifactManifestCanonical,
} from "../agent-contract/canonical-preview-artifact.js";
import {
  npRequireAgentPreviewReportV1,
  npRequireAgentPreviewReportPartsV1,
} from "../agent-contract/changeset-wire-contract.js";
import type { NpAgentPreviewArtifactViewportV1 } from "../agent-contract/types.js";
import {
  npDigestAgentPreviewArtifactContentV1,
  npRequireAgentPreviewArtifactUploadRequestV1,
  npDigestAgentPreviewArtifactUploadRequestV1,
  npDigestAgentPreviewArtifactUploadSetV1,
  npAgentPreviewArtifactUploadIdempotencyV1,
  npRequireAgentPreviewArtifactUploadResolutionV1,
  npDigestAgentPreviewArtifactUploadReceiptV1,
  npDigestAgentPreviewArtifactDeleteReceiptV1,
  type NpAgentPreviewArtifactAdapterIdentityV1,
  type NpAgentPreviewArtifactStorageAdapterV1,
  type NpAgentPreviewArtifactUploadRequestV1,
} from "./preview-artifact-contract.js";

type Db = ReturnType<typeof getDb>;
type Preview = typeof previews.$inferSelect;
type Artifact = typeof artifacts.$inferSelect;
type Upload = typeof uploads.$inferSelect;
export interface NpAgentPreviewArtifactInputV1 {
  kind: "screenshot" | "report";
  route: string | null;
  locale: string | null;
  viewport: NpAgentPreviewArtifactViewportV1 | null;
  reportPart: number | null;
  reportTotalParts: number | null;
  mime: "image/png" | "image/webp" | "application/json";
  bytes: Uint8Array;
}
export interface NpAgentPreviewArtifactServiceOptionsV1 {
  storageAdapter?: NpAgentPreviewArtifactAdapterIdentityV1;
  resolveAdapter: (
    identity: NpAgentPreviewArtifactAdapterIdentityV1,
  ) => NpAgentPreviewArtifactStorageAdapterV1 | null;
  withPreviewAuthority: <T>(input: {
    siteId: string;
    previewId: string;
    mutate: (db: Db, preview: Preview) => Promise<T>;
  }) => Promise<T>;
  now?: () => Date;
}
export interface NpAgentPreviewArtifactServiceV1 {
  reserve(input: {
    siteId: string;
    previewId: string;
    artifacts: readonly NpAgentPreviewArtifactInputV1[];
  }): Promise<{
    uploads: Array<{ artifactId: string; uploadId: string; ordinal: number }>;
    uploadSetDigest: string;
  }>;
  dispatch(input: { siteId: string; uploadId: string; bytes: Uint8Array }): Promise<void>;
  reconcileUpload(input: { siteId: string; uploadId: string; operator?: boolean }): Promise<void>;
  finalize(input: { siteId: string; previewId: string }): Promise<void>;
  readArtifact(input: {
    siteId: string;
    previewId: string;
    artifactId: string;
    authorize: () => Promise<void>;
  }): Promise<{ bytes: Uint8Array; mime: string; contentDigest: string; expiresAt: string }>;
  deleteArtifact(input: { siteId: string; artifactId: string }): Promise<void>;
  reconcilePreviewCleanup(input: { siteId: string; previewId: string }): Promise<void>;
}
/** 24 serial artifacts × (PUT + resolution + stat + read) × 60s, plus the 90s lease grace. */
export const npAgentPreviewArtifactDispatchWindowMillisecondsV1 = 24 * 4 * 60_000 + 90_000;
const failure = () => new Error("PREVIEW_ARTIFACT_UNAVAILABLE");
const same = (a: unknown, b: unknown) =>
  serializeAgentCanonicalJson(a) === serializeAgentCanonicalJson(b);
const scope = (
  table: typeof previews | typeof artifacts | typeof uploads,
  siteId: string,
  id: string,
) => and(eq(table.siteId, siteId), eq(table.id, id));
const identity = (a: Artifact): NpAgentPreviewArtifactAdapterIdentityV1 => ({
  id: a.storageAdapterId,
  contractVersion: a.storageAdapterContractVersion,
  fingerprint: a.storageAdapterFingerprint,
});
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
async function contract(p: Preview) {
  const body = npRequireAgentPreviewContractCanonical(p.previewContractBody);
  if ((await npDigestAgentPreviewContractCanonical(body)) !== p.previewContractFingerprint)
    throw failure();
}
function report(p: Preview, bytes: Uint8Array, part: number | null, total: number | null) {
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  const parsed = npRequireAgentPreviewReportV1(JSON.parse(text));
  if (
    serializeAgentCanonicalJson(parsed) !== text ||
    parsed.siteId !== p.siteId ||
    parsed.changeSetId !== p.changesetId ||
    parsed.previewId !== p.id ||
    parsed.generation !== p.generation ||
    parsed.planHash !== p.planHash ||
    parsed.previewContractFingerprint !== p.previewContractFingerprint ||
    parsed.part !== part ||
    parsed.totalParts !== total
  )
    throw failure();
  return parsed;
}
async function bounded<T>(
  call: (signal: AbortSignal) => Promise<T>,
  milliseconds = 60_000,
): Promise<T> {
  const abort = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.resolve().then(() => call(abort.signal)),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          abort.abort();
          reject(failure());
        }, milliseconds);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
    abort.abort();
  }
}
export function createAgentPreviewArtifactServiceV1(
  options: NpAgentPreviewArtifactServiceOptionsV1,
): NpAgentPreviewArtifactServiceV1 {
  const now = options.now ?? (() => new Date());
  const storageIdentity = options.storageAdapter
    ? Object.freeze({ ...options.storageAdapter })
    : undefined;
  function adapter(a: Artifact) {
    const expected = identity(a),
      value = options.resolveAdapter(expected);
    if (
      !value ||
      !same(expected, {
        id: value.id,
        contractVersion: value.contractVersion,
        fingerprint: value.fingerprint,
      })
    )
      throw failure();
    return value;
  }
  async function rows(db: Db, p: Preview): Promise<Array<{ a: Artifact; u: Upload }>> {
    const result = await db
      .select({ a: artifacts, u: uploads })
      .from(artifacts)
      .innerJoin(
        uploads,
        and(
          eq(uploads.siteId, artifacts.siteId),
          eq(uploads.previewId, artifacts.previewId),
          eq(uploads.artifactId, artifacts.id),
        ),
      )
      .where(and(eq(artifacts.siteId, p.siteId), eq(artifacts.previewId, p.id)))
      .orderBy(asc(artifacts.ordinal))
      .limit(25);
    if (result.length > 24 || result.length !== p.expectedArtifactCount) throw failure();
    for (const { a, u } of result)
      if (
        a.previewContractFingerprint !== p.previewContractFingerprint ||
        u.uploadRequestDigest !== npDigestAgentPreviewArtifactUploadRequestV1(request(p, a)) ||
        u.idempotencyKey !== npAgentPreviewArtifactUploadIdempotencyV1(u.uploadRequestDigest) ||
        u.uploadSetDigest !== p.uploadSetDigest
      )
        throw failure();
    for (const { a, u } of result) {
      if (
        u.adapterOperationReceiptDigest &&
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
          safeCode: u.adapterOperationStatus === "failed_no_effect" ? u.lastErrorCode : null,
          resolvedAt: u.adapterOperationResolvedAt?.toISOString(),
        }) !== u.adapterOperationReceiptDigest
      )
        throw failure();
      if (
        a.deleteReceiptDigest &&
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
          deletedAt: a.deletedAt?.toISOString(),
        }) !== a.deleteReceiptDigest
      )
        throw failure();
    }
    if (npDigestAgentPreviewArtifactUploadSetV1(setBody(p, result)) !== p.uploadSetDigest)
      throw failure();
    return result;
  }
  async function load(db: Db, siteId: string, uploadId: string) {
    const [u] = await db
      .select()
      .from(uploads)
      .where(scope(uploads, siteId, uploadId))
      .limit(1);
    if (!u) throw failure();
    const [p] = await db
      .select()
      .from(previews)
      .where(scope(previews, siteId, u.previewId))
      .limit(1);
    if (!p) throw failure();
    await contract(p);
    const all = await rows(db, p),
      found = all.find((row) => row.u.id === uploadId);
    if (!found) throw failure();
    return { p, ...found };
  }
  async function reserve(input: Parameters<NpAgentPreviewArtifactServiceV1["reserve"]>[0]) {
    if (!Array.isArray(input.artifacts) || input.artifacts.length > 24) throw failure();
    const frozen = input.artifacts.map((a) => {
      if (
        !(a.bytes instanceof Uint8Array) ||
        a.bytes.byteLength > (a.kind === "report" ? 512 * 1024 : 2 * 1024 * 1024)
      )
        throw failure();
      return { ...a, bytes: new Uint8Array(a.bytes) };
    });
    return options.withPreviewAuthority({
      ...input,
      mutate: async (db, p) => {
        await contract(p);
        if (p.state !== "rendering" && p.state !== "queued" && p.state !== "ready") throw failure();
        if (p.expectedArtifactCount !== null) {
          const existing = await rows(db, p);
          if (
            existing.length !== frozen.length ||
            existing.some(({ a }, i) => {
              const f = frozen[i];
              return (
                a.contentDigest !== npDigestAgentPreviewArtifactContentV1(f.bytes) ||
                a.kind !== f.kind ||
                a.route !== f.route ||
                a.locale !== f.locale ||
                !same(a.viewport, f.viewport) ||
                a.reportPart !== f.reportPart ||
                a.reportTotalParts !== f.reportTotalParts ||
                a.mime !== f.mime
              );
            })
          )
            throw failure();
          return {
            uploads: existing.map(({ a, u }) => ({
              artifactId: a.id,
              uploadId: u.id,
              ordinal: a.ordinal,
            })),
            uploadSetDigest: p.uploadSetDigest!,
          };
        }
        if (p.state === "ready" || (frozen.length > 0 && !storageIdentity)) throw failure();
        const stamp = now();
        const screenshots = frozen.filter((a) => a.kind === "screenshot");
        if (screenshots.length) {
          const [render] = await db
            .select()
            .from(renderSessions)
            .where(
              and(
                eq(renderSessions.siteId, p.siteId),
                eq(renderSessions.previewId, p.id),
                eq(renderSessions.id, p.renderSessionId!),
              ),
            )
            .limit(1);
          if (
            !render ||
            render.state !== "completed" ||
            render.capturePlan.length !== screenshots.length ||
            screenshots.some((a, i) => {
              const expected = render.capturePlan[i];
              return (
                !expected ||
                a.route !== expected.route ||
                a.locale !== expected.locale ||
                !same(a.viewport, {
                  name: expected.viewportName,
                  width: expected.width,
                  height: expected.height,
                  deviceScaleFactor: expected.deviceScaleFactor,
                })
              );
            })
          )
            throw failure();
        }
        const staged: Array<{ a: Artifact; u: Upload }> = [];
        const reports = [];
        for (const [index, f] of frozen.entries()) {
          if (f.kind === "report")
            reports.push(report(p, f.bytes, f.reportPart, f.reportTotalParts));
          const triple = storageIdentity!;
          const a = {
            id: randomUUID(),
            siteId: p.siteId,
            previewId: p.id,
            ordinal: index + 1,
            kind: f.kind,
            previewContractFingerprint: p.previewContractFingerprint,
            route: f.route,
            locale: f.locale,
            viewport: f.viewport,
            reportPart: f.reportPart,
            reportTotalParts: f.reportTotalParts,
            storageKey: `agent-preview/${randomUUID()}`,
            contentDigest: npDigestAgentPreviewArtifactContentV1(f.bytes),
            mime: f.mime,
            bytes: f.bytes.byteLength,
            storageAdapterId: triple.id,
            storageAdapterContractVersion: triple.contractVersion,
            storageAdapterFingerprint: triple.fingerprint,
            objectState: "absent",
            objectExpiresAt: null,
            metadataPruneAt: new Date(stamp.getTime() + 365 * 86400_000),
            deleteAttempt: 0,
            deleteReceiptDigest: null,
            deleteStatus: null,
            deleteErrorCode: null,
            deletedAt: null,
            rowVersion: 1,
            createdAt: stamp,
          } satisfies Artifact;
          adapter(a);
          const digest = npDigestAgentPreviewArtifactUploadRequestV1(request(p, a));
          const u = {
            id: randomUUID(),
            siteId: p.siteId,
            previewId: p.id,
            artifactId: a.id,
            uploadSetDigest: "",
            uploadRequestDigest: digest,
            idempotencyKey: npAgentPreviewArtifactUploadIdempotencyV1(digest),
            state: "queued",
            attempt: 0,
            rowVersion: 1,
            leaseUntil: null,
            callDeadlineAt: null,
            adapterOperationStatus: "not_dispatched",
            adapterOperationRef: null,
            adapterOperationReceiptDigest: null,
            adapterOperationResolvedAt: null,
            observedObjectState: "unknown",
            everObservedPresent: false,
            verifiedAt: null,
            lastErrorCode: null,
            createdAt: stamp,
            startedAt: null,
            finishedAt: null,
            pruneAt: a.metadataPruneAt,
          } satisfies Upload;
          staged.push({ a, u });
        }
        if (reports.length) npRequireAgentPreviewReportPartsV1(reports);
        manifest(
          p,
          staged.map((r) => r.a),
          new Date(stamp.getTime() + 1),
        );
        const uploadSetDigest = npDigestAgentPreviewArtifactUploadSetV1(setBody(p, staged));
        for (const { a, u } of staged) {
          await db.insert(artifacts).values(a);
          await db.insert(uploads).values({ ...u, uploadSetDigest });
        }
        await db
          .update(previews)
          .set({ expectedArtifactCount: staged.length, uploadSetDigest, artifactReservedAt: stamp })
          .where(scope(previews, p.siteId, p.id));
        return {
          uploads: staged.map(({ a, u }) => ({
            artifactId: a.id,
            uploadId: u.id,
            ordinal: a.ordinal,
          })),
          uploadSetDigest,
        };
      },
    });
  }
  async function dispatch(input: Parameters<NpAgentPreviewArtifactServiceV1["dispatch"]>[0]) {
    const initial = await load(getDb(), input.siteId, input.uploadId);
    if (
      initial.u.state === "queued" &&
      initial.p.artifactReservedAt &&
      now().getTime() >=
        initial.p.artifactReservedAt.getTime() + npAgentPreviewArtifactDispatchWindowMillisecondsV1
    ) {
      await reconcileUpload({ siteId: input.siteId, uploadId: input.uploadId });
      return;
    }
    if (!(input.bytes instanceof Uint8Array) || input.bytes.byteLength !== initial.a.bytes)
      throw failure();
    const bytes = new Uint8Array(input.bytes);
    if (
      bytes.byteLength !== initial.a.bytes ||
      npDigestAgentPreviewArtifactContentV1(bytes) !== initial.a.contentDigest
    )
      throw failure();
    const claimed = await options.withPreviewAuthority({
      siteId: input.siteId,
      previewId: initial.p.id,
      mutate: async (db, p) => {
        const current = await load(db, input.siteId, input.uploadId);
        if (current.u.state !== "queued" || current.u.attempt !== 0) return null;
        if (
          !p.artifactReservedAt ||
          now().getTime() >=
            p.artifactReservedAt.getTime() + npAgentPreviewArtifactDispatchWindowMillisecondsV1
        )
          return null;
        if (!["queued", "rendering"].includes(p.state)) throw failure();
        const stamp = now();
        const [u] = await db
          .update(uploads)
          .set({
            state: "running",
            attempt: 1,
            rowVersion: sql`${uploads.rowVersion}+1`,
            startedAt: stamp,
            callDeadlineAt: new Date(stamp.getTime() + 60_000),
            leaseUntil: new Date(stamp.getTime() + 90_000),
            adapterOperationStatus: "unknown",
          })
          .where(
            and(
              scope(uploads, input.siteId, input.uploadId),
              eq(uploads.rowVersion, current.u.rowVersion),
              eq(uploads.state, "queued"),
            ),
          )
          .returning();
        return u ? { ...current, u } : null;
      },
    });
    if (!claimed) return;
    let operationRef: string | null = null;
    try {
      const result = await bounded((signal) =>
        adapter(claimed.a).put({
          request: request(claimed.p, claimed.a),
          idempotencyKey: claimed.u.idempotencyKey,
          bytes,
          signal,
        }),
      );
      if (result?.operationRef !== undefined) {
        if (
          typeof result.operationRef !== "string" ||
          result.operationRef.length < 1 ||
          result.operationRef.length > 512
        )
          throw failure();
        operationRef = result.operationRef;
      }
    } catch {
      /* A failed or timed-out call does not establish no effect. */
    } finally {
      bytes.fill(0);
    }
    await getDb()
      .update(uploads)
      .set({
        state: "waiting_inspection",
        leaseUntil: null,
        adapterOperationRef: operationRef,
        rowVersion: sql`${uploads.rowVersion}+1`,
      })
      .where(
        and(
          scope(uploads, input.siteId, input.uploadId),
          eq(uploads.rowVersion, claimed.u.rowVersion),
          eq(uploads.state, "running"),
        ),
      );
    await reconcileUpload({ siteId: input.siteId, uploadId: input.uploadId });
  }
  async function reconcileUpload(
    input: Parameters<NpAgentPreviewArtifactServiceV1["reconcileUpload"]>[0],
  ) {
    const loaded = await load(getDb(), input.siteId, input.uploadId);
    if (["succeeded", "failed", "cancelled"].includes(loaded.u.state)) return;
    if (loaded.u.state === "queued") {
      if (
        !loaded.p.artifactReservedAt ||
        now().getTime() <
          loaded.p.artifactReservedAt.getTime() + npAgentPreviewArtifactDispatchWindowMillisecondsV1
      )
        return;
      await getDb().transaction(async (db) => {
        const [p] = await db
          .select()
          .from(previews)
          .where(scope(previews, input.siteId, loaded.p.id))
          .for("update")
          .limit(1);
        if (
          !p ||
          !p.artifactReservedAt ||
          now().getTime() <
            p.artifactReservedAt.getTime() + npAgentPreviewArtifactDispatchWindowMillisecondsV1
        )
          return;
        const [cancelled] = await db
          .update(uploads)
          .set({
            state: "cancelled",
            observedObjectState: "absent",
            finishedAt: now(),
            lastErrorCode: "UPLOAD_NO_EFFECT",
            rowVersion: sql`${uploads.rowVersion}+1`,
          })
          .where(
            and(
              scope(uploads, input.siteId, input.uploadId),
              eq(uploads.state, "queued"),
              eq(uploads.attempt, 0),
              eq(uploads.rowVersion, loaded.u.rowVersion),
            ),
          )
          .returning({ id: uploads.id });
        if (cancelled)
          await db
            .update(previews)
            .set({ state: "failed", completedAt: now(), errorCode: "PREVIEW_FAILED" })
            .where(
              and(
                scope(previews, input.siteId, p.id),
                sql`${previews.state} in ('queued','rendering')`,
              ),
            );
      });
      return;
    }
    const stamp = now();
    if (
      (loaded.u.leaseUntil && loaded.u.leaseUntil > stamp) ||
      loaded.u.attempt >= (input.operator ? 255 : 5)
    )
      return;
    const [claimed] = await getDb()
      .update(uploads)
      .set({
        state: "running",
        leaseUntil: new Date(stamp.getTime() + 90_000),
        attempt: loaded.u.attempt + 1,
        rowVersion: sql`${uploads.rowVersion}+1`,
      })
      .where(
        and(
          scope(uploads, input.siteId, input.uploadId),
          eq(uploads.rowVersion, loaded.u.rowVersion),
        ),
      )
      .returning();
    if (!claimed) return;
    const patch: Partial<typeof uploads.$inferInsert> = {
      state: "waiting_inspection",
      leaseUntil: null,
      rowVersion: claimed.rowVersion + 1,
    };
    let mustDelete = false;
    try {
      const storage = adapter(loaded.a),
        req = request(loaded.p, loaded.a);
      const resolution = npRequireAgentPreviewArtifactUploadResolutionV1(
        claimed.adapterOperationReceiptDigest
          ? {
              status: claimed.adapterOperationStatus,
              resolvedAt: claimed.adapterOperationResolvedAt?.toISOString(),
              safeCode:
                claimed.adapterOperationStatus === "failed_no_effect"
                  ? claimed.lastErrorCode
                  : null,
            }
          : await bounded((signal) =>
              storage.resolveOperation({
                request: req,
                idempotencyKey: claimed.idempotencyKey,
                operationRef: claimed.adapterOperationRef,
                signal,
              }),
            ),
      );
      patch.adapterOperationStatus = resolution.status;
      patch.lastErrorCode = resolution.safeCode;
      if (resolution.resolvedAt !== null) {
        const receipt = {
          schemaVersion: "np.agent-preview-artifact-upload-operation-receipt.v1",
          siteId: input.siteId,
          previewId: loaded.p.id,
          artifactId: loaded.a.id,
          uploadRequestDigest: claimed.uploadRequestDigest,
          idempotencyKey: claimed.idempotencyKey,
          storageAdapterId: loaded.a.storageAdapterId,
          storageAdapterContractVersion: loaded.a.storageAdapterContractVersion,
          storageAdapterFingerprint: loaded.a.storageAdapterFingerprint,
          status: resolution.status,
          safeCode: resolution.safeCode,
          resolvedAt: resolution.resolvedAt,
        };
        patch.adapterOperationReceiptDigest = npDigestAgentPreviewArtifactUploadReceiptV1(receipt);
        patch.adapterOperationResolvedAt = new Date(resolution.resolvedAt);
        if (resolution.status === "committed") {
          const observed = await bounded((signal) =>
            storage.stat({ storageKey: loaded.a.storageKey, signal }),
          );
          if (observed.state !== "absent" && observed.state !== "present") throw failure();
          patch.observedObjectState = observed.state;
          patch.everObservedPresent = claimed.everObservedPresent || observed.state === "present";
          let valid = false;
          if (observed.state === "present") {
            mustDelete = true;
            const read = await bounded((signal) =>
              storage.read({
                storageKey: loaded.a.storageKey,
                maximumBytes: loaded.a.bytes,
                signal,
              }),
            );
            valid =
              observed.mime === loaded.a.mime &&
              observed.bytes === loaded.a.bytes &&
              read.mime === loaded.a.mime &&
              read.bytes instanceof Uint8Array &&
              read.bytes.byteLength === loaded.a.bytes &&
              npDigestAgentPreviewArtifactContentV1(read.bytes) === loaded.a.contentDigest;
            if (valid && loaded.a.kind === "report")
              report(loaded.p, read.bytes, loaded.a.reportPart, loaded.a.reportTotalParts);
            if (read.bytes instanceof Uint8Array) read.bytes.fill(0);
          }
          patch.state = valid ? "succeeded" : "failed";
          patch.finishedAt = now();
          patch.verifiedAt = valid ? now() : null;
          patch.lastErrorCode = valid ? null : "ARTIFACT_INTEGRITY_FAILED";
          mustDelete = mustDelete && !valid;
        } else {
          const absence = await bounded((signal) =>
            storage.stat({ storageKey: loaded.a.storageKey, signal }),
          );
          if (absence.state !== "absent") {
            if (absence.state === "present") patch.everObservedPresent = true;
            throw failure();
          }
          patch.state = "failed";
          patch.finishedAt = now();
          patch.observedObjectState = "absent";
          patch.lastErrorCode = resolution.safeCode ?? "UPLOAD_NO_EFFECT";
        }
      }
    } catch {
      if (
        patch.adapterOperationStatus !== "failed_no_effect" ||
        !patch.adapterOperationReceiptDigest
      )
        patch.lastErrorCode = "ARTIFACT_INSPECTION_FAILED";
    }
    await getDb().transaction(async (db) => {
      const [changed] = await db
        .update(uploads)
        .set(patch)
        .where(
          and(
            scope(uploads, input.siteId, input.uploadId),
            eq(uploads.rowVersion, claimed.rowVersion),
          ),
        )
        .returning({ id: uploads.id });
      if (!changed) return;
      if (mustDelete)
        await db
          .update(artifacts)
          .set({ objectState: "delete_pending", rowVersion: sql`${artifacts.rowVersion}+1` })
          .where(scope(artifacts, input.siteId, loaded.a.id));
      if (patch.state === "failed")
        await db
          .update(previews)
          .set({
            state: "failed",
            completedAt: now(),
            errorCode:
              patch.lastErrorCode === "ARTIFACT_INTEGRITY_FAILED"
                ? "ARTIFACT_INTEGRITY_FAILED"
                : "PREVIEW_FAILED",
          })
          .where(
            and(
              scope(previews, input.siteId, loaded.p.id),
              sql`${previews.state} in ('queued','rendering')`,
            ),
          );
    });
  }
  async function finalize(input: Parameters<NpAgentPreviewArtifactServiceV1["finalize"]>[0]) {
    await options.withPreviewAuthority({
      ...input,
      mutate: async (db, p) => {
        await contract(p);
        const all = await rows(db, p);
        if (p.state === "ready") return;
        if (
          !["queued", "rendering"].includes(p.state) ||
          all.some(
            ({ a, u }) =>
              u.state !== "succeeded" ||
              u.adapterOperationStatus !== "committed" ||
              !u.adapterOperationReceiptDigest ||
              !u.verifiedAt ||
              a.objectState !== "absent" ||
              a.deleteAttempt !== 0 ||
              a.objectExpiresAt !== null,
          )
        )
          throw failure();
        if (p.renderSessionId) {
          const [render] = await db
            .select()
            .from(renderSessions)
            .where(
              and(
                eq(renderSessions.siteId, p.siteId),
                eq(renderSessions.previewId, p.id),
                eq(renderSessions.id, p.renderSessionId),
              ),
            )
            .limit(1);
          if (
            !render ||
            render.state !== "completed" ||
            render.renderAttemptId !== p.renderAttemptId ||
            render.planHash !== p.planHash ||
            render.previewContractFingerprint !== p.previewContractFingerprint
          )
            throw failure();
        } else if (all.some(({ a }) => a.kind === "screenshot")) throw failure();
        const [parent] = await db
          .select()
          .from(changesets)
          .where(and(eq(changesets.siteId, p.siteId), eq(changesets.id, p.changesetId)))
          .limit(1);
        const stamp = now();
        if (
          !parent ||
          parent.state !== "ready" ||
          parent.planHash !== p.planHash ||
          parent.expiresAt <= stamp
        )
          throw failure();
        const expiry = new Date(
          Math.min(parent.expiresAt.getTime(), stamp.getTime() + 7 * 86400_000),
        );
        const digest = await npDigestAgentPreviewArtifactManifestCanonical(
          manifest(
            p,
            all.map(({ a }) => a),
            expiry,
          ),
        );
        for (const { a, u } of all) {
          await db
            .update(artifacts)
            .set({
              objectState: "ready",
              objectExpiresAt: expiry,
              rowVersion: sql`${artifacts.rowVersion}+1`,
              metadataPruneAt: new Date(
                Math.max(a.metadataPruneAt.getTime(), parent.expiresAt.getTime() + 365 * 86400_000),
              ),
            })
            .where(scope(artifacts, p.siteId, a.id));
          await db
            .update(uploads)
            .set({
              pruneAt: new Date(
                Math.max(u.pruneAt.getTime(), parent.expiresAt.getTime() + 365 * 86400_000),
              ),
            })
            .where(scope(uploads, p.siteId, u.id));
        }
        await db
          .update(previews)
          .set({
            state: "ready",
            renderingStartedAt: p.renderingStartedAt ?? stamp,
            completedAt: stamp,
            expiresAt: expiry,
            digest,
            checkSummary: {
              checksRun:
                typeof p.checkSummary?.checksRun === "number" ? p.checkSummary.checksRun : 0,
              screenshots: all.filter(({ a }) => a.kind === "screenshot").length,
              warningCodes: [
                ...(all.some(({ a }) => a.kind === "screenshot")
                  ? []
                  : ["SCREENSHOTS_UNAVAILABLE"]),
                ...(typeof p.checkSummary?.checksRun === "number" && p.checkSummary.checksRun > 0
                  ? []
                  : ["CHECKS_NOT_RUN"]),
              ],
            },
            errorCode: null,
          })
          .where(scope(previews, p.siteId, p.id));
      },
    });
  }
  async function readArtifact(
    input: Parameters<NpAgentPreviewArtifactServiceV1["readArtifact"]>[0],
  ) {
    await input.authorize();
    const [p] = await getDb()
      .select()
      .from(previews)
      .where(scope(previews, input.siteId, input.previewId))
      .limit(1);
    if (!p || p.state !== "ready" || !p.expiresAt || p.expiresAt <= now()) throw failure();
    await contract(p);
    const all = await rows(getDb(), p),
      entry = all.find(({ a }) => a.id === input.artifactId);
    if (
      !entry ||
      all.some(
        ({ a, u }) =>
          a.objectState !== "ready" ||
          a.objectExpiresAt?.getTime() !== p.expiresAt!.getTime() ||
          u.state !== "succeeded",
      ) ||
      (await npDigestAgentPreviewArtifactManifestCanonical(
        manifest(
          p,
          all.map(({ a }) => a),
          p.expiresAt,
        ),
      )) !== p.digest
    )
      throw failure();
    const a = entry.a,
      storage = adapter(a);
    const metadata = await bounded((signal) => storage.stat({ storageKey: a.storageKey, signal }));
    if (metadata.state !== "present" || metadata.mime !== a.mime || metadata.bytes !== a.bytes)
      throw failure();
    const content = await bounded((signal) =>
      storage.read({ storageKey: a.storageKey, maximumBytes: a.bytes, signal }),
    );
    try {
      if (
        !(content.bytes instanceof Uint8Array) ||
        content.bytes.byteLength !== a.bytes ||
        content.mime !== a.mime ||
        npDigestAgentPreviewArtifactContentV1(content.bytes) !== a.contentDigest
      )
        throw failure();
      if (a.kind === "report") report(p, content.bytes, a.reportPart, a.reportTotalParts);
      const [current] = await getDb()
        .select()
        .from(previews)
        .where(scope(previews, p.siteId, p.id))
        .limit(1);
      const [object] = await getDb()
        .select()
        .from(artifacts)
        .where(scope(artifacts, p.siteId, a.id))
        .limit(1);
      if (
        !current ||
        !object ||
        current.state !== "ready" ||
        current.digest !== p.digest ||
        current.expiresAt?.getTime() !== p.expiresAt.getTime() ||
        current.expiresAt <= now() ||
        object.rowVersion !== a.rowVersion ||
        object.objectState !== "ready"
      )
        throw failure();
      await input.authorize();
      if (p.expiresAt <= now()) throw failure();
      return {
        bytes: new Uint8Array(content.bytes),
        mime: a.mime,
        contentDigest: a.contentDigest,
        expiresAt: p.expiresAt.toISOString(),
      };
    } finally {
      if (content.bytes instanceof Uint8Array) content.bytes.fill(0);
    }
  }
  async function deleteArtifact(
    input: Parameters<NpAgentPreviewArtifactServiceV1["deleteArtifact"]>[0],
  ) {
    const [a] = await getDb()
      .select()
      .from(artifacts)
      .where(scope(artifacts, input.siteId, input.artifactId))
      .limit(1);
    if (!a) throw failure();
    const [u] = await getDb()
      .select()
      .from(uploads)
      .where(and(eq(uploads.siteId, input.siteId), eq(uploads.artifactId, a.id)))
      .limit(1);
    if (!u) throw failure();
    const { p } = await load(getDb(), input.siteId, u.id);
    if (p.state === "ready" && p.expiresAt && p.expiresAt > now()) throw failure();
    const [liveLaunch] = await getDb()
      .select({ id: launches.id })
      .from(launches)
      .where(
        and(
          eq(launches.siteId, input.siteId),
          eq(launches.previewId, p.id),
          sql`(${launches.state} in ('active','exchange_pending') or to_timestamp(${launches.exp})+interval '60 seconds'>${now()})`,
        ),
      )
      .limit(1);
    const [liveRender] = await getDb()
      .select({ id: renderSessions.id })
      .from(renderSessions)
      .where(
        and(
          eq(renderSessions.siteId, input.siteId),
          eq(renderSessions.previewId, p.id),
          sql`(${renderSessions.state}='active' or ${renderSessions.expiresAt}+interval '60 seconds'>${now()})`,
        ),
      )
      .limit(1);
    if (liveLaunch || liveRender) return;
    if (
      !["succeeded", "failed", "cancelled"].includes(u.state) ||
      !["committed", "not_started", "failed_no_effect", "not_dispatched"].includes(
        u.adapterOperationStatus,
      )
    )
      return;
    if (
      a.objectState === "absent" &&
      (a.deleteReceiptDigest ||
        (!u.everObservedPresent && u.adapterOperationStatus !== "committed"))
    )
      return;
    if (a.deleteAttempt >= 255) return;
    const [claimed] = await getDb()
      .update(artifacts)
      .set({
        objectState: "delete_pending",
        deleteAttempt: a.deleteAttempt + 1,
        rowVersion: sql`${artifacts.rowVersion}+1`,
      })
      .where(and(scope(artifacts, input.siteId, a.id), eq(artifacts.rowVersion, a.rowVersion)))
      .returning();
    if (!claimed) return;
    try {
      const storage = adapter(a);
      const result = await bounded((signal) =>
        storage.delete({
          storageKey: a.storageKey,
          idempotencyKey: `npad1_${createHash("sha256")
            .update("np.agent-artifact-delete-idempotency.v1\0")
            .update(
              serializeAgentCanonicalJson({
                siteId: a.siteId,
                previewId: a.previewId,
                artifactId: a.id,
                contentDigest: a.contentDigest,
                storageAdapterId: a.storageAdapterId,
                storageAdapterContractVersion: a.storageAdapterContractVersion,
                storageAdapterFingerprint: a.storageAdapterFingerprint,
              }),
            )
            .digest("base64url")}`,
          signal,
        }),
      );
      if (result.status !== "deleted" && result.status !== "already_absent") throw failure();
      const stat = await bounded((signal) => storage.stat({ storageKey: a.storageKey, signal }));
      if (stat.state !== "absent") throw failure();
      const deletedAt = now(),
        digest = npDigestAgentPreviewArtifactDeleteReceiptV1({
          schemaVersion: "np.agent-artifact-delete-receipt.v1",
          siteId: a.siteId,
          previewId: a.previewId,
          artifactId: a.id,
          contentDigest: a.contentDigest,
          storageAdapterId: a.storageAdapterId,
          storageAdapterContractVersion: a.storageAdapterContractVersion,
          storageAdapterFingerprint: a.storageAdapterFingerprint,
          deleteAttempt: claimed.deleteAttempt,
          status: result.status,
          deletedAt: deletedAt.toISOString(),
        });
      await getDb().transaction(async (db) => {
        const [updated] = await db
          .update(artifacts)
          .set({
            objectState: "absent",
            deleteReceiptDigest: digest,
            deleteStatus: result.status,
            deletedAt,
            deleteErrorCode: null,
            rowVersion: sql`${artifacts.rowVersion}+1`,
          })
          .where(
            and(scope(artifacts, input.siteId, a.id), eq(artifacts.rowVersion, claimed.rowVersion)),
          )
          .returning({ id: artifacts.id });
        if (!updated) return;
      });
    } catch {
      await getDb()
        .update(artifacts)
        .set({ deleteErrorCode: "ARTIFACT_DELETE_FAILED" })
        .where(
          and(scope(artifacts, input.siteId, a.id), eq(artifacts.rowVersion, claimed.rowVersion)),
        );
    }
  }
  async function reconcilePreviewCleanup(
    input: Parameters<NpAgentPreviewArtifactServiceV1["reconcilePreviewCleanup"]>[0],
  ) {
    const [p] = await getDb()
      .select()
      .from(previews)
      .where(scope(previews, input.siteId, input.previewId))
      .limit(1);
    if (!p) throw failure();
    if (
      (p.state === "ready" && p.expiresAt && p.expiresAt > now()) ||
      ["queued", "rendering"].includes(p.state)
    )
      return;
    const stamp = now();
    if (p.state === "ready" && p.expiresAt && p.expiresAt <= stamp)
      await getDb()
        .update(previews)
        .set({ state: "expired" })
        .where(and(scope(previews, p.siteId, p.id), eq(previews.state, "ready")));
    await getDb()
      .update(launches)
      .set({ state: "expired", expiredAt: stamp, terminalReason: "PREVIEW_INVALIDATED" })
      .where(
        and(
          eq(launches.siteId, input.siteId),
          eq(launches.previewId, p.id),
          sql`${launches.state} in ('active','exchange_pending')`,
        ),
      );
    await getDb()
      .update(renderSessions)
      .set({ state: "cancelled", closedAt: stamp, closeReason: "PREVIEW_INVALIDATED" })
      .where(
        and(
          eq(renderSessions.siteId, input.siteId),
          eq(renderSessions.previewId, p.id),
          eq(renderSessions.state, "active"),
        ),
      );
    if (p.expectedArtifactCount === null) {
      const [unexpected] = await getDb()
        .select({ id: artifacts.id })
        .from(artifacts)
        .where(and(eq(artifacts.siteId, p.siteId), eq(artifacts.previewId, p.id)))
        .limit(1);
      if (unexpected) throw failure();
      return;
    }
    const all = await rows(getDb(), p);
    for (const { a, u } of all) {
      if (u.state === "queued")
        await getDb()
          .update(uploads)
          .set({
            state: "cancelled",
            observedObjectState: "absent",
            finishedAt: stamp,
            rowVersion: sql`${uploads.rowVersion}+1`,
          })
          .where(
            and(
              scope(uploads, input.siteId, u.id),
              eq(uploads.state, "queued"),
              eq(uploads.rowVersion, u.rowVersion),
            ),
          );
      else if (!["succeeded", "failed", "cancelled"].includes(u.state))
        await reconcileUpload({ siteId: input.siteId, uploadId: u.id });
      await deleteArtifact({ siteId: input.siteId, artifactId: a.id });
    }
  }
  return {
    reserve,
    dispatch,
    reconcileUpload,
    finalize,
    readArtifact,
    deleteArtifact,
    reconcilePreviewCleanup,
  };
}
