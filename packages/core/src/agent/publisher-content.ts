import type {
  NpAgentJsonObject,
  NpAgentJsonSchema,
  NpAgentVersionBaseV1,
  NpAgentProviderRequestCanonicalV1,
} from "../agent-contract/types.js";
import { createHash } from "node:crypto";
import { npRequireAgentVersionBase } from "../agent-contract/changeset-contract.js";
import type { NpFieldConfig } from "../config/types.js";
import { isNpRichTextContent } from "../fields/rich-text.js";
import { serializeAgentCanonicalJson } from "../agent-contract/canonical-foundation.js";

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
  /** Persist only through an explicitly versioned Runtime context profile. */
  selectionReceipt: NpAgentPublisherSelectionReceiptV1;
}
export interface NpAgentPublisherSelectionReceiptV1 {
  readonly schemaVersion: "np.agent-publisher-selection-receipt.v1";
  readonly observedAt: string;
  readonly criteria: {
    readonly collectionSlugs: readonly string[];
    readonly staleBefore: string;
    readonly candidateLimit: number;
    readonly batchSize: number;
    readonly audience: "public";
    readonly status: "published";
    readonly ranking: "bounded-findings-age-identity.v1";
  };
  readonly coverage: {
    readonly candidateSample: "complete" | "partial";
    readonly routeInventory: "complete" | "partial" | "unavailable";
  };
  /** Counts only projected, anonymously readable observations, never hidden query rows. */
  readonly counts: {
    readonly scanned: number;
    readonly admitted: number;
    readonly selected: number;
  };
  /** No document identities, field values, ACL decisions or exception details. */
  readonly exclusions: readonly {
    readonly code: "unavailable" | "oversized" | "batch-limit";
    readonly count: number;
  }[];
}

export interface NpAgentPublisherSelectionDiagnosticV2 {
  schemaVersion: "np.agent-publisher-selection-diagnostic.v2";
  requestDigest: string;
  selectionDigest: string;
  selectionReceipt: NpAgentPublisherSelectionReceiptV1;
  candidateSnapshot: Array<{
    evidenceId: string;
    collection: string;
    documentId: string;
    base: NpAgentVersionBaseV1;
    updatedAt: string;
    locale: string | null;
    findings: NpAgentPublisherFindingV1[];
    contentDigest: string;
  }>;
}

/** Retains selected public identities/bases and source hashes, never raw content or exclusions. */
export function npRequireAgentPublisherSelectionDiagnosticV2(
  request: NpAgentProviderRequestCanonicalV1,
  requestDigest: string,
): NpAgentPublisherSelectionDiagnosticV2 {
  const invalid = (): never => {
    throw new Error("Invalid Publisher selection snapshot.");
  };
  const hash = (domain: string, value: unknown) =>
    `cj1:sha256:${createHash("sha256")
      .update(`${domain}\0${serializeAgentCanonicalJson(value)}`)
      .digest("base64url")}`;
  const exact = (value: unknown, keys: string[]): Record<string, unknown> => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return invalid();
    const row = value as Record<string, unknown>;
    if (Object.keys(row).length !== keys.length || keys.some((key) => !Object.hasOwn(row, key)))
      return invalid();
    return row;
  };
  const entries = request.trustedContext.filter((entry) => entry.id === "publisher-candidates");
  if (entries.length !== 1 || !/^cj1:sha256:[A-Za-z0-9_-]{43}$/u.test(requestDigest))
    return invalid();
  const entry = entries[0];
  const metadata = exact(JSON.parse(entry.text), [
    "observedAt",
    "scanned",
    "truncated",
    "candidates",
    "selectionReceipt",
  ]);
  const receipt = npRequireAgentPublisherSelectionReceiptV1(metadata.selectionReceipt);
  if (
    entry.kind !== "server-fact" ||
    entry.classification.dataClass !== "sensitive-approved" ||
    entry.digest !== hash("np.agent-runtime-publisher-candidates.v1", metadata) ||
    entry.classification.sourceDigest !== entry.digest ||
    metadata.observedAt !== receipt.observedAt ||
    metadata.scanned !== receipt.counts.scanned ||
    typeof metadata.truncated !== "boolean" ||
    metadata.truncated !== (receipt.coverage.candidateSample === "partial") ||
    !Array.isArray(metadata.candidates) ||
    metadata.candidates.length !== receipt.counts.selected
  )
    return invalid();
  const findings: NpAgentPublisherFindingV1[] = [
    "stale-content",
    "missing-seo-title",
    "missing-seo-description",
    "seo-fields-unknown",
    "broken-internal-link",
    "stale-reference",
    "internal-links-unknown",
  ];
  const keys = new Set<string>();
  const candidateSnapshot = metadata.candidates.map((value, index) => {
    const row = exact(value, [
      "evidenceId",
      "collection",
      "documentId",
      "base",
      "updatedAt",
      "locale",
      "findings",
    ]);
    const evidenceId = `publisher-content-${index.toString().padStart(3, "0")}`;
    if (
      row.evidenceId !== evidenceId ||
      typeof row.collection !== "string" ||
      !receipt.criteria.collectionSlugs.includes(row.collection) ||
      typeof row.documentId !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(
        row.documentId,
      ) ||
      typeof row.updatedAt !== "string" ||
      !Number.isFinite(Date.parse(row.updatedAt)) ||
      new Date(row.updatedAt).toISOString() !== row.updatedAt ||
      row.updatedAt >= receipt.criteria.staleBefore ||
      !(
        row.locale === null ||
        (typeof row.locale === "string" && /^[A-Za-z0-9_-]{1,64}$/u.test(row.locale))
      ) ||
      !Array.isArray(row.findings) ||
      row.findings.length > findings.length ||
      row.findings.some((finding) => !findings.includes(finding)) ||
      new Set(row.findings).size !== row.findings.length ||
      !row.findings.includes("stale-content")
    )
      return invalid();
    const key = `${row.collection}:${row.documentId}`;
    if (keys.has(key)) return invalid();
    keys.add(key);
    const sources = request.untrustedEvidence.filter((source) => source.id === evidenceId);
    const source = sources[0];
    if (
      sources.length !== 1 ||
      source.kind !== "content" ||
      source.classification.dataClass !== "sensitive-approved" ||
      source.classification.sourceDigest !== source.digest ||
      source.observedAt !== row.updatedAt
    )
      return invalid();
    return {
      evidenceId,
      collection: row.collection,
      documentId: row.documentId,
      base: npRequireAgentVersionBase(row.base),
      updatedAt: row.updatedAt,
      locale: row.locale,
      findings: [...row.findings] as NpAgentPublisherFindingV1[],
      contentDigest: source.digest,
    };
  });
  return {
    schemaVersion: "np.agent-publisher-selection-diagnostic.v2",
    requestDigest,
    selectionDigest: entry.digest,
    selectionReceipt: receipt,
    candidateSnapshot,
  };
}

