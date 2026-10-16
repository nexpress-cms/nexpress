import { createHash } from "node:crypto";
import { getCollectionConfig, getCollectionZodSchema } from "@nexpress/core/collections";
import {
  npAnalyzeAgentPublisherContentV1,
  npRequireAgentPublisherRouteInventoryV1,
  npInspectAgentRenderedAccessibilityV1,
  type NpAgentRenderedAccessibilityReportV1,
  type NpAgentOperatorHostContextV1,
  type NpAgentPublisherRouteInventoryV1,
  type NpAgentReadCapabilityExecutorsV1,
} from "@nexpress/core/agents";
import {
  npRequireAgentContentQueryOutputV1,
  npRequireAgentSchemaGetOutputV1,
  type NpAgentAuditCheckFamily,
  type NpAgentAuditRunInputV1,
} from "@nexpress/core/agent-contract";
import type { NpFieldConfig } from "@nexpress/core";

type Request = NpAgentOperatorHostContextV1 & {
  input: NpAgentAuditRunInputV1;
  auditId: string;
};
type Status = "pass" | "warn" | "fail" | "unknown";
type NamedField = Exclude<NpFieldConfig, { type: "row" } | { type: "collapsible" }>;
export interface NpAgentOperatorAuditObservationV1 {
  /** Unknown is distinct from an observed warning; older ok/warn/error readers remain valid. */
  state: "ok" | "warn" | "error" | "unknown";
  evidenceRefs: string[];
  targetCount?: number;
  /** Unknown attempted reads reserve their budget so later families cannot reuse it. */
  consumedTargets?: number;
}
const accessibilityIds = [
  "html.lang",
  "image.alt",
  "control.name",
  "link.name",
  "id.unique",
] as const;
export interface NpAgentOperatorRenderedAccessibilityReportV1 {
  schemaVersion: NpAgentRenderedAccessibilityReportV1["schemaVersion"];
  /** Computed from the exact supplied HTML by npDigestAgentOperatorRenderedHtmlV1. */
  htmlDigest: string;
  checks: Array<{
    id: NpAgentRenderedAccessibilityReportV1["checks"][number]["id"];
    status: Status;
  }>;
}
export interface NpAgentOperatorSecurityReportV1 {
  schemaVersion: "np.agent-operator-deterministic-security.v1";
  siteId: string;
  sourceId: string;
  sourceDigest: string;
  observedAt: string;
  complete: boolean;
  checks: Array<{ id: string; status: Status }>;
}
/** Fixed host installation, never capability-selected callbacks, code, URLs or report paths. */
export interface NpAgentOperatorAuditObservationOwnersV1 {
  families: readonly NpAgentAuditCheckFamily[];
  content?: {
    /** Existing Core executors retain current requester, collection, item and site ACLs. */
    readSchema: NpAgentReadCapabilityExecutorsV1["schema.get"];
    readContent: NpAgentReadCapabilityExecutorsV1["content.query"];
    /** Canonical public routing owner; incomplete coverage never proves a broken link. */
    routeInventory?: (request: Request) => Promise<NpAgentPublisherRouteInventoryV1>;
  };
  accessibility?: {
    /** Actual render owner must honor current site, original requester and selected collections; no network probing. */
    selectRendered(request: Request): Promise<{
      complete: boolean;
      targets: Array<{ html: string }>;
    }>;
    /** Optional trusted deterministic override; absence uses the actual framework static HTML checks. */
    checkRendered?: (
      html: string,
      request: Request,
    ) => Promise<NpAgentOperatorRenderedAccessibilityReportV1>;
  };
  security?: {
    /** Exact stable check inventory and provenance supplied by the deterministic owner. */
    sourceId: string;
    checkIds: readonly string[];
    maximumAgeSeconds?: number;
    read(request: Request): Promise<NpAgentOperatorSecurityReportV1 | null>;
  };
}
const digestPattern = /^cj1:sha256:[A-Za-z0-9_-]{43}$/u;
const tokenPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,95}$/u;
const statuses = new Set<Status>(["pass", "warn", "fail", "unknown"]);
// These evidence domains encode fixed ordered tuples of validated primitive facts.
const hash = (domain: string, value: readonly unknown[]) =>
  `cj1:sha256:${createHash("sha256")
    .update(`${domain}\0${JSON.stringify(value)}`)
    .digest("base64url")}`;
