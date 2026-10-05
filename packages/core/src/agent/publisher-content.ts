import type {
  NpAgentJsonObject,
  NpAgentJsonSchema,
  NpAgentVersionBaseV1,
} from "../agent-contract/types.js";
import type { NpFieldConfig } from "../config/types.js";
import { isNpRichTextContent } from "../fields/rich-text.js";

export type NpAgentPublisherFindingV1 =
  | "stale-content"
  | "missing-seo-title"
  | "missing-seo-description"
  | "seo-fields-unknown"
  | "broken-internal-link"
  | "stale-reference"
  | "internal-links-unknown";
export interface NpAgentPublisherRouteInventoryV1 {
  siteId: string;
  complete: boolean;
  routes: readonly { path: string; updatedAt: string | null }[];
}
export interface NpAgentPublisherCandidateV1 {
  collection: string;
  documentId: string;
  base: NpAgentVersionBaseV1;
  updatedAt: string;
  locale: string | null;
  findings: NpAgentPublisherFindingV1[];
  schema: NpAgentJsonSchema;
  content: NpAgentJsonObject;
}
export interface NpAgentPublisherCandidatesV1 {
  observedAt: string;
  scanned: number;
  truncated: boolean;
  candidates: NpAgentPublisherCandidateV1[];
}
/** Full selected schema/content envelope, not per-document allowance. */
export const NP_AGENT_PUBLISHER_PAYLOAD_BYTES = 256 * 1024;
export const NP_AGENT_PUBLISHER_DOCUMENT_BYTES = 48 * 1024;

export function npRequireAgentPublisherRouteInventoryV1(
  value: NpAgentPublisherRouteInventoryV1,
  siteId: string,
): NpAgentPublisherRouteInventoryV1 {
  if (
    value.siteId !== siteId ||
    typeof value.complete !== "boolean" ||
    !Array.isArray(value.routes) ||
    value.routes.length > 2000
  )
    throw new Error("Invalid Publisher route inventory.");
  const paths = new Set<string>();
  for (const route of value.routes) {
    if (
      typeof route.path !== "string" ||
      route.path.length > 2048 ||
      !route.path.startsWith("/") ||
      route.path.startsWith("//") ||
      /[?#\\\s]/u.test(route.path) ||
      paths.has(route.path) ||
      new URL(route.path, "https://publisher.invalid").pathname !== route.path
    )
      throw new Error("Invalid Publisher route inventory.");
    if (
      route.updatedAt !== null &&
      (!Number.isFinite(Date.parse(route.updatedAt)) ||
        new Date(route.updatedAt).toISOString() !== route.updatedAt)
    )
      throw new Error("Invalid Publisher route inventory.");
    paths.add(route.path);
  }
  return { siteId, complete: value.complete, routes: value.routes.map((r) => ({ ...r })) };
}

/** Analyze only fields already projected by the collection read owner; no network or authority. */
export function npAnalyzeAgentPublisherContentV1(input: {
  fields: readonly NpFieldConfig[];
  content: NpAgentJsonObject;
  cutoff: string;
  inventory: NpAgentPublisherRouteInventoryV1 | null;
}): NpAgentPublisherFindingV1[] {
  const findings = new Set<NpAgentPublisherFindingV1>(["stale-content"]);
  let titleKnown = false,
    descriptionKnown = false,
    unknownLinks = false;
  const links: string[] = [];
  const walkRich = (node: unknown, depth = 0): void => {
    if (depth > 32 || links.length > 200)
      throw new Error("Publisher links exceed the bounded limit.");
    if (!node || typeof node !== "object" || Array.isArray(node)) return;
    const row = node as Record<string, unknown>;
    if ((row.type === "link" || row.type === "autolink") && typeof row.url === "string") {
      if (links.length >= 200) throw new Error("Publisher links exceed the bounded limit.");
      links.push(row.url);
    }
    if (Array.isArray(row.children)) for (const child of row.children) walkRich(child, depth + 1);
  };
  const inspect = (
    fields: readonly NpFieldConfig[],
    content: Record<string, unknown>,
    prefix = "",
    depth = 0,
  ): void => {
    if (depth > 16) throw new Error("Publisher fields exceed the bounded limit.");
    for (const field of fields) {
      if (field.type === "row" || field.type === "collapsible") {
        inspect(field.fields, content, prefix, depth + 1);
        continue;
      }
      if (field.hidden === true) continue;
      const value = content[field.name],
        name = `${prefix}${field.name}`;
      if (["seoTitle", "metaTitle", "seo.title", "seo.metaTitle"].includes(name)) {
        titleKnown = true;
        if (typeof value !== "string" || !value.trim()) findings.add("missing-seo-title");
      }
      if (
        ["seoDescription", "metaDescription", "seo.description", "seo.metaDescription"].includes(
          name,
        )
      ) {
        descriptionKnown = true;
        if (typeof value !== "string" || !value.trim()) findings.add("missing-seo-description");
      }
      if (field.type === "group")
        inspect(
          field.fields,
          value && typeof value === "object" && !Array.isArray(value)
            ? (value as Record<string, unknown>)
            : {},
          `${name}.`,
          depth + 1,
        );
      if (field.type === "array" && Array.isArray(value))
        for (const entry of value)
          if (entry && typeof entry === "object" && !Array.isArray(entry))
            inspect(field.fields, entry as Record<string, unknown>, `${name}.`, depth + 1);
      if (field.type === "richText" && value !== null && value !== undefined) {
        if (!isNpRichTextContent(value)) throw new Error("Publisher rich text is unavailable.");
        walkRich(value.document.root);
      }
      if (field.type === "blocks" && value !== undefined && value !== null) unknownLinks = true;
    }
  };
  inspect(input.fields, input.content);
  if (!titleKnown || !descriptionKnown) findings.add("seo-fields-unknown");
  const routes = new Map(input.inventory?.routes.map((r) => [r.path, r]) ?? []);
  for (const link of links) {
    if (link.startsWith("#") || /^(?:mailto:|tel:)/iu.test(link)) continue;
    if (/^https?:/iu.test(link)) {
      unknownLinks = true;
      continue;
    }
    if (
      !link.startsWith("/") ||
      link.startsWith("//") ||
      link.includes("\\") ||
      link.length > 2048
    ) {
      unknownLinks = true;
      continue;
    }
    const path = new URL(link, "https://publisher.invalid").pathname;
    if (!input.inventory?.complete) {
      unknownLinks = true;
      continue;
    }
    const target = routes.get(path);
    if (!target) findings.add("broken-internal-link");
    else if (target.updatedAt !== null && target.updatedAt < input.cutoff)
      findings.add("stale-reference");
  }
  if (unknownLinks || input.inventory === null || !input.inventory.complete)
    findings.add("internal-links-unknown");
  return [...findings].sort();
}
export function npRankAgentPublisherCandidatesV1(
  candidates: readonly NpAgentPublisherCandidateV1[],
): NpAgentPublisherCandidateV1[] {
  const score = (c: NpAgentPublisherCandidateV1) =>
    c.findings.reduce(
      (n, f) =>
        n +
        (f === "broken-internal-link"
          ? 4
          : f === "missing-seo-title" || f === "missing-seo-description"
            ? 2
            : f === "stale-reference"
              ? 1
              : 0),
      0,
    );
  return [...candidates].sort(
    (a, b) =>
      score(b) - score(a) ||
      a.updatedAt.localeCompare(b.updatedAt) ||
      a.collection.localeCompare(b.collection) ||
      a.documentId.localeCompare(b.documentId),
  );
}
