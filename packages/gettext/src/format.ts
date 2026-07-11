import { po } from "gettext-parser";
import {
  NP_TRANSLATION_UNIT_ID_MAX_LENGTH,
  type NpTranslationCatalog,
  type NpTranslationDocument,
  type NpTranslationInlinePart,
  type NpTranslationUnit,
} from "@nexpress/translation";
import {
  type GetTextTranslation,
  type GetTextTranslationRecord,
  type GetTextTranslations,
} from "gettext-parser";

const CATALOG_VERSION = "1";
const CONTEXT_PREFIX = "np:content:";
const MAX_PO_BYTES = 16 * 1024 * 1024;
const MAX_CONTEXT_LENGTH = 8192;
const MAX_ROUTE_LENGTH = 1024;
const MAX_UNITS = 100_000;
const INLINE_TOKEN_PREFIX = "{NP:";

interface ContextDescriptor {
  route: string;
  unitId: string;
  inline: boolean;
}

/** Render one collection/locale-pair catalog as deterministic Gettext PO. */
export function renderGettext(catalog: NpTranslationCatalog): string {
  const locales = catalogLocales(catalog.documents);
  const translations: GetTextTranslationRecord = { "": {} };
  const seenContexts = new Set<string>();

  for (const document of catalog.documents) {
    for (const unit of document.units) {
      const inline = unit.sourceInline !== undefined || unit.targetInline !== undefined;
      if (inline && (!unit.sourceInline || !unit.targetInline)) {
        throw new GettextRenderError(
          `Inline unit "${unit.id}" must provide both source and target structures`,
        );
      }
      if (inline && !hasSameInlineShape(unit.sourceInline!, unit.targetInline!)) {
        throw new GettextRenderError(
          `Inline unit "${unit.id}" has missing, changed, or reordered protected tokens`,
        );
      }
      const context = renderContext({ route: document.route, unitId: unit.id, inline });
      if (seenContexts.has(context)) {
        throw new GettextRenderError(
          `Duplicate translation unit "${unit.id}" in document "${document.route}"`,
        );
      }
      seenContexts.add(context);

      const msgid = inline ? renderProtectedInline(unit.sourceInline!) : unit.source;
      const msgstr = inline ? renderProtectedInline(unit.targetInline!) : unit.target;
      translations[context] = {
        [msgid]: {
          msgctxt: context,
          msgid,
          msgstr: [msgstr],
          comments: {
            extracted: inline
              ? "NexPress protected rich text: translate text between {NP:G:...} and {NP:/G}; keep every {NP:...} token unchanged."
              : "NexPress content translation: keep msgctxt unchanged.",
          },
        },
      };
    }
  }

  const table: GetTextTranslations = {
    charset: "utf-8",
    headers: {
      "Project-Id-Version": "NexPress content",
      "MIME-Version": "1.0",
      "Content-Type": "text/plain; charset=UTF-8",
      "Content-Transfer-Encoding": "8bit",
      Language: locales.targetLocale,
      "X-Nexpress-Source-Language": locales.sourceLocale,
      "X-Nexpress-Catalog-Version": CATALOG_VERSION,
    },
    translations,
  };

  return po.compile(table, { foldLength: 0, sort: false, eol: "\n" }).toString("utf8");
}

/** Parse the NexPress Gettext subset into the shared translation catalog. */
export function parseGettext(input: string | Buffer): NpTranslationCatalog {
  const size = typeof input === "string" ? Buffer.byteLength(input) : input.byteLength;
  if (size > MAX_PO_BYTES) {
    throw new GettextParseError(`PO input exceeds the ${MAX_PO_BYTES}-byte limit`);
  }

  let table: GetTextTranslations;
  try {
    table = po.parse(input, { validation: true });
  } catch (error) {
    throw new GettextParseError(`Malformed PO input: ${(error as Error).message}`);
  }

  const sourceLocale = header(table, "X-Nexpress-Source-Language");
  const targetLocale = header(table, "Language");
  const version = header(table, "X-Nexpress-Catalog-Version");
  if (!sourceLocale || !targetLocale || version !== CATALOG_VERSION) {
    throw new GettextParseError(
      "PO headers must declare Language, X-Nexpress-Source-Language, and X-Nexpress-Catalog-Version: 1",
    );
  }
  if (sourceLocale === targetLocale) {
    throw new GettextParseError("PO source and target languages must differ");
  }

  const documents = new Map<string, NpTranslationDocument>();
  let unitCount = 0;
  for (const [context, messages] of Object.entries(table.translations)) {
    if (context === "") {
      const unscoped = Object.values(messages).find((message) => message.msgid !== "");
      if (unscoped) {
        throw new GettextParseError(`Message "${unscoped.msgid}" is missing NexPress msgctxt`);
      }
      continue;
    }
    const descriptor = parseContext(context);
    if (!descriptor) {
      throw new GettextParseError(`Unsupported or malformed msgctxt "${context}"`);
    }
    for (const message of Object.values(messages)) {
      unitCount++;
      if (unitCount > MAX_UNITS) {
        throw new GettextParseError(`PO input exceeds the ${MAX_UNITS}-unit limit`);
      }
      validateMessage(message, context);
      const unit = parseMessage(message, descriptor);
      let document = documents.get(descriptor.route);
      if (!document) {
        document = {
          route: descriptor.route,
          sourceLocale,
          targetLocale,
          units: [],
        };
        documents.set(descriptor.route, document);
      }
      document.units.push(unit);
    }
  }

  return { documents: [...documents.values()] };
}

