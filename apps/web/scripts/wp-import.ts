import { closeSync, openSync, writeSync } from "node:fs";

import { and, eq, isNull } from "drizzle-orm";

import {
  type NxAuthUser,
  createDbConnection,
  findDocuments,
  getDb,
  hashPassword,
  nxComments,
  nxMedia,
  nxMembers,
  nxUsers,
  recordAuditEvent,
  renderCommentMarkdown,
  saveDocument,
  uploadMedia,
} from "@nexpress/core";
import {
  applyBundle,
  loadResumeState,
  persistResumeState,
  type ReportHtmlDeps,
  type ResumeDeps,
  runCli,
} from "@nexpress/wp-import";

import { ensureCoreServices, ensurePluginsLoaded } from "../src/lib/init-core";

/**
 * Phase 21.4 — `pnpm wp-import` shim. The CLI logic lives in
 * `@nexpress/wp-import`; this file's only job is to bootstrap the
 * framework's core services + plug the apply hooks back into the
 * CLI so it can write to the DB.
 *
 * Phase 21.5 — also plug in the media deps so the importer can
 * download + upload assets through the framework's media service
 * (Sharp pipeline, storage adapter, audit refs all run as normal).
 *
 * Phase 21.6 — wire the taxonomy resolver against the reference
 * app's `taxonomies` collection. User projects with their own
 * taxonomy storage swap this hook out (or skip it entirely; the
 * importer drops terms with a single notes line).
 *
 * Phase 21.7 — wire the comments deps. Imported members land
 * directly in `nx_members` with status="imported"; comments land
 * in `nx_comments` via the framework's DB handle. We bypass
 * `createComment` because that path runs spam/profanity adapters
 * and fans out notifications — neither is appropriate for
 * archived content.
 *
 * Phase 21.8 — wire the authors resolver. Default behavior creates
 * a NexPress staff user with `role: "viewer"` for each WP author,
 * tagged with a flagged email so the operator can promote them
 * after the import. The CLI flag `--no-create-authors` swaps in a
 * resolver that always returns null so posts come in without an
 * author and are credited to the import operator.
 *
 * Phase 21.12 — wire the new operator-control flags:
 *   --strict       escalate sub-pipeline warnings to fatal errors
 *   --update       rewrite slug-collisions instead of skipping
 *   --report-html  emit a side-by-side HTML/Lexical diff next to
 *                  the WXR for spot-checking conversions
 *
 * For dry-run-summary mode (the default with no flags) the shim
 * doesn't strictly need the bootstrap — but doing it
 * unconditionally keeps the script's behavior predictable and
 * matches the seed scripts in the same directory.
 */

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("wp-import: DATABASE_URL is not set");
  process.exit(2);
}

ensureCoreServices();
await ensurePluginsLoaded();

