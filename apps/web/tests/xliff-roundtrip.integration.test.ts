import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  closeTestDb,
  ensureMigrated,
  registerTestCollections,
  seedUser,
  skipIfNoTestDb,
  truncateAll,
  type TestUserSession,
} from "./harness.js";

/**
 * Phase 12.12 — XLIFF round-trip. Writes a source-locale row,
 * exports an XLIFF bundle, edits the `<target>` text the way a
 * translator would, imports the result, and verifies the new
 * sibling row landed with the translated content + the original
 * non-translatable fields preserved.
 */
describe.skipIf(skipIfNoTestDb())("xliff round-trip (Phase 12.12)", () => {
  let usePagesBlocksCollection: (() => void) | null = null;
  let usePagesRichTextCollection: (() => void) | null = null;

  beforeAll(async () => {
    await ensureMigrated();
    registerTestCollections();
    const { ensureFor } = await import("@/lib/init-core");
    await ensureFor("read");

    // The reference pages table already has a JSONB `blocks` column but the
    // shipped collection declares it as a blocks field. Re-register that one
    // test column as richText so this suite exercises real pipeline + Postgres
    // round-trips without adding a production-only schema column just for QA.
    const { registerCollection } = await import("@nexpress/core");
    const { pagesTable } = await import("../../../packages/core/src/integration/fixtures.js");
    const { pagesCollection } = await import("@nexpress/app/collections/pages");
    const baseConfig = {
      ...pagesCollection,
      access: undefined,
      hooks: undefined,
    };
    const richTextConfig = {
      ...baseConfig,
      fields: baseConfig.fields.map((field) =>
        "name" in field && field.name === "blocks"
          ? { type: "richText" as const, name: "blocks" }
          : field,
      ),
    };
    usePagesBlocksCollection = () => registerCollection("pages", pagesTable, baseConfig);
    usePagesRichTextCollection = () => registerCollection("pages", pagesTable, richTextConfig);
    usePagesRichTextCollection();
  });
  beforeEach(async () => {
    usePagesRichTextCollection?.();
    await truncateAll();
  });
  afterAll(async () => {
    usePagesBlocksCollection?.();
    await closeTestDb();
  });

  let admin: TestUserSession;
  beforeEach(async () => {
    admin = await seedUser({ role: "admin" });
  });
  function actor() {
    return {
      id: admin.userId,
      email: admin.email,
      name: "Test",
      role: admin.role,
      tokenVersion: 0,
    };
  }

  function richTextFixture(): Record<string, unknown> {
    return {
      root: {
        type: "root",
        version: 1,
        direction: null,
        format: "",
        indent: 0,
        children: [
          {
            type: "paragraph",
            version: 1,
            direction: null,
            format: "",
            indent: 0,
            children: [
              {
                type: "text",
                version: 1,
                detail: 0,
                format: 1,
                mode: "normal",
                style: "",
                text: "Hello ",
              },
              {
                type: "link",
                version: 1,
                url: "https://example.com/docs",
                children: [
                  {
                    type: "text",
                    version: 1,
                    detail: 0,
                    format: 2,
                    mode: "normal",
                    style: "",
                    text: "world",
                  },
                ],
              },
              { type: "image", version: 1, src: "/media/example.png", altText: "Example" },
            ],
          },
          {
            type: "paragraph",
            version: 1,
            direction: null,
            format: "",
            indent: 0,
            children: [
              {
                type: "text",
                version: 1,
                detail: 0,
                format: 0,
                mode: "normal",
                style: "",
                text: "Second paragraph",
              },
            ],
          },
        ],
      },
    };
  }

  function blockFixture(): Array<Record<string, unknown>> {
    return [
      {
        id: "layout-translation",
        type: "grid",
        props: { columns: 12, gap: "2rem" },
        children: [
          {
            id: "hero-translation",
            type: "hero",
            props: {
              title: "Block hero",
              subtitle: "Translate nested content.",
              ctaText: "Read more",
              ctaUrl: "/docs",
              backgroundImage: "/media/hero.png",
            },
          },
          {
            id: "faq-translation",
            type: "faq",
            props: {
              heading: "Block questions",
              items: [{ question: "How?", answer: "With explicit schema paths." }],
            },
          },
          {
            id: "rich-translation",
            type: "rich-text",
            props: { content: richTextFixture() },
          },
        ],
      },
    ];
  }

  it("exports a published source row, imports an edited target, and creates a sibling", async () => {
    const { saveDocument, findDocuments } = await import("@nexpress/core");
    const { exportXliff, importXliff, parseXliff, renderXliff } = await import("@nexpress/xliff");

    // 1. Author the source-locale (en) row.
    const en = await saveDocument(
      "pages",
      null,
      { title: "Hello", seoDescription: "Hello world", locale: "en" },
      actor(),
      { status: "published" },
    );
    const groupId = (en.doc as { translationGroupId: string }).translationGroupId;
    expect(groupId).toBeTruthy();

    // 2. Export. Should emit one file: pages-en-ko.xliff
    //    (no -ja because the harness only configures en + ko).
    const bundle = await exportXliff();
    const koFile = bundle.files.find((f) => f.collection === "pages" && f.targetLocale === "ko");
    expect(koFile).toBeDefined();
    expect(bundle.summary.docCount).toBe(1);
    expect(bundle.summary.targetLocales).toEqual(["ko"]);

    // 3. Round-trip the XML — translator opens it in their tool,
    //    fills in `<target>`. We simulate that by parsing,
    //    setting target, and re-rendering.
    const parsed = parseXliff(koFile!.xml);
    expect(parsed.files[0]!.original).toBe(`pages/${groupId}`);
    expect(parsed.files[0]!.units).toHaveLength(2);
    const titleUnit = parsed.files[0]!.units.find((u) => u.id === "title")!;
    const seoDescriptionUnit = parsed.files[0]!.units.find((u) => u.id === "seoDescription")!;
    titleUnit.target = "안녕하세요";
    seoDescriptionUnit.target = "안녕 세상";
    const translatedXml = renderXliff(parsed);

    // 4. Import. Should CREATE a new ko sibling.
    const result = await importXliff({
      xml: translatedXml,
      user: actor(),
    });
    expect(result.applied).toHaveLength(1);
    expect(result.applied[0]!.operation).toBe("create");
    expect(result.applied[0]!.locale).toBe("ko");
    expect(result.applied[0]!.unitCount).toBe(2);
    expect(result.skipped).toHaveLength(0);
    expect(result.wrote).toBe(true);

    // 5. Verify the ko sibling landed with translated fields and
    //    the same translationGroupId. New siblings always start
    //    as draft so the translator's reviewer can publish them.
    const koResult = await findDocuments("pages", {
      where: { translationGroupId: groupId },
      locale: "ko",
    });
    expect(koResult.docs).toHaveLength(1);
    const koDoc = koResult.docs[0] as Record<string, unknown>;
    expect(koDoc.title).toBe("안녕하세요");
    expect(koDoc.seoDescription).toBe("안녕 세상");
    expect(koDoc.locale).toBe("ko");
    expect(koDoc.translationGroupId).toBe(groupId);
    expect(koDoc._status ?? koDoc.status).toBe("draft");
  });

  it("re-importing the same XLIFF updates the sibling instead of duplicating", async () => {
    const { saveDocument, findDocuments } = await import("@nexpress/core");
    const { exportXliff, importXliff, parseXliff, renderXliff } = await import("@nexpress/xliff");

    const en = await saveDocument(
      "pages",
      null,
      { title: "Greeting", seoDescription: "Hi", locale: "en" },
      actor(),
      { status: "published" },
    );
    const groupId = (en.doc as { translationGroupId: string }).translationGroupId;

    // First round.
    let bundle = await exportXliff();
    let parsed = parseXliff(bundle.files[0]!.xml);
    parsed.files[0]!.units.find((u) => u.id === "title")!.target = "인사";
    parsed.files[0]!.units.find((u) => u.id === "seoDescription")!.target = "안녕";
    let result = await importXliff({
      xml: renderXliff(parsed),
      user: actor(),
    });
    expect(result.applied[0]!.operation).toBe("create");

    // Second round — translator changed the title. Should UPDATE
    // the existing ko sibling, not create a second one.
    bundle = await exportXliff();
    parsed = parseXliff(bundle.files[0]!.xml);
    // Pre-existing target text is round-tripped on the export.
    expect(parsed.files[0]!.units.find((u) => u.id === "title")!.target).toBe("인사");
    parsed.files[0]!.units.find((u) => u.id === "title")!.target = "환영";
    result = await importXliff({
      xml: renderXliff(parsed),
      user: actor(),
    });
    expect(result.applied[0]!.operation).toBe("update");

    const koResult = await findDocuments("pages", {
      where: { translationGroupId: groupId },
      locale: "ko",
    });
    expect(koResult.docs).toHaveLength(1);
    expect((koResult.docs[0] as { title: string }).title).toBe("환영");
  });

  it("dryRun reports the planned operations without writing", async () => {
    const { saveDocument, findDocuments } = await import("@nexpress/core");
    const { exportXliff, importXliff, parseXliff, renderXliff } = await import("@nexpress/xliff");
    await saveDocument(
      "pages",
      null,
      { title: "DryRun", seoDescription: "x", locale: "en" },
      actor(),
      { status: "published" },
    );
    const bundle = await exportXliff();
    const parsed = parseXliff(bundle.files[0]!.xml);
    parsed.files[0]!.units.find((u) => u.id === "title")!.target = "마른달리기";
    const result = await importXliff({
      xml: renderXliff(parsed),
      user: actor(),
      dryRun: true,
    });
    expect(result.wrote).toBe(false);
    expect(result.applied).toHaveLength(1);
    expect(result.applied[0]!.operation).toBe("create");

    // Verify nothing landed in the DB.
    const koResult = await findDocuments("pages", { locale: "ko" });
    expect(koResult.docs).toHaveLength(0);
  });

  it("a file with all-empty <target> is skipped (no draft-blanking)", async () => {
    const { saveDocument } = await import("@nexpress/core");
    const { exportXliff, importXliff } = await import("@nexpress/xliff");
    await saveDocument(
      "pages",
      null,
      { title: "Empty", seoDescription: "y", locale: "en" },
      actor(),
      { status: "published" },
    );
    const bundle = await exportXliff();
    // Export emits empty <target> when no sibling exists yet —
    // hand that bundle straight back without filling anything.
    const result = await importXliff({
      xml: bundle.files[0]!.xml,
      user: actor(),
    });
    expect(result.applied).toHaveLength(0);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0]!.reason).toMatch(/all <target> elements/i);
  });

  it("rejects trans-units whose id isn't a translatable field (no locale/groupId hijack)", async () => {
    // Regression: a hand-edited / malicious XLIFF that ships
    // `<trans-unit id="locale">` or `id="translationGroupId">`
    // would, pre-fix, spread straight onto the merged sibling
    // on the UPDATE path — corrupting the
    // (locale, translation_group_id) sibling structure.
    // Validate that those units land on `skipped` instead and
    // the existing target row keeps its locale.
    const { saveDocument, findDocuments } = await import("@nexpress/core");
    const { importXliff } = await import("@nexpress/xliff");

    // Set up: existing en + ko siblings.
    const en = await saveDocument(
      "pages",
      null,
      { title: "Source", seoDescription: "Source body", locale: "en" },
      actor(),
      { status: "published" },
    );
    const groupId = (en.doc as { translationGroupId: string }).translationGroupId;
    await saveDocument(
      "pages",
      null,
      {
        title: "Target",
        seoDescription: "Target body",
        locale: "ko",
        translationGroupId: groupId,
      },
      actor(),
      { status: "published" },
    );

    // Hand-craft an XLIFF that names a non-translatable id —
    // both `locale` (i18n column) and `translationGroupId`
    // (sibling key) plus a real field for control. Any other
    // odd id (e.g. unknown column) should also be rejected.
    const malicious = `<?xml version="1.0" encoding="UTF-8"?>
<xliff version="1.2" xmlns="urn:oasis:names:tc:xliff:document:1.2">
  <file source-language="en" target-language="ko" datatype="plaintext" original="pages/${groupId}">
    <body>
      <trans-unit id="title">
        <source>Source</source>
        <target>새 제목</target>
      </trans-unit>
      <trans-unit id="locale">
        <source>en</source>
        <target>ja</target>
      </trans-unit>
      <trans-unit id="translationGroupId">
        <source>${groupId}</source>
        <target>00000000-0000-0000-0000-000000000000</target>
      </trans-unit>
      <trans-unit id="not_a_field">
        <source>x</source>
        <target>y</target>
      </trans-unit>
    </body>
  </file>
</xliff>`;

    const result = await importXliff({ xml: malicious, user: actor() });

    // Exactly one applied write — `title` UPDATE on the ko
    // sibling. The other three units land in `skipped`.
    expect(result.applied).toHaveLength(1);
    expect(result.applied[0]!.operation).toBe("update");
    expect(result.applied[0]!.unitCount).toBe(1);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0]!.reason).toMatch(/non-translatable id/);
    expect(result.skipped[0]!.reason).toContain("locale");
    expect(result.skipped[0]!.reason).toContain("translationGroupId");
    expect(result.skipped[0]!.reason).toContain("not_a_field");

    // The ko row's locale + translationGroupId stayed intact.
    const koResult = await findDocuments("pages", {
      where: { translationGroupId: groupId },
      locale: "ko",
    });
    expect(koResult.docs).toHaveLength(1);
    const koDoc = koResult.docs[0] as Record<string, unknown>;
    expect(koDoc.title).toBe("새 제목");
    expect(koDoc.locale).toBe("ko");
    expect(koDoc.translationGroupId).toBe(groupId);
  });

  it("rejects an XLIFF file whose `original` references an unknown collection", async () => {
    const { importXliff } = await import("@nexpress/xliff");
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<xliff version="1.2" xmlns="urn:oasis:names:tc:xliff:document:1.2">
  <file source-language="en" target-language="ko" datatype="plaintext" original="not-a-real-collection/00000000-0000-0000-0000-000000000000">
    <body>
      <trans-unit id="title">
        <source>x</source>
        <target>y</target>
      </trans-unit>
    </body>
  </file>
</xliff>`;
    const result = await importXliff({ xml, user: actor() });
    expect(result.applied).toHaveLength(0);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0]!.reason).toMatch(/Unknown collection/);
  });

  it("Issue #383 — private source rows still round-trip when the operator is threaded", async () => {
    // Without `options.user`, the pipeline's anonymous-visibility
    // guard (#262) restricts findDocuments to `visibility = "public"`
    // and a private source row drops silently out of the bundle.
    // The CLI shim now threads its synthetic admin user through
    // both export and the import sibling lookup so private docs
    // round-trip end-to-end.
    const { saveDocument, findDocuments } = await import("@nexpress/core");
    const { exportXliff, importXliff, parseXliff, renderXliff } = await import("@nexpress/xliff");

    // 1. Author a PRIVATE source-locale row.
    const en = await saveDocument(
      "pages",
      null,
      { title: "Secret", seoDescription: "Hidden body", locale: "en", visibility: "private" },
      actor(),
      { status: "published" },
    );
    const groupId = (en.doc as { translationGroupId: string }).translationGroupId;
    expect(groupId).toBeTruthy();

    // 2a. Export WITHOUT the operator — the private row should be
    //     omitted entirely (matches the pre-fix behavior; this is
    //     the bug surface).
    const anonBundle = await exportXliff();
    expect(anonBundle.summary.docCount).toBe(0);
    expect(anonBundle.files).toHaveLength(0);

    // 2b. Export WITH the operator — the private row surfaces.
    const bundle = await exportXliff({ user: actor() });
    expect(bundle.summary.docCount).toBe(1);
    const koFile = bundle.files.find((f) => f.collection === "pages" && f.targetLocale === "ko");
    expect(koFile).toBeDefined();

    // 3. Translator fills in `<target>`; import lands a sibling.
    const parsed = parseXliff(koFile!.xml);
    parsed.files[0]!.units.find((u) => u.id === "title")!.target = "비밀";
    parsed.files[0]!.units.find((u) => u.id === "seoDescription")!.target = "숨겨진 본문";
    const result = await importXliff({
      xml: renderXliff(parsed),
      user: actor(),
    });
    expect(result.applied).toHaveLength(1);
    expect(result.applied[0]!.operation).toBe("create");

    // 4. Re-export now that a (draft / private-shape) ko sibling
    //    exists, with the operator threaded so it's visible. The
    //    target text we just imported should round-trip back.
    const round2 = await exportXliff({ user: actor() });
    const koFile2 = round2.files.find((f) => f.targetLocale === "ko");
    const parsed2 = parseXliff(koFile2!.xml);
    expect(parsed2.files[0]!.units.find((u) => u.id === "title")!.target).toBe("비밀");

    // 5. Translator updates the title; import should UPDATE — not
    //    create a duplicate sibling — because findSibling now sees
    //    the private target row.
    parsed2.files[0]!.units.find((u) => u.id === "title")!.target = "기밀";
    const update = await importXliff({
      xml: renderXliff(parsed2),
      user: actor(),
    });
    expect(update.applied).toHaveLength(1);
    expect(update.applied[0]!.operation).toBe("update");

    const koResult = await findDocuments(
      "pages",
      {
        where: { translationGroupId: groupId, visibility: "*" },
        locale: "ko",
      },
      actor(),
    );
    expect(koResult.docs).toHaveLength(1);
    expect((koResult.docs[0] as { title: string }).title).toBe("기밀");
  });

  it("export skips empty source fields (no <trans-unit> with empty <source>)", async () => {
    const { saveDocument } = await import("@nexpress/core");
    const { exportXliff, parseXliff } = await import("@nexpress/xliff");
    // Body deliberately empty — the unit for `body` should be
    // dropped from the file rather than emit an empty <source>.
    await saveDocument(
      "pages",
      null,
      { title: "Title only", seoDescription: "", locale: "en" },
      actor(),
      { status: "published" },
    );
    const bundle = await exportXliff();
    const parsed = parseXliff(bundle.files[0]!.xml);
    const ids = parsed.files[0]!.units.map((u) => u.id);
    expect(ids).toEqual(["title"]);
  });

  it("round-trips Lexical rich text without flattening formatting, links, or media", async () => {
    const { findDocuments, getDocumentById, saveDocument } = await import("@nexpress/core");
    const { exportXliff, importXliff, parseXliff, renderXliff } = await import("@nexpress/xliff");
    const source = await saveDocument(
      "pages",
      null,
      {
        title: "Rich source",
        seoDescription: "Source summary",
        blocks: richTextFixture(),
        locale: "en",
      },
      actor(),
      { status: "published" },
    );
    const groupId = (source.doc as { translationGroupId: string }).translationGroupId;

    let bundle = await exportXliff();
    let parsed = parseXliff(bundle.files[0]!.xml);
    const file = parsed.files[0]!;
    file.units.find((unit) => unit.id === "title")!.target = "풍부한 번역";
    const richUnit = file.units.find((unit) => unit.id === "blocks")!;
    expect(richUnit.sourceInline).toBeDefined();
    expect(richUnit.source).toBe("Hello world\nSecond paragraph");
    richUnit.targetInline = richUnit.targetInline!.map((part) => {
      if (part.type !== "group") return part;
      if (part.id === "n-0-0") return { ...part, text: "안녕 " };
      if (part.id === "n-0-1-0") return { ...part, text: "세계" };
      return { ...part, text: "두 번째 문단" };
    });

    const translatedXml = renderXliff(parsed);
    const dryRun = await importXliff({ xml: translatedXml, user: actor(), dryRun: true });
    expect(dryRun).toEqual(
      expect.objectContaining({
        wrote: false,
        applied: [expect.objectContaining({ operation: "create", unitCount: 2 })],
      }),
    );
    expect(
      (await findDocuments("pages", { where: { translationGroupId: groupId }, locale: "ko" })).docs,
    ).toHaveLength(0);

    const created = await importXliff({ xml: translatedXml, user: actor() });
    expect(created.applied).toEqual([
      expect.objectContaining({ operation: "create", unitCount: 2, locale: "ko" }),
    ]);

    const koRows = await findDocuments("pages", {
      where: { translationGroupId: groupId },
      locale: "ko",
    });
    const ko = await getDocumentById("pages", (koRows.docs[0] as { id: string }).id, actor());
    const root = (ko!.blocks as { root: { children: Array<Record<string, unknown>> } }).root;
    const paragraph = root.children[0] as { children: Array<Record<string, unknown>> };
    expect(paragraph.children[0]).toEqual(expect.objectContaining({ text: "안녕 ", format: 1 }));
    const link = paragraph.children[1] as { url: string; children: Array<{ text: string }> };
    expect(link.url).toBe("https://example.com/docs");
    expect(link.children[0]!.text).toBe("세계");
    expect(paragraph.children[2]).toEqual(
      expect.objectContaining({ type: "image", src: "/media/example.png", altText: "Example" }),
    );
    const second = root.children[1] as { children: Array<{ text: string }> };
    expect(second.children[0]!.text).toBe("두 번째 문단");

    // Existing translated text pre-fills the next export. An empty fragment on
    // re-import retains its current target text instead of blanking it.
    bundle = await exportXliff();
    parsed = parseXliff(bundle.files[0]!.xml);
    const updateUnit = parsed.files[0]!.units.find((unit) => unit.id === "blocks")!;
    expect(updateUnit.target).toBe("안녕 세계\n두 번째 문단");
    updateUnit.targetInline = updateUnit.targetInline!.map((part) => {
      if (part.type !== "group") return part;
      if (part.id === "n-0-0") return { ...part, text: "환영 " };
      if (part.id === "n-0-1-0") return { ...part, text: "" };
      return part;
    });
    const updated = await importXliff({ xml: renderXliff(parsed), user: actor() });
    expect(updated.applied[0]).toEqual(expect.objectContaining({ operation: "update" }));

    const afterUpdate = await getDocumentById(
      "pages",
      (koRows.docs[0] as { id: string }).id,
      actor(),
    );
    const updatedParagraph = (
      afterUpdate!.blocks as { root: { children: Array<{ children: Array<{ text: string }> }> } }
    ).root.children[0]!;
    expect(updatedParagraph.children[0]!.text).toBe("환영 ");
    expect(
      (updatedParagraph.children[1] as unknown as { children: Array<{ text: string }> })
        .children[0]!.text,
    ).toBe("세계");
  });

  it("rejects damaged rich-text inline codes while still applying valid atomic units", async () => {
    const { findDocuments, getDocumentById, saveDocument } = await import("@nexpress/core");
    const { exportXliff, importXliff, parseXliff, renderXliff } = await import("@nexpress/xliff");
    const source = await saveDocument(
      "pages",
      null,
      { title: "Guarded", blocks: richTextFixture(), locale: "en" },
      actor(),
      { status: "published" },
    );
    const groupId = (source.doc as { translationGroupId: string }).translationGroupId;
    const bundle = await exportXliff();
    const parsed = parseXliff(bundle.files[0]!.xml);
    parsed.files[0]!.units.find((unit) => unit.id === "title")!.target = "보호됨";
    const richUnit = parsed.files[0]!.units.find((unit) => unit.id === "blocks")!;
    richUnit.targetInline = richUnit.targetInline!.map((part) =>
      part.type === "group" ? { ...part, text: "번역" } : part,
    );
    richUnit.targetInline.splice(1, 1);

    const result = await importXliff({ xml: renderXliff(parsed), user: actor() });
    expect(result.applied).toEqual([expect.objectContaining({ unitCount: 1 })]);
    expect(result.skipped).toEqual([
      expect.objectContaining({ reason: expect.stringContaining("target inline-code structure") }),
    ]);

    const koRows = await findDocuments("pages", {
      where: { translationGroupId: groupId },
      locale: "ko",
    });
    const ko = await getDocumentById("pages", (koRows.docs[0] as { id: string }).id, actor());
    expect(ko!.title).toBe("보호됨");
    const firstText = (
      ko!.blocks as { root: { children: Array<{ children: Array<{ text: string }> }> } }
    ).root.children[0]!.children[0]!.text;
    expect(firstText).toBe("Hello ");
  });

  it("round-trips schema-declared block props through nested blocks and arrays", async () => {
    usePagesBlocksCollection?.();
    try {
      const { findDocuments, getDocumentById, saveDocument } = await import("@nexpress/core");
      const { exportXliff, importXliff, parseXliff, renderXliff } = await import("@nexpress/xliff");
      const source = await saveDocument(
        "pages",
        null,
        { title: "Block source", blocks: blockFixture(), locale: "en" },
        actor(),
        { status: "published" },
      );
      const groupId = (source.doc as { translationGroupId: string }).translationGroupId;

      const bundle = await exportXliff();
      const parsed = parseXliff(bundle.files[0]!.xml);
      const units = parsed.files[0]!.units;
      expect(units.some((unit) => unit.source === "2rem")).toBe(false);
      expect(units.some((unit) => unit.source === "/docs")).toBe(false);

      for (const unit of units) {
        if (unit.source === "Block source") unit.target = "블록 번역";
        if (unit.source === "Block hero") unit.target = "블록 히어로";
        if (unit.source === "How?") unit.target = "어떻게?";
        if (unit.source === "With explicit schema paths.") unit.target = "명시적 스키마 경로로.";
        if (unit.sourceInline) {
          const sourceTextById = new Map(
            unit.sourceInline
              .filter((part) => part.type === "group")
              .map((part) => [part.id, part.text]),
          );
          unit.targetInline = unit.targetInline!.map((part) =>
            part.type === "group"
              ? { ...part, text: `번역:${sourceTextById.get(part.id) ?? ""}` }
              : part,
          );
        }
      }

      const result = await importXliff({ xml: renderXliff(parsed), user: actor() });
      expect(result.applied).toEqual([
        expect.objectContaining({ operation: "create", unitCount: expect.any(Number) }),
      ]);
      expect(result.applied[0]!.unitCount).toBeGreaterThan(4);

      const rows = await findDocuments("pages", {
        where: { translationGroupId: groupId },
        locale: "ko",
      });
      const target = await getDocumentById("pages", (rows.docs[0] as { id: string }).id, actor());
      expect(target!.title).toBe("블록 번역");
      const layout = (target!.blocks as Array<Record<string, unknown>>)[0]!;
      expect((layout.props as Record<string, unknown>).gap).toBe("2rem");
      const children = layout.children as Array<Record<string, unknown>>;
      const hero = children.find((block) => block.id === "hero-translation")!;
      expect(hero.props).toEqual(
        expect.objectContaining({ title: "블록 히어로", ctaUrl: "/docs" }),
      );
      const faq = children.find((block) => block.id === "faq-translation")!;
      const faqItems = (faq.props as { items: Array<Record<string, unknown>> }).items;
      expect(faqItems[0]).toEqual(
        expect.objectContaining({ question: "어떻게?", answer: "명시적 스키마 경로로." }),
      );
      const rich = children.find((block) => block.id === "rich-translation")!;
      const content = (
        rich.props as { content: { root: { children: Array<Record<string, unknown>> } } }
      ).content;
      const firstParagraph = content.root.children[0] as {
        children: Array<Record<string, unknown>>;
      };
      expect(firstParagraph.children[0]!.text).toBe("번역:Hello ");
      expect(firstParagraph.children[2]).toEqual(
        expect.objectContaining({ type: "image", src: "/media/example.png" }),
      );
    } finally {
      usePagesRichTextCollection?.();
    }
  });
});