export class GettextRenderError extends Error {
  override readonly name = "GettextRenderError";
}

export class GettextParseError extends Error {
  override readonly name = "GettextParseError";
}

function catalogLocales(documents: NpTranslationDocument[]): {
  sourceLocale: string;
  targetLocale: string;
} {
  const first = documents[0];
  if (!first) throw new GettextRenderError("Cannot render an empty translation catalog");
  for (const document of documents) {
    if (
      document.sourceLocale !== first.sourceLocale ||
      document.targetLocale !== first.targetLocale
    ) {
      throw new GettextRenderError("Every PO document must use the same locale pair");
    }
  }
  if (first.sourceLocale === first.targetLocale) {
    throw new GettextRenderError("PO source and target languages must differ");
  }
  return { sourceLocale: first.sourceLocale, targetLocale: first.targetLocale };
}

function renderContext(descriptor: ContextDescriptor): string {
  if (
    descriptor.route.length === 0 ||
    descriptor.route.length > MAX_ROUTE_LENGTH ||
    descriptor.unitId.length === 0 ||
    descriptor.unitId.length > NP_TRANSLATION_UNIT_ID_MAX_LENGTH
  ) {
    throw new GettextRenderError(`Translation route or unit id is outside supported limits`);
  }
  const encoded = Buffer.from(JSON.stringify(descriptor), "utf8").toString("base64url");
  const context = `${CONTEXT_PREFIX}${encoded}`;
  if (context.length > MAX_CONTEXT_LENGTH) {
    throw new GettextRenderError(`Translation context for "${descriptor.unitId}" is too long`);
  }
  return context;
}

function parseContext(context: string): ContextDescriptor | null {
  if (!context.startsWith(CONTEXT_PREFIX) || context.length > MAX_CONTEXT_LENGTH) return null;
  try {
    const encoded = context.slice(CONTEXT_PREFIX.length);
    const decoded = Buffer.from(encoded, "base64url").toString("utf8");
    if (Buffer.from(decoded, "utf8").toString("base64url") !== encoded) return null;
    const value: unknown = JSON.parse(decoded);
    if (!isRecord(value)) return null;
    const keys = Object.keys(value);
    if (
      keys.length !== 3 ||
      !keys.includes("route") ||
      !keys.includes("unitId") ||
      !keys.includes("inline")
    ) {
      return null;
    }
    if (
      typeof value.route !== "string" ||
      value.route.length === 0 ||
      value.route.length > MAX_ROUTE_LENGTH ||
      typeof value.unitId !== "string" ||
      value.unitId.length === 0 ||
      value.unitId.length > NP_TRANSLATION_UNIT_ID_MAX_LENGTH ||
      typeof value.inline !== "boolean"
    ) {
      return null;
    }
    return { route: value.route, unitId: value.unitId, inline: value.inline };
  } catch {
    return null;
  }
}

function validateMessage(message: GetTextTranslation, context: string): void {
  if (message.msgctxt !== context) {
    throw new GettextParseError(`Message under "${context}" has a mismatched msgctxt`);
  }
  if (message.msgid_plural !== undefined || message.msgstr.length !== 1) {
    throw new GettextParseError(`Plural message "${message.msgid}" is not supported`);
  }
}

function parseMessage(
  message: GetTextTranslation,
  descriptor: ContextDescriptor,
): NpTranslationUnit {
  const target = message.msgstr[0] ?? "";
  if (!descriptor.inline) {
    return { id: descriptor.unitId, source: message.msgid, target };
  }

  const sourceInline = parseProtectedInline(message.msgid, descriptor.unitId, "msgid");
  const targetInline =
    target.length === 0
      ? sourceInline.map((part) => (part.type === "group" ? { ...part, text: "" } : { ...part }))
      : parseProtectedInline(target, descriptor.unitId, "msgstr");
  if (!hasSameInlineShape(sourceInline, targetInline)) {
    throw inlineError(
      descriptor.unitId,
      "msgstr",
      "has missing, changed, or reordered protected tokens",
    );
  }
  return {
    id: descriptor.unitId,
    source: inlinePlainText(sourceInline),
    target: inlinePlainText(targetInline),
    sourceInline,
    targetInline,
  };
}

