import type { NpFeedEntry, NpSitemapEntry } from "../seo/index.js";
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
  sitemapEntries?: () => Promise<NpSitemapEntry[]> | NpSitemapEntry[];
  feedEntries?: () => Promise<NpFeedEntry[]> | NpFeedEntry[];
  robotsTxt?: () => string | Promise<string>;
}

interface ImplShape {
  notFound?: unknown;
  error?: unknown;
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

export function extractSeoHooks(impl: unknown): NpThemeSeoHooksExtracted {
  const shape = impl as ImplShape | undefined;
  const seo = shape?.seo;
  if (!seo || typeof seo !== "object") return {};
  const out: NpThemeSeoHooksExtracted = {};
  if (typeof seo.sitemapEntries === "function") {
    out.sitemapEntries = seo.sitemapEntries;
  }
  if (typeof seo.feedEntries === "function") {
    out.feedEntries = seo.feedEntries;
  }
  if (typeof seo.robotsTxt === "function") {
    out.robotsTxt = seo.robotsTxt;
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

export async function getActiveThemeSeoHooks(): Promise<NpThemeSeoHooksExtracted> {
  const theme = await getActiveTheme();
  if (!theme) return {};
  return extractSeoHooks(theme.impl);
}
