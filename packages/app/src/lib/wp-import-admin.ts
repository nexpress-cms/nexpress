import { createHash } from "node:crypto";

import {
  NpNotFoundError,
  NpServiceUnavailableError,
  NpValidationError,
  enqueueJob,
  findDocuments,
  getJobsPauseState,
  getOptionalJobQueue,
  hashPassword,
  listWorkerHealth,
  npComments,
  npImportRuns,
  npMedia,
  npMembers,
  npUsers,
  recordAuditEvent,
  recordJobLog,
  registerJobHandler,
  renderCommentMarkdown,
  saveDocument,
  uploadMedia,
  type NpAuthUser,
  type NpImportRunOptions,
  type NpImportRunResumeState,
  type NpImportRunStatus,
} from "@nexpress/core";
import { getDb } from "@nexpress/core/db";
import {
  npAuthContractLimits,
  npIsCanonicalAuthEmail,
  npIsCanonicalMemberHandle,
} from "@nexpress/core/auth-contract";
import {
  npRequireJobsEnabledFlag,
  type NpWordPressImportApplyJobData,
} from "@nexpress/core/jobs-contract";
import {
  applyBundle,
  emptyResumeState,
  parseConfig,
  parseWxr,
  type AppliedRow,
  type ApplyReport,
  type AttachmentIndex,
  type AuthorResolution,
  type CommentImportPlan,
  type CollectionMapping,
  type LexicalRoot,
  type MediaPipelineReport,
  type ReportHtmlDeps,
  type ResumeDeps,
  type ResumeState,
  type SkippedRow,
  type TaxonomyResolution,
  type WpImportBundle,
  WpImportConfigError,
} from "@nexpress/wp-import";
import { and, asc, desc, eq, inArray, isNotNull, isNull, lt } from "drizzle-orm";

import { npGetReloadSafeHandler } from "./reload-safe-handler";

const MAX_LIST_ITEMS = 250;
const MAX_LOG_LINES = 200;
const MAX_CONVERSION_SAMPLES = 12;
const MAX_CONVERSION_SAMPLE_CHARS = 6_000;
const IMPORT_RUN_LIST_LIMIT = 25;
const IMPORT_RUN_SWEEP_LIMIT = 100;
const DEFAULT_IMPORT_RUN_STALE_AFTER_SECONDS = 24 * 60 * 60;
const BUILTIN_WP_TYPE_COLLECTIONS: Record<string, string> = {
  page: "pages",
  post: "posts",
};
export const WORDPRESS_IMPORT_APPLY_JOB_TYPE = "import:wordpressApply";

export type WpImportAdminMode = "preview" | "apply";

export interface WpImportAdminOptions {
  mode: WpImportAdminMode;
  sourceName: string;
  update: boolean;
  strict: boolean;
  createAuthors: boolean;
  includeMedia: boolean;
  resume: boolean;
  collectionMappings?: Record<string, CollectionMapping>;
}

export interface WpImportAdminList<T> {
  total: number;
  items: T[];
  truncated: boolean;
}

export interface WpImportAdminCounts {
  records: number;
  authors: number;
  terms: number;
  comments: number;
  inlineMediaRefs: number;
  featuredImages: number;
  recordsByType: Record<string, number>;
  termsByTaxonomy: Record<string, number>;
  statuses: Record<string, number>;
}

export interface WpImportAdminReport {
  applied: WpImportAdminList<AppliedRow>;
  skipped: WpImportAdminList<SkippedRow>;
  errors: WpImportAdminList<{ wpId: number; slug: string; message: string }>;
  notes: WpImportAdminList<string>;
  logs: WpImportAdminList<string>;
  conversionSamples: WpImportAdminList<WpImportAdminConversionSample>;
  attachments: {
    byId: number;
    byUrl: number;
  };
  media: {
    status: "not-run" | "completed";
    uploaded: number;
    reused: number;
    skipped: number;
    resolvedUrls: number;
    resolvedAttachments: number;
    errors: WpImportAdminList<{ url: string; reason: string }>;
  };
  taxonomies: {
    status: "not-run" | "completed";
    resolved: number;
    skipped: WpImportAdminList<{ taxonomy: string; slug: string; name: string }>;
    errors: WpImportAdminList<{
      key: { taxonomy: string; slug: string; name: string };
      reason: string;
    }>;
  };
  comments: {
    status: "not-run" | "completed";
    applied: number;
    skippedUnapproved: number;
    skippedNoMember: number;
    skippedByResume: number;
    errors: WpImportAdminList<{ wpCommentId: number; reason: string }>;
  };
  authors: {
    status: "not-run" | "completed";
    resolved: number;
    skipped: WpImportAdminList<string>;
    errors: WpImportAdminList<{ login: string; reason: string }>;
  };
}

export interface WpImportAdminConversionSample {
  wpId: number;
  wpType: string;
  slug: string;
  title: string;
  rawHtml: string;
  lexicalJson: string;
  truncated: boolean;
}

export interface WpImportAdminMappingRow {
  wpType: string;
  collection: string;
  fieldOverrides: Record<string, string>;
  records: number;
}

export interface WpImportAdminUnmappedType {
  wpType: string;
  records: number;
}

