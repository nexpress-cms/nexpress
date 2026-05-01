import Link from "next/link";

import { getAllCollectionSlugs, getCollectionConfig } from "@nexpress/core";

import { ensureFor } from "@/lib/bootstrap";

export default async function AdminDashboard() {
  await ensureFor("read");
  const collections = getAllCollectionSlugs().map((slug) => getCollectionConfig(slug));

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Collections</h1>
      <ul className="grid gap-4 sm:grid-cols-2">
        {collections.map((c) => (
          <li key={c.slug} className="rounded border bg-white p-4">
            <Link className="block space-y-1" href={`/admin/collections/${c.slug}`}>
              <h2 className="font-semibold">{c.labels.plural}</h2>
              {c.admin?.description ? (
                <p className="text-sm text-slate-600">{c.admin.description}</p>
              ) : null}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
