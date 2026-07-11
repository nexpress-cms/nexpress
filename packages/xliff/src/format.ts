import { XMLParser } from "fast-xml-parser";

export const NP_XLIFF_RICH_TEXT_RESTYPE = "x-nexpress-richtext";

export type XliffInlinePart =
  | { type: "group"; id: string; ctype: string; text: string }
  | { type: "placeholder"; id: string; ctype: string };

export interface XliffTransUnit {
  id: string;
  /** Plain-text projection retained for atomic fields and API ergonomics. */
  source: string;
  /** Plain-text projection retained for atomic fields and API ergonomics. */
  target: string;
  /** Present when `<source>` contains NexPress-managed XLIFF inline codes. */
  sourceInline?: XliffInlinePart[];
  /** Present when `<target>` contains NexPress-managed XLIFF inline codes. */
  targetInline?: XliffInlinePart[];
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
 * Render the NexPress XLIFF 1.2 subset deterministically. Atomic fields stay
 * plain text. Rich-text fields use flat `<g>` codes for Lexical text leaves
 * and protected `<x ctype="lb">` placeholders for block boundaries.
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
      const inline = unit.sourceInline !== undefined || unit.targetInline !== undefined;
      const restype = inline ? ` restype="${NP_XLIFF_RICH_TEXT_RESTYPE}"` : "";
      lines.push(`      <trans-unit id="${escapeAttr(unit.id)}"${restype}>`);
      lines.push(`        <source>${renderContent(unit.source, unit.sourceInline)}</source>`);
      lines.push(`        <target>${renderContent(unit.target, unit.targetInline)}</target>`);
      lines.push("      </trans-unit>");
    }
    lines.push("    </body>");
    lines.push("  </file>");
  }
  lines.push("</xliff>");
  return lines.join("\n");
}

const PARSER = new XMLParser({
  preserveOrder: true,
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  trimValues: false,
  parseTagValue: false,
  parseAttributeValue: false,
});

type OrderedNode = Record<string, unknown>;
type OrderedAttributes = Record<string, string>;

/**
 * Parse plain and NexPress-rich XLIFF units without discarding mixed-content
 * order. Unknown inline elements and raw text mixed around inline codes are
 * rejected so import never guesses how a translation maps back to Lexical.
 */
export function parseXliff(xml: string): XliffDocument {
  let parsed: unknown;
  try {
    parsed = PARSER.parse(xml);
  } catch (error) {
    throw new XliffParseError(`Malformed XLIFF XML: ${(error as Error).message}`);
  }
  if (!Array.isArray(parsed)) {
    throw new XliffParseError("Missing root <xliff> element");
  }
  const rootNode = parsed.find(
    (candidate): candidate is OrderedNode => isRecord(candidate) && Array.isArray(candidate.xliff),
  );
  if (!rootNode) {
    throw new XliffParseError("Missing root <xliff> element");
  }

  const rootAttributes = attributes(rootNode);
  if (rootAttributes["@_version"] !== "1.2") {
    throw new XliffParseError('Root <xliff> must declare version="1.2"');
  }

  const files: XliffFile[] = [];
  for (const fileNode of children(rootNode, "xliff").filter((node) => "file" in node)) {
    const fileAttributes = attributes(fileNode);
    const sourceLocale = fileAttributes["@_source-language"];
    const targetLocale = fileAttributes["@_target-language"];
    const original = fileAttributes["@_original"];
    if (!sourceLocale || !targetLocale || !original) {
      throw new XliffParseError(
        "Each <file> must declare source-language, target-language, and original",
      );
    }

    const fileChildren = children(fileNode, "file");
    const bodyNode = fileChildren.find((node) => "body" in node);
    const units: XliffTransUnit[] = [];
    for (const unitNode of bodyNode ? children(bodyNode, "body") : []) {
      if (!("trans-unit" in unitNode)) continue;
      const unitAttributes = attributes(unitNode);
      const id = unitAttributes["@_id"];
      if (!id) {
        throw new XliffParseError(`<trans-unit> in file "${original}" is missing the id attribute`);
      }

      const unitChildren = children(unitNode, "trans-unit");
      const sourceNode = unitChildren.find((node) => "source" in node);
      const targetNode = unitChildren.find((node) => "target" in node);
      const source = parseContent(sourceNode ? children(sourceNode, "source") : [], id, "source");
      const target = parseContent(targetNode ? children(targetNode, "target") : [], id, "target");
      const restype = unitAttributes["@_restype"];
      const hasInline = source.inline !== undefined || target.inline !== undefined;
      if (restype === NP_XLIFF_RICH_TEXT_RESTYPE && source.inline === undefined) {
        throw new XliffParseError(
          `Rich-text trans-unit "${id}" must contain inline codes in <source>`,
        );
      }
      if (hasInline && restype !== NP_XLIFF_RICH_TEXT_RESTYPE) {
        throw new XliffParseError(
          `Inline trans-unit "${id}" must declare restype="${NP_XLIFF_RICH_TEXT_RESTYPE}"`,
        );
      }

      units.push({
        id,
        source: source.text,
        target: target.text,
        ...(source.inline ? { sourceInline: source.inline } : {}),
        ...(target.inline ? { targetInline: target.inline } : {}),
      });
    }
    files.push({ original, sourceLocale, targetLocale, units });
  }
  return { files };
}

