import React from "react";
import { JobsView } from "@nexpress/admin/client";
import { can, verifyTokenFull } from "@nexpress/core/auth";
import { getSearchCollectionLabels } from "@nexpress/core/search";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { getAuthRuntimeConfig } from "../../../lib/auth-helpers";
import { getDb } from "../../../lib/db";
import { ensureFor } from "../../../lib/init-core";
import { npParseJobListQuery } from "../../../lib/job-api-contract";

export const dynamic = "force-dynamic";

export default async function JobsPage({
  searchParams,
}: {
  searchParams: Promise<{ name?: string | string[] }>;
}) {
  await ensureFor("read");
  const token = (await cookies()).get("np-session")?.value;
  if (!token) redirect("/admin/login");
  const user = await verifyTokenFull(token, getAuthRuntimeConfig().secret, getDb());
  if (!user) redirect("/admin/login");
  if (!can(user, "admin.manage")) {
    return <p role="alert">You need admin.manage to inspect background jobs.</p>;
  }

  const params = await searchParams;
  const query = new URLSearchParams();
  for (const name of Array.isArray(params.name)
    ? params.name
    : params.name === undefined
      ? []
      : [params.name]) {
    query.append("name", name);
  }
  let queueName: string | undefined;
  try {
    queueName = npParseJobListQuery(query).name;
  } catch {
    return (
      <section className="space-y-3">
        <h1 className="text-xl font-semibold">Background jobs</h1>
        <p role="alert">The queue filter is invalid. No jobs were requested.</p>
        <a href="/admin/jobs" className="underline">
          View all queues
        </a>
      </section>
    );
  }
  const searchCollections = Object.entries(getSearchCollectionLabels()).map(([slug, label]) => ({
    slug,
    label,
  }));
  return (
    <JobsView
      key={queueName ?? "all"}
      queueName={queueName}
      searchCollections={searchCollections}
    />
  );
}
