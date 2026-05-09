import * as React from "react";
import type { NpRouteRenderProps, NpThemeArchives } from "@nexpress/theme";
import {
  findDocuments,
  type NpFindResult,
} from "@nexpress/core";

/**
 * Phase F.9 — magazine archive components.
 *
 * Each archive component fetches its own data (per design doc
 * §5.1 — components own queries; framework provides the route
 * dispatch only). The hasMany filter from F.E (#542) keeps the
 * code minimal: `where: { categories: id }` works directly.
 *
 * Two archives shipped:
 *   - byCategory at /category/:slug
 *   - byAuthor at /author/:id
 *
 * byTag and byDate are recorded as F.9.1 follow-up (the
 * shape mirrors byCategory; one less for review focus).
 */

interface ArchiveLayoutProps {
  title: string;
  subtitle?: string;
  result: NpFindResult<Record<string, unknown>>;
}

function ArchiveLayout({
  title,
  subtitle,
  result,
}: ArchiveLayoutProps): React.ReactElement {
  return (
    <main
      className="np-magazine-archive"
      style={{ maxWidth: 720, margin: "3rem auto", padding: "0 1.5rem" }}
    >
      <header
        style={{
          marginBottom: "2rem",
          borderBottom: "3px double var(--np-color-foreground)",
          paddingBottom: "1rem",
        }}
      >
        <p
          style={{
            margin: 0,
            color: "var(--np-color-muted-foreground)",
            fontSize: "0.8125rem",
            textTransform: "uppercase",
            letterSpacing: "0.1em",
            fontFamily: "var(--np-font-heading)",
          }}
        >
          Archive
        </p>
        <h1
          style={{
            margin: "0.5rem 0 0",
            fontSize: "2rem",
            fontFamily: "var(--np-font-heading)",
          }}
        >
          {title}
        </h1>
        {subtitle ? (
          <p style={{ margin: "0.75rem 0 0", color: "var(--np-color-muted-foreground)" }}>
            {subtitle}
          </p>
        ) : null}
        <p style={{ margin: "0.75rem 0 0", color: "var(--np-color-muted-foreground)", fontSize: "0.875rem" }}>
          {result.totalDocs} {result.totalDocs === 1 ? "story" : "stories"}
        </p>
      </header>
      {result.docs.length === 0 ? (
        <p style={{ color: "var(--np-color-muted-foreground)" }}>
          No stories yet.
        </p>
      ) : (
        <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
          {result.docs.map((doc) => (
            <li
              key={doc.id as string}
              style={{
                padding: "1.25rem 0",
                borderBottom: "1px solid var(--np-color-border)",
              }}
            >
              <h2
                style={{
                  fontFamily: "var(--np-font-heading)",
                  fontSize: "1.25rem",
                  margin: 0,
                }}
              >
                <a
                  href={`/blog/${doc.slug as string}`}
                  style={{ color: "inherit", textDecoration: "none" }}
                >
                  {doc.title as string}
                </a>
              </h2>
              {doc.excerpt ? (
                <p
                  style={{
                    margin: "0.5rem 0 0",
                    color: "var(--np-color-muted-foreground)",
                  }}
                >
                  {doc.excerpt as string}
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}

export async function CategoryArchive({
  params,
}: NpRouteRenderProps): Promise<React.ReactElement> {
  const slug = params.slug ?? "";
  // Find category by slug. The category collection is required by
  // the manifest (see settings.ts/manifest.requires); operators
  // who skip `pnpm nexpress theme:install` see an empty result.
  const cats = await findDocuments<Record<string, unknown>>("categories", {
    where: { slug },
    limit: 1,
  });
  const category = cats.docs[0];
  if (!category) {
    return (
      <ArchiveLayout
        title="Category not found"
        result={{
          docs: [],
          totalDocs: 0,
          totalPages: 0,
          page: 1,
          limit: 10,
          hasNextPage: false,
          hasPrevPage: false,
        }}
      />
    );
  }
  const result = await findDocuments<Record<string, unknown>>("posts", {
    where: {
      status: "published",
      categories: category.id as string,
    },
    sort: "-publishedAt",
    limit: 10,
  });
  return (
    <ArchiveLayout
      title={(category.name as string) ?? slug}
      subtitle={category.description as string | undefined}
      result={result}
    />
  );
}

export async function AuthorArchive({
  params,
}: NpRouteRenderProps): Promise<React.ReactElement> {
  const id = params.id ?? "";
  const result = await findDocuments<Record<string, unknown>>("posts", {
    where: { status: "published", author: id },
    sort: "-publishedAt",
    limit: 10,
  });
  return (
    <ArchiveLayout
      title={`Stories by ${id}`}
      subtitle="Recent posts from this author."
      result={result}
    />
  );
}

export const magazineArchives: NpThemeArchives = {
  posts: {
    byCategory: { component: CategoryArchive },
    byAuthor: { component: AuthorArchive },
  },
};
