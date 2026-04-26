import { buildPageMetadata, getPageBySlug } from "@nexpress/core";
import { renderBlocks } from "@nexpress/blocks";
import type { Metadata } from "next";
import { draftMode } from "next/headers";
import { notFound } from "next/navigation";
import type { NxPageBlocks } from "@nexpress/blocks";

import { DefaultHomePage } from "@/components/default-home-page";
import { ensureCoreServices, ensurePluginsLoaded } from "@/lib/init-core";
import {
  RenderBodyEnd,
  RenderHead,
  collectRenderContributions,
} from "@/components/render-contributions";

interface PageProps {
  params: Promise<{ slug?: string[] }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  ensureCoreServices();
  const { slug } = await params;
  const path = slug?.join("/") || "/";
  const page = await getPageBySlug(path);

  // Pages without a published row fall back to site-wide
  // defaults; that's also what the `DefaultHomePage` empty-state
  // surface uses, so the meta tags still describe the brand.
  return (await buildPageMetadata({
    title: typeof page?.title === "string" ? page.title : null,
    description:
      typeof page?.seoDescription === "string" ? page.seoDescription : null,
    path: path === "/" ? "/" : `/${path}`,
    ogType: "website",
  })) as Metadata;
}

export default async function CatchAllPage({ params }: PageProps) {
  ensureCoreServices();
  await ensurePluginsLoaded();
  const { slug } = await params;
  const path = slug?.join("/") || "/";
  const { isEnabled: isDraft } = await draftMode();

  const page = await getPageBySlug(path, { draft: isDraft });
  if (!page) {
    // The site root is special: a fresh install with no pages
    // would 404 on `/` and look broken. Surface a default landing
    // page that confirms NexPress is running and points the
    // operator at /admin. Once an admin publishes a real
    // `pages` row with slug `/`, the lookup above succeeds and
    // this branch never runs.
    if (path === "/") {
      return <DefaultHomePage />;
    }
    notFound();
  }

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
