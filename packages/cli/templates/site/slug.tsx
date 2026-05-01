import { getPageBySlug } from "@nexpress/core";
import { notFound } from "next/navigation";

import { ensureFor } from "@/lib/bootstrap";

interface SitePageProps {
  params: Promise<{ slug?: string[] }>;
}

export default async function SitePage({ params }: SitePageProps) {
  await ensureFor("read");
  const { slug } = await params;
  const path = slug?.join("/") || "/";
  const page = await getPageBySlug(path);
  if (!page) notFound();

  return (
    <article className="prose">
      <h1>{(page.title as string) ?? "Untitled"}</h1>
      {typeof page.summary === "string" ? <p>{page.summary}</p> : null}
    </article>
  );
}
