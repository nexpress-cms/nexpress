import { getCollectionConfig } from "@nexpress/core";
import { CollectionEditView } from "@nexpress/admin/client";
import { toClientCollectionConfig } from "@nexpress/next";
import { notFound } from "next/navigation";
import { ensureFor } from "../../../../../lib/init-core";

export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ collection: string }>;
}

export default async function CreatePage({ params }: Props) {
  await ensureFor("read");

  const { collection } = await params;
  const config = getCollectionConfig(collection);
  if (!config) notFound();

  return <CollectionEditView config={toClientCollectionConfig(config)} collectionSlug={collection} />;
}
