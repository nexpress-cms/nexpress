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
  beforeAll(async () => {
    await ensureMigrated();
    registerTestCollections();
    const { ensureCoreServices } = await import("@/lib/init-core");
    ensureCoreServices();
  });
  beforeEach(async () => {
    await truncateAll();
  });
  afterAll(async () => {
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

  it("exports a published source row, imports an edited target, and creates a sibling", async () => {
    const { saveDocument, findDocuments } = await import("@nexpress/core");
    const { exportXliff, importXliff, parseXliff, renderXliff } = await import(
      "@nexpress/xliff"
    );

    // 1. Author the source-locale (en) row.
    const en = await saveDocument(
      "localized-pages",
      null,
      { title: "Hello", body: "Hello world", locale: "en" },
      actor(),
      { status: "published" },
    );
    const groupId = (en.doc as { translationGroupId: string }).translationGroupId;
    expect(groupId).toBeTruthy();

    // 2. Export. Should emit one file: localized-pages-en-ko.xliff
    //    (no -ja because the harness only configures en + ko).
    const bundle = await exportXliff();
    const koFile = bundle.files.find(
      (f) => f.collection === "localized-pages" && f.targetLocale === "ko",
    );
    expect(koFile).toBeDefined();
    expect(bundle.summary.docCount).toBe(1);
    expect(bundle.summary.targetLocales).toEqual(["ko"]);

    // 3. Round-trip the XML — translator opens it in their tool,
    //    fills in `<target>`. We simulate that by parsing,
    //    setting target, and re-rendering.
    const parsed = parseXliff(koFile!.xml);
    expect(parsed.files[0]!.original).toBe(`localized-pages/${groupId}`);
    expect(parsed.files[0]!.units).toHaveLength(2);
    const titleUnit = parsed.files[0]!.units.find((u) => u.id === "title")!;
    const bodyUnit = parsed.files[0]!.units.find((u) => u.id === "body")!;
    titleUnit.target = "안녕하세요";
    bodyUnit.target = "안녕 세상";
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
    const koResult = await findDocuments("localized-pages", {
      where: { translationGroupId: groupId },
      locale: "ko",
    });
    expect(koResult.docs).toHaveLength(1);
    const koDoc = koResult.docs[0] as Record<string, unknown>;
    expect(koDoc.title).toBe("안녕하세요");
    expect(koDoc.body).toBe("안녕 세상");
    expect(koDoc.locale).toBe("ko");
    expect(koDoc.translationGroupId).toBe(groupId);
    expect(koDoc._status ?? koDoc.status).toBe("draft");
  });

  it("re-importing the same XLIFF updates the sibling instead of duplicating", async () => {
    const { saveDocument, findDocuments } = await import("@nexpress/core");
    const { exportXliff, importXliff, parseXliff, renderXliff } = await import(
      "@nexpress/xliff"
    );

    const en = await saveDocument(
      "localized-pages",
      null,
      { title: "Greeting", body: "Hi", locale: "en" },
      actor(),
      { status: "published" },
    );
    const groupId = (en.doc as { translationGroupId: string }).translationGroupId;

    // First round.
    let bundle = await exportXliff();
    let parsed = parseXliff(bundle.files[0]!.xml);
    parsed.files[0]!.units.find((u) => u.id === "title")!.target = "인사";
    parsed.files[0]!.units.find((u) => u.id === "body")!.target = "안녕";
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
    expect(
      parsed.files[0]!.units.find((u) => u.id === "title")!.target,
    ).toBe("인사");
    parsed.files[0]!.units.find((u) => u.id === "title")!.target = "환영";
    result = await importXliff({
      xml: renderXliff(parsed),
      user: actor(),
    });
    expect(result.applied[0]!.operation).toBe("update");

    const koResult = await findDocuments("localized-pages", {
      where: { translationGroupId: groupId },
      locale: "ko",
    });
    expect(koResult.docs).toHaveLength(1);
    expect((koResult.docs[0] as { title: string }).title).toBe("환영");
  });

  it("dryRun reports the planned operations without writing", async () => {
    const { saveDocument, findDocuments } = await import("@nexpress/core");
    const { exportXliff, importXliff, parseXliff, renderXliff } = await import(
      "@nexpress/xliff"
    );
    await saveDocument(
      "localized-pages",
      null,
      { title: "DryRun", body: "x", locale: "en" },
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
    const koResult = await findDocuments("localized-pages", { locale: "ko" });
    expect(koResult.docs).toHaveLength(0);
  });

  it("a file with all-empty <target> is skipped (no draft-blanking)", async () => {
    const { saveDocument } = await import("@nexpress/core");
    const { exportXliff, importXliff } = await import("@nexpress/xliff");
    await saveDocument(
      "localized-pages",
      null,
      { title: "Empty", body: "y", locale: "en" },
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

  it("export skips empty source fields (no <trans-unit> with empty <source>)", async () => {
    const { saveDocument } = await import("@nexpress/core");
    const { exportXliff, parseXliff } = await import("@nexpress/xliff");
    // Body deliberately empty — the unit for `body` should be
    // dropped from the file rather than emit an empty <source>.
    await saveDocument(
      "localized-pages",
      null,
      { title: "Title only", body: "", locale: "en" },
      actor(),
      { status: "published" },
    );
    const bundle = await exportXliff();
    const parsed = parseXliff(bundle.files[0]!.xml);
    const ids = parsed.files[0]!.units.map((u) => u.id);
    expect(ids).toEqual(["title"]);
  });
});
