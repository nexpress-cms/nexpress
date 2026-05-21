import { findDocuments } from "@nexpress/core";
import type { NpRouteRenderProps } from "@nexpress/theme";
import * as React from "react";

import {
  MagazineArchiveItem,
  type MagazineArchiveItemDoc,
} from "../components/archive-item.js";

const SECTION_TO_CATEGORY: Record<string, string> = {
  features: "Features",
  dispatches: "Dispatches",
  profiles: "Profiles",
  essays: "Essays",
  photography: "Photography",
};

function titleFor(section: string): string {
  return SECTION_TO_CATEGORY[section] ?? section;
}

export async function MagazineSectionArchiveRoute({
  params,
}: NpRouteRenderProps): Promise<React.ReactElement> {
  const section = params.section ?? "";
  const name = titleFor(section);
  const categories = await findDocuments<Record<string, unknown>>("categories", {
    where: { slug: section },
    limit: 1,
  });
  const category = categories.docs[0];
  const categoryId = typeof category?.id === "string" ? category.id : null;
  const result = categoryId
    ? await findDocuments<Record<string, unknown>>("posts", {
        where: { status: "published", categories: categoryId },
        sort: "-publishedAt",
        limit: 24,
      })
    : await findDocuments<Record<string, unknown>>("posts", {
        where: { status: "published" },
        sort: "-publishedAt",
        limit: 12,
      });

  return (
    <section className="np-magazine-section-page">
      <div className="np-magazine-container">
        <header className="np-magazine-section-hero">
          <p>Section</p>
          <h1>{name}</h1>
          <span>
            {typeof category?.description === "string"
              ? category.description
              : "Recent stories from the magazine desk, arranged newest first."}
          </span>
        </header>

        <div className="np-magazine-section-layout">
          <aside>
            <strong>{result.totalDocs.toString()}</strong>
            <span>{result.totalDocs === 1 ? "story" : "stories"}</span>
          </aside>
          {result.docs.length > 0 ? (
            <ul className="np-magazine-section-list">
              {result.docs.map((doc, index) => (
                <li key={(doc.id as string | undefined) ?? index.toString()}>
                  <MagazineArchiveItem
                    doc={doc as MagazineArchiveItemDoc}
                    romanIndex={index}
                  />
                </li>
              ))}
            </ul>
          ) : (
            <p className="np-magazine-archive-empty">No stories yet.</p>
          )}
        </div>
      </div>
    </section>
  );
}