function renderProtectedInline(parts: NpTranslationInlinePart[]): string {
  return parts
    .map((part) => {
      const id = encodeTokenValue(part.id);
      const ctype = encodeTokenValue(part.ctype);
      if (part.type === "placeholder") return `{NP:X:${id}:${ctype}}`;
      return `{NP:G:${id}:${ctype}}${part.text.replaceAll("{", "{{")}{NP:/G}`;
    })
    .join("");
}

function parseProtectedInline(
  value: string,
  unitId: string,
  field: "msgid" | "msgstr",
): NpTranslationInlinePart[] {
  const parts: NpTranslationInlinePart[] = [];
  let position = 0;
  while (position < value.length) {
    if (!value.startsWith(INLINE_TOKEN_PREFIX, position)) {
      throw inlineError(unitId, field, "contains text outside protected group tokens");
    }
    const tokenEnd = value.indexOf("}", position);
    if (tokenEnd < 0) throw inlineError(unitId, field, "contains an unterminated token");
    const token = value.slice(position + 1, tokenEnd);
    const tokenParts = token.split(":");
    if (tokenParts[0] !== "NP") throw inlineError(unitId, field, "contains an unknown token");

    if (tokenParts[1] === "X" && tokenParts.length === 4) {
      parts.push({
        type: "placeholder",
        id: decodeTokenValue(tokenParts[2], unitId, field),
        ctype: decodeTokenValue(tokenParts[3], unitId, field),
      });
      position = tokenEnd + 1;
      continue;
    }
    if (tokenParts[1] !== "G" || tokenParts.length !== 4) {
      throw inlineError(unitId, field, "contains an invalid opening token");
    }
    const close = "{NP:/G}";
    const closeIndex = findUnescapedClose(value, close, tokenEnd + 1);
    if (closeIndex < 0) throw inlineError(unitId, field, "is missing a closing group token");
    const rawText = value.slice(tokenEnd + 1, closeIndex);
    parts.push({
      type: "group",
      id: decodeTokenValue(tokenParts[2], unitId, field),
      ctype: decodeTokenValue(tokenParts[3], unitId, field),
      text: unescapeInlineText(rawText, unitId, field),
    });
    position = closeIndex + close.length;
  }
  if (parts.length === 0) throw inlineError(unitId, field, "contains no protected tokens");
  return parts;
}

function findUnescapedClose(value: string, close: string, start: number): number {
  let position = start;
  while (position < value.length) {
    const candidate = value.indexOf(close, position);
    if (candidate < 0) return -1;
    let precedingBraces = 0;
    while (candidate - precedingBraces - 1 >= start) {
      if (value[candidate - precedingBraces - 1] !== "{") break;
      precedingBraces++;
    }
    if (precedingBraces % 2 === 0) return candidate;
    position = candidate + 1;
  }
  return -1;
}

function encodeTokenValue(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}

function decodeTokenValue(value: string, unitId: string, field: string): string {
  const decoded = Buffer.from(value, "base64url").toString("utf8");
  if (
    decoded.length === 0 ||
    decoded.length > 256 ||
    Buffer.from(decoded, "utf8").toString("base64url") !== value
  ) {
    throw inlineError(unitId, field, "contains an invalid token value");
  }
  return decoded;
}

function unescapeInlineText(value: string, unitId: string, field: string): string {
  let output = "";
  for (let index = 0; index < value.length; index++) {
    if (value.startsWith("{{", index)) {
      output += "{";
      index++;
      continue;
    }
    if (value.startsWith(INLINE_TOKEN_PREFIX, index)) {
      throw inlineError(unitId, field, "contains a nested or reordered token");
    }
    output += value[index];
  }
  return output;
}

function inlinePlainText(parts: NpTranslationInlinePart[]): string {
  return parts.map((part) => (part.type === "group" ? part.text : "\n")).join("");
}

function hasSameInlineShape(
  source: NpTranslationInlinePart[],
  target: NpTranslationInlinePart[],
): boolean {
  return (
    source.length === target.length &&
    source.every((part, index) => {
      const candidate = target[index];
      return (
        candidate !== undefined &&
        candidate.type === part.type &&
        candidate.id === part.id &&
        candidate.ctype === part.ctype
      );
    })
  );
}

function inlineError(unitId: string, field: string, detail: string): GettextParseError {
  return new GettextParseError(`Inline unit "${unitId}" ${field} ${detail}`);
}

function header(table: GetTextTranslations, name: string): string {
  const exact = table.headers[name];
  if (typeof exact === "string") return exact.trim();
  const match = Object.entries(table.headers).find(
    ([candidate]) => candidate.toLowerCase() === name.toLowerCase(),
  );
  return typeof match?.[1] === "string" ? match[1].trim() : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
