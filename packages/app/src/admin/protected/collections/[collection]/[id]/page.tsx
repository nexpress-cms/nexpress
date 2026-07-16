import {
  getCollectionConfig,
  getCollectionTabsForSlug,
  getDocumentById,
  verifyTokenFull,
} from "@nexpress/core";
import { CollectionEditView } from "@nexpress/admin/client";
import type { CollectionTabDescriptor } from "@nexpress/admin";
import { npSerializeCollectionDocumentWithDiagnostics } from "@nexpress/core/collections";
import { toClientCollectionConfig } from "@nexpress/next";
import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { ensureFor } from "../../../../../lib/init-core";
import { resolveCollectionPreviewPath } from "../../../../../lib/collection-preview";
import { getAuthRuntimeConfig } from "../../../../../lib/auth-helpers";
import { getCachedActiveTheme } from "../../../../../lib/cached-theme";
import { getDb } from "../../../../../lib/db";

export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ collection: string; id: string }>;
}

export default async function EditPage({ params }: Props) {
  await ensureFor("plugins");

  const { collection, id } = await params;
  const config = getCollectionConfig(collection);
  if (!config) notFound();

  // Pass the authenticated staff user into `getDocumentById` so the
  // collection's `access.read` is evaluated against the actual session
  // (#57). Previously the SSR fetch ran anonymous and returned data for
  // collections whose access function should have refused it.
  const cookieStore = await cookies();
  const token = cookieStore.get("np-session")?.value;
  if (!token) redirect("/admin/login");
  const { secret } = getAuthRuntimeConfig();
  const user = await verifyTokenFull(token, secret, getDb());
  if (!user) redirect("/admin/login");

  const doc = await getDocumentById(collection, id, user);
  if (!doc) notFound();

  // Active-theme gate for theme-contributed fields. Without this
  // Magazine-active sites see Portfolio's sidebar group cards (the
  // bundled-themes prebake merges every built-in theme's
  // `requires.collections` into the resolved config). The layout
  // already gates collections / kinds / blocks / patterns the same
  // way; this is the field-level pair.
  const activeTheme = await getCachedActiveTheme();
  const activeThemeId = activeTheme?.manifest.id ?? null;

  const tabs: CollectionTabDescriptor[] = getCollectionTabsForSlug(collection).map((tab) => ({
    pluginId: tab.pluginId,
    pluginName: tab.pluginName,
    id: tab.id,
    label: tab.label,
    widgets: tab.widgets,
    actions: tab.actions,
    description: tab.description,
  }));

  return (
    <CollectionEditView
      config={toClientCollectionConfig(config, activeThemeId)}
      doc={npSerializeCollectionDocumentWithDiagnostics<Record<string, unknown>>(doc, config)}
      collectionSlug={collection}
      collectionTabs={tabs}
      canPreview={Boolean(config.seo?.urlPath)}
      previewPath={resolveCollectionPreviewPath(config, doc)}
    />
  );
}