export function npDigestAgentOperatorRenderedHtmlV1(html: string): string {
  return npInspectAgentRenderedAccessibilityV1(html).htmlDigest;
}
function state(values: Status[]): NpAgentOperatorAuditObservationV1["state"] {
  return values.includes("fail")
    ? "error"
    : values.length === 0 || values.includes("unknown")
      ? "unknown"
      : values.includes("warn")
        ? "warn"
        : "ok";
}
function unknown(family: NpAgentAuditCheckFamily, bound: number) {
  return {
    state: "unknown" as const,
    targetCount: 0,
    consumedTargets: bound,
    evidenceRefs: ["observation:operator-audit:v1", `family:${family}`, "coverage:unavailable"],
  };
}
function fields(entries: readonly NpFieldConfig[], depth = 0): NamedField[] {
  if (depth > 16 || entries.length > 1000) throw new Error("Invalid audit fields.");
  return entries.flatMap((field): NamedField[] => {
    if (field.type === "row" || field.type === "collapsible")
      return fields(field.fields, depth + 1);
    if (field.hidden === true) return [];
    if (field.type === "group" || field.type === "array")
      return [{ ...field, fields: fields(field.fields, depth + 1) }];
    return [field];
  });
}
function assertBound(request: Request) {
  const bound = request.input.maxTargets;
  if (
    !Number.isSafeInteger(bound) ||
    bound < 1 ||
    bound > 1000 ||
    request.input.collections.length > 64 ||
    new Set(request.input.collections).size !== request.input.collections.length
  )
    throw new Error("Invalid audit observation bound.");
  return bound;
}
async function contentObservation(
  owner: NonNullable<NpAgentOperatorAuditObservationOwnersV1["content"]>,
  family: "content" | "seo" | "links",
  request: Request,
  authorize: () => Promise<void>,
): Promise<NpAgentOperatorAuditObservationV1> {
  const bound = request.input.maxTargets;
  if (request.input.collections.length === 0) return unknown(family, bound);
  let inventory: NpAgentPublisherRouteInventoryV1 | null = null;
  if (family === "links" && owner.routeInventory) {
    await authorize();
    inventory = npRequireAgentPublisherRouteInventoryV1(
      await owner.routeInventory(request),
      request.siteId,
    );
    await authorize();
    if (inventory.siteId !== request.siteId) throw new Error("Invalid audit inventory.");
  }
  const outcomes: Status[] = [];
  const provenance: Array<{ schemaDigest: string; documentDigests: string[] }> = [];
  const findings: Record<string, number> = {};
  let inspected = 0,
    consumed = 0,
    bytes = 0,
    complete = true;
  for (const slug of request.input.collections) {
    request.abortSignal.throwIfAborted();
    const remaining = bound - consumed;
    if (remaining < 1) {
      complete = false;
      break;
    }
    await authorize();
    const schema = npRequireAgentSchemaGetOutputV1(
      await owner.readSchema(
        { selector: "collection", slug },
        { ...request, transaction: request.db },
      ),
    );
    if (schema.selector.selector !== "collection" || schema.selector.slug !== slug)
      throw new Error("Invalid audit schema.");
    const config = getCollectionConfig(slug);
    const visible = fields(config.fields);
    const names = visible.map((field) => field.name).sort();
    if (names.length > 64 || new Set(names).size !== names.length) return unknown(family, bound);
    const limit = Math.min(remaining, 100);
    const loaded = await owner.readContent(
      {
        collection: slug,
        fields: names,
        audience: "public",
        status: "published",
        filter: null,
        sort: [],
        limit,
        cursor: null,
      },
      { ...request, transaction: request.db },
    );
    const result = npRequireAgentContentQueryOutputV1(loaded);
    bytes += Buffer.byteLength(JSON.stringify(result));
    if (bytes > 3 * 1024 * 1024) return unknown(family, bound);
    await authorize();
    if (
      result.collection !== slug ||
      result.items.length > limit ||
      new Set(result.items.map((item) => item.id)).size !== result.items.length ||
      result.items.some((item) => item.status !== "published")
    )
      throw new Error("Invalid audit content.");
    inspected += result.items.length;
    consumed += Math.max(1, result.items.length);
    complete &&= result.nextCursor === null;
    provenance.push({
      schemaDigest: schema.digest,
      documentDigests: result.items.map((item) => item.digest),
    });
    for (const item of result.items) {
      if (family === "content") {
        const valid = getCollectionZodSchema({ ...config, fields: visible }, item.data).safeParse(
          item.data,
        ).success;
        outcomes.push(valid ? "pass" : "fail");
        if (!valid)
          findings["visible-field-contract"] = (findings["visible-field-contract"] ?? 0) + 1;
      } else {
        const analysis = npAnalyzeAgentPublisherContentV1({
          fields: visible,
          content: item.data,
          cutoff: "0001-01-01T00:00:00.000Z",
          inventory,
        });
        const selected = analysis.filter((finding) =>
          family === "seo"
            ? ["missing-seo-title", "missing-seo-description", "seo-fields-unknown"].includes(
                finding,
              )
            : ["broken-internal-link", "internal-links-unknown"].includes(finding),
        );
        for (const finding of selected) findings[finding] = (findings[finding] ?? 0) + 1;
        outcomes.push(
          selected.some(
            (finding) => finding.startsWith("missing-") || finding === "broken-internal-link",
          )
            ? "fail"
            : selected.some((finding) => finding.endsWith("unknown"))
              ? "unknown"
              : "pass",
        );
      }
    }
  }
  if (!complete) outcomes.push("unknown");
  return {
    state: state(outcomes),
    targetCount: inspected,
    consumedTargets: consumed,
    evidenceRefs: [
      "observation:operator-audit:v1",
      `family:${family}`,
      family === "content" ? "basis:visible-field-schema" : "basis:publisher-static-fields",
      "coverage:public-published-selected-documents",
      `complete:${complete}`,
      `fact:inspected:${inspected}`,
      `sources:${hash(
        "np.agent-operator-audit-sources.v1",
        provenance.map(({ schemaDigest, documentDigests }) => [schemaDigest, documentDigests]),
      )}`,
      ...(family === "links"
        ? [
            `inventory:${
              inventory === null
                ? "unavailable"
                : hash("np.agent-operator-audit-inventory.v1", [
                    inventory.siteId,
                    inventory.complete,
                    inventory.routes.map(({ path, updatedAt }) => [path, updatedAt]),
                  ])
            }`,
            `inventory-complete:${inventory?.complete ?? false}`,
          ]
        : []),
      ...Object.entries(findings)
        .sort()
        .map(([id, count]) => `finding:${id}:${count}`),
    ],
  };
}

