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

import { type NxAuthUser, findDocuments, nxMedia, nxUsers, uploadMedia } from "@nexpress/core";
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
    expect(skippedReasons).toContain("attachment — handled by media pipeline");

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

  it("21.5 — runs the media pipeline, wires coverImage, and rewrites Lexical img mediaId", async () => {
    const xml = readFileSync(FIXTURE, "utf8");
    const bundle = parseWxr(xml);
    const session = await seedUser({ email: "wp-media@example.com", role: "admin" });
    const actor = await asActor(session);

    const tinyJpeg = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
    const downloaded: string[] = [];

    const report = await applyBundle(bundle, {
      actor,
      dryRun: false,
      media: {
        download: async (url) => {
          downloaded.push(url);
          return { buffer: tinyJpeg, mimeType: "image/jpeg", filename: "hero.jpg" };
        },
        upload: async (file) => {
          const result = await uploadMedia(
            { buffer: file.buffer, originalFilename: file.originalFilename, mimeType: file.mimeType },
            actor.id,
          );
          return { id: result.id };
        },
      },
    });

    expect(report.errors).toEqual([]);
    expect(report.media?.uploaded).toBe(1);
    expect(downloaded).toHaveLength(1);

    const heroUrl = "https://acme.example.com/wp-content/uploads/2025/04/hero.jpg";
    const mediaId = report.media?.resolution.byUrl.get(heroUrl);
    expect(mediaId).toBeTruthy();
    expect(report.media?.resolution.byAttachmentId.get(42)).toBe(mediaId);

    // Hello World post: coverImage on the doc, mediaId stamped on the
    // inline `<img>` Lexical node.
    const posts = await findDocuments("posts", { where: { slug: "hello-world" }, limit: 1 }, actor);
    const post = posts.docs[0]!;
    expect(post.coverImage).toBe(mediaId);

    const content = post.content as { root: { children: Array<{ type: string; children?: Array<Record<string, unknown>> }> } };
    const para = content.root.children[0];
    const img = para?.children?.find((c) => c.type === "image");
    expect(img?.mediaId).toBe(mediaId);
    expect(img?.src).toBe(heroUrl);

    // Confirm the nx_media row exists and is owned by the importer.
    const db = await getTestDb();
    const [row] = await db.select().from(nxMedia).where(eq(nxMedia.id, mediaId!)).limit(1);
    expect(row).toBeDefined();
  });

  it("21.6 — resolves WP categories/tags via taxonomies resolver and attaches term ids to posts", async () => {
    const xml = readFileSync(FIXTURE, "utf8");
    const bundle = parseWxr(xml);
    const session = await seedUser({ email: "wp-tax@example.com", role: "admin" });
    const actor = await asActor(session);

    const created: Array<{ taxonomy: string; slug: string }> = [];
    let nextId = 1;
    const idsBySlug = new Map<string, string>();

    const report = await applyBundle(bundle, {
      actor,
      dryRun: false,
      taxonomies: {
        findOrCreate: async ({ taxonomy, slug }) => {
          const cached = idsBySlug.get(slug);
          if (cached) return { id: cached };
          const id = `tax-${nextId++}`;
          idsBySlug.set(slug, id);
          created.push({ taxonomy, slug });
          return Promise.resolve({ id });
        },
      },
    });

    // The fixture has one category (news) and one tag (launch),
    // both attached to the hello-world post.
    expect(report.errors).toEqual([]);
    expect(created).toEqual(
      expect.arrayContaining([
        { taxonomy: "category", slug: "news" },
        { taxonomy: "post_tag", slug: "launch" },
      ]),
    );
    expect(report.taxonomies?.termIds.size).toBe(2);

    const helloRow = report.applied.find((r) => r.slug === "hello-world");
    expect(helloRow?.categoryIds).toEqual([idsBySlug.get("news")]);
    expect(helloRow?.tagIds).toEqual([idsBySlug.get("launch")]);
  });

  it("21.6 — surfaces a notes line when terms exist but no resolver is supplied", async () => {
    const xml = readFileSync(FIXTURE, "utf8");
    const bundle = parseWxr(xml);
    const session = await seedUser({ email: "wp-tax-skip@example.com", role: "admin" });
    const actor = await asActor(session);

    const report = await applyBundle(bundle, { actor, dryRun: false });
    expect(report.taxonomies).toBeNull();
    expect(report.notes.some((n) => n.includes("no taxonomy resolver"))).toBe(true);
  });

  it("21.5 — leaves Lexical untouched when a media URL fails to download", async () => {
    const xml = readFileSync(FIXTURE, "utf8");
    const bundle = parseWxr(xml);
    const session = await seedUser({ email: "wp-media-fail@example.com", role: "admin" });
    const actor = await asActor(session);

    const report = await applyBundle(bundle, {
      actor,
      dryRun: false,
      media: {
        download: async () => {
          throw new Error("simulated network failure");
        },
        upload: async () => {
          throw new Error("upload should not be reached");
        },
      },
    });

    expect(report.errors).toEqual([]); // doc-level errors empty
    expect(report.media?.uploaded).toBe(0);
    expect(report.media?.errors.length).toBeGreaterThan(0);

    const posts = await findDocuments("posts", { where: { slug: "hello-world" }, limit: 1 }, actor);
    const post = posts.docs[0]!;
    // No coverImage wired when the source asset never resolved.
    expect(post.coverImage).toBeFalsy();
    // Lexical img keeps its original src for SSR fallback rendering.
    const content = post.content as { root: { children: Array<{ children?: Array<Record<string, unknown>> }> } };
    const img = content.root.children[0]?.children?.find((c) => c.type === "image");
    expect(img?.mediaId).toBeUndefined();
    expect(img?.src).toBe("https://acme.example.com/wp-content/uploads/2025/04/hero.jpg");
  });
});
