import { describe, expect, it } from "vitest";

import { XliffParseError, parseXliff, renderXliff } from "./format.js";

describe("renderXliff", () => {
  it("emits a sitemap-org-style xliff 1.2 envelope", () => {
    const xml = renderXliff({
      files: [
        {
          original: "discussions/abc",
          sourceLocale: "en",
          targetLocale: "ko",
          units: [
            { id: "title", source: "Welcome", target: "" },
            { id: "body", source: "Hello world", target: "안녕" },
          ],
        },
      ],
    });
    expect(xml).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(xml).toContain('<xliff version="1.2"');
    expect(xml).toContain('source-language="en"');
    expect(xml).toContain('target-language="ko"');
    expect(xml).toContain('original="discussions/abc"');
    expect(xml).toContain('<trans-unit id="title">');
    expect(xml).toContain("<source>Welcome</source>");
    expect(xml).toContain("<target>안녕</target>");
  });

  it("escapes XML-meaningful characters per XML 1.0 rules", () => {
    // Element text: `<`, `&`, `>` MUST be escaped; `"` and `'`
    // don't need escaping in element bodies (only in attribute
    // values). Attributes always get the full escape pass.
    const xml = renderXliff({
      files: [
        {
          original: "posts/needs&escape",
          sourceLocale: "en",
          targetLocale: "de",
          units: [
            {
              id: "snippet",
              source: 'a < b & "c"',
              target: "x > y",
            },
          ],
        },
      ],
    });
    expect(xml).toContain('a &lt; b &amp; "c"');
    expect(xml).toContain("x &gt; y");
    // Attribute escape: `&` in `original` becomes `&amp;`.
    expect(xml).toContain('original="posts/needs&amp;escape"');
  });

  it("renders rich text as protected XLIFF inline codes", () => {
    const xml = renderXliff({
      files: [
        {
          original: "posts/abc",
          sourceLocale: "en",
          targetLocale: "ko",
          units: [
            {
              id: "content",
              source: "Hello\nworld",
              target: "안녕\n세계",
              sourceInline: [
                { type: "group", id: "n-0-0", ctype: "x-nexpress-lexical", text: "Hello" },
                { type: "placeholder", id: "b-0", ctype: "lb" },
                { type: "group", id: "n-1-0", ctype: "x-nexpress-lexical", text: "world" },
              ],
              targetInline: [
                { type: "group", id: "n-0-0", ctype: "x-nexpress-lexical", text: "안녕" },
                { type: "placeholder", id: "b-0", ctype: "lb" },
                { type: "group", id: "n-1-0", ctype: "x-nexpress-lexical", text: "세계" },
              ],
            },
          ],
        },
      ],
    });

    expect(xml).toContain('restype="x-nexpress-richtext"');
    expect(xml).toContain('<g id="n-0-0" ctype="x-nexpress-lexical">Hello</g>');
    expect(xml).toContain('<x id="b-0" ctype="lb"/>');
    expect(parseXliff(xml).files[0].units[0]).toEqual(
      expect.objectContaining({
        source: "Hello\nworld",
        target: "안녕\n세계",
        sourceInline: expect.any(Array),
        targetInline: expect.any(Array),
      }),
    );
  });
});

describe("parseXliff", () => {
  it("round-trips a rendered document back to the same shape", () => {
    const doc = {
      files: [
        {
          original: "discussions/abc",
          sourceLocale: "en",
          targetLocale: "ko",
          units: [
            { id: "title", source: "Welcome", target: "환영합니다" },
            { id: "body", source: "Hello world", target: "" },
          ],
        },
        {
          original: "posts/123",
          sourceLocale: "en",
          targetLocale: "ko",
          units: [{ id: "title", source: "Greeting", target: "" }],
        },
      ],
    };
    const xml = renderXliff(doc);
    const parsed = parseXliff(xml);
    expect(parsed).toEqual(doc);
  });

  it("decodes escaped entities back to their literal characters", () => {
    const xml = renderXliff({
      files: [
        {
          original: "posts/x",
          sourceLocale: "en",
          targetLocale: "fr",
          units: [{ id: "html", source: "<p>hi</p>", target: "<p>salut</p>" }],
        },
      ],
    });
    const parsed = parseXliff(xml);
    expect(parsed.files[0].units[0]).toEqual({
      id: "html",
      source: "<p>hi</p>",
      target: "<p>salut</p>",
    });
  });

  it("throws when the root <xliff> element is missing entirely", () => {
    // fast-xml-parser is fairly permissive on unclosed tags; the
    // contract we lock here is that a body without <xliff> at all
    // surfaces as a `XliffParseError` rather than a silent empty
    // result. (Malformed-content edge cases are deferred to the
    // parser library.)
    expect(() => parseXliff("<plain>not an xliff doc</plain>")).toThrow(XliffParseError);
  });

  it("throws when a <file> is missing required attributes", () => {
    const xml = `<?xml version="1.0"?>
<xliff version="1.2" xmlns="urn:oasis:names:tc:xliff:document:1.2">
  <file source-language="en">
    <body></body>
  </file>
</xliff>`;
    expect(() => parseXliff(xml)).toThrow(/source-language, target-language, and original/);
  });

  it("treats an empty <target> as empty string (not undefined)", () => {
    const xml = `<?xml version="1.0"?>
<xliff version="1.2" xmlns="urn:oasis:names:tc:xliff:document:1.2">
  <file source-language="en" target-language="ko" datatype="plaintext" original="x/y">
    <body>
      <trans-unit id="t">
        <source>hi</source>
        <target></target>
      </trans-unit>
    </body>
  </file>
</xliff>`;
    const parsed = parseXliff(xml);
    expect(parsed.files[0].units[0].target).toBe("");
  });

  it("rejects raw target text mixed around protected inline codes", () => {
    const xml = `<?xml version="1.0"?>
<xliff version="1.2" xmlns="urn:oasis:names:tc:xliff:document:1.2">
  <file source-language="en" target-language="ko" datatype="plaintext" original="x/y">
    <body>
      <trans-unit id="content" restype="x-nexpress-richtext">
        <source><g id="n-0-0" ctype="x-nexpress-lexical">hello</g></source>
        <target>outside<g id="n-0-0" ctype="x-nexpress-lexical">안녕</g></target>
      </trans-unit>
    </body>
  </file>
</xliff>`;
    expect(() => parseXliff(xml)).toThrow(/mixes raw text with inline codes/);
  });
});