export interface WpImportAdminMappingSummary {
  configured: WpImportAdminList<WpImportAdminMappingRow>;
  unmapped: WpImportAdminList<WpImportAdminUnmappedType>;
}

export interface WpImportAdminResumeSummary {
  enabled: boolean;
  sourceHash: string | null;
  source: string | null;
  documents: number;
  comments: number;
  authors: number;
  media: number;
  taxonomies: number;
}

export interface WpImportAdminResponse {
  mode: WpImportAdminMode;
  dryRun: boolean;
  sourceName: string;
  site: WpImportBundle["site"];
  options: {
    update: boolean;
    strict: boolean;
    createAuthors: boolean;
    includeMedia: boolean;
    resume: boolean;
    collectionMappings?: Record<string, CollectionMapping>;
  };
  counts: WpImportAdminCounts;
  mappings: WpImportAdminMappingSummary;
  resume: WpImportAdminResumeSummary;
  report: WpImportAdminReport;
}

type ImportRunRow = typeof npImportRuns.$inferSelect;

export interface WpImportAdminRun {
  id: string;
  kind: string;
  mode: WpImportAdminMode;
  status: NpImportRunStatus;
  sourceName: string;
  sourceSize: number;
  sourceMimeType: string | null;
  sourceHash: string | null;
  options: NpImportRunOptions;
  jobId: string | null;
  resume: WpImportAdminResumeSummary;
  report: WpImportAdminResponse | null;
  logs: string[];
  error: string | null;
  createdBy: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export type WpImportAdminBackgroundState =
  "ready" | "disabled" | "paused" | "no-workers" | "stale-workers";

export interface WpImportAdminBackgroundStatus {
  jobsEnabled: boolean;
  paused: boolean;
  state: WpImportAdminBackgroundState;
  workerAliveCount: number;
  workerTotalCount: number;
  newestHeartbeat: string | null;
  staleAfterSeconds: number;
}

export interface WpImportAdminRunList {
  runs: WpImportAdminRun[];
  background: WpImportAdminBackgroundStatus;
}

export interface WpImportAdminSweepResult {
  failed: number;
  cutoff: string;
  staleAfterSeconds: number;
  runs: WpImportAdminRun[];
}

export interface WpImportAdminQueuedResponse {
  mode: "apply";
  queued: true;
  run: WpImportAdminRun;
}

export async function runWordPressAdminImport(args: {
  xml: string;
  actor: NpAuthUser;
  options: WpImportAdminOptions;
  resume?: ResumeDeps;
}): Promise<WpImportAdminResponse> {
  const { actor, options } = args;
  const bundle = parseWxrForAdmin(args.xml);
  const dryRun = options.mode === "preview";
  const sourceHash = hashImportSource(args.xml);
  const logs: string[] = [];
  const conversionSamples: WpImportAdminConversionSample[] = [];
  const collectionMappings = options.collectionMappings ?? {};

  const report = await applyBundle(bundle, {
    actor,
    dryRun,
    strict: options.strict,
    update: options.update,
    collectionMappings,
    log: (line) => {
      logs.push(line);
    },
    reportHtml: createAdminReportHtmlDeps(conversionSamples),
    ...(options.resume && args.resume ? { resume: args.resume } : {}),
    ...(options.includeMedia ? { media: createMediaDeps(actor.id) } : {}),
    ...(!dryRun
      ? {
          taxonomies: createTaxonomyDeps(actor),
          comments: createCommentDeps(),
          preserveOriginalAuthor: { posts: "wpOriginalAuthor" },
          audit: {
            record: ({ action, targetType, targetId, payload }) =>
              recordAuditEvent({
                actor: { kind: "staff", userId: actor.id },
                action,
                targetType,
                targetId,
                payload,
              }),
          },
          authors: options.createAuthors
            ? createAuthorDeps()
            : { resolveAuthor: () => Promise.resolve(null) },
        }
      : {}),
  });

  return {
    mode: options.mode,
    dryRun,
    sourceName: options.sourceName,
    site: bundle.site,
    options: {
      update: options.update,
      strict: options.strict,
      createAuthors: options.createAuthors,
      includeMedia: options.includeMedia,
      resume: options.resume,
      collectionMappings,
    },
    counts: summarizeBundle(bundle),
    mappings: summarizeMappings(bundle, collectionMappings),
    resume: summarizeResumeState(options.resume, sourceHash, args.resume?.state ?? null),
    report: serializeReport(report, logs, conversionSamples),
  };
}

export function parseWordPressImportMappingConfig(
  value: unknown,
): Record<string, CollectionMapping> {
  if (value === null || value === undefined) return {};
  if (typeof value !== "string") {
    throw new NpValidationError("Invalid input", [
      { field: "mappingConfig", message: "mappingConfig must be a JSON string" },
    ]);
  }

  const source = value.trim();
  if (!source) return {};

  try {
    return parseConfig(source, "mappingConfig").collectionMappings;
  } catch (error) {
    if (error instanceof WpImportConfigError) {
      throw new NpValidationError("Invalid input", [
        { field: "mappingConfig", message: error.message },
      ]);
    }
    throw error;
  }
}

export async function createWordPressImportPreviewResumeDeps(args: {
  sourceName: string;
  sourceHash: string;
}): Promise<ResumeDeps> {
  const reusable = await findReusableResumeState(args.sourceHash, args.sourceName);
  return {
    state: reusable?.state ?? emptyResumeState(resumeSourceLabel(args.sourceName, args.sourceHash)),
    persist: () => {},
  };
}

export async function createAndEnqueueWordPressImportRun(args: {
  xml: string;
  actor: NpAuthUser;
  sourceName: string;
  sourceSize: number;
  sourceMimeType: string | null;
  options: NpImportRunOptions;
}): Promise<WpImportAdminRun> {
  const queue = getOptionalJobQueue();
  if (!queue) {
    throw new NpServiceUnavailableError(
      "WordPress background apply requires jobs. Set NP_ENABLE_JOBS=1 on the web runtime and start a worker with `NP_ENABLE_JOBS=1 pnpm run worker`.",
    );
  }

  const db = getDb();
  const now = new Date();
  const normalizedOptions = normalizeImportRunOptions(args.options);
  const sourceHash = hashImportSource(args.xml);
  const reusableResume = normalizedOptions.resume
    ? await findReusableResumeState(sourceHash, args.sourceName)
    : null;
  const resumeState = normalizedOptions.resume
    ? (reusableResume?.state ?? emptyResumeState(resumeSourceLabel(args.sourceName, sourceHash)))
    : null;
  const initialLogs = [
    `Queued WordPress import for ${args.sourceName}.`,
    ...(normalizedOptions.resume
      ? [
          reusableResume
            ? `Loaded resume marker from run ${reusableResume.runId}.`
            : "Started a fresh resume marker for this source.",
        ]
      : []),
  ];
  const [created] = await db
    .insert(npImportRuns)
    .values({
      kind: "wordpress",
      mode: "apply",
      sourceName: args.sourceName,
      sourceSize: args.sourceSize,
      sourceMimeType: args.sourceMimeType,
      sourceHash,
      sourceXml: args.xml,
      options: normalizedOptions,
      resumeState: toImportRunResumeState(resumeState),
      status: "queued",
      logs: initialLogs,
      createdBy: args.actor.id,
      updatedAt: now,
    })
    .returning();

  if (!created) {
    throw new Error("WordPress import run insert returned no row");
  }

  try {
    const jobId = await enqueueJob(WORDPRESS_IMPORT_APPLY_JOB_TYPE, { runId: created.id });
    if (!jobId) {
      throw new Error("Job queue did not return an id");
    }

    const [updated] = await db
      .update(npImportRuns)
      .set({
        jobId,
        updatedAt: new Date(),
        logs: appendLog(created.logs, `Background job ${jobId} enqueued.`),
      })
      .where(eq(npImportRuns.id, created.id))
      .returning();

    return serializeImportRun(updated ?? { ...created, jobId });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const [failed] = await db
      .update(npImportRuns)
      .set({
        status: "failed",
        sourceXml: null,
        error: message,
        finishedAt: new Date(),
        updatedAt: new Date(),
        logs: appendLog(created.logs, `Failed to enqueue background job: ${message}`),
      })
      .where(eq(npImportRuns.id, created.id))
      .returning();

    const run = serializeImportRun(failed ?? created);
    throw new NpServiceUnavailableError(
      `WordPress import run ${run.id} could not be queued: ${message}`,
    );
  }
}

export async function listWordPressImportRuns(
  limit = IMPORT_RUN_LIST_LIMIT,
): Promise<WpImportAdminRunList> {
  const db = getDb();
  const [rows, background] = await Promise.all([
    db
      .select()
      .from(npImportRuns)
      .where(eq(npImportRuns.kind, "wordpress"))
      .orderBy(desc(npImportRuns.createdAt))
      .limit(Math.min(Math.max(1, limit), 100)),
    getWordPressImportBackgroundStatus(),
  ]);
  return { runs: rows.map(serializeImportRun), background };
}

export async function getWordPressImportRun(id: string): Promise<WpImportAdminRun> {
  const db = getDb();
  const [row] = await db
    .select()
    .from(npImportRuns)
    .where(and(eq(npImportRuns.id, id), eq(npImportRuns.kind, "wordpress")))
    .limit(1);
  if (!row) throw new NpNotFoundError("wp-import-run", id);
  return serializeImportRun(row);
}

export async function getWordPressImportBackgroundStatus(): Promise<WpImportAdminBackgroundStatus> {
  const jobsEnabled = npRequireJobsEnabledFlag(process.env.NP_ENABLE_JOBS);
  const [workers, pause] = await Promise.all([listWorkerHealth(), getJobsPauseState()]);
  const state: WpImportAdminBackgroundState = !jobsEnabled
    ? "disabled"
    : pause.paused
      ? "paused"
      : workers.aliveCount > 0
        ? "ready"
        : workers.totalCount > 0
          ? "stale-workers"
          : "no-workers";

  return {
    jobsEnabled,
    paused: pause.paused,
    state,
    workerAliveCount: workers.aliveCount,
    workerTotalCount: workers.totalCount,
    newestHeartbeat: workers.newestHeartbeat,
    staleAfterSeconds: getWordPressImportRunStaleAfterSeconds(),
  };
}

export async function sweepStaleWordPressImportRuns(
  options: { now?: Date; staleAfterMs?: number; limit?: number } = {},
): Promise<WpImportAdminSweepResult> {
  const now = options.now ?? new Date();
  const staleAfterMs = options.staleAfterMs ?? getWordPressImportRunStaleAfterSeconds() * 1_000;
  const staleAfterSeconds = Math.max(1, Math.floor(staleAfterMs / 1_000));
  const cutoff = new Date(now.getTime() - staleAfterMs);
  const limit = Math.min(
    Math.max(1, options.limit ?? IMPORT_RUN_SWEEP_LIMIT),
    IMPORT_RUN_SWEEP_LIMIT,
  );
  const workers = await listWorkerHealth(now);
  const staleStatuses: NpImportRunStatus[] =
    workers.aliveCount > 0 ? ["queued"] : ["queued", "running"];
  const db = getDb();
  const staleRows = await db
    .select()
    .from(npImportRuns)
    .where(
      and(
        eq(npImportRuns.kind, "wordpress"),
        inArray(npImportRuns.status, staleStatuses),
        lt(npImportRuns.updatedAt, cutoff),
      ),
    )
    .orderBy(asc(npImportRuns.updatedAt))
    .limit(limit);

  const failedRuns: WpImportAdminRun[] = [];
  for (const row of staleRows) {
    const message = `Import run exceeded the ${formatDuration(staleAfterSeconds)} stale timeout before reaching a terminal state.`;
    const [updated] = await db
      .update(npImportRuns)
      .set({
        status: "failed",
        sourceXml: null,
        error: message,
        finishedAt: now,
        updatedAt: now,
        logs: appendLog(row.logs, message),
      })
      .where(and(eq(npImportRuns.id, row.id), inArray(npImportRuns.status, staleStatuses)))
      .returning();
    if (updated) failedRuns.push(serializeImportRun(updated));
  }

  return {
    failed: failedRuns.length,
    cutoff: cutoff.toISOString(),
    staleAfterSeconds,
    runs: failedRuns,
  };
}

export function registerWordPressImportJobs(): void {
  registerJobHandler(
    WORDPRESS_IMPORT_APPLY_JOB_TYPE,
    npGetReloadSafeHandler<NpWordPressImportApplyJobData>(
      "np.app.jobs.import.wordpress-apply",
      async (data) => {
        const run = await executeWordPressImportRun(data.runId);
        if (run.status === "failed") {
          throw new Error(run.error ?? `WordPress import run ${run.id} failed`);
        }
      },
    ),
  );
}

export async function executeWordPressImportRun(runId: string): Promise<WpImportAdminRun> {
  const db = getDb();
  const [run] = await db
    .select()
    .from(npImportRuns)
    .where(and(eq(npImportRuns.id, runId), eq(npImportRuns.kind, "wordpress")))
    .limit(1);
  if (!run) throw new NpNotFoundError("wp-import-run", runId);

  if (run.status === "succeeded" || run.status === "failed") {
    return serializeImportRun(run);
  }

  const startedAt = run.startedAt ?? new Date();
  const runningLogs = appendLog(run.logs, `Started WordPress import ${run.id}.`);
  await db
    .update(npImportRuns)
    .set({
      status: "running",
      startedAt,
      updatedAt: new Date(),
      logs: runningLogs,
    })
    .where(eq(npImportRuns.id, run.id));
  await recordJobLog("info", `Started WordPress import ${run.id}.`, {
    sourceName: run.sourceName,
  });

  try {
    if (!run.sourceXml) {
      throw new Error("Import source XML is missing.");
    }
    if (!run.createdBy) {
      throw new Error("Import run has no actor.");
    }

    const actor = await loadImportActor(run.createdBy);
    const normalizedOptions = normalizeImportRunOptions(run.options);
    const sourceHash = run.sourceHash ?? hashImportSource(run.sourceXml);
    const resume =
      normalizedOptions.resume === true
        ? createDbResumeDeps(
            run.id,
            fromImportRunResumeState(
              run.resumeState,
              resumeSourceLabel(run.sourceName, sourceHash),
            ) ?? emptyResumeState(resumeSourceLabel(run.sourceName, sourceHash)),
          )
        : undefined;
    const result = await runWordPressAdminImport({
      xml: run.sourceXml,
      actor,
      options: {
        mode: "apply",
        sourceName: run.sourceName,
        update: normalizedOptions.update,
        strict: normalizedOptions.strict,
        createAuthors: normalizedOptions.createAuthors,
        includeMedia: normalizedOptions.includeMedia,
        resume: normalizedOptions.resume === true,
        collectionMappings: normalizedOptions.collectionMappings ?? {},
      },
      resume,
    });
    const finishedAt = new Date();
    const [updated] = await db
      .update(npImportRuns)
      .set({
        status: "succeeded",
        report: result,
        sourceHash,
        resumeState: toImportRunResumeState(resume?.state ?? null),
        sourceXml: null,
        error: null,
        finishedAt,
        updatedAt: finishedAt,
        logs: appendLog(runningLogs, `Finished WordPress import ${run.id}.`),
      })
      .where(eq(npImportRuns.id, run.id))
      .returning();

    await recordJobLog("info", `Finished WordPress import ${run.id}.`, {
      applied: result.report.applied.total,
      skipped: result.report.skipped.total,
      errors: result.report.errors.total,
    });
    return serializeImportRun(updated ?? { ...run, status: "succeeded", report: result });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const finishedAt = new Date();
    const [failed] = await db
      .update(npImportRuns)
      .set({
        status: "failed",
        sourceXml: null,
        error: message,
        finishedAt,
        updatedAt: finishedAt,
        logs: appendLog(runningLogs, `Failed WordPress import ${run.id}: ${message}`),
      })
      .where(eq(npImportRuns.id, run.id))
      .returning();

    await recordJobLog("error", `WordPress import ${run.id} failed: ${message}`);
    return serializeImportRun(failed ?? { ...run, status: "failed", error: message });
  }
}

function parseWxrForAdmin(xml: string): WpImportBundle {
  try {
    return parseWxr(xml);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new NpValidationError("Invalid input", [
      { field: "file", message: `Invalid WXR file: ${message}` },
    ]);
  }
}

async function loadImportActor(userId: string): Promise<NpAuthUser> {
  const db = getDb();
  const [row] = await db
    .select({
      id: npUsers.id,
      email: npUsers.email,
      name: npUsers.name,
      role: npUsers.role,
      tokenVersion: npUsers.tokenVersion,
    })
    .from(npUsers)
    .where(eq(npUsers.id, userId))
    .limit(1);
  if (!row) {
    throw new Error(`Import actor ${userId} no longer exists.`);
  }
  return row;
}

function serializeImportRun(row: ImportRunRow): WpImportAdminRun {
  const options = normalizeImportRunOptions(row.options);
  return {
    id: row.id,
    kind: row.kind,
    mode: row.mode === "preview" ? "preview" : "apply",
    status: row.status,
    sourceName: row.sourceName,
    sourceSize: row.sourceSize,
    sourceMimeType: row.sourceMimeType,
    sourceHash: row.sourceHash,
    options,
    jobId: row.jobId,
    resume: summarizeResumeState(
      options.resume === true,
      row.sourceHash,
      fromImportRunResumeState(row.resumeState, row.sourceName),
    ),
    report: isImportReport(row.report) ? row.report : null,
    logs: Array.isArray(row.logs) ? row.logs.filter((item) => typeof item === "string") : [],
    error: row.error,
    createdBy: row.createdBy,
    startedAt: toIso(row.startedAt),
    finishedAt: toIso(row.finishedAt),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function isImportReport(value: unknown): value is WpImportAdminResponse {
  return (
    typeof value === "object" &&
    value !== null &&
    "mode" in value &&
    "report" in value &&
    "counts" in value
  );
}

function toIso(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}

function appendLog(current: string[] | null | undefined, line: string): string[] {
  return [...(current ?? []), line].slice(-MAX_LOG_LINES);
}

function normalizeImportRunOptions(options: NpImportRunOptions): NpImportRunOptions {
  return {
    update: options.update,
    strict: options.strict,
    createAuthors: options.createAuthors,
    includeMedia: options.includeMedia,
    resume: options.resume ?? false,
    collectionMappings: options.collectionMappings ?? {},
  };
}

function getWordPressImportRunStaleAfterSeconds(): number {
  const raw = Number.parseInt(process.env.NP_IMPORT_RUN_STALE_AFTER_SECONDS ?? "", 10);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_IMPORT_RUN_STALE_AFTER_SECONDS;
}

function formatDuration(seconds: number): string {
  if (seconds % 86_400 === 0) return `${(seconds / 86_400).toString()}d`;
  if (seconds % 3_600 === 0) return `${(seconds / 3_600).toString()}h`;
  if (seconds % 60 === 0) return `${(seconds / 60).toString()}m`;
  return `${seconds.toString()}s`;
}

export function hashImportSource(xml: string): string {
  return createHash("sha256").update(xml, "utf8").digest("hex");
}

async function findReusableResumeState(
  sourceHash: string,
  sourceName: string,
): Promise<{ runId: string; state: ResumeState } | null> {
  const db = getDb();
  const [row] = await db
    .select({
      runId: npImportRuns.id,
      resumeState: npImportRuns.resumeState,
    })
    .from(npImportRuns)
    .where(
      and(
        eq(npImportRuns.kind, "wordpress"),
        eq(npImportRuns.sourceHash, sourceHash),
        isNotNull(npImportRuns.resumeState),
      ),
    )
    .orderBy(desc(npImportRuns.createdAt))
    .limit(1);
  if (!row) return null;

  const state = fromImportRunResumeState(
    row.resumeState,
    resumeSourceLabel(sourceName, sourceHash),
  );
  return state ? { runId: row.runId, state } : null;
}

function createDbResumeDeps(runId: string, state: ResumeState): ResumeDeps {
  const db = getDb();
  return {
    state,
    persist: async () => {
      state.updatedAt = new Date().toISOString();
      await db
        .update(npImportRuns)
        .set({
          resumeState: toImportRunResumeState(state),
          updatedAt: new Date(),
        })
        .where(eq(npImportRuns.id, runId));
    },
  };
}

function createAdminReportHtmlDeps(samples: WpImportAdminConversionSample[]): ReportHtmlDeps {
  return {
    emit: (sample) => {
      if (samples.length >= MAX_CONVERSION_SAMPLES) return;
      samples.push(serializeConversionSample(sample));
    },
  };
}

function serializeConversionSample(sample: {
  wpId: number;
  wpType: string;
  slug: string;
  title: string;
  rawContent: string;
  lexical: LexicalRoot;
}): WpImportAdminConversionSample {
  const rawHtml = truncateText(sample.rawContent, MAX_CONVERSION_SAMPLE_CHARS);
  const lexicalJson = truncateText(
    JSON.stringify(sample.lexical, null, 2),
    MAX_CONVERSION_SAMPLE_CHARS,
  );
  return {
    wpId: sample.wpId,
    wpType: sample.wpType,
    slug: sample.slug,
    title: sample.title,
    rawHtml: rawHtml.value,
    lexicalJson: lexicalJson.value,
    truncated: rawHtml.truncated || lexicalJson.truncated,
  };
}

function toImportRunResumeState(state: ResumeState | null): NpImportRunResumeState | null {
  if (!state) return null;
  return {
    version: 1,
    source: state.source,
    startedAt: state.startedAt,
    updatedAt: state.updatedAt,
    documents: state.documents,
    comments: Object.fromEntries(
      Object.entries(state.comments).map(([key, value]) => [String(key), value]),
    ),
    authors: state.authors,
    media: state.media,
    taxonomies: state.taxonomies,
  };
}

function fromImportRunResumeState(value: unknown, fallbackSource: string): ResumeState | null {
  if (!isRecord(value) || value.version !== 1) return null;
  const now = new Date().toISOString();
  return {
    version: 1,
    source: typeof value.source === "string" ? value.source : fallbackSource,
    startedAt: typeof value.startedAt === "string" ? value.startedAt : now,
    updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : now,
    documents: asStringMap(value.documents),
    comments: asNumberKeyMap(value.comments),
    authors: asStringMap(value.authors),
    media: asStringMap(value.media),
    taxonomies: asStringMap(value.taxonomies),
  };
}

function summarizeResumeState(
  enabled: boolean,
  sourceHash: string | null,
  state: ResumeState | null,
): WpImportAdminResumeSummary {
  return {
    enabled,
    sourceHash: enabled ? sourceHash : null,
    source: enabled ? (state?.source ?? null) : null,
    documents: enabled ? Object.keys(state?.documents ?? {}).length : 0,
    comments: enabled ? Object.keys(state?.comments ?? {}).length : 0,
    authors: enabled ? Object.keys(state?.authors ?? {}).length : 0,
    media: enabled ? Object.keys(state?.media ?? {}).length : 0,
    taxonomies: enabled ? Object.keys(state?.taxonomies ?? {}).length : 0,
  };
}

function resumeSourceLabel(sourceName: string, sourceHash: string): string {
  return `${sourceName}#${sourceHash.slice(0, 12)}`;
}

function truncateText(value: string, limit: number): { value: string; truncated: boolean } {
  if (value.length <= limit) return { value, truncated: false };
  return { value: `${value.slice(0, limit)}\n... truncated ...`, truncated: true };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asStringMap(value: unknown): Record<string, string> {
  if (!isRecord(value)) return {};
  const out: Record<string, string> = {};
  for (const [key, item] of Object.entries(value)) {
    if (typeof item === "string") out[key] = item;
  }
  return out;
}

function asNumberKeyMap(value: unknown): Record<number, string> {
  if (!isRecord(value)) return {};
  const out: Record<number, string> = {};
  for (const [key, item] of Object.entries(value)) {
    const parsed = Number.parseInt(key, 10);
    if (Number.isFinite(parsed) && typeof item === "string") out[parsed] = item;
  }
  return out;
}

function createMediaDeps(actorId: string) {
  return {
    upload: async (file: { buffer: Buffer; originalFilename: string; mimeType: string }) => {
      const result = await uploadMedia(
        {
          buffer: file.buffer,
          originalFilename: file.originalFilename,
          mimeType: file.mimeType,
        },
        actorId,
      );
      return { id: result.id };
    },
    findExistingByHash: async (sha256: string) => {
      const db = getDb();
      const [hit] = await db
        .select({ id: npMedia.id })
        .from(npMedia)
        .where(and(eq(npMedia.hash, sha256), isNull(npMedia.deletedAt)))
        .limit(1);
      return hit ? { id: hit.id } : null;
    },
  };
}

function createTaxonomyDeps(actor: NpAuthUser) {
  return {
    findOrCreate: async ({
      taxonomy,
      slug,
      name,
    }: {
      taxonomy: string;
      slug: string;
      name: string;
    }) => {
      const collectionSlug =
        taxonomy === "category" ? "categories" : taxonomy === "post_tag" ? "tags" : null;
      if (!collectionSlug) return null;

      const existing = await findDocuments(collectionSlug, { where: { slug }, limit: 1 }, actor);
      const hit = existing.docs[0];
      const hitId = typeof hit?.id === "string" ? hit.id : null;
      if (hitId) return { id: hitId };

      const created = await saveDocument(collectionSlug, null, { name, slug }, actor, {
        status: "published",
      });
      const createdId = typeof created.doc.id === "string" ? created.doc.id : null;
      if (!createdId) {
        throw new Error(`${collectionSlug} create returned no id`);
      }
      return { id: createdId };
    },
  };
}

function createCommentDeps() {
  return {
    ensureImportedMember: async ({
      handle,
      email,
      displayName,
    }: {
      handle: string;
      email: string | null;
      displayName: string;
    }) => {
      const db = getDb();
      const canonicalHandle = handle.trim().toLowerCase();
      if (!npIsCanonicalMemberHandle(canonicalHandle)) {
        throw new NpValidationError("Invalid imported member", [
          { field: "handle", message: "Imported member handle violates the auth contract" },
        ]);
      }
      const [existing] = await db
        .select({ id: npMembers.id })
        .from(npMembers)
        .where(eq(npMembers.handle, canonicalHandle))
        .limit(1);
      if (existing) return { id: existing.id };

      const normalizedEmail = email?.trim().toLowerCase() ?? null;
      const safeEmail =
        normalizedEmail &&
        npIsCanonicalAuthEmail(normalizedEmail) &&
        (await isMemberEmailFree(normalizedEmail))
          ? normalizedEmail
          : `${canonicalHandle}@imported.invalid`;
      const normalizedDisplayName =
        displayName.trim().slice(0, npAuthContractLimits.displayNameLength) || canonicalHandle;
      const [inserted] = await db
        .insert(npMembers)
        .values({
          handle: canonicalHandle,
          email: safeEmail,
          displayName: normalizedDisplayName,
          status: "imported",
          emailVerified: false,
        })
        .returning({ id: npMembers.id });
      if (!inserted) throw new Error("imported member insert returned no row");
      return { id: inserted.id };
    },
    insertComment: async ({
      targetType,
      targetId,
      parentId,
      memberId,
      bodyMd,
      bodyHtml,
      createdAt,
    }: {
      targetType: string;
      targetId: string;
      parentId: string | null;
      memberId: string;
      bodyMd: string;
      bodyHtml: string;
      createdAt: Date;
    }) => {
      const db = getDb();
      const [row] = await db
        .insert(npComments)
        .values({
          targetType,
          targetId,
          parentId,
          memberId,
          bodyMd,
          bodyHtml,
          status: "visible",
          createdAt,
        })
        .returning({ id: npComments.id });
      if (!row) throw new Error("comment insert returned no row");
      return { id: row.id };
    },
    renderBody: (source: string) => renderCommentMarkdown(source),
  };
}

function createAuthorDeps() {
  return {
    resolveAuthor: async ({
      wpAuthorLogin,
      wpAuthor,
    }: {
      wpAuthorLogin: string;
      wpAuthor: { email?: string; displayName?: string } | undefined;
    }) => {
      const db = getDb();
      const local =
        wpAuthorLogin
          .trim()
          .toLowerCase()
          .replace(/[^a-z0-9._+-]+/gu, "-")
          .replace(/^-+|-+$/gu, "")
          .slice(0, 64) || "wp-author";
      const importedEmail = wpAuthor?.email
        ? flagImportedEmail(wpAuthor.email)
        : `${local}@wp-import.invalid`;
      const email = npIsCanonicalAuthEmail(importedEmail)
        ? importedEmail
        : `${local}@wp-import.invalid`;
      const [existing] = await db
        .select({ id: npUsers.id })
        .from(npUsers)
        .where(eq(npUsers.email, email))
        .limit(1);
      if (existing) return { id: existing.id };

      const password = await hashPassword(
        `wp-import-${wpAuthorLogin}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
      );
      const name =
        (wpAuthor?.displayName || wpAuthorLogin).trim().slice(0, npAuthContractLimits.nameLength) ||
        local;
      const [inserted] = await db
        .insert(npUsers)
        .values({
          email,
          password,
          name,
          role: "viewer",
        })
        .returning({ id: npUsers.id });
      if (!inserted) throw new Error("staff user insert returned no row");
      return { id: inserted.id };
    },
  };
}

function summarizeBundle(bundle: WpImportBundle): WpImportAdminCounts {
  const comments = bundle.records.reduce((sum, record) => sum + record.comments.length, 0);
  const inlineMediaRefs = bundle.records.reduce(
    (sum, record) => sum + record.mediaRefs.filter((ref) => ref.kind === "inline").length,
    0,
  );
  const featuredImages = bundle.records.reduce(
    (sum, record) => sum + record.mediaRefs.filter((ref) => ref.kind === "featured").length,
    0,
  );

  return {
    records: bundle.records.length,
    authors: bundle.authors.length,
    terms: bundle.terms.length,
    comments,
    inlineMediaRefs,
    featuredImages,
    recordsByType: countBy(bundle.records, (record) => record.wpType),
    termsByTaxonomy: countBy(bundle.terms, (term) => term.taxonomy),
    statuses: countBy(bundle.records, (record) => record.status),
  };
}

function summarizeMappings(
  bundle: WpImportBundle,
  collectionMappings: Record<string, CollectionMapping>,
): WpImportAdminMappingSummary {
  const recordsByType = countBy(bundle.records, (record) => record.wpType);
  const configured = Object.entries(collectionMappings)
    .map(([wpType, mapping]) => ({
      wpType,
      collection: mapping.collection,
      fieldOverrides: mapping.fieldOverrides ?? {},
      records: recordsByType[wpType] ?? 0,
    }))
    .sort((a, b) => a.wpType.localeCompare(b.wpType));
  const unmapped = Object.entries(recordsByType)
    .filter(([wpType]) => {
      if (wpType === "attachment") return false;
      if (BUILTIN_WP_TYPE_COLLECTIONS[wpType]) return false;
      return !collectionMappings[wpType];
    })
    .map(([wpType, records]) => ({ wpType, records }))
    .sort((a, b) => a.wpType.localeCompare(b.wpType));

  return {
    configured: list(configured),
    unmapped: list(unmapped),
  };
}

function serializeReport(
  report: ApplyReport,
  logs: string[],
  conversionSamples: WpImportAdminConversionSample[],
): WpImportAdminReport {
  return {
    applied: list(report.applied),
    skipped: list(report.skipped),
    errors: list(report.errors),
    notes: list(report.notes),
    logs: tailList(logs, MAX_LOG_LINES),
    conversionSamples: list(conversionSamples, MAX_CONVERSION_SAMPLES),
    attachments: serializeAttachments(report.attachments),
    media: serializeMedia(report.media),
    taxonomies: serializeTaxonomies(report.taxonomies),
    comments: serializeComments(report.comments),
    authors: serializeAuthors(report.authors),
  };
}

function serializeAttachments(attachments: AttachmentIndex): WpImportAdminReport["attachments"] {
  return {
    byId: attachments.byId.size,
    byUrl: attachments.byUrl.size,
  };
}

function serializeMedia(media: MediaPipelineReport | null): WpImportAdminReport["media"] {
  if (!media) {
    return {
      status: "not-run",
      uploaded: 0,
      reused: 0,
      skipped: 0,
      resolvedUrls: 0,
      resolvedAttachments: 0,
      errors: list([]),
    };
  }

  return {
    status: "completed",
    uploaded: media.uploaded,
    reused: media.reused,
    skipped: media.skipped,
    resolvedUrls: media.resolution.byUrl.size,
    resolvedAttachments: media.resolution.byAttachmentId.size,
    errors: list(media.errors),
  };
}

function serializeTaxonomies(
  taxonomies: TaxonomyResolution | null,
): WpImportAdminReport["taxonomies"] {
  if (!taxonomies) {
    return {
      status: "not-run",
      resolved: 0,
      skipped: list([]),
      errors: list([]),
    };
  }

  return {
    status: "completed",
    resolved: taxonomies.termIds.size,
    skipped: list(taxonomies.skipped),
    errors: list(taxonomies.errors),
  };
}

function serializeComments(comments: CommentImportPlan | null): WpImportAdminReport["comments"] {
  if (!comments) {
    return {
      status: "not-run",
      applied: 0,
      skippedUnapproved: 0,
      skippedNoMember: 0,
      skippedByResume: 0,
      errors: list([]),
    };
  }

  return {
    status: "completed",
    applied: comments.applied,
    skippedUnapproved: comments.skippedUnapproved,
    skippedNoMember: comments.skippedNoMember,
    skippedByResume: comments.skippedByResume,
    errors: list(comments.errors),
  };
}

function serializeAuthors(authors: AuthorResolution | null): WpImportAdminReport["authors"] {
  if (!authors) {
    return {
      status: "not-run",
      resolved: 0,
      skipped: list([]),
      errors: list([]),
    };
  }

  return {
    status: "completed",
    resolved: authors.authorIds.size,
    skipped: list(authors.skipped),
    errors: list(authors.errors),
  };
}

function list<T>(items: T[], limit = MAX_LIST_ITEMS): WpImportAdminList<T> {
  return {
    total: items.length,
    items: items.slice(0, limit),
    truncated: items.length > limit,
  };
}

function tailList<T>(items: T[], limit: number): WpImportAdminList<T> {
  return {
    total: items.length,
    items: items.slice(-limit),
    truncated: items.length > limit,
  };
}

function countBy<T>(rows: T[], keyOf: (row: T) => string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const row of rows) {
    const key = keyOf(row);
    out[key] = (out[key] ?? 0) + 1;
  }
  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => a.localeCompare(b)));
}

function flagImportedEmail(original: string): string {
  const normalized = original.trim().toLowerCase();
  const at = normalized.indexOf("@");
  if (at < 0) return `${normalized}+wp-import@wp-import.invalid`;
  const local = normalized.slice(0, at);
  const domain = normalized.slice(at + 1);
  return `${local}+wp-import@${domain}`;
}

async function isMemberEmailFree(email: string): Promise<boolean> {
  const db = getDb();
  const [hit] = await db
    .select({ id: npMembers.id })
    .from(npMembers)
    .where(eq(npMembers.email, email))
    .limit(1);
  return !hit;
}