/** Freeze a safe receipt before the Runtime owner persists its pre-dispatch ledger diagnostic. */
export function npCreateAgentPublisherSelectionReceiptV1(input: {
  observedAt: string;
  collectionSlugs: readonly string[];
  staleBefore: string;
  candidateLimit: number;
  batchSize: number;
  partial: boolean;
  inventory: NpAgentPublisherRouteInventoryV1 | null;
  scanned: number;
  admitted: number;
  selected: number;
  unavailable: number;
  oversized: number;
}): NpAgentPublisherSelectionReceiptV1 {
  return npRequireAgentPublisherSelectionReceiptV1({
    schemaVersion: "np.agent-publisher-selection-receipt.v1",
    observedAt: input.observedAt,
    criteria: Object.freeze({
      collectionSlugs: Object.freeze([...input.collectionSlugs]),
      staleBefore: input.staleBefore,
      candidateLimit: input.candidateLimit,
      batchSize: input.batchSize,
      audience: "public",
      status: "published",
      ranking: "bounded-findings-age-identity.v1",
    }),
    coverage: Object.freeze({
      candidateSample: input.partial ? "partial" : "complete",
      routeInventory:
        input.inventory === null
          ? "unavailable"
          : input.inventory.complete
            ? "complete"
            : "partial",
    }),
    counts: Object.freeze({
      scanned: input.scanned,
      admitted: input.admitted,
      selected: input.selected,
    }),
    exclusions: Object.freeze(
      [
        { code: "unavailable" as const, count: input.unavailable },
        { code: "oversized" as const, count: input.oversized },
        { code: "batch-limit" as const, count: input.admitted - input.selected },
      ]
        .filter(({ count }) => count > 0)
        .map((exclusion) => Object.freeze(exclusion)),
    ),
  });
}

