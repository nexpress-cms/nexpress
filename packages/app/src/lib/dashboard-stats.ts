import { count, desc, eq, isNull } from "drizzle-orm";
import type { AnyPgColumn, PgTable } from "drizzle-orm/pg-core";
import {
  getAllCollectionSlugs,
  getCollectionConfig,
  getCollectionTable,
  getSiteById,
  NP_DEFAULT_SITE_ID,
  npMedia,
} from "@nexpress/core";

import { getActiveThemeState } from "./active-theme-state";
import { getDb } from "./db";

export type DashboardStats = {
  collections: Array<{ slug: string; label: string; count: number }>;
  recentActivity: Array<{
    id: string;
    collection: string;
    title: string;
    action: string;
    timestamp: string;
  }>;
  draftCount: number;
  mediaCount: number;
  /**
   * First-time setup checklist state. Drives the dashboard's
   * `WelcomeCard`, which renders a 5-step checklist instead of the
   * previous static welcome message. Each flag answers "has the
   * operator already done step N?" — true means ✓, false means ☐.
   */
  onboarding: {
    siteNameSet: boolean;
    hasPublishedPost: boolean;
    themeCustomized: boolean;
    productionDomainSet: boolean;
  };
};

const TITLE_CANDIDATES = ["title", "name", "label", "slug"] as const;
const RECENT_PER_COLLECTION = 5;
const RECENT_LIMIT = 8;

function getColumn(table: PgTable, key: string): AnyPgColumn | null {
  const col = (table as unknown as Record<string, unknown>)[key];
  return col ? (col as AnyPgColumn) : null;
}

export async function loadDashboardStats(): Promise<DashboardStats> {
  const db = getDb();
  const slugs = getAllCollectionSlugs();

  const collectionEntries: DashboardStats["collections"] = [];
  let draftCount = 0;
  const activityCandidates: Array<{
    id: string;
    collection: string;
    title: string;
    action: string;
    timestamp: Date;
  }> = [];

  for (const slug of slugs) {
    const config = getCollectionConfig(slug);
    const table = getCollectionTable(slug) as PgTable;
    const label = config.labels.plural;

    const totalRows = (await db.select({ total: count() }).from(table)) as Array<{
      total: number | string;
    }>;
    collectionEntries.push({
      slug,
      label,
      count: Number(totalRows[0]?.total ?? 0),
    });

    const statusCol = getColumn(table, "status");
    if (statusCol) {
      const draftRows = (await db
        .select({ total: count() })
        .from(table)
        .where(eq(statusCol, "draft"))) as Array<{ total: number | string }>;
      draftCount += Number(draftRows[0]?.total ?? 0);
    }

    const updatedAtCol = getColumn(table, "updatedAt");
    const idCol = getColumn(table, "id");
    if (!updatedAtCol || !idCol) continue;

    const titleKey = TITLE_CANDIDATES.find((candidate) => getColumn(table, candidate));
    const titleCol = titleKey ? getColumn(table, titleKey) : null;
    const recentSelect: Record<string, AnyPgColumn> = {
      id: idCol,
      updatedAt: updatedAtCol,
      title: titleCol ?? idCol,
    };
    if (statusCol) {
      recentSelect.status = statusCol;
    }

    const rows = (await db
      .select(recentSelect)
      .from(table)
      .orderBy(desc(updatedAtCol))
      .limit(RECENT_PER_COLLECTION)) as Array<Record<string, unknown>>;

    for (const row of rows) {
      const rowIdValue = row.id;
      const rowId = typeof rowIdValue === "string" ? rowIdValue : "";
      if (!rowId) continue;

      const titleValue = row.title;
      const title =
        typeof titleValue === "string" && titleValue.trim().length > 0 ? titleValue : rowId;

      const statusValue = row.status;
      const action =
        typeof statusValue === "string" && statusValue.length > 0 ? statusValue : "updated";

      const updatedAtValue = row.updatedAt;
      let timestamp: Date;
      if (updatedAtValue instanceof Date) {
        timestamp = updatedAtValue;
      } else if (typeof updatedAtValue === "string") {
        timestamp = new Date(updatedAtValue);
      } else {
        timestamp = new Date();
      }

      activityCandidates.push({
        id: `${slug}:${rowId}`,
        collection: label,
        title,
        action,
        timestamp,
      });
    }
  }

  const mediaRows = (await db
    .select({ total: count() })
    .from(npMedia)
    .where(isNull(npMedia.deletedAt))) as Array<{ total: number | string }>;

  const recentActivity = activityCandidates
    .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
    .slice(0, RECENT_LIMIT)
    .map((item) => ({
      id: item.id,
      collection: item.collection,
      title: item.title,
      action: item.action,
      timestamp: item.timestamp.toISOString(),
    }));

  return {
    collections: collectionEntries.sort((a, b) => b.count - a.count),
    recentActivity,
    draftCount,
    mediaCount: Number(mediaRows[0]?.total ?? 0),
    onboarding: await loadOnboardingState(),
  };
}

/**
 * Resolve the first-time-setup checklist for the default site. Each
 * flag is best-effort: a missing setting or a thrown lookup falls back
 * to `false` (= step still pending) so the checklist never crashes the
 * dashboard render. Multi-site installs surface the *default* site's
 * state since the welcome card lives under the global dashboard route.
 */
async function loadOnboardingState(): Promise<DashboardStats["onboarding"]> {
  // Site name set: any name other than the seeded default counts.
  let siteNameSet = false;
  try {
    const site = await getSiteById(NP_DEFAULT_SITE_ID);
    siteNameSet = Boolean(site && site.name && site.name !== "Default site");
  } catch {
    /* swallow — checklist falls back to "pending" */
  }

  // First published post: count posts directly. We want PUBLISHED
  // specifically because a draft sitting in the editor doesn't make
  // the site useful to a visitor.
  let hasPublishedPost = false;
  try {
    const db = getDb();
    const postsTable = getCollectionTable("posts") as PgTable;
    const statusCol = getColumn(postsTable, "status");
    const rows = statusCol
      ? ((await db
          .select({ total: count() })
          .from(postsTable)
          .where(eq(statusCol, "published"))) as Array<{
          total: number | string;
        }>)
      : ((await db.select({ total: count() }).from(postsTable)) as Array<{
          total: number | string;
        }>);
    hasPublishedPost = Number(rows[0]?.total ?? 0) > 0;
  } catch {
    /* swallow */
  }

  // Theme customized: anything other than the framework's `default`
  // placeholder. The seed-installed default theme works but signals
  // "I haven't picked one yet" — operators usually swap to magazine /
  // portfolio / docs / their own theme.
  let themeCustomized = false;
  try {
    const activeTheme = await getActiveThemeState();
    themeCustomized = Boolean(
      activeTheme.effectiveActiveId && activeTheme.effectiveActiveId !== "default",
    );
  } catch {
    /* swallow */
  }

  // Production domain: SITE_URL is set at boot. localhost / 127.0.0.1
  // means the operator hasn't pointed at a real domain yet.
  const siteUrl = process.env.SITE_URL ?? "";
  const productionDomainSet =
    siteUrl.trim() !== "" && !/localhost|127\.0\.0\.1|0\.0\.0\.0/i.test(siteUrl);

  return {
    siteNameSet,
    hasPublishedPost,
    themeCustomized,
    productionDomainSet,
  };
}
