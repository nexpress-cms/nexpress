import { getCollectionConfig } from "@nexpress/core";
import { CollectionEditView } from "@nexpress/admin/client";
import { notFound } from "next/navigation";
import { ensureCoreServices } from "@/lib/init-core";

export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ collection: string }>;
}

export default async function CreatePage({ params }: Props) {
  ensureCoreServices();

  const { collection } = await params;
  const config = getCollectionConfig(collection);
  if (!config) notFound();

  return <CollectionEditView config={config} collectionSlug={collection} />;
}
