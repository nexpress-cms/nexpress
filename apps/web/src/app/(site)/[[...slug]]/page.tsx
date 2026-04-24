import { getPageBySlug } from "@nexpress/core";
import { renderBlocks } from "@nexpress/blocks";
import { draftMode } from "next/headers";
import { notFound } from "next/navigation";
import type { NxPageBlocks } from "@nexpress/blocks";

import { ensureCoreServices, ensurePluginsLoaded } from "@/lib/init-core";
import {
  RenderBodyEnd,
  RenderHead,
  collectRenderContributions,
} from "@/components/render-contributions";

interface PageProps {
  params: Promise<{ slug?: string[] }>;
}

export default async function CatchAllPage({ params }: PageProps) {
  ensureCoreServices();
  await ensurePluginsLoaded();
  const { slug } = await params;
  const path = slug?.join("/") || "/";
  const { isEnabled: isDraft } = await draftMode();

  const page = await getPageBySlug(path, { draft: isDraft });
  if (!page) notFound();

  const pageBlocks = page.blocks as NxPageBlocks | undefined;

  const { head, bodyEnd } = await collectRenderContributions({
    collection: "pages",
    slug: path,
    document: page,
  });

  return (
    <div className="nx-page">
      <RenderHead entries={head} />
      {isDraft ? (
        <div className="nx-draft-banner" style={{ padding: "0.75rem 1rem", background: "#fef3c7", color: "#92400e", fontSize: "0.875rem", textAlign: "center" }}>
          Draft preview — <a href="/api/preview/exit" style={{ color: "inherit", textDecoration: "underline" }}>exit</a>
        </div>
      ) : null}
      {pageBlocks ? renderBlocks(pageBlocks) : <h1>{(page.title as string) ?? "Untitled"}</h1>}
      <RenderBodyEnd entries={bodyEnd} />
    </div>
  );
}
