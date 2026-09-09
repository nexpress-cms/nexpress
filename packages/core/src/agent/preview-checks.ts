import { createHash } from "node:crypto";
import { isIP } from "node:net";
import { parse, type DefaultTreeAdapterMap } from "parse5";
import {
  npAgentChangeSetLimits,
  npAgentPreviewCheckIdsV1,
  npAgentPreviewIssueMessagesV1,
  npRequireAgentPreviewReportPartsV1,
  npRequireAgentPreviewReportV1,
  type NpAgentPreviewReportV1,
  type NpAgentPreviewCheckIdV1,
  type NpAgentPreviewIssueCodeV1,
} from "../agent-contract/changeset-wire-contract.js";
import { serializeAgentCanonicalJson } from "../agent-contract/canonical-foundation.js";
import {
  canonicalBodyPreviewRoute,
  canonicalBodyPreviewLocale,
  canonicalBodyQuerylessHttpsOrigin,
} from "../agent-contract/canonical-preview-values.js";
import { npSeoContractLimits } from "../seo/contract.js";
import { checkPreviewExternalLink } from "./preview-link-check.js";

type Report = NpAgentPreviewReportV1;
type Route = NonNullable<Report["results"][number]["route"]>;
type Element = DefaultTreeAdapterMap["element"];
type Node = DefaultTreeAdapterMap["node"];
export interface NpAgentPreviewChecksInputV1 {
  identity: Pick<
    Report,
    | "siteId"
    | "changeSetId"
    | "previewId"
    | "generation"
    | "planHash"
    | "previewContractFingerprint"
    | "generatedAt"
  >;
  routes: readonly Route[];
  /** Host renders through the existing bounded, read-only preview overlay. */
  render: (route: Route) => Promise<string>;
  productionOrigins: readonly string[];
  /** Complete canonical public route inventory from the same generation's overlay. */
  routeManifest: readonly Route[];
  resolveRoute: (route: Route) => Promise<boolean>;
  assertCurrentAuthority: () => Promise<void>;
  /** Deployment-owned and frozen by the preview contract; never caller supplied. */
  linkAllowlistOrigins: readonly string[];
}
export const npAgentPreviewCheckVersionsV1 = Object.freeze({
  routeParserVersion: 1,
  checkRegistryVersion: 1,
  networkPolicyVersion: 1,
});
const fail = (): never => {
  throw new Error("PREVIEW_CHECK_CONTRACT_INVALID");
};
const key = (route: Route) => `${route.route}\0${route.locale ?? ""}`;
const attr = (element: Element, name: string) => element.attrs.find((a) => a.name === name)?.value;
const children = (node: Node): Node[] => ("childNodes" in node ? node.childNodes : []);
function elements(html: string): Element[] {
  if (Buffer.byteLength(html, "utf8") > npAgentChangeSetLimits.previewHtmlBytes) fail();
  const root = parse(html);
  const pending: Array<{ node: Node; depth: number }> = [{ node: root, depth: 0 }];
  const output: Element[] = [];
  let visited = 0;
  while (pending.length) {
    const { node, depth } = pending.pop()!;
    if (++visited > 100_000 || depth > 256) fail();
    if ("tagName" in node) output.push(node);
    for (const child of children(node)) pending.push({ node: child, depth: depth + 1 });
  }
  return output;
}
function textContent(node: Node): string {
  const pending = [node];
  let text = "";
  while (pending.length) {
    const current = pending.pop()!;
    if (current.nodeName === "#text" && "value" in current) text += current.value;
    else if (!("tagName" in current && ["script", "style", "template"].includes(current.tagName)))
      pending.push(...children(current).slice().reverse());
  }
  return text.trim();
}
function hasName(element: Element, ids: Map<string, Element>, labels: Set<string>): boolean {
  if (attr(element, "aria-label")?.trim()) return true;
  const references = attr(element, "aria-labelledby")?.trim().split(/\s+/u);
  if (
    references?.length &&
    references.every((id) => ids.has(id)) &&
    references.some((id) => textContent(ids.get(id)!).length > 0)
  )
    return true;
  if (attr(element, "id") && labels.has(attr(element, "id")!)) return true;
  for (let parent = element.parentNode; parent && "tagName" in parent; parent = parent.parentNode) {
    if (parent.tagName === "label" && textContent(parent)) return true;
  }
  if (element.tagName === "input") {
    const type = (attr(element, "type") ?? "text").toLowerCase();
    if (["submit", "reset"].includes(type))
      return attr(element, "value") === undefined || !!attr(element, "value")?.trim();
    if (type === "image") return !!attr(element, "alt")?.trim();
    return type === "button" && !!attr(element, "value")?.trim();
  }
  return (
    !!textContent(element) ||
    children(element).some(
      (child) => "tagName" in child && child.tagName === "img" && !!attr(child, "alt")?.trim(),
    )
  );
}
function hidden(element: Element): boolean {
  for (
    let current: Node | null = element;
    current && "tagName" in current;
    current = current.parentNode
  ) {
    if (attr(current, "hidden") !== undefined || attr(current, "aria-hidden") === "true")
      return true;
  }
  return false;
}
function validStructuredData(value: unknown): boolean {
  const pending: Array<{ value: unknown; depth: number }> = [{ value, depth: 0 }];
  let count = 0;
  while (pending.length) {
    const item = pending.pop()!;
    if (++count > 10_000 || item.depth > 64) return false;
    if (item.value && typeof item.value === "object") {
      const entries = Object.entries(item.value);
      if (entries.some(([k]) => ["__proto__", "constructor", "prototype"].includes(k)))
        return false;
      for (const [, child] of entries) pending.push({ value: child, depth: item.depth + 1 });
    }
  }
  const objects = Array.isArray(value) ? value : [value];
  return (
    objects.length > 0 &&
    objects.every((item: unknown) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return false;
      const obj = item as Record<string, unknown>;
      return (
        obj["@context"] === "https://schema.org" &&
        ((typeof obj["@type"] === "string" && !!obj["@type"]) ||
          (Array.isArray(obj["@graph"]) && obj["@graph"].length > 0))
      );
    })
  );
}