async function accessibilityObservation(
  owner: NonNullable<NpAgentOperatorAuditObservationOwnersV1["accessibility"]>,
  request: Request,
  authorize: () => Promise<void>,
): Promise<NpAgentOperatorAuditObservationV1> {
  const bound = request.input.maxTargets;
  const selected = await owner.selectRendered(request);
  await authorize();
  if (
    typeof selected.complete !== "boolean" ||
    !Array.isArray(selected.targets) ||
    selected.targets.length > Math.min(bound, 100)
  )
    return unknown("accessibility", bound);
  const outcomes: Status[] = selected.complete ? [] : ["unknown"];
  const provenance: Array<{
    htmlDigest: string;
    checks: NpAgentOperatorRenderedAccessibilityReportV1["checks"];
  }> = [];
  let bytes = 0;
  for (const target of selected.targets) {
    request.abortSignal.throwIfAborted();
    if (typeof target.html !== "string") return unknown("accessibility", bound);
    const size = Buffer.byteLength(target.html);
    bytes += size;
    if (size > 256 * 1024 || bytes > 1024 * 1024) return unknown("accessibility", bound);
    await authorize();
    const actual = npInspectAgentRenderedAccessibilityV1(target.html);
    const report = owner.checkRendered ? await owner.checkRendered(target.html, request) : actual;
    await authorize();
    const htmlDigest = actual.htmlDigest;
    if (
      report.schemaVersion !== "np.agent-operator-static-accessibility.v1" ||
      report.htmlDigest !== htmlDigest ||
      !Array.isArray(report.checks) ||
      report.checks.length !== accessibilityIds.length ||
      new Set(report.checks.map((check) => check.id)).size !== accessibilityIds.length ||
      report.checks.some(
        (check) => !accessibilityIds.includes(check.id) || !statuses.has(check.status),
      )
    )
      return unknown("accessibility", bound);
    provenance.push({ htmlDigest, checks: report.checks });
    outcomes.push(...report.checks.map((check) => check.status));
  }
  return {
    state: state(outcomes),
    targetCount: selected.targets.length,
    consumedTargets: selected.complete ? Math.max(1, selected.targets.length) : bound,
    evidenceRefs: [
      "observation:operator-audit:v1",
      "family:accessibility",
      "basis:rendered-html-fixed-static-checks",
      "coverage:selected-static-checks-only",
      "acceptance:browser-and-assistive-technology-unestablished",
      `complete:${selected.complete}`,
      `fact:inspected:${selected.targets.length}`,
      `sources:${hash(
        "np.agent-operator-accessibility-evidence.v1",
        provenance.map(({ htmlDigest, checks }) => [
          htmlDigest,
          checks.map(({ id, status }) => [id, status]),
        ]),
      )}`,
    ],
  };
}

