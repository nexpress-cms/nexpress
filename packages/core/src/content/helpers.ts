import { eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import { nxSettings } from "../db/schema/system.js";
import { nxNavigation } from "../db/schema/system.js";
import type { NxThemeTokens } from "../theme/types.js";
import type { NxNavItem, NxFindOptions, NxFindResult, NxAuthUser } from "../config/types.js";
import { DEFAULT_THEME } from "../theme/defaults.js";
import { findDocuments, getDb } from "../collections/index.js";

export async function getTheme(): Promise<NxThemeTokens> {
  const db = getDb() as NodePgDatabase<Record<string, unknown>>;
  const rows = await db
    .select()
    .from(nxSettings)
    .where(eq(nxSettings.key, "theme"))
    .limit(1);

  if (rows.length === 0 || !rows[0]) {
    return DEFAULT_THEME;
  }

  return rows[0].value as NxThemeTokens;
}

export async function getNavigation(
  location: string = "header",
): Promise<NxNavItem[]> {
  const db = getDb() as NodePgDatabase<Record<string, unknown>>;
  const rows = await db
    .select()
    .from(nxNavigation)
    .where(eq(nxNavigation.location, location))
    .limit(1);

  if (rows.length === 0 || !rows[0]) {
    return [];
  }

  return rows[0].items;
}

export async function getPageBySlug(
  slug: string,
): Promise<Record<string, unknown> | null> {
  const result = await findDocuments("pages", {
    where: { slug: slug || "/" },
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
  const db = getDb() as NodePgDatabase<Record<string, unknown>>;
  const rows = await db
    .select()
    .from(nxSettings)
    .where(eq(nxSettings.key, key))
    .limit(1);

  if (rows.length === 0 || !rows[0]) {
    return null;
  }

  return rows[0].value as T;
}
