import { getCollectionConfig } from "@nexpress/core";
import { CollectionEditView } from "@nexpress/admin/client";
import { toClientCollectionConfig } from "@nexpress/next";

import { ensureFor } from "@/lib/bootstrap";

interface Props {
  params: Promise<{ collection: string }>;
}

export default async function AdminCollectionCreate({ params }: Props) {
  await ensureFor("read");
  const { collection } = await params;
  const config = getCollectionConfig(collection);

  return (
    <CollectionEditView
      config={toClientCollectionConfig(config)}
      collectionSlug={collection}
    />
  );
}