const code = await runCli(process.argv.slice(2), undefined, {
  applyBundle: async (bundle, ctx) => {
    const reportHtml = ctx.reportHtmlPath ? openReportFile(ctx.reportHtmlPath) : null;
    const resume: ResumeDeps | undefined = ctx.resumeStatePath
      ? (() => {
          const path = ctx.resumeStatePath;
          if (!path) return undefined;
          const state = loadResumeState(path, path);
          return {
            state,
            persist: () => persistResumeState(path, state),
          };
        })()
      : undefined;
    try {
      return await applyBundle(bundle, {
        actor: ctx.actor,
        dryRun: ctx.dryRun,
        log: ctx.log,
        strict: ctx.strict,
        update: ctx.update,
        reportHtml: reportHtml?.deps,
        resume,
      media: {
        upload: async (file) => {
          const result = await uploadMedia(
            { buffer: file.buffer, originalFilename: file.originalFilename, mimeType: file.mimeType },
            ctx.actor.id,
          );
          return { id: result.id };
        },
        // Phase 21.13 — cross-run dedup. The framework's media
        // service computes the SHA-256 on insert, so a second
        // import of the same WXR finds the existing row and
        // skips both download + upload. `deletedAt IS NULL` keeps
        // soft-deleted media from being silently revived.
        findExistingByHash: async (sha256) => {
          const db = getDb();
          const [hit] = await db
            .select({ id: nxMedia.id })
            .from(nxMedia)
            .where(and(eq(nxMedia.hash, sha256), isNull(nxMedia.deletedAt)))
            .limit(1);
          return hit ? { id: hit.id } : null;
        },
      },
      taxonomies: {
        findOrCreate: async ({ taxonomy, slug, name }) => {
          // Look up by slug first (the slugField is unique on the
          // taxonomies collection). If a row already exists with a
          // different `taxonomy` field we bail rather than collide;
          // this is rare in practice — slugs are taxonomy-scoped on
          // a real WP site — but the warning is more useful than a
          // silent stomp.
          const existing = await findDocuments(
            "taxonomies",
            { where: { slug }, limit: 1 },
            ctx.actor,
          );
          const hit = existing.docs[0];
          if (hit) {
            const id = typeof hit.id === "string" ? hit.id : null;
            if (id) {
              if (hit.taxonomy !== taxonomy) {
                throw new Error(
                  `slug "${slug}" already maps to taxonomy "${String(hit.taxonomy)}", not "${taxonomy}"`,
                );
              }
              return { id };
            }
          }
          const created = await saveDocument(
            "taxonomies",
            null,
            { name, slug, taxonomy },
            ctx.actor,
            { status: "published" },
          );
          const createdId =
            typeof created.doc.id === "string" ? created.doc.id : null;
          if (!createdId) throw new Error("taxonomies create returned no id");
          return { id: createdId };
        },
      },
      comments: {
        ensureImportedMember: async ({ handle, email, displayName }) => {
          const db = getDb();
          const [existing] = await db
            .select({ id: nxMembers.id })
            .from(nxMembers)
            .where(eq(nxMembers.handle, handle))
            .limit(1);
          if (existing) return { id: existing.id };
          // No password, no verified email — `imported` status
          // already blocks login. Email collisions are rare for
          // imported guests but possible if a live member already
          // owns the address; in that case fall through with a
          // synthetic placeholder so the unique index on
          // nx_members.email doesn't reject the insert.
          const safeEmail = email && (await isEmailFree(email)) ? email : `${handle}@imported.invalid`;
          const [inserted] = await db
            .insert(nxMembers)
            .values({
              handle,
              email: safeEmail,
              displayName,
              status: "imported",
              emailVerified: false,
            })
            .returning({ id: nxMembers.id });
          if (!inserted) throw new Error("imported member insert returned no row");
          return { id: inserted.id };
        },
        insertComment: async ({ targetType, targetId, parentId, memberId, bodyMd, bodyHtml, createdAt }) => {
          const db = getDb();
          const [row] = await db
            .insert(nxComments)
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
            .returning({ id: nxComments.id });
          if (!row) throw new Error("comment insert returned no row");
          return { id: row.id };
        },
        renderBody: (source) => renderCommentMarkdown(source),
      },
      collectionMappings: ctx.collectionMappings,
      preserveOriginalAuthor: { posts: "wpOriginalAuthor" },
      audit: {
        record: ({ action, targetType, targetId, payload }) =>
          recordAuditEvent({
            actor: { kind: "staff", userId: ctx.actor.id },
            action,
            targetType,
            targetId,
            payload,
          }),
      },
      authors: ctx.createAuthors
        ? {
            resolveAuthor: async ({ wpAuthorLogin, wpAuthor }) => {
              const db = getDb();
              const email = wpAuthor?.email
                ? flagImportedEmail(wpAuthor.email)
                : `${wpAuthorLogin}@wp-import.invalid`;
              const [existing] = await db
                .select({ id: nxUsers.id })
                .from(nxUsers)
                .where(eq(nxUsers.email, email))
                .limit(1);
              if (existing) return { id: existing.id };
              const password = await hashPassword(
                `wp-import-${wpAuthorLogin}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
              );
              const [inserted] = await db
                .insert(nxUsers)
                .values({
                  email,
                  password,
                  name: wpAuthor?.displayName || wpAuthorLogin,
                  role: "viewer",
                })
                .returning({ id: nxUsers.id });
              if (!inserted) throw new Error("staff user insert returned no row");
              return { id: inserted.id };
            },
          }
        : { resolveAuthor: () => Promise.resolve(null) },
      });
    } finally {
      reportHtml?.close();
    }
  },
  resolveActor: async () => {
    const actor = await findFirstAdmin();
    if (!actor) {
      throw new Error("No admin user found in nx_users. Run `pnpm seed:admin` once and retry.");
    }
    return actor;
  },
});
process.exit(code);

/**
 * Phase 21.12 — open a report file at `path` and return a
 * ReportHtmlDeps that emits one `<section>` per imported record,
 * plus a close handle the shim calls when the apply pass
 * finishes (success OR failure — wrap in try/finally so a thrown
 * error still flushes the trailing `</body>`). The file is
 * truncated on open, so re-running the importer overwrites the
 * previous artifact.
 */
function openReportFile(path: string): { deps: ReportHtmlDeps; close: () => void } {
  const fd = openSync(path, "w");
  writeSync(
    fd,
    `<!doctype html><html><head><meta charset="utf-8"><title>wp-import HTML/Lexical diff</title>` +
      `<style>body{font-family:system-ui,sans-serif;margin:2rem;max-width:1200px}` +
      `section{margin-bottom:3rem;border-bottom:1px solid #e2e8f0;padding-bottom:2rem}` +
      `h2{font-size:1.1rem;margin-bottom:0.5rem}` +
      `.cols{display:grid;grid-template-columns:1fr 1fr;gap:1rem}` +
      `.col{border:1px solid #cbd5e1;border-radius:6px;padding:1rem;background:#f8fafc}` +
      `.col h3{margin:0 0 0.5rem;font-size:0.85rem;color:#64748b;text-transform:uppercase}` +
      `pre{background:#0f172a;color:#e2e8f0;padding:0.75rem;border-radius:4px;overflow:auto;font-size:0.8rem}` +
      `</style></head><body>`,
  );
  const deps: ReportHtmlDeps = {
    emit: ({ wpId, wpType, slug, title, rawContent, lexical }) => {
      const safeTitle = String(title).replace(/[<>&]/g, (c) =>
        c === "<" ? "&lt;" : c === ">" ? "&gt;" : "&amp;",
      );
      const escapedJson = JSON.stringify(lexical, null, 2)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
      writeSync(
        fd,
        `<section><h2>[${wpType}#${wpId}] ${safeTitle} — ${slug}</h2>` +
          `<div class="cols">` +
          `<div class="col"><h3>WP source HTML</h3><div>${rawContent}</div></div>` +
          `<div class="col"><h3>Lexical AST</h3><pre>${escapedJson}</pre></div>` +
          `</div></section>`,
      );
    },
  };
  return {
    deps,
    close: () => {
      writeSync(fd, `</body></html>`);
      closeSync(fd);
    },
  };
}

/**
 * Phase 21.8 — flag the WP author's email so the imported staff
 * row can't accidentally be confused with a live account. We
 * splice `+wp-import` into the local part: that's RFC-5321
 * sub-addressing which most providers route to the same inbox,
 * but the addresses are distinct enough that the operator can
 * filter / clean up later.
 */
function flagImportedEmail(original: string): string {
  const at = original.indexOf("@");
  if (at < 0) return `${original}+wp-import@wp-import.invalid`;
  const local = original.slice(0, at);
  const domain = original.slice(at + 1);
  return `${local}+wp-import@${domain}`;
}

async function isEmailFree(email: string): Promise<boolean> {
  const db = getDb();
  const [hit] = await db
    .select({ id: nxMembers.id })
    .from(nxMembers)
    .where(eq(nxMembers.email, email))
    .limit(1);
  return !hit;
}

async function findFirstAdmin(): Promise<NxAuthUser | null> {
  const db = createDbConnection({ connectionString: databaseUrl! });
  const rows = await db
    .select({
      id: nxUsers.id,
      email: nxUsers.email,
      name: nxUsers.name,
      role: nxUsers.role,
      tokenVersion: nxUsers.tokenVersion,
    })
    .from(nxUsers)
    .where(eq(nxUsers.role, "admin"))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role as NxAuthUser["role"],
    tokenVersion: row.tokenVersion,
  };
}
