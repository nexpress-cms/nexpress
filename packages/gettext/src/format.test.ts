import { describe, expect, it } from "vitest";
import { type NpTranslationCatalog } from "@nexpress/translation";

import { GettextParseError, GettextRenderError, parseGettext, renderGettext } from "./format.js";

function catalog(): NpTranslationCatalog {
  return {
    documents: [
      {
        route: "pages/11111111-1111-4111-8111-111111111111",
        sourceLocale: "en",
        targetLocale: "ko",
        units: [
          { id: "title", source: "Hello", target: "안녕하세요" },
          {
            id: "body",
            source: "Hello {\nNext {NP:/G}",
            target: "안녕 {\n다음 {NP:/G}",
            sourceInline: [
              { type: "group", id: "n-0", ctype: "x-nexpress-lexical", text: "Hello {" },
              { type: "placeholder", id: "b-0", ctype: "lb" },
              {
                type: "group",
                id: "n-1",
                ctype: "x-nexpress-lexical",
                text: "Next {NP:/G}",
              },
            ],
            targetInline: [
              { type: "group", id: "n-0", ctype: "x-nexpress-lexical", text: "안녕 {" },
              { type: "placeholder", id: "b-0", ctype: "lb" },
              {
                type: "group",
                id: "n-1",
                ctype: "x-nexpress-lexical",
                text: "다음 {NP:/G}",
              },
            ],
          },
        ],
      },
    ],
  };
}

describe("Gettext PO format", () => {
  it("round-trips atomic and protected rich-text units", () => {
    const body = renderGettext(catalog());
    expect(body).toContain('msgid "Hello"');
    expect(body).toContain("X-Nexpress-Catalog-Version: 1");
    expect(body).toContain("{NP:G:");
    expect(parseGettext(body)).toEqual(catalog());
  });

  it("fails closed when a protected inline token is changed", () => {
    const body = renderGettext(catalog()).replaceAll("{NP:G:", "{NP:Z:");
    expect(() => parseGettext(body)).toThrow(GettextParseError);
  });

  it("rejects changed or reordered target tokens before producing a catalog", () => {
    const reordered = catalog();
    const unit = reordered.documents[0].units.find((candidate) => candidate.id === "body")!;
    [unit.targetInline![0], unit.targetInline![1]] = [unit.targetInline![1], unit.targetInline![0]];
    expect(() => renderGettext(reordered)).toThrow(GettextRenderError);

    const body = renderGettext(catalog());
    const tokenStart = body.lastIndexOf("{NP:X:");
    const tokenEnd = body.indexOf("}", tokenStart) + 1;
    const token = body.slice(tokenStart, tokenEnd);
    const changed = token.replace(
      token.split(":")[2],
      Buffer.from("changed").toString("base64url"),
    );
    const tampered = body.slice(0, tokenStart) + changed + body.slice(tokenEnd);
    expect(() => parseGettext(tampered)).toThrow(/changed, or reordered protected tokens/);
  });

  it("rejects unknown contexts instead of treating them as fields", () => {
    const body = renderGettext(catalog()).replace("np:content:", "custom:");
    expect(() => parseGettext(body)).toThrow(/msgctxt/);
  });

  it("rejects unscoped PO messages", () => {
    const body = `${renderGettext(catalog())}\nmsgid "unscoped"\nmsgstr "번역"\n`;
    expect(() => parseGettext(body)).toThrow(/msgctxt/);
  });

  it("rejects mixed locale pairs before serializing", () => {
    const value = catalog();
    value.documents.push({ ...value.documents[0], targetLocale: "fr", units: [] });
    expect(() => renderGettext(value)).toThrow(/same locale pair/);
  });
});
