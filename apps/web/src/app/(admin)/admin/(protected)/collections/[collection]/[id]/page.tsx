import { getCollectionConfig, getCollectionTabsForSlug, getDocumentById } from "@nexpress/core";
import { CollectionEditView } from "@nexpress/admin/client";
import type { CollectionTabDescriptor } from "@nexpress/admin";
import { toClientCollectionConfig } from "@nexpress/next";
import { notFound } from "next/navigation";
import { ensureCoreServices, ensurePluginsLoaded } from "@/lib/init-core";

export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ collection: string; id: string }>;
}

export default async function EditPage({ params }: Props) {
  ensureCoreServices();
  await ensurePluginsLoaded();

  const { collection, id } = await params;
  const config = getCollectionConfig(collection);
  if (!config) notFound();

  const doc = await getDocumentById(collection, id);
  if (!doc) notFound();

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
      config={toClientCollectionConfig(config)}
      doc={doc}
      collectionSlug={collection}
      collectionTabs={tabs}
    />
  );
}
