import { NP_DEFAULT_SITE_ID } from "@nexpress/core";
import {
  defaultRevalidationRules,
  invalidateCacheTargets,
  navCacheTag,
  siteCacheTag,
  themeCacheTag,
} from "@nexpress/next";
import type { NpCacheInvalidationPathInput, NpCacheInvalidationPathType } from "@nexpress/next";
import type { NpCdnPurgeSource } from "@nexpress/next";

const APPROVAL_TOKEN = "cache-revalidate";

export type OpsCacheRevalidateTarget = "public" | "collection" | "theme" | "navigation" | "site";

function collectionCacheTag(slug: string): string {
  return `nx:collection:${slug}`;
}

export interface OpsCacheRevalidateArgs {
  target?: OpsCacheRevalidateTarget | null;
  collection?: string | null;
  documentSlug?: string | null;
  navigationLocation?: string | null;
  siteId?: string | null;
  execute?: boolean;
  approve?: string | null;
}

export interface PlannedPath {
  path: string;
  type?: NpCacheInvalidationPathType;
}

export interface CachePlan {
  target: OpsCacheRevalidateTarget;
  collection: string | null;
  documentSlug: string | null;
  navigationLocation: string | null;
  siteId: string;
  pathInputs: NpCacheInvalidationPathInput[];
  paths: PlannedPath[];
  tags: string[];
}

export interface OpsCacheRevalidateResult {
  schemaVersion: "np.ops-cache-revalidate.v1";
  action: "cache.revalidate";
  target: OpsCacheRevalidateTarget;
  execute: boolean;
  approve: string | null;
  applied: boolean;
  siteId: string;
  collection: string | null;
  documentSlug: string | null;
  navigationLocation: string | null;
  paths: PlannedPath[];
  tags: string[];
  nextCommand: string | null;
  error?: string;
}

export function buildOpsCacheRevalidatePlan(args: OpsCacheRevalidateArgs): CachePlan {
  const target = args.target ?? "public";
  const siteId = args.siteId ?? NP_DEFAULT_SITE_ID;
  const collection = normalizeOptional(args.collection);
  const documentSlug = normalizeOptional(args.documentSlug);
  const navigationLocation = normalizeOptional(args.navigationLocation) ?? "header";

  switch (target) {
    case "public":
      return normalizePlan({
        target,
        collection: null,
        documentSlug: null,
        navigationLocation: null,
        siteId,
        pathInputs: ["/", "/blog", "/search"],
        tags: [
          "nx:sitemap",
          `nx:sitemap:${siteId}`,
          "nx:feed",
          `nx:feed:${siteId}`,
          "nx:search",
          `nx:search:${siteId}`,
        ],
      });
    case "collection": {
      if (!collection) {
        throw new Error("cache.revalidate collection target requires collection.");
      }
      const rule = defaultRevalidationRules[collection];
      return normalizePlan({
        target,
        collection,
        documentSlug,
        navigationLocation: null,
        siteId,
        pathInputs: substituteAll(rule?.paths ?? [], { siteId, documentSlug }),
        tags: [
          ...substituteAll(rule?.tags ?? [], { siteId, documentSlug }),
          collectionCacheTag(collection),
        ],
      });
    }
    case "theme":
      return normalizePlan({
        target,
        collection: null,
        documentSlug: null,
        navigationLocation: null,
        siteId,
        pathInputs: [{ path: "/", type: "layout" }],
        tags: [themeCacheTag(siteId), `nx:sitemap:${siteId}`, `nx:feed:${siteId}`],
      });
    case "navigation":
      return normalizePlan({
        target,
        collection: null,
        documentSlug: null,
        navigationLocation,
        siteId,
        pathInputs: [],
        tags: [navCacheTag(siteId, navigationLocation)],
      });
    case "site":
      return normalizePlan({
        target,
        collection: null,
        documentSlug: null,
        navigationLocation: null,
        siteId,
        pathInputs: [{ path: "/", type: "layout" }],
        tags: [siteCacheTag(siteId)],
      });
  }
}