/** Exact safe reconstruction for the pre-dispatch diagnostic receipt; rejects extra evidence. */
export function npRequireAgentPublisherSelectionReceiptV1(
  value: unknown,
): NpAgentPublisherSelectionReceiptV1 {
  const invalid = (): never => {
    throw new Error("Invalid Publisher selection receipt.");
  };
  const encoded = serializeAgentCanonicalJson(value);
  if (new TextEncoder().encode(encoded).byteLength > 8192) invalid();
  const object = (entry: unknown, keys: readonly string[]): Record<string, unknown> => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return invalid();
    const row = entry as Record<string, unknown>;
    if (Object.keys(row).length !== keys.length || keys.some((key) => !Object.hasOwn(row, key)))
      return invalid();
    return row;
  };
  const row = object(JSON.parse(encoded), [
    "schemaVersion",
    "observedAt",
    "criteria",
    "coverage",
    "counts",
    "exclusions",
  ]);
  const criteria = object(row.criteria, [
    "collectionSlugs",
    "staleBefore",
    "candidateLimit",
    "batchSize",
    "audience",
    "status",
    "ranking",
  ]);
  const coverage = object(row.coverage, ["candidateSample", "routeInventory"]);
  const counts = object(row.counts, ["scanned", "admitted", "selected"]);
  const time = (entry: unknown): string => {
    if (
      typeof entry !== "string" ||
      !Number.isFinite(Date.parse(entry)) ||
      new Date(entry).toISOString() !== entry
    )
      return invalid();
    return entry;
  };
  const integer = (entry: unknown, min: number, max: number): number => {
    if (typeof entry !== "number" || !Number.isSafeInteger(entry) || entry < min || entry > max)
      return invalid();
    return entry;
  };
  if (
    row.schemaVersion !== "np.agent-publisher-selection-receipt.v1" ||
    criteria.audience !== "public" ||
    criteria.status !== "published" ||
    criteria.ranking !== "bounded-findings-age-identity.v1" ||
    !Array.isArray(criteria.collectionSlugs) ||
    criteria.collectionSlugs.length < 1 ||
    criteria.collectionSlugs.length > 32 ||
    criteria.collectionSlugs.some(
      (slug, index, slugs) =>
        typeof slug !== "string" ||
        !/^[a-z][a-z0-9-]{0,95}$/u.test(slug) ||
        (index > 0 && slugs[index - 1] >= slug),
    ) ||
    !["complete", "partial"].includes(String(coverage.candidateSample)) ||
    !["complete", "partial", "unavailable"].includes(String(coverage.routeInventory)) ||
    !Array.isArray(row.exclusions) ||
    row.exclusions.length > 3
  )
    return invalid();
  const observedAt = time(row.observedAt),
    staleBefore = time(criteria.staleBefore);
  if (staleBefore >= observedAt) return invalid();
  const candidateLimit = integer(criteria.candidateLimit, 1, 50),
    batchSize = integer(criteria.batchSize, 1, 5);
  const scanned = integer(counts.scanned, 0, candidateLimit),
    admitted = integer(counts.admitted, 0, scanned),
    selected = integer(counts.selected, 0, Math.min(admitted, batchSize));
  const exclusionCodes = ["unavailable", "oversized", "batch-limit"] as const;
  const exclusions = row.exclusions.map((entry) => {
    const exclusion = object(entry, ["code", "count"]);
    if (!exclusionCodes.includes(exclusion.code as (typeof exclusionCodes)[number]))
      return invalid();
    return {
      code: exclusion.code as (typeof exclusionCodes)[number],
      count: integer(exclusion.count, 1, candidateLimit),
    };
  });
  if (
    selected !== Math.min(admitted, batchSize) ||
    exclusions.some(
      (entry, index) =>
        index > 0 &&
        exclusionCodes.indexOf(exclusions[index - 1].code) >= exclusionCodes.indexOf(entry.code),
    ) ||
    exclusions.reduce((sum, entry) => sum + entry.count, 0) !== scanned - selected ||
    (exclusions.find((entry) => entry.code === "batch-limit")?.count ?? 0) !==
      admitted - selected ||
    (exclusions.length > 0 && coverage.candidateSample !== "partial")
  )
    return invalid();
  return Object.freeze({
    schemaVersion: "np.agent-publisher-selection-receipt.v1",
    observedAt,
    criteria: Object.freeze({
      collectionSlugs: Object.freeze([...criteria.collectionSlugs] as string[]),
      staleBefore,
      candidateLimit,
      batchSize,
      audience: "public",
      status: "published",
      ranking: "bounded-findings-age-identity.v1",
    }),
    coverage: Object.freeze({
      candidateSample: coverage.candidateSample as "complete" | "partial",
      routeInventory: coverage.routeInventory as "complete" | "partial" | "unavailable",
    }),
    counts: Object.freeze({ scanned, admitted, selected }),
    exclusions: Object.freeze(exclusions.map((entry) => Object.freeze(entry))),
  });
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
      if (["seoTitle", "seoMetaTitle", "metaTitle", "seo.title", "seo.metaTitle"].includes(name)) {
        titleKnown = true;
        if (typeof value !== "string" || !value.trim()) findings.add("missing-seo-title");
      }
      if (
        [
          "seoDescription",
          "seoMetaDescription",
          "metaDescription",
          "seo.description",
          "seo.metaDescription",
        ].includes(name)
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
    else if (target.updatedAt === null) unknownLinks = true;
    else if (target.updatedAt < input.cutoff) findings.add("stale-reference");
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
