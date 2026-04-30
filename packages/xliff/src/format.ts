import { XMLParser } from "fast-xml-parser";

/**
 * XLIFF 1.2 reader/writer scoped to the subset we round-trip.
 *
 * Shape contract:
 *   - One `<xliff version="1.2">` root with the standard namespace.
 *   - One or more `<file>` elements, each with `source-language`,
 *     `target-language`, `datatype="plaintext"`, and an `original`
 *     attribute that encodes the routing back to a NexPress doc:
 *       original = "{collectionSlug}/{translationGroupId}"
 *   - Each `<file>` contains a single `<body>` with a flat list of
 *     `<trans-unit>` elements:
 *       <trans-unit id="{fieldName}">
 *         <source>...</source>
 *         <target>...</target>   // optional / empty pre-translation
 *       </trans-unit>
 *
 * We deliberately ignore segmentation (`<seg-source>`), inline
 * markup (`<g>`, `<x>`, etc.), groups, alt-trans, and notes — XLIFF
 * supports them but the round-trip we ship handles atomic-string
 * fields only. Files that come back from a SaaS with extra inline
 * markup will round-trip as if the markup were part of the target
 * text; that's acceptable for v1 since we only export simple text.
 */

export interface XliffTransUnit {
  id: string;
  source: string;
  target: string;
}

export interface XliffFile {
  /** `original` attribute — `{collectionSlug}/{translationGroupId}` */
  original: string;
  sourceLocale: string;
  targetLocale: string;
  units: XliffTransUnit[];
}

export interface XliffDocument {
  files: XliffFile[];
}

/**
 * Render an XLIFF 1.2 XML document. Output is deterministic
 * (stable element + attribute order, two-space indentation, LF
 * line endings) so a round-tripped file compares clean against
 * the original except for the translator's `<target>` edits.
 */
export function renderXliff(doc: XliffDocument): string {
  const lines: string[] = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<xliff version="1.2" xmlns="urn:oasis:names:tc:xliff:document:1.2">',
  ];
  for (const file of doc.files) {
    lines.push(
      `  <file source-language="${escapeAttr(file.sourceLocale)}" target-language="${escapeAttr(file.targetLocale)}" datatype="plaintext" original="${escapeAttr(file.original)}">`,
    );
    lines.push("    <body>");
    for (const unit of file.units) {
      lines.push(`      <trans-unit id="${escapeAttr(unit.id)}">`);
      lines.push(`        <source>${escapeText(unit.source)}</source>`);
      lines.push(`        <target>${escapeText(unit.target)}</target>`);
      lines.push("      </trans-unit>");
    }
    lines.push("    </body>");
    lines.push("  </file>");
  }
  lines.push("</xliff>");
  return lines.join("\n");
}

const PARSER = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  // Preserve whitespace inside <source> / <target> — translators
  // may want leading/trailing space for things like " — " or
  // newlines between paragraphs.
  trimValues: false,
  // Keep elements parsed as objects even when there's only one
  // child, so `file.body.trans-unit` is always an array we can
  // iterate without runtime branching.
  isArray: (name, jpath) => {
    return (
      jpath === "xliff.file" ||
      jpath === "xliff.file.body.trans-unit"
    );
  },
});

interface ParsedXml {
  xliff?: {
    file?: ParsedFile[];
    "@_version"?: string;
  };
}

interface ParsedFile {
  "@_source-language"?: string;
  "@_target-language"?: string;
  "@_original"?: string;
  body?: {
    "trans-unit"?: ParsedUnit[];
  };
}

interface ParsedUnit {
  "@_id"?: string;
  source?: string | { "#text"?: string };
  target?: string | { "#text"?: string };
}

/**
 * Parse an XLIFF 1.2 XML body into the document shape. Throws on
 * malformed XML or missing required attributes (`source-language`,
 * `target-language`, `original`); per-unit `target` may be empty
 * but the element itself must exist (XLIFF spec allows `<target>`
 * to be omitted but our round-trip emits it always).
 */
export function parseXliff(xml: string): XliffDocument {
  let parsed: ParsedXml;
  try {
    parsed = PARSER.parse(xml) as ParsedXml;
  } catch (error) {
    throw new XliffParseError(
      `Malformed XLIFF XML: ${(error as Error).message}`,
    );
  }
  const root = parsed.xliff;
  if (!root) {
    throw new XliffParseError("Missing root <xliff> element");
  }
  const files = root.file ?? [];
  const out: XliffFile[] = [];
  for (const f of files) {
    const sourceLocale = f["@_source-language"];
    const targetLocale = f["@_target-language"];
    const original = f["@_original"];
    if (!sourceLocale || !targetLocale || !original) {
      throw new XliffParseError(
        "Each <file> must declare source-language, target-language, and original",
      );
    }
    const units: XliffTransUnit[] = [];
    for (const u of f.body?.["trans-unit"] ?? []) {
      const id = u["@_id"];
      if (!id) {
        throw new XliffParseError(
          `<trans-unit> in file "${original}" is missing the id attribute`,
        );
      }
      units.push({
        id,
        source: extractText(u.source),
        target: extractText(u.target),
      });
    }
    out.push({ original, sourceLocale, targetLocale, units });
  }
  return { files: out };
}

export class XliffParseError extends Error {
  override readonly name = "XliffParseError";
}

function extractText(node: string | { "#text"?: string } | undefined): string {
  if (node === undefined || node === null) return "";
  if (typeof node === "string") return node;
  if (typeof node === "object" && typeof node["#text"] === "string") {
    return node["#text"];
  }
  return "";
}

function escapeAttr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeText(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
