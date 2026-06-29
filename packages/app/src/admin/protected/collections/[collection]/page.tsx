import {
  getCollectionConfig,
  findDocuments,
  verifyTokenFull,
  type NpDocumentStatus,
} from "@nexpress/core";
import { CollectionListView } from "@nexpress/admin/client";
import { toClientCollectionConfig } from "@nexpress/next";
import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { ensureFor } from "../../../../lib/init-core";
import { getAuthRuntimeConfig } from "../../../../lib/auth-helpers";
import { getDb } from "../../../../lib/db";

export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ collection: string }>;
  searchParams: Promise<{
    page?: string;
    sort?: string;
    search?: string;
    status?: string;
    /**
     * Universal-content-model #748 — when present, narrows the
     * list view to rows with `kind = <value>`. The admin
     * sidebar's per-kind entries set this. Unknown kinds yield
     * an empty list rather than an error (operators bookmark
     * URLs, themes change kinds — silent degradation beats a
     * confusing 404 on a still-existing collection).
     */
    kind?: string;
  }>;
}

const LIST_STATUS_FILTERS = new Set<NpDocumentStatus>([
  "draft",
  "scheduled",
  "published",
  "pending",
  "archived",
]);

function normalizeStatusFilter(value: string | undefined): NpDocumentStatus | undefined {
  if (!value || value === "all") return undefined;
  return LIST_STATUS_FILTERS.has(value as NpDocumentStatus)
    ? (value as NpDocumentStatus)
    : undefined;
}

export default async function CollectionListPage({ params, searchParams }: Props) {
  await ensureFor("read");

  const { collection } = await params;
  const config = getCollectionConfig(collection);
  if (!config) notFound();

  // Resolve the staff session and pass it into `findDocuments` so the
  // collection's `access.read` is evaluated against the current user.
  // Without this the page leaked documents from access-restricted
  // collections to any logged-in staff account regardless of role
  // (#57).
  const cookieStore = await cookies();
  const token = cookieStore.get("np-session")?.value;
  if (!token) redirect("/admin/login");
  const { secret } = getAuthRuntimeConfig();
  const user = await verifyTokenFull(token, secret, getDb());
  if (!user) redirect("/admin/login");

  const { page, sort, search, kind, status } = await searchParams;
  const activeStatus = normalizeStatusFilter(status);
  const where: { kind?: string; status?: NpDocumentStatus } = {};
  if (typeof kind === "string" && kind.length > 0) where.kind = kind;
  if (activeStatus) where.status = activeStatus;

  const result = await findDocuments(
    collection,
    {
      page: parseInt(page || "1", 10),
      limit: 25,
      sort: sort || config.admin?.defaultSort || "-createdAt",
      search,
      ...(Object.keys(where).length > 0 ? { where } : {}),
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
      {...(typeof kind === "string" && kind.length > 0 ? { activeKind: kind } : {})}
      {...(activeStatus ? { activeStatus } : {})}
    />
  );
}
