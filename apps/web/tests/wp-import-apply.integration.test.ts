import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  closeTestDb,
  ensureMigrated,
  getTestDb,
  registerTestCollections,
  seedUser,
  skipIfNoTestDb,
  truncateAll,
} from "./harness.js";

import { type NxAuthUser, findDocuments, nxUsers } from "@nexpress/core";
import { eq } from "drizzle-orm";
import { applyBundle, parseWxr } from "@nexpress/wp-import";

const FIXTURE = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../packages/wp-import/tests/fixtures/minimal.wxr.xml",
);

async function asActor(session: { userId: string; email: string; role: NxAuthUser["role"] }) {
  // saveDocument needs an NxAuthUser; reconstruct one from the seeded
  // session (the harness only returns the JWT-facing slice).
  const db = await getTestDb();
  const rows = await db
    .select({ name: nxUsers.name, tokenVersion: nxUsers.tokenVersion })
    .from(nxUsers)
    .where(eq(nxUsers.id, session.userId));
  const row = rows[0];
  if (!row) throw new Error("seed user missing");
  return {
    id: session.userId,
    email: session.email,
    name: row.name,
    role: session.role,
    tokenVersion: row.tokenVersion,
  } satisfies NxAuthUser;
}

describe.skipIf(skipIfNoTestDb())("wp-import applyBundle (Phase 21.4 integration)", () => {
  beforeAll(async () => {
    await ensureMigrated();
    registerTestCollections();
  });
  beforeEach(async () => {
    await truncateAll();
  });
  afterAll(async () => {
    await closeTestDb();
  });

  it("writes one post + one page from the minimal fixture", async () => {
    const xml = readFileSync(FIXTURE, "utf8");
    const bundle = parseWxr(xml);
    const session = await seedUser({ email: "wp-applier@example.com", role: "admin" });
    const actor = await asActor(session);

    const report = await applyBundle(bundle, { actor, dryRun: false });

    expect(report.errors).toEqual([]);
    const slugs = report.applied.map((r) => `${r.collection}/${r.slug}`).sort();
    expect(slugs).toEqual(["pages/about", "posts/hello-world"]);

    // Attachment record skipped with the right reason.
    const skippedReasons = report.skipped.map((s) => s.reason);
    expect(skippedReasons).toContain("attachment — handled by 21.5 media pipeline");

    // Verify the actual rows landed.
    const posts = await findDocuments("posts", { where: { slug: "hello-world" }, limit: 1 }, actor);
    expect(posts.docs).toHaveLength(1);
    expect(posts.docs[0]?.title).toBe("Hello World");
    // `status` (lifecycle) is the field set by `options.status`. Posts also
    // carry `_status` (workflow draft/published) which defaults to draft and
    // flips on a separate publish action — not what the importer touches.
    expect(posts.docs[0]?.status).toBe("published");

    const pages = await findDocuments("pages", { where: { slug: "about" }, limit: 1 }, actor);
    expect(pages.docs).toHaveLength(1);
    expect(pages.docs[0]?.title).toBe("About");
  });

  it("converts <p>/<img> in rawContent to a Lexical AST stored on the post", async () => {
    const xml = readFileSync(FIXTURE, "utf8");
    const bundle = parseWxr(xml);
    const session = await seedUser({ email: "wp-content@example.com", role: "admin" });
    const actor = await asActor(session);

    await applyBundle(bundle, { actor, dryRun: false });

    const posts = await findDocuments("posts", { where: { slug: "hello-world" }, limit: 1 }, actor);
    const content = posts.docs[0]?.content as { root: { children: Array<{ type: string }> } };
    expect(content?.root?.type).toBe("root");
    // Paragraph wrapping the inline content + img survives.
    const types = content.root.children.map((c) => c.type);
    expect(types[0]).toBe("paragraph");
  });

  it("is idempotent on slug — re-running skips already-imported records", async () => {
    const xml = readFileSync(FIXTURE, "utf8");
    const bundle = parseWxr(xml);
    const session = await seedUser({ email: "wp-idempotent@example.com", role: "admin" });
    const actor = await asActor(session);

    const first = await applyBundle(bundle, { actor, dryRun: false });
    expect(first.applied).toHaveLength(2);
    expect(first.skipped.filter((s) => s.reason === "slug already exists")).toHaveLength(0);

    const second = await applyBundle(bundle, { actor, dryRun: false });
    expect(second.applied).toHaveLength(0);
    expect(second.skipped.filter((s) => s.reason === "slug already exists")).toHaveLength(2);
    expect(second.errors).toEqual([]);
  });

  it("dry-run mode reports what would happen without writing", async () => {
    const xml = readFileSync(FIXTURE, "utf8");
    const bundle = parseWxr(xml);
    const session = await seedUser({ email: "wp-dry@example.com", role: "admin" });
    const actor = await asActor(session);

    const report = await applyBundle(bundle, { actor, dryRun: true });
    expect(report.applied.map((r) => r.slug).sort()).toEqual(["about", "hello-world"]);

    // Nothing should have actually been written.
    const posts = await findDocuments("posts", { where: { slug: "hello-world" }, limit: 1 }, actor);
    expect(posts.docs).toHaveLength(0);
  });

  it("builds the attachment index from the bundle", async () => {
    const xml = readFileSync(FIXTURE, "utf8");
    const bundle = parseWxr(xml);
    const session = await seedUser({ email: "wp-att@example.com", role: "admin" });
    const actor = await asActor(session);

    const report = await applyBundle(bundle, { actor, dryRun: true });
    expect(report.attachments.byId.get(42)?.sourceUrl).toBe(
      "https://acme.example.com/wp-content/uploads/2025/04/hero.jpg",
    );
  });

  it("surfaces a notes line when records had original WP authors", async () => {
    const xml = readFileSync(FIXTURE, "utf8");
    const bundle = parseWxr(xml);
    const session = await seedUser({ email: "wp-notes@example.com", role: "admin" });
    const actor = await asActor(session);

    const report = await applyBundle(bundle, { actor, dryRun: true });
    expect(report.notes.some((n) => n.includes("Phase 21.8"))).toBe(true);
  });
});
