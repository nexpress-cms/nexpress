import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";

import {
  closeTestDb,
  ensureMigrated,
  readJson,
  registerTestCollections,
  seedUser,
  skipIfNoTestDb,
  truncateAll,
  type TestUserSession,
} from "./harness.js";

interface InterchangeResponse {
  mode: "preview" | "apply";
  format: "gettext" | "xliff";
  catalog: {
    documentCount: number;
    unitCount: number;
    sourceLocale: string;
    targetLocale: string;
  };
  result: {
    applied: Array<{
      collection: string;
      docId: string;
      locale: string;
      operation: "create" | "update";
      unitCount: number;
    }>;
    skipped: Array<{ reason: string }>;
    wrote: boolean;
  };
}

describe.skipIf(skipIfNoTestDb())("Admin translation interchange", () => {
  beforeAll(async () => {
    await ensureMigrated();
    registerTestCollections();
    const { ensureFor } = await import("@/lib/init-core");
    await ensureFor("plugins");
  });

  beforeEach(async () => {
    await truncateAll();
  });

  afterAll(async () => {
    await closeTestDb();
  });

  it("exports bounded XLIFF and Gettext catalogs and previews PO imports", async () => {
    const editor = await seedUser({ role: "editor" });
    await createPublishedSource(editor, "Admin export", "Export body");
    const { GET, POST } = await import("@/app/api/admin/i18n/interchange/route");

    const xliff = await GET(exportRequest(editor, "xliff"));
    expect(xliff.status).toBe(200);
    expect(xliff.headers.get("content-type")).toContain("application/xliff+xml");
    expect(xliff.headers.get("content-disposition")).toContain("pages-en-ko.xliff");
    expect(xliff.headers.get("cache-control")).toBe("no-store");
    expect(xliff.headers.get("x-np-translation-documents")).toBe("1");
    const xliffBody = await xliff.text();
    expect(xliffBody).toContain('<xliff version="1.2"');
    expect(xliffBody).toContain("Admin export");

    const gettext = await GET(exportRequest(editor, "gettext"));
    expect(gettext.status).toBe(200);
    expect(gettext.headers.get("content-type")).toContain("text/x-gettext-translation");
    expect(gettext.headers.get("content-disposition")).toContain("pages-en-ko.po");
    const gettextBody = await gettext.text();
    expect(gettextBody).toContain("X-Nexpress-Catalog-Version: 1");
    expect(gettextBody).toContain('msgid "Admin export"');

    const { parseGettext, renderGettext } = await import("@nexpress/gettext");
    const catalog = parseGettext(gettextBody);
    const titleUnit = catalog.documents
      .flatMap((document) => document.units)
      .find((unit) => unit.id === "title");
    expect(titleUnit).toBeDefined();
    if (!titleUnit) throw new Error("Expected exported Gettext title unit");
    titleUnit.target = "관리자 PO 번역";
    const preview = await readJson<InterchangeResponse>(
      await POST(
        importRequest(editor, renderGettext(catalog), "pages-en-ko.po", "gettext", "preview"),
      ),
    );
    expect(preview.status).toBe(200);
    expect(preview.body).toMatchObject({
      format: "gettext",
      result: {
        wrote: false,
        applied: [expect.objectContaining({ operation: "create", unitCount: 1 })],
      },
    });
  });

  it("previews without writing, then reparses and applies the same upload", async () => {
    const editor = await seedUser({ role: "editor" });
    const groupId = await createPublishedSource(editor, "Source title", "Source body");
    const { GET, POST } = await import("@/app/api/admin/i18n/interchange/route");
    const exported = await GET(exportRequest(editor, "xliff"));
    const { parseXliff, renderXliff } = await import("@nexpress/xliff");
    const parsed = parseXliff(await exported.text());
    const translatedFile = parsed.files[0];
    const titleUnit = translatedFile?.units.find((unit) => unit.id === "title");
    const descriptionUnit = translatedFile?.units.find((unit) => unit.id === "seoDescription");
    expect(titleUnit).toBeDefined();
    expect(descriptionUnit).toBeDefined();
    if (!titleUnit || !descriptionUnit) {
      throw new Error("Expected exported XLIFF title and description units");
    }
    titleUnit.target = "관리자 번역";
    descriptionUnit.target = "번역 본문";
    const translated = renderXliff(parsed);

    const previewResponse = await POST(
      importRequest(editor, translated, "pages-en-ko.xliff", "xliff", "preview"),
    );
    expect(previewResponse.headers.get("cache-control")).toBe("no-store");
    const preview = await readJson<InterchangeResponse>(previewResponse);
    expect(preview.status).toBe(200);
    expect(preview.body).toMatchObject({
      mode: "preview",
      format: "xliff",
      catalog: { documentCount: 1, sourceLocale: "en", targetLocale: "ko" },
      result: { wrote: false },
    });
    expect(preview.body.result.applied).toEqual([
      expect.objectContaining({ collection: "pages", operation: "create", unitCount: 2 }),
    ]);

    const { findDocuments } = await import("@nexpress/core");
    expect(
      (
        await findDocuments(
          "pages",
          { where: { translationGroupId: groupId }, locale: "ko" },
          actor(editor),
        )
      ).docs,
    ).toHaveLength(0);

    const applyResponse = await POST(
      importRequest(editor, translated, "pages-en-ko.xliff", "xliff", "apply"),
    );
    const applied = await readJson<InterchangeResponse>(applyResponse);
    expect(applied.status).toBe(200);
    expect(applied.body.result.wrote).toBe(true);
    expect(applied.body.result.applied).toEqual([
      expect.objectContaining({ collection: "pages", operation: "create", unitCount: 2 }),
    ]);
    const rows = await findDocuments(
      "pages",
      { where: { translationGroupId: groupId }, locale: "ko" },
      actor(editor),
    );
    expect(rows.docs).toEqual([
      expect.objectContaining({ title: "관리자 번역", seoDescription: "번역 본문" }),
    ]);
  });

  it("rejects malformed uploads and viewers with stable API errors", async () => {
    const editor = await seedUser({ role: "editor" });
    const viewer = await seedUser({ role: "viewer" });
    const { GET, POST } = await import("@/app/api/admin/i18n/interchange/route");

    const malformed = await readJson<{ error: { code: string } }>(
      await POST(importRequest(editor, "not xliff", "broken.xliff", "xliff", "preview")),
    );
    expect(malformed.status).toBe(400);
    expect(malformed.body.error.code).toBe("VALIDATION_ERROR");

    const forbidden = await readJson<{ error: { code: string } }>(
      await GET(exportRequest(viewer, "xliff")),
    );
    expect(forbidden.status).toBe(403);
    expect(forbidden.body.error.code).toBe("FORBIDDEN");
  });

  it("rejects files beyond the bounded Admin request envelope", async () => {
    const editor = await seedUser({ role: "editor" });
    const { POST } = await import("@/app/api/admin/i18n/interchange/route");
    const oversized = "x".repeat(4 * 1024 * 1024 + 1);
    const response = await readJson<{ error: { code: string; details: unknown[] } }>(
      await POST(importRequest(editor, oversized, "large.po", "gettext", "preview")),
    );
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");
    expect(response.body.error.details).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ message: expect.stringContaining("CLI") }),
      ]),
    );
  });
});

