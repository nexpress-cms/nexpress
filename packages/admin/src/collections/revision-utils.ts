"use client";

import { isNpRichTextContent } from "@nexpress/core/fields";
import {
  npAnalyzeAutosaveRevisionWireResult,
  npAnalyzeRevisionWire,
  npAnalyzeRevisionWireList,
  type NpAutosaveRevisionWireResult,
  type NpRevisionWire,
  type NpRevisionWireList,
  type NpRevisionWireSummary,
} from "@nexpress/core/revisions";

export type RevisionSummary = NpRevisionWireSummary;
export type RevisionDetail = NpRevisionWire;

function invalidResponse(issues: Array<{ path: string; message: string }>): Error {
  const first = issues[0];
  return new Error(
    first
      ? `Invalid revision API response at ${first.path}: ${first.message}`
      : "Invalid revision API response",
  );
}

export function parseRevisionListResponse(value: unknown): NpRevisionWireList {
  const result = npAnalyzeRevisionWireList(value);
  if (!result.ok) throw invalidResponse(result.issues);
  return result.value;
}

export function parseRevisionDetailResponse(value: unknown): NpRevisionWire {
  const result = npAnalyzeRevisionWire(value);
  if (!result.ok) throw invalidResponse(result.issues);
  return result.value;
}

export function parseAutosaveResponse(value: unknown): NpAutosaveRevisionWireResult {
  const result = npAnalyzeAutosaveRevisionWireResult(value);
  if (!result.ok) throw invalidResponse(result.issues);
  return result.value;
}

export function formatRevisionDate(value: string): string {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString();
}

export function snapshotValueKey(value: unknown): string {
  try {
    return JSON.stringify(value ?? null);
  } catch {
    return String(value);
  }
}

const authoringFieldPriority = new Map<string, number>([
  ["title", 0],
  ["slug", 1],
  ["content", 2],
  ["excerpt", 3],
  ["status", 4],
  ["publishedAt", 5],
]);

function fieldPriority(path: string): number {
  return (
    authoringFieldPriority.get(path) ?? authoringFieldPriority.get(path.split(".")[0] ?? "") ?? 100
  );
}

export function sortAuthoringDiffFields(fields: string[]): string[] {
  return [...fields].sort((a, b) => {
    const priorityDiff = fieldPriority(a) - fieldPriority(b);
    return priorityDiff === 0 ? a.localeCompare(b) : priorityDiff;
  });
}

export function diffSnapshotFields(
  current: Record<string, unknown>,
  revision: Record<string, unknown>,
): string[] {
  const keys = new Set([...Object.keys(current), ...Object.keys(revision)]);
  return sortAuthoringDiffFields(
    Array.from(keys).filter(
      (key) => snapshotValueKey(current[key]) !== snapshotValueKey(revision[key]),
    ),
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function collectText(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    return value
      .map((item) => collectText(item))
      .filter(Boolean)
      .join(" ");
  }
  if (!isRecord(value)) return "";

  const parts: string[] = [];
  if (typeof value.text === "string") {
    parts.push(value.text);
  }
  if (Array.isArray(value.children)) {
    const childText = collectText(value.children);
    if (childText) parts.push(childText);
  }
  if (isNpRichTextContent(value)) {
    const documentText = collectText(value.document.root);
    if (documentText) parts.push(documentText);
  }
  return parts.join(" ");
}

function countLexicalBlocks(value: unknown): number {
  if (!isNpRichTextContent(value)) return 0;
  return value.document.root.children.length;
}

function plural(count: number, singular: string, pluralLabel = `${singular}s`): string {
  return `${count.toString()} ${count === 1 ? singular : pluralLabel}`;
}

export function summarizeSnapshotValue(value: unknown): string {
  if (value === null || value === undefined || value === "") {
    return "Empty";
  }

  if (typeof value === "string") {
    return value.length > 90 ? `${value.slice(0, 87)}...` : value;
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  if (Array.isArray(value)) {
    if (value.length === 0) return "Empty list";
    const blockTypes = value
      .map((item) => {
        if (!isRecord(item)) return null;
        const type = item.blockType ?? item.type;
        return typeof type === "string" ? type : null;
      })
      .filter((type): type is string => Boolean(type));
    if (blockTypes.length > 0) {
      const uniqueTypes = Array.from(new Set(blockTypes)).slice(0, 3).join(", ");
      return `${plural(value.length, "block")} (${uniqueTypes})`;
    }
    return plural(value.length, "item");
  }

  if (isRecord(value)) {
    if (isNpRichTextContent(value)) {
      const text = collectText(value).trim();
      const wordCount = text.length > 0 ? text.split(/\s+/).filter(Boolean).length : 0;
      const blockCount = countLexicalBlocks(value);
      if (wordCount > 0 || blockCount > 0) {
        return `${plural(wordCount, "word")} across ${plural(blockCount, "block")}`;
      }
      return "Empty rich text";
    }

    return plural(Object.keys(value).length, "field");
  }

  return "Unsupported value";
}
