import { getCollectionConfig, findDocuments, verifyTokenFull } from "@nexpress/core";
import { CollectionListView } from "@nexpress/admin/client";
import { toClientCollectionConfig } from "@nexpress/next";
import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { ensureCoreServices } from "@/lib/init-core";
import { getAuthRuntimeConfig } from "@/lib/auth-helpers";
import { getDb } from "@/lib/db";

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

  // Resolve the staff session and pass it into `findDocuments` so the
  // collection's `access.read` is evaluated against the current user.
  // Without this the page leaked documents from access-restricted
  // collections to any logged-in staff account regardless of role
  // (#57).
  const cookieStore = await cookies();
  const token = cookieStore.get("nx-session")?.value;
  if (!token) redirect("/admin/login");
  const { secret } = getAuthRuntimeConfig();
  const user = await verifyTokenFull(token, secret, getDb());
  if (!user) redirect("/admin/login");

  const { page, sort, search } = await searchParams;

  const result = await findDocuments(
    collection,
    {
      page: parseInt(page || "1", 10),
      limit: 25,
      sort: sort || config.admin?.defaultSort || "-createdAt",
      search,
    },
    user,
  );

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