export function runOpsCacheRevalidate(args: OpsCacheRevalidateArgs): OpsCacheRevalidateResult {
  const plan = buildOpsCacheRevalidatePlan(args);
  const execute = Boolean(args.execute);
  const approve = args.approve ?? null;
  const nextCommand = execute
    ? null
    : buildNextCommand(plan, " --execute --approve cache-revalidate");

  if (!execute) {
    return toResult(plan, { execute, approve, applied: false, nextCommand });
  }

  if (approve !== APPROVAL_TOKEN) {
    return toResult(plan, {
      execute,
      approve,
      applied: false,
      nextCommand: buildNextCommand(plan, " --execute --approve cache-revalidate"),
      error: "Missing --approve cache-revalidate",
    });
  }

  invalidateCacheTargets({
    source: cacheTargetSource(plan.target),
    collection: plan.collection ?? undefined,
    documentSlug: plan.documentSlug ?? undefined,
    navigationLocation: plan.navigationLocation ?? undefined,
    siteId: plan.siteId,
    paths: plan.pathInputs,
    tags: plan.tags,
  });

  return toResult(plan, { execute, approve, applied: true, nextCommand: null });
}

function cacheTargetSource(target: OpsCacheRevalidateTarget): NpCdnPurgeSource {
  switch (target) {
    case "collection":
      return "collection";
    case "theme":
      return "theme";
    case "navigation":
      return "navigation";
    case "public":
    case "site":
      return "site";
  }
}

function toResult(
  plan: CachePlan,
  state: {
    execute: boolean;
    approve: string | null;
    applied: boolean;
    nextCommand: string | null;
    error?: string;
  },
): OpsCacheRevalidateResult {
  return {
    schemaVersion: "np.ops-cache-revalidate.v1",
    action: "cache.revalidate",
    target: plan.target,
    execute: state.execute,
    approve: state.approve,
    applied: state.applied,
    siteId: plan.siteId,
    collection: plan.collection,
    documentSlug: plan.documentSlug,
    navigationLocation: plan.navigationLocation,
    paths: plan.paths,
    tags: plan.tags,
    nextCommand: state.nextCommand,
    ...(state.error ? { error: state.error } : {}),
  };
}

function normalizePlan(args: Omit<CachePlan, "paths"> & { tags: string[] }): CachePlan {
  const paths = uniquePaths(args.pathInputs.map(normalizePathInput));
  return {
    ...args,
    pathInputs: paths,
    paths,
    tags: unique(args.tags),
  };
}

function normalizePathInput(input: NpCacheInvalidationPathInput): PlannedPath {
  return typeof input === "string" ? { path: input } : input;
}

function substituteAll(
  templates: readonly string[],
  ctx: { siteId: string; documentSlug: string | null },
): string[] {
  const values: string[] = [];
  for (const template of templates) {
    let value = template;
    if (value.includes("{siteId}")) {
      value = value.replace("{siteId}", ctx.siteId);
    }
    if (value.includes("{slug}")) {
      if (!ctx.documentSlug) continue;
      value = value.replace("{slug}", ctx.documentSlug);
    }
    values.push(value);
  }
  return values;
}

function normalizeOptional(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function uniquePaths(values: readonly PlannedPath[]): PlannedPath[] {
  const seen = new Set<string>();
  const paths: PlannedPath[] = [];
  for (const value of values) {
    const key = `${value.path}\0${value.type ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    paths.push(value);
  }
  return paths;
}

function buildNextCommand(plan: CachePlan, suffix: string): string {
  const parts = ["POST /api/admin/ops/actions", `action=cache.revalidate`, `target=${plan.target}`];
  if (plan.collection) parts.push(`collection=${plan.collection}`);
  if (plan.documentSlug) parts.push(`documentSlug=${plan.documentSlug}`);
  if (plan.navigationLocation) parts.push(`navigationLocation=${plan.navigationLocation}`);
  return `${parts.join(" ")}${suffix}`;
}
