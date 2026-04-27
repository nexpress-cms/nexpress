import { and, eq } from "drizzle-orm";

import { nxSettings } from "../db/schema/system.js";
import { nxNavigation } from "../db/schema/system.js";
import type { NxThemeTokens } from "../theme/types.js";
import type { NxNavItem, NxFindOptions, NxFindResult, NxAuthUser } from "../config/types.js";
import { DEFAULT_THEME } from "../theme/defaults.js";
import { findDocuments, getDb } from "../collections/index.js";
import { getCurrentSiteId } from "../sites/context.js";
import { NX_DEFAULT_SITE_ID } from "../sites/registry.js";

/**
 * Phase 15.4 — every settings/navigation read scopes by the
 * current site id so each tenant gets its own theme tokens,
 * navigation menus, and arbitrary settings. The resolver
 * falls back to the default site when no request context is
 * set (background workers, scripts, tests with no resolver
 * wired) so existing single-tenant code keeps working
 * unchanged.
 */
async function resolveSiteId(): Promise<string> {
  return (await getCurrentSiteId()) ?? NX_DEFAULT_SITE_ID;
}

export async function getTheme(): Promise<NxThemeTokens> {
  const db = getDb();
  const siteId = await resolveSiteId();
  const rows = await db
    .select()
    .from(nxSettings)
    .where(and(eq(nxSettings.siteId, siteId), eq(nxSettings.key, "theme")))
    .limit(1);

  if (rows.length === 0 || !rows[0]) {
    return DEFAULT_THEME;
  }

  return rows[0].value as NxThemeTokens;
}

export async function getNavigation(
  location: string = "header",
): Promise<NxNavItem[]> {
  const db = getDb();
  const siteId = await resolveSiteId();
  const rows = await db
    .select()
    .from(nxNavigation)
    .where(
      and(eq(nxNavigation.siteId, siteId), eq(nxNavigation.location, location)),
    )
    .limit(1);

  if (rows.length === 0 || !rows[0]) {
    return [];
  }

  return rows[0].items;
}

export async function getPageBySlug(
  slug: string,
  options?: { draft?: boolean },
): Promise<Record<string, unknown> | null> {
  const where: Record<string, unknown> = { slug: slug || "/" };

  if (!options?.draft) {
    where.status = "published";
  }

  const result = await findDocuments("pages", {
    where,
    limit: 1,
  });

  return result.docs[0] ?? null;
}

export async function getPostBySlug(
  slug: string,
  options?: { draft?: boolean },
): Promise<Record<string, unknown> | null> {
  const where: Record<string, unknown> = { slug };

  if (!options?.draft) {
    where.status = "published";
  }

  const result = await findDocuments("posts", {
    where,
    limit: 1,
  });

  return result.docs[0] ?? null;
}

export async function findPosts(
  options: NxFindOptions,
  user?: NxAuthUser,
): Promise<NxFindResult> {
  return findDocuments("posts", options, user);
}

export async function getAllPageSlugs(): Promise<string[]> {
  const result = await findDocuments("pages", {
    limit: 10000,
  });

  return result.docs
    .map((doc) => doc.slug as string)
    .filter(Boolean);
}

export async function getSetting<T = unknown>(key: string): Promise<T | null> {
  const db = getDb();
  const siteId = await resolveSiteId();
  const rows = await db
    .select()
    .from(nxSettings)
    .where(and(eq(nxSettings.siteId, siteId), eq(nxSettings.key, key)))
    .limit(1);

  if (rows.length === 0 || !rows[0]) {
    return null;
  }

  return rows[0].value as T;
}
