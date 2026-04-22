import { getCollectionConfig, findDocuments } from "@nexpress/core";
import { CollectionListView } from "@nexpress/admin/client";
import { toClientCollectionConfig } from "@nexpress/next";
import { notFound } from "next/navigation";
import { ensureCoreServices } from "@/lib/init-core";

export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ collection: string }>;
  searchParams: Promise<{ page?: string; sort?: string; search?: string }>;
}

export default async function CollectionListPage({
  params,
  searchParams,
}: Props) {
  ensureCoreServices();

  const { collection } = await params;
  const config = getCollectionConfig(collection);
  if (!config) notFound();

  const { page, sort, search } = await searchParams;

  const result = await findDocuments(collection, {
    page: parseInt(page || "1", 10),
    limit: 25,
    sort: sort || config.admin?.defaultSort || "-createdAt",
    search,
  });

  return (
    <CollectionListView
      config={toClientCollectionConfig(config)}
      docs={result.docs}
      totalDocs={result.totalDocs}
      totalPages={result.totalPages}
      currentPage={result.page}
    />
  );
}
