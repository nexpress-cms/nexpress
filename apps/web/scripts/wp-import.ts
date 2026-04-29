import { eq } from "drizzle-orm";

import {
  type NxAuthUser,
  createDbConnection,
  findDocuments,
  getDb,
  nxComments,
  nxMembers,
  nxUsers,
  renderCommentMarkdown,
  saveDocument,
  uploadMedia,
} from "@nexpress/core";
import { applyBundle, runCli } from "@nexpress/wp-import";

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
  applyBundle: async (bundle, ctx) =>
    applyBundle(bundle, {
      actor: ctx.actor,
      dryRun: ctx.dryRun,
      log: ctx.log,
      media: {
        upload: async (file) => {
          const result = await uploadMedia(
            { buffer: file.buffer, originalFilename: file.originalFilename, mimeType: file.mimeType },
            ctx.actor.id,
          );
          return { id: result.id };
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
    }),
  resolveActor: async () => {
    const actor = await findFirstAdmin();
    if (!actor) {
      throw new Error("No admin user found in nx_users. Run `pnpm seed:admin` once and retry.");
    }
    return actor;
  },
});
process.exit(code);

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
