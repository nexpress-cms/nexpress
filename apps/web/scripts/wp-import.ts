import { eq } from "drizzle-orm";

import { type NxAuthUser, createDbConnection, nxUsers, uploadMedia } from "@nexpress/core";
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
