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

import {
  type NpAuthUser,
  findDocuments,
  listAuditEvents,
  listComments,
  npComments,
  npMedia,
  npMembers,
  npUsers,
  recordAuditEvent,
  renderCommentMarkdown,
  uploadMedia,
} from "@nexpress/core";
import { eq } from "drizzle-orm";
import { applyBundle, parseWxr } from "@nexpress/wp-import";

const FIXTURE = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../packages/wp-import/tests/fixtures/minimal.wxr.xml",
);

async function asActor(session: { userId: string; email: string; role: NpAuthUser["role"] }) {
  // saveDocument needs an NpAuthUser; reconstruct one from the seeded
  // session (the harness only returns the JWT-facing slice).
  const db = await getTestDb();
  const rows = await db
    .select({ name: npUsers.name, tokenVersion: npUsers.tokenVersion })
    .from(npUsers)
    .where(eq(npUsers.id, session.userId));
  const row = rows[0];
  if (!row) throw new Error("seed user missing");
  return {
    id: session.userId,
    email: session.email,
    name: row.name,
    role: session.role,
    tokenVersion: row.tokenVersion,
  } satisfies NpAuthUser;
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
    const [row] = await db.select().from(npMedia).where(eq(npMedia.id, mediaId!)).limit(1);
    expect(row).toBeDefined();
  });

  it("21.6 — resolves WP categories/tags via taxonomies resolver and attaches term ids to posts", async () => {
    const xml = readFileSync(FIXTURE, "utf8");
    const bundle = parseWxr(xml);
    const session = await seedUser({ email: "wp-tax@example.com", role: "admin" });
    const actor = await asActor(session);

    const created: Array<{ taxonomy: string; slug: string }> = [];
    const idsBySlug = new Map<string, string>();
    const { saveDocument } = await import("@nexpress/core");

    const report = await applyBundle(bundle, {
      actor,
      dryRun: false,
      taxonomies: {
        findOrCreate: async ({ taxonomy, slug, name }) => {
          const cached = idsBySlug.get(slug);
          if (cached) return { id: cached };
          // Insert a real taxonomy row so the post.categories /
          // post.tags FK + UUID validation pass.
          const result = await saveDocument(
            "taxonomies",
            null,
            { name, slug, taxonomy },
            actor,
            { status: "published" },
          );
          const id = (result.doc as { id: string }).id;
          idsBySlug.set(slug, id);
          created.push({ taxonomy, slug });
          return { id };
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

  it("21.7 — imports approved comments under imported members and skips unapproved", async () => {
    const xml = readFileSync(FIXTURE, "utf8");
    const bundle = parseWxr(xml);
    const session = await seedUser({ email: "wp-comments@example.com", role: "admin" });
    const actor = await asActor(session);
    const db = await getTestDb();

    const report = await applyBundle(bundle, {
      actor,
      dryRun: false,
      comments: {
        ensureImportedMember: async ({ handle, email, displayName }) => {
          const [existing] = await db
            .select({ id: npMembers.id })
            .from(npMembers)
            .where(eq(npMembers.handle, handle))
            .limit(1);
          if (existing) return { id: existing.id };
          const [inserted] = await db
            .insert(npMembers)
            .values({
              handle,
              email: email ?? `${handle}@imported.invalid`,
              displayName,
              status: "imported",
              emailVerified: false,
            })
            .returning({ id: npMembers.id });
          return { id: inserted!.id };
        },
        insertComment: async (input) => {
          const [row] = await db
            .insert(npComments)
            .values({
              targetType: input.targetType,
              targetId: input.targetId,
              parentId: input.parentId,
              memberId: input.memberId,
              bodyMd: input.bodyMd,
              bodyHtml: input.bodyHtml,
              status: "visible",
              createdAt: input.createdAt,
            })
            .returning({ id: npComments.id });
          return { id: row!.id };
        },
        renderBody: (s) => renderCommentMarkdown(s),
      },
    });

    expect(report.errors).toEqual([]);
    expect(report.comments?.applied).toBe(2); // both fixture comments approved
    expect(report.comments?.skippedUnapproved).toBe(0);
    expect(report.comments?.errors).toEqual([]);

    // Verify the rows landed and the parent map resolved.
    const rows = (await db.select().from(npComments)) as Array<{
      bodyMd: string;
      parentId: string | null;
      id: string;
      memberId: string;
    }>;
    expect(rows).toHaveLength(2);
    const top = rows.find((r) => r.bodyMd === "Great post!");
    const reply = rows.find((r) => r.bodyMd === "Thanks Bob!");
    expect(top?.parentId).toBeNull();
    expect(reply?.parentId).toBe(top?.id);

    // Two distinct authors → two imported member rows.
    const members = (await db
      .select()
      .from(npMembers)
      .where(eq(npMembers.status, "imported"))) as Array<{ handle: string }>;
    expect(members.map((m) => m.handle).sort()).toEqual(
      ["alice-example-com-wpimp", "bob-example-com-wpimp"].sort(),
    );
  });

  it("21.8 — resolves WP authors and stamps post.author with the resulting user id", async () => {
    const xml = readFileSync(FIXTURE, "utf8");
    const bundle = parseWxr(xml);
    const session = await seedUser({ email: "wp-authors@example.com", role: "admin" });
    const actor = await asActor(session);
    const db = await getTestDb();

    let nextId = 1;
    const seenLogins: string[] = [];
    const report = await applyBundle(bundle, {
      actor,
      dryRun: false,
      authors: {
        resolveAuthor: async ({ wpAuthorLogin }) => {
          seenLogins.push(wpAuthorLogin);
          // Insert a real nx_users row so the post.author FK resolves.
          const [inserted] = await db
            .insert(npUsers)
            .values({
              email: `${wpAuthorLogin}-${nextId++}@wp-import.invalid`,
              password: "x",
              name: wpAuthorLogin,
              role: "viewer",
            })
            .returning({ id: npUsers.id });
          return { id: inserted!.id };
        },
      },
    });

    expect(report.errors).toEqual([]);
    expect(seenLogins).toEqual(["alice"]); // single unique author in fixture
    expect(report.authors?.authorIds.size).toBe(1);

    const helloRow = report.applied.find((r) => r.slug === "hello-world");
    expect(helloRow?.authorId).toBe(report.authors?.authorIds.get("alice"));

    const posts = await findDocuments("posts", { where: { slug: "hello-world" }, limit: 1 }, actor);
    expect(posts.docs[0]?.author).toBe(helloRow?.authorId);
  });

  it("21.10 — emits import.wp.applied audit events for every imported document", async () => {
    const xml = readFileSync(FIXTURE, "utf8");
    const bundle = parseWxr(xml);
    const session = await seedUser({ email: "wp-audit@example.com", role: "admin" });
    const actor = await asActor(session);

    await applyBundle(bundle, {
      actor,
      dryRun: false,
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
    });

    const events = await listAuditEvents({ action: "import.wp.applied", limit: 50 });
    const slugs = events.events
      .map((e) => (e.payload as Record<string, unknown>).slug)
      .filter((s): s is string => typeof s === "string");
    expect(slugs.sort()).toEqual(["about", "hello-world"]);

    // Re-run lands "skipped" events for both posts.
    await applyBundle(bundle, {
      actor,
      dryRun: false,
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
    });
    const skipEvents = await listAuditEvents({ action: "import.wp.skipped", limit: 50 });
    expect(skipEvents.events.length).toBeGreaterThanOrEqual(2);
  });

  it("21.7 — surfaces a notes line when comments exist but no comments deps were supplied", async () => {
    const xml = readFileSync(FIXTURE, "utf8");
    const bundle = parseWxr(xml);
    const session = await seedUser({ email: "wp-comments-skip@example.com", role: "admin" });
    const actor = await asActor(session);

    const report = await applyBundle(bundle, { actor, dryRun: false });
    expect(report.comments).toBeNull();
    expect(report.notes.some((n) => n.includes("no comments deps"))).toBe(true);
  });

  it("21.11 — preserves the original WP author display name on `wpOriginalAuthor`", async () => {
    const xml = readFileSync(FIXTURE, "utf8");
    const bundle = parseWxr(xml);
    const session = await seedUser({ email: "wp-original-author@example.com", role: "admin" });
    const actor = await asActor(session);

    // Run with no authors resolver — author column stays empty,
    // but the byline must survive on the dedicated text field.
    const report = await applyBundle(bundle, {
      actor,
      dryRun: false,
      preserveOriginalAuthor: { posts: "wpOriginalAuthor" },
    });
    expect(report.errors).toEqual([]);

    const posts = await findDocuments("posts", { where: { slug: "hello-world" }, limit: 1 }, actor);
    const post = posts.docs[0]!;
    // The fixture's <wp:author_display_name> is "Alice Author".
    expect(post.wpOriginalAuthor).toBe("Alice Author");
    expect(post.author).toBeFalsy();
  });

  it("21.11 — listComments returns authorStatus so the public site can render a badge", async () => {
    const xml = readFileSync(FIXTURE, "utf8");
    const bundle = parseWxr(xml);
    const session = await seedUser({ email: "wp-imported-badge@example.com", role: "admin" });
    const actor = await asActor(session);
    const db = await getTestDb();

    await applyBundle(bundle, {
      actor,
      dryRun: false,
      comments: {
        ensureImportedMember: async ({ handle, email, displayName }) => {
          const [existing] = await db
            .select({ id: npMembers.id })
            .from(npMembers)
            .where(eq(npMembers.handle, handle))
            .limit(1);
          if (existing) return { id: existing.id };
          const [inserted] = await db
            .insert(npMembers)
            .values({
              handle,
              email: email ?? `${handle}@imported.invalid`,
              displayName,
              status: "imported",
              emailVerified: false,
            })
            .returning({ id: npMembers.id });
          return { id: inserted!.id };
        },
        insertComment: async (input) => {
          const [row] = await db
            .insert(npComments)
            .values({
              targetType: input.targetType,
              targetId: input.targetId,
              parentId: input.parentId,
              memberId: input.memberId,
              bodyMd: input.bodyMd,
              bodyHtml: input.bodyHtml,
              status: "visible",
              createdAt: input.createdAt,
            })
            .returning({ id: npComments.id });
          return { id: row!.id };
        },
        renderBody: (s) => renderCommentMarkdown(s),
      },
    });

    const posts = await findDocuments("posts", { where: { slug: "hello-world" }, limit: 1 }, actor);
    const postId = posts.docs[0]!.id as string;
    const result = await listComments("posts", postId, { order: "oldest" });
    expect(result.comments).toHaveLength(2);
    for (const row of result.comments) {
      expect(row.authorStatus).toBe("imported");
    }
  });

  it("21.12 — --update rewrites slug-collisions instead of skipping them", async () => {
    const xml = readFileSync(FIXTURE, "utf8");
    const bundle = parseWxr(xml);
    const session = await seedUser({ email: "wp-update@example.com", role: "admin" });
    const actor = await asActor(session);

    // First run lays down the post.
    await applyBundle(bundle, { actor, dryRun: false });
    const beforePosts = await findDocuments("posts", { where: { slug: "hello-world" }, limit: 1 }, actor);
    const beforeId = beforePosts.docs[0]?.id as string;
    expect(beforeId).toBeTruthy();

    // Second run with --update rewrites the row in place — the
    // document id stays stable.
    const report = await applyBundle(bundle, { actor, dryRun: false, update: true });
    expect(report.errors).toEqual([]);
    expect(report.applied).toHaveLength(2); // both records rewritten
    expect(report.skipped.filter((s) => s.reason === "slug already exists")).toHaveLength(0);

    const afterPosts = await findDocuments("posts", { where: { slug: "hello-world" }, limit: 1 }, actor);
    expect(afterPosts.docs[0]?.id).toBe(beforeId);
  });

  it("21.12 — --strict promotes media errors to record-level errors", async () => {
    const xml = readFileSync(FIXTURE, "utf8");
    const bundle = parseWxr(xml);
    const session = await seedUser({ email: "wp-strict@example.com", role: "admin" });
    const actor = await asActor(session);

    const report = await applyBundle(bundle, {
      actor,
      dryRun: false,
      strict: true,
      media: {
        download: () => Promise.reject(new Error("simulated failure")),
        upload: () => Promise.reject(new Error("upload should not run")),
      },
    });

    // Without --strict the failed download is just a media error.
    // With --strict it bubbles up as a record-level error so the
    // CLI exits non-zero.
    expect(report.errors.length).toBeGreaterThan(0);
    expect(report.errors[0]?.message).toContain("media:");
  });

  it("21.12 — reportHtml deps fires once per imported record", async () => {
    const xml = readFileSync(FIXTURE, "utf8");
    const bundle = parseWxr(xml);
    const session = await seedUser({ email: "wp-report@example.com", role: "admin" });
    const actor = await asActor(session);

    const samples: Array<{ slug: string; lexicalChildrenLen: number }> = [];
    await applyBundle(bundle, {
      actor,
      dryRun: false,
      reportHtml: {
        emit: ({ slug, lexical }) => {
          samples.push({ slug, lexicalChildrenLen: lexical.root.children.length });
        },
      },
    });

    const slugs = samples.map((s) => s.slug).sort();
    expect(slugs).toEqual(["about", "hello-world"]);
    // The hello-world fixture's body wraps "Welcome to Acme. <img/> More text."
    // in a single paragraph, so the Lexical root has one block child.
    expect(samples.find((s) => s.slug === "hello-world")?.lexicalChildrenLen).toBeGreaterThan(0);
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
