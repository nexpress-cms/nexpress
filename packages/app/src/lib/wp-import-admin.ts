import {
  NpValidationError,
  findDocuments,
  getDb,
  hashPassword,
  npComments,
  npMedia,
  npMembers,
  npUsers,
  recordAuditEvent,
  renderCommentMarkdown,
  saveDocument,
  uploadMedia,
  type NpAuthUser,
} from "@nexpress/core";
import {
  applyBundle,
  parseWxr,
  type AppliedRow,
  type ApplyReport,
  type AttachmentIndex,
  type AuthorResolution,
  type CommentImportPlan,
  type MediaPipelineReport,
  type SkippedRow,
  type TaxonomyResolution,
  type WpImportBundle,
} from "@nexpress/wp-import";
import { and, eq, isNull } from "drizzle-orm";

const MAX_LIST_ITEMS = 250;
const MAX_LOG_LINES = 200;

export type WpImportAdminMode = "preview" | "apply";

export interface WpImportAdminOptions {
  mode: WpImportAdminMode;
  sourceName: string;
  update: boolean;
  strict: boolean;
  createAuthors: boolean;
  includeMedia: boolean;
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
  };
  counts: WpImportAdminCounts;
  report: WpImportAdminReport;
}

export async function runWordPressAdminImport(args: {
  xml: string;
  actor: NpAuthUser;
  options: WpImportAdminOptions;
}): Promise<WpImportAdminResponse> {
  const { actor, options } = args;
  const bundle = parseWxrForAdmin(args.xml);
  const dryRun = options.mode === "preview";
  const logs: string[] = [];

  const report = await applyBundle(bundle, {
    actor,
    dryRun,
    strict: options.strict,
    update: options.update,
    log: (line) => {
      logs.push(line);
    },
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
    },
    counts: summarizeBundle(bundle),
    report: serializeReport(report, logs),
  };
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
      const [existing] = await db
        .select({ id: npMembers.id })
        .from(npMembers)
        .where(eq(npMembers.handle, handle))
        .limit(1);
      if (existing) return { id: existing.id };

      const safeEmail =
        email && (await isMemberEmailFree(email)) ? email : `${handle}@imported.invalid`;
      const [inserted] = await db
        .insert(npMembers)
        .values({
          handle,
          email: safeEmail,
          displayName,
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
      const email = wpAuthor?.email
        ? flagImportedEmail(wpAuthor.email)
        : `${wpAuthorLogin}@wp-import.invalid`;
      const [existing] = await db
        .select({ id: npUsers.id })
        .from(npUsers)
        .where(eq(npUsers.email, email))
        .limit(1);
      if (existing) return { id: existing.id };

      const password = await hashPassword(
        `wp-import-${wpAuthorLogin}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
      );
      const [inserted] = await db
        .insert(npUsers)
        .values({
          email,
          password,
          name: wpAuthor?.displayName || wpAuthorLogin,
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

function serializeReport(report: ApplyReport, logs: string[]): WpImportAdminReport {
  return {
    applied: list(report.applied),
    skipped: list(report.skipped),
    errors: list(report.errors),
    notes: list(report.notes),
    logs: tailList(logs, MAX_LOG_LINES),
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
  const at = original.indexOf("@");
  if (at < 0) return `${original}+wp-import@wp-import.invalid`;
  const local = original.slice(0, at);
  const domain = original.slice(at + 1);
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
