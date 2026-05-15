import { getCollectionConfig } from "@nexpress/core";
import { CollectionEditView } from "@nexpress/admin/client";
import { toClientCollectionConfig } from "@nexpress/next";
import { notFound } from "next/navigation";
import { ensureFor } from "../../../../../lib/init-core";

export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ collection: string }>;
  searchParams: Promise<{
    /**
     * Universal-content-model #748 — when present, pre-fills the
     * kind field on the new-doc form so creating from a
     * kind-scoped list view lands in the same bucket. Validated
     * against the kind field's options at submit time by the
     * pipeline's Zod schema; an unknown value here just gets
     * stripped (the field falls back to its `defaultValue`).
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
  const initialDoc =
    typeof kind === "string" && kind.length > 0 ? { kind } : undefined;

  return (
    <CollectionEditView
      config={toClientCollectionConfig(config)}
      collectionSlug={collection}
      {...(initialDoc ? { doc: initialDoc } : {})}
    />
  );
}
