import {
  npRequireFeedEntries,
  npRequireRobotsTxt,
  npRequireSitemapEntries,
} from "../seo/contract.js";
import type { NpFeedEntry, NpSitemapEntry } from "../seo/types.js";
import { getActiveTheme } from "./registry.js";

/**
 * Phase F.7 — pure structural narrowers for theme `notFound`,
 * `error`, and `seo` contributions. Core treats `theme.impl`
 * as opaque (`unknown`); these helpers do the duck-typing in
 * one place so the consuming routes stay readable.
 *
 * `getActiveThemeNotFoundComponent` / `…ErrorComponent` return
 * the React component refs unchanged — typing as `unknown`
 * here, the consumers (in `apps/web`) cast to ComponentType
 * at the JSX site. Core can't import `react` directly without
 * dragging the peer into a server-only package, so the cast
 * is delegated.
 */

export interface NpThemeSeoHooksExtracted {
  sitemapEntries?: () => Promise<readonly NpSitemapEntry[]>;
  feedEntries?: () => Promise<readonly NpFeedEntry[]>;
  robotsTxt?: () => string | Promise<string>;
}

interface ImplShape {
  notFound?: unknown;
  error?: unknown;
  members?: {
    notFound?: unknown;
    error?: unknown;
  };
  seo?: NpThemeSeoHooksExtracted;
}

export function extractNotFoundComponent(impl: unknown): unknown {
  const shape = impl as ImplShape | undefined;
  return typeof shape?.notFound === "function" ? shape.notFound : null;
}

export function extractErrorComponent(impl: unknown): unknown {
  const shape = impl as ImplShape | undefined;
  return typeof shape?.error === "function" ? shape.error : null;
}

/**
 * Phase M.3 — member-tree 404 component, with fallback to the
 * top-level `impl.notFound`. Returns `null` when neither the
 * member-specific nor the top-level component is declared (the
 * caller renders the framework default). Same opacity contract
 * as `extractNotFoundComponent` — typed as `unknown` here, the
 * consumer in `apps/web/src/app/(member)/not-found.tsx` casts
 * to `ComponentType` at the JSX site.
 */
export function extractMembersNotFoundComponent(impl: unknown): unknown {
  const shape = impl as ImplShape | undefined;
  const memberLevel = shape?.members?.notFound;
  if (typeof memberLevel === "function") return memberLevel;
  return typeof shape?.notFound === "function" ? shape.notFound : null;
}

export function extractSeoHooks(impl: unknown): NpThemeSeoHooksExtracted {
  const shape = impl as ImplShape | undefined;
  const seo = shape?.seo;
  if (!seo || typeof seo !== "object") return {};
  const out: NpThemeSeoHooksExtracted = {};
  if (typeof seo.sitemapEntries === "function") {
    const sitemapEntries = seo.sitemapEntries;
    out.sitemapEntries = async () => npRequireSitemapEntries(await sitemapEntries.call(seo));
  }
  if (typeof seo.feedEntries === "function") {
    const feedEntries = seo.feedEntries;
    out.feedEntries = async () => npRequireFeedEntries(await feedEntries.call(seo));
  }
  if (typeof seo.robotsTxt === "function") {
    const robotsTxt = seo.robotsTxt;
    out.robotsTxt = async () => npRequireRobotsTxt(await robotsTxt.call(seo));
  }
  return out;
}

/**
 * Async sugar over the active theme. Each helper returns a
 * fresh resolution per call; multi-site safety comes from
 * `getActiveTheme()` reading per-request site context.
 */

export async function getActiveThemeNotFound(): Promise<unknown> {
  const theme = await getActiveTheme();
  if (!theme) return null;
  return extractNotFoundComponent(theme.impl);
}

export async function getActiveThemeError(): Promise<unknown> {
  const theme = await getActiveTheme();
  if (!theme) return null;
  return extractErrorComponent(theme.impl);
}

/**
 * Phase M.3 — async sugar for the member-tree 404. Returns the
 * theme's `impl.members.notFound` when declared, falling back
 * to its `impl.notFound` (top-level), then `null`.
 */
export async function getActiveThemeMembersNotFound(): Promise<unknown> {
  const theme = await getActiveTheme();
  if (!theme) return null;
  return extractMembersNotFoundComponent(theme.impl);
}

export async function getActiveThemeSeoHooks(): Promise<NpThemeSeoHooksExtracted> {
  const theme = await getActiveTheme();
  if (!theme) return {};
  return extractSeoHooks(theme.impl);
}
