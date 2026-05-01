import { getCollectionConfig, getDocumentById } from "@nexpress/core";
import { CollectionEditView } from "@nexpress/admin/client";
import { toClientCollectionConfig } from "@nexpress/next";

import { ensureFor } from "@/lib/bootstrap";

interface Props {
  params: Promise<{ collection: string; id: string }>;
}

export default async function AdminEditDocument({ params }: Props) {
  await ensureFor("read");
  const { collection, id } = await params;
  const config = getCollectionConfig(collection);
  const doc = await getDocumentById(collection, id);

  if (!doc) {
    return <p className="text-sm text-slate-600">Document not found.</p>;
  }

  return (
    <CollectionEditView
      config={toClientCollectionConfig(config)}
      doc={doc}
      collectionSlug={collection}
    />
  );
}
