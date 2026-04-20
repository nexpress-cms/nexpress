import { getCollectionConfig, getDocumentById } from "@nexpress/core";
import { CollectionEditView } from "@nexpress/admin/client";
import { notFound } from "next/navigation";
import { ensureCoreServices } from "@/lib/init-core";

export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ collection: string; id: string }>;
}

export default async function EditPage({ params }: Props) {
  ensureCoreServices();

  const { collection, id } = await params;
  const config = getCollectionConfig(collection);
  if (!config) notFound();

  const doc = await getDocumentById(collection, id);
  if (!doc) notFound();

  return (
    <CollectionEditView
      config={config}
      doc={doc}
      collectionSlug={collection}
    />
  );
}
