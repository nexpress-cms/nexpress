import { getCollectionConfig } from "@nexpress/core";
import { CollectionEditView } from "@nexpress/admin/client";
import { toClientCollectionConfig } from "@nexpress/next";
import { notFound } from "next/navigation";
import { ensureFor } from "../../../../../lib/init-core";
import { getCachedActiveTheme } from "../../../../../lib/cached-theme";
import { resolveCreateKindPreset } from "../../../../../lib/kind-preset";

export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ collection: string }>;
  searchParams: Promise<{
    /**
     * Universal-content-model #748 — when present, pre-fills the
     * kind field on the new-doc form so creating from a
     * kind-scoped list view lands in the same bucket. Unknown
     * values are ignored before they reach the form so bookmarked
     * stale URLs fall back to the field's defaultValue.
     */
    kind?: string;
  }>;
}

export default async function CreatePage({ params, searchParams }: Props) {
  await ensureFor("read");

  const { collection } = await params;
  const { kind } = await searchParams;
  const config = getCollectionConfig(collection);
  if (!config) notFound();

  // Pre-fill the kind field by threading it through as a partial
  // `doc`. The edit view treats partials as initial form values;
  // it never gates on "is this an existing row?" — the missing
  // `id` already signals create-mode to the submit handler.
  const initialKind = resolveCreateKindPreset(config, kind);
  const initialDoc = initialKind ? { kind: initialKind } : undefined;

  // Active-theme gate for theme-contributed fields — same as the
  // edit page. See `[id]/page.tsx` for the longer rationale.
  const activeTheme = await getCachedActiveTheme();
  const activeThemeId = activeTheme?.manifest.id ?? null;

  return (
    <CollectionEditView
      config={toClientCollectionConfig(config, activeThemeId)}
      collectionSlug={collection}
      canPreview={Boolean(config.seo?.urlPath)}
      {...(initialDoc ? { doc: initialDoc } : {})}
    />
  );
}