async function createPublishedSource(
  session: TestUserSession,
  title: string,
  seoDescription: string,
): Promise<string> {
  const { saveDocument } = await import("@nexpress/core");
  const result = await saveDocument(
    "pages",
    null,
    { title, seoDescription, locale: "en" },
    actor(session),
    { status: "published" },
  );
  return (result.doc as { translationGroupId: string }).translationGroupId;
}

function exportRequest(session: TestUserSession, format: "gettext" | "xliff"): NextRequest {
  const params = new URLSearchParams({
    format,
    collection: "pages",
    sourceLocale: "en",
    targetLocale: "ko",
  });
  return new NextRequest(`http://localhost:3000/api/admin/i18n/interchange?${params.toString()}`, {
    headers: { cookie: `np-session=${session.accessToken}` },
  });
}

function importRequest(
  session: TestUserSession,
  content: string,
  filename: string,
  format: "gettext" | "xliff",
  mode: "preview" | "apply",
): NextRequest {
  const formData = new FormData();
  formData.set("file", new File([content], filename, { type: "text/plain" }));
  formData.set("format", format);
  formData.set("mode", mode);
  return new NextRequest("http://localhost:3000/api/admin/i18n/interchange", {
    method: "POST",
    headers: {
      cookie: `np-session=${session.accessToken}; np-csrf=${session.csrfToken}`,
      "x-csrf-token": session.csrfToken,
    },
    body: formData,
  });
}

function actor(session: TestUserSession) {
  return {
    id: session.userId,
    email: session.email,
    name: "Translation editor",
    role: session.role,
    tokenVersion: 0,
  };
}
