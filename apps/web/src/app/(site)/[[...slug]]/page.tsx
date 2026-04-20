import { getPageBySlug } from "@nexpress/core";
import { renderBlocks } from "@nexpress/blocks";
import { notFound } from "next/navigation";
import type { NxPageBlocks } from "@nexpress/blocks";

interface PageProps {
  params: Promise<{ slug?: string[] }>;
}

export default async function CatchAllPage({ params }: PageProps) {
  const { slug } = await params;
  const path = slug?.join("/") || "/";

  const page = await getPageBySlug(path);
  if (!page) notFound();

  const pageBlocks = page.blocks as NxPageBlocks | undefined;
  if (!pageBlocks) {
    return (
      <div className="nx-page">
        <h1>{(page.title as string) ?? "Untitled"}</h1>
      </div>
    );
  }

  return (
    <div className="nx-page">
      {renderBlocks(pageBlocks)}
    </div>
  );
}