/** Framework-owned static checks; no browser execution, WCAG certification or remote body reads. */
export async function runAgentPreviewChecksV1(
  input: NpAgentPreviewChecksInputV1,
): Promise<Report[]> {
  if (
    input.routes.length * npAgentPreviewCheckIdsV1.length > 1000 ||
    input.routeManifest.length > 100_000
  )
    fail();
  // Validate identity and every caller-independent route before rendering or network effects.
  npRequireAgentPreviewReportV1({
    schemaVersion: "np.agent-preview-report.v1",
    ...input.identity,
    part: 1,
    totalParts: 1,
    issues: [],
    results: input.routes.map((route, i) => ({
      id: `route-${i}`,
      checkId: "route-collision",
      status: "pass",
      route,
      issueIds: [],
    })),
  });
  const origins = new Set(
    input.productionOrigins.map((o) =>
      canonicalBodyQuerylessHttpsOrigin(o, "preview.productionOrigin"),
    ),
  );
  if (!origins.size || origins.size > 100) fail();
  const allowlist = new Set(
    input.linkAllowlistOrigins.map((o) =>
      canonicalBodyQuerylessHttpsOrigin(o, "preview.linkAllowlist"),
    ),
  );
  if (
    allowlist.size > 100 ||
    [...allowlist].some((o) => isIP(new URL(o).hostname.replace(/^\[|\]$/gu, "")))
  )
    fail();
  const manifests = new Map<string, number>();
  const paths = new Map<string, Route[]>();
  for (const route of input.routeManifest) {
    canonicalBodyPreviewRoute(route.route, "preview.route");
    if (route.locale !== null) canonicalBodyPreviewLocale(route.locale, "preview.locale");
    if (
      route.audience !== "public" ||
      Object.keys(route).sort().join(",") !== "audience,locale,route"
    )
      fail();
    manifests.set(key(route), (manifests.get(key(route)) ?? 0) + 1);
    const targets = paths.get(route.route) ?? [];
    targets.push(route);
    paths.set(route.route, targets);
  }
  if (new Set(input.routes.map(key)).size !== input.routes.length) fail();
  const results: Report["results"] = [],
    issues: Report["issues"] = [];
  let linkCount = 0;
  const networkResults = new Map<
    string,
    { result: Report["results"][number]; target: Report["issues"][number]["target"] }[]
  >();
  const add = (
    result: Report["results"][number],
    code: NpAgentPreviewIssueCodeV1,
    target: Report["issues"][number]["target"] = null,
  ) => {
    if (issues.length >= 1000) fail();
    const warning = code === "EXTERNAL_UNVERIFIED" || code === "CHECK_TIMEOUT";
    const id = `issue-${issues.length + 1}`;
    result.issueIds.push(id);
    result.status = !warning ? "fail" : result.status === "fail" ? "fail" : "warning";
    issues.push({
      id,
      resultId: result.id,
      severity: warning ? "warning" : "error",
      code,
      safeMessage: npAgentPreviewIssueMessagesV1[code],
      target,
      evidenceRefs: [],
    });
  };
  await input.assertCurrentAuthority();
  for (const route of input.routes) {
    canonicalBodyPreviewRoute(route.route, "preview.route");
    await input.assertCurrentAuthority();
    const dom = elements(await input.render(route));
    await input.assertCurrentAuthority();
    const checks = new Map<NpAgentPreviewCheckIdV1, Report["results"][number]>();
    for (const checkId of npAgentPreviewCheckIdsV1) {
      const result: Report["results"][number] = {
        id: `result-${results.length + 1}`,
        checkId,
        status: "pass",
        route: { ...route },
        issueIds: [],
      };
      results.push(result);
      checks.set(checkId, result);
    }
    const issue = (
      check: NpAgentPreviewCheckIdV1,
      code: NpAgentPreviewIssueCodeV1,
      element?: Element,
    ) =>
      add(
        checks.get(check)!,
        code,
        element
          ? {
              kind: "selector",
              selectorDigest: `cj1:sha256:${createHash("sha256")
                .update(`np.agent-preview-selector.v1\0${key(route)}\0${dom.indexOf(element)}`)
                .digest("base64url")}`,
            }
          : null,
      );
    const title = dom.filter((e) => e.tagName === "title");
    const description = dom.filter(
      (e) => e.tagName === "meta" && attr(e, "name")?.toLowerCase() === "description",
    );
    if (
      !title.length ||
      !title.some((e) => textContent(e)) ||
      !description.length ||
      !description.some((e) => attr(e, "content")?.trim())
    )
      issue("metadata", "METADATA_MISSING");
    if (
      title.length > 1 ||
      description.length > 1 ||
      title.some((e) => textContent(e).length > npSeoContractLimits.titleLength) ||
      description.some(
        (e) => (attr(e, "content")?.length ?? 0) > npSeoContractLimits.descriptionLength,
      )
    )
      issue("metadata", "METADATA_INVALID");
    const canonicals = dom.filter(
      (e) =>
        e.tagName === "link" && attr(e, "rel")?.toLowerCase().split(/\s+/u).includes("canonical"),
    );
    if (canonicals.length > 1) issue("metadata", "METADATA_INVALID");
    for (const element of canonicals) {
      try {
        const href = attr(element, "href"),
          url = new URL(href ?? "");
        if (
          href !== url.href ||
          !origins.has(url.origin) ||
          url.username ||
          url.password ||
          url.search ||
          url.hash ||
          url.pathname !== route.route
        )
          issue("metadata", "METADATA_INVALID", element);
      } catch {
        issue("metadata", "METADATA_INVALID", element);
      }
    }
    for (const e of dom.filter(
      (e) => e.tagName === "script" && attr(e, "type")?.toLowerCase() === "application/ld+json",
    )) {
      try {
        const json = children(e)
          .map((n) => ("value" in n ? n.value : ""))
          .join("");
        if (Buffer.byteLength(json) > 512 * 1024 || !validStructuredData(JSON.parse(json)))
          issue("structured-data", "STRUCTURED_DATA_INVALID", e);
      } catch {
        issue("structured-data", "STRUCTURED_DATA_INVALID", e);
      }
    }
    const ids = new Map<string, Element>(),
      labels = new Set<string>();
    for (const e of dom) {
      const id = attr(e, "id");
      if (id) {
        if (ids.has(id)) issue("accessibility", "ACCESSIBILITY_VIOLATION", e);
        ids.set(id, e);
      }
      if (e.tagName === "label" && attr(e, "for") && textContent(e)) labels.add(attr(e, "for")!);
    }
    for (const e of dom) {
      if (hidden(e)) continue;
      if (
        (e.tagName === "html" && !attr(e, "lang")?.trim()) ||
        (e.tagName === "img" && attr(e, "alt") === undefined) ||
        (["input", "select", "textarea", "button"].includes(e.tagName) &&
          attr(e, "type") !== "hidden" &&
          !hasName(e, ids, labels)) ||
        (e.tagName === "a" && attr(e, "href") !== undefined && !hasName(e, ids, labels))
      )
        issue("accessibility", "ACCESSIBILITY_VIOLATION", e);
    }
    if ((manifests.get(key(route)) ?? 0) > 1) issue("route-collision", "ROUTE_COLLISION");
    const seen = new Set<string>();
    for (const e of dom.filter((e) => ["a", "area"].includes(e.tagName))) {
      const href = attr(e, "href");
      if (href === undefined || seen.has(href)) continue;
      seen.add(href);
      if (++linkCount > 10_000) fail();
      let url: URL;
      try {
        if (href.length > 2048 || /[\s\\]/u.test(href)) throw new Error();
        url = new URL(href, `${[...origins][0]}${route.route}`);
        if (url.protocol !== "https:" || url.username || url.password || url.port)
          throw new Error();
      } catch {
        issue("broken-links", "EXTERNAL_UNVERIFIED");
        continue;
      }
      if (origins.has(url.origin)) {
        let destination: Route;
        try {
          destination = {
            ...route,
            route: canonicalBodyPreviewRoute(url.pathname, "preview.link"),
          };
        } catch {
          issue("broken-links", "ROUTE_NOT_FOUND");
          continue;
        }
        const candidates = paths.get(destination.route) ?? [];
        const matching = candidates.filter((candidate) => candidate.locale === route.locale);
        const resolved =
          matching.length === 1 ? matching[0] : candidates.length === 1 ? candidates[0] : undefined;
        if (!resolved || !(await input.resolveRoute({ ...resolved })))
          issue("broken-links", "ROUTE_NOT_FOUND");
      } else {
        if (
          url.search ||
          url.hash ||
          /[?#%]/u.test(href) ||
          href !== url.href ||
          !allowlist.has(url.origin)
        ) {
          issue("broken-links", "EXTERNAL_UNVERIFIED");
          continue;
        }
        const requests = networkResults.get(url.href) ?? [];
        requests.push({
          result: checks.get("broken-links")!,
          target: { kind: "external-origin", origin: url.origin },
        });
        networkResults.set(url.href, requests);
      }
    }
    await input.assertCurrentAuthority();
  }
  // Fixed lanes; links beyond the network ceiling remain explicitly unverified.
  const links = [...networkResults.keys()].sort();
  let next = 0;
  const outcomes = new Map<string, "reachable" | "unreachable" | "timeout" | "unverified">();
  let stopped = false;
  const networkWork = await Promise.allSettled(
    Array.from({ length: Math.min(4, links.length) }, async () => {
      while (!stopped && next < links.length) {
        const index = next++,
          url = links[index];
        try {
          const status =
            index < 100
              ? await checkPreviewExternalLink(new URL(url), input.assertCurrentAuthority)
              : "unverified";
          outcomes.set(url, status);
        } catch (error) {
          stopped = true;
          throw error;
        }
      }
    }),
  );
  for (const work of networkWork) if (work.status === "rejected") throw work.reason;
  for (const url of links) {
    const status = outcomes.get(url);
    const code =
      status === "reachable"
        ? null
        : status === "unverified"
          ? "EXTERNAL_UNVERIFIED"
          : status === "timeout"
            ? "CHECK_TIMEOUT"
            : "EXTERNAL_UNREACHABLE";
    if (code) for (const item of networkResults.get(url)!) add(item.result, code, item.target);
  }
  await input.assertCurrentAuthority();
  results.sort((a, b) => {
    const order = (r: typeof a) =>
      `${r.checkId}\0${r.route?.route ?? ""}\0${r.route?.locale ?? ""}\0${r.id}`;
    return order(a) < order(b) ? -1 : order(a) > order(b) ? 1 : 0;
  });
  const parts: Report[] = [];
  let part: Report = {
    schemaVersion: "np.agent-preview-report.v1",
    ...input.identity,
    part: 1,
    totalParts: 4,
    results: [],
    issues: [],
  };
  const emptyBytes = Buffer.byteLength(serializeAgentCanonicalJson(part));
  let partBytes = emptyBytes;
  const ownedIssues = new Map<string, Report["issues"]>();
  for (const issue of issues) {
    const owned = ownedIssues.get(issue.resultId) ?? [];
    owned.push(issue);
    ownedIssues.set(issue.resultId, owned);
  }
  for (const result of results) {
    const owned = ownedIssues.get(result.id) ?? [];
    const resultBytes = Buffer.byteLength(serializeAgentCanonicalJson(result));
    const issueBytes = owned.reduce(
      (total, issue) => total + Buffer.byteLength(serializeAgentCanonicalJson(issue)),
      0,
    );
    const addition = () =>
      resultBytes +
      (part.results.length ? 1 : 0) +
      issueBytes +
      Math.max(0, owned.length - (part.issues.length ? 0 : 1));
    if (partBytes + addition() > npAgentChangeSetLimits.reportBytes) {
      if (!part.results.length || parts.length >= npAgentChangeSetLimits.previewReports - 1) fail();
      parts.push(part);
      part = { ...part, part: parts.length + 1, results: [], issues: [] };
      partBytes = emptyBytes;
    }
    partBytes += addition();
    if (partBytes > npAgentChangeSetLimits.reportBytes) fail();
    part.results.push(result);
    part.issues.push(...owned);
  }
  parts.push(part);
  for (const item of parts) item.totalParts = parts.length;
  return npRequireAgentPreviewReportPartsV1(parts);
}