async function securityObservation(
  owner: NonNullable<NpAgentOperatorAuditObservationOwnersV1["security"]>,
  request: Request,
  authorize: () => Promise<void>,
): Promise<NpAgentOperatorAuditObservationV1> {
  const bound = request.input.maxTargets;
  const maximumAge = owner.maximumAgeSeconds ?? 300;
  if (
    !tokenPattern.test(owner.sourceId) ||
    owner.checkIds.length < 1 ||
    owner.checkIds.length > 64 ||
    new Set(owner.checkIds).size !== owner.checkIds.length ||
    owner.checkIds.some((id) => !tokenPattern.test(id)) ||
    !Number.isSafeInteger(maximumAge) ||
    maximumAge < 1 ||
    maximumAge > 86400 ||
    owner.checkIds.length > bound
  )
    return unknown("security", bound);
  const report = await owner.read(request);
  await authorize();
  if (!report) return unknown("security", bound);
  const observed = Date.parse(report.observedAt);
  const requested = Date.parse(request.requestedAt);
  if (
    report.schemaVersion !== "np.agent-operator-deterministic-security.v1" ||
    report.siteId !== request.siteId ||
    report.sourceId !== owner.sourceId ||
    !digestPattern.test(report.sourceDigest) ||
    !Number.isFinite(observed) ||
    new Date(observed).toISOString() !== report.observedAt ||
    !Number.isFinite(requested) ||
    observed > requested ||
    requested - observed > maximumAge * 1000 ||
    typeof report.complete !== "boolean" ||
    !Array.isArray(report.checks) ||
    report.checks.length > owner.checkIds.length ||
    new Set(report.checks.map((check) => check.id)).size !== report.checks.length ||
    report.checks.some((check) => !owner.checkIds.includes(check.id) || !statuses.has(check.status))
  )
    return unknown("security", bound);
  const complete = report.complete && report.checks.length === owner.checkIds.length;
  return {
    state: state([
      ...report.checks.map((check) => check.status),
      ...(!complete ? ["unknown" as const] : []),
    ]),
    targetCount: report.checks.length,
    consumedTargets: owner.checkIds.length,
    evidenceRefs: [
      "observation:operator-audit:v1",
      "family:security",
      "basis:fixed-deterministic-owner-report",
      "coverage:declared-checks-only",
      `source:${owner.sourceId}`,
      `observed:${report.observedAt}`,
      `complete:${complete}`,
      ...(["pass", "warn", "fail", "unknown"] as const).map(
        (status) =>
          `fact:${status}:${report.checks.filter((check) => check.status === status).length}`,
      ),
      `sources:${hash("np.agent-operator-security-evidence.v1", [
        report.schemaVersion,
        report.siteId,
        report.sourceId,
        report.sourceDigest,
        report.observedAt,
        report.complete,
        report.checks.map(({ id, status }) => [id, status]),
      ])}`,
    ],
  };
}

/** Source errors are unknown; authority/abort failures remain failures at the shared boundary. */
export async function collectOperatorAuditObservation(
  owners: NpAgentOperatorAuditObservationOwnersV1,
  family: NpAgentAuditCheckFamily,
  request: Request,
  authorize: () => Promise<void>,
): Promise<NpAgentOperatorAuditObservationV1> {
  const bound = assertBound(request);
  request.abortSignal.throwIfAborted();
  await authorize();
  let authorityFailed = false;
  const currentAuthority = async () => {
    request.abortSignal.throwIfAborted();
    try {
      await authorize();
    } catch (error) {
      authorityFailed = true;
      throw error;
    }
  };
  let result: NpAgentOperatorAuditObservationV1;
  try {
    result =
      (family === "content" || family === "seo" || family === "links") && owners.content
        ? await contentObservation(owners.content, family, request, currentAuthority)
        : family === "accessibility" && owners.accessibility
          ? await accessibilityObservation(owners.accessibility, request, currentAuthority)
          : family === "security" && owners.security
            ? await securityObservation(owners.security, request, currentAuthority)
            : unknown(family, bound);
  } catch (error) {
    if (authorityFailed) throw error;
    result = unknown(family, bound);
  }
  request.abortSignal.throwIfAborted();
  await authorize();
  return result;
}