export class XliffParseError extends Error {
  override readonly name = "XliffParseError";
}

function renderContent(text: string, inline: XliffInlinePart[] | undefined): string {
  if (!inline) return escapeText(text);
  return inline
    .map((part) => {
      if (part.type === "group") {
        return `<g id="${escapeAttr(part.id)}" ctype="${escapeAttr(part.ctype)}">${escapeText(part.text)}</g>`;
      }
      return `<x id="${escapeAttr(part.id)}" ctype="${escapeAttr(part.ctype)}"/>`;
    })
    .join("");
}

function parseContent(
  nodes: OrderedNode[],
  unitId: string,
  element: "source" | "target",
): { text: string; inline?: XliffInlinePart[] } {
  let plainText = "";
  let sawInline = false;
  const inline: XliffInlinePart[] = [];

  for (const node of nodes) {
    if ("#text" in node) {
      const value = node["#text"];
      const text = orderedText(value);
      if (sawInline && text.trim().length > 0) {
        throw new XliffParseError(
          `Rich-text trans-unit "${unitId}" mixes raw text with inline codes in <${element}>`,
        );
      }
      plainText += text;
      continue;
    }
    if ("g" in node) {
      sawInline = true;
      const partAttributes = attributes(node);
      const id = partAttributes["@_id"];
      const ctype = partAttributes["@_ctype"];
      if (!id || !ctype) {
        throw new XliffParseError(`<g> in trans-unit "${unitId}" must declare id and ctype`);
      }
      const groupChildren = children(node, "g");
      const unsupported = groupChildren.find((child) => !("#text" in child));
      if (unsupported) {
        throw new XliffParseError(
          `<g id="${id}"> in trans-unit "${unitId}" contains unsupported nested markup`,
        );
      }
      const text = groupChildren
        .map((child) => {
          const value = child["#text"];
          return orderedText(value);
        })
        .join("");
      inline.push({ type: "group", id, ctype, text });
      continue;
    }
    if ("x" in node) {
      sawInline = true;
      const partAttributes = attributes(node);
      const id = partAttributes["@_id"];
      const ctype = partAttributes["@_ctype"];
      if (!id || !ctype) {
        throw new XliffParseError(`<x> in trans-unit "${unitId}" must declare id and ctype`);
      }
      inline.push({ type: "placeholder", id, ctype });
      continue;
    }
    const unknown = Object.keys(node).find((key) => key !== ":@");
    if (unknown) {
      throw new XliffParseError(
        `Unsupported <${unknown}> inside trans-unit "${unitId}" <${element}>`,
      );
    }
  }

  if (!sawInline) return { text: plainText };
  if (plainText.trim().length > 0) {
    throw new XliffParseError(
      `Rich-text trans-unit "${unitId}" mixes raw text with inline codes in <${element}>`,
    );
  }
  return {
    text: inline.map((part) => (part.type === "group" ? part.text : "\n")).join(""),
    inline,
  };
}

function children(node: OrderedNode, key: string): OrderedNode[] {
  const value = node[key];
  if (!Array.isArray(value)) return [];
  return value.filter(isRecord);
}

function attributes(node: OrderedNode): OrderedAttributes {
  const value = node[":@"];
  if (!isRecord(value)) return {};
  const out: OrderedAttributes = {};
  for (const [key, candidate] of Object.entries(value)) {
    if (typeof candidate === "string") out[key] = candidate;
  }
  return out;
}

function isRecord(value: unknown): value is OrderedNode {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function orderedText(value: unknown): string {
  return typeof value === "string" ? value : "";
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
