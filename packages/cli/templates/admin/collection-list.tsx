import { findDocuments, getCollectionConfig } from "@nexpress/core";
import { CollectionListView } from "@nexpress/admin/client";
import { toClientCollectionConfig } from "@nexpress/next";

import { ensureFor } from "@/lib/bootstrap";

interface Props {
  params: Promise<{ collection: string }>;
  searchParams: Promise<{ page?: string }>;
}

export default async function AdminCollectionList({ params, searchParams }: Props) {
  await ensureFor("read");
  const { collection } = await params;
  const { page } = await searchParams;
  const currentPage = Math.max(1, Number(page ?? 1) || 1);

  const config = getCollectionConfig(collection);
  const { docs, totalDocs, totalPages } = await findDocuments(collection, {
    page: currentPage,
    limit: 20,
    sort: "-updatedAt",
  });

  return (
    <CollectionListView
      config={toClientCollectionConfig(config)}
      docs={docs}
      totalDocs={totalDocs}
      totalPages={totalPages}
      currentPage={currentPage}
    />
  );
}
