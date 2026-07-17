import { z } from "zod";

/**
 * Phase F.9-B — operator-tunable docs settings.
 *
 * Stresses F.3's settings auto-form on a different axis from
 * magazine: more URL inputs, a select/enum for sidebar
 * orientation, and a documentation-flavored field set.
 */
export const docsSettingsSchema = z.object({
  version: z
    .string()
    .default("v1")
    .describe("Currently-displayed version label, shown in the masthead. Update on each release."),
  githubRepo: z
    .string()
    .url()
    .optional()
    .describe(
      "Optional repository URL — when set, page templates render an 'Edit on GitHub' link in the prev/next bar.",
    ),
  githubBranch: z
    .string()
    .default("main")
    .describe(
      "Branch the 'Edit on GitHub' link points at. Default 'main' — change to 'master' / 'docs' / whatever the repo uses.",
    ),
  githubDocsPath: z
    .string()
    .default("docs")
    .describe(
      "Path under the repo where doc source files live. Joined with the doc slug to build the edit link target.",
    ),
  githubExtension: z
    .string()
    .default(".md")
    .describe(
      "File extension appended to the slug when building the edit link (e.g. '.md', '.mdx'). Include the leading dot.",
    ),
  sidebarHeading: z
    .string()
    .default("Documentation")
    .describe("Heading shown above the hierarchical sidebar nav."),
  showTableOfContents: z
    .boolean()
    .default(true)
    .describe("Render the in-page TOC sidebar on doc pages."),
  searchPlaceholder: z
    .string()
    .default("Search the docs…")
    .describe("Placeholder text for the search input in the masthead."),
});

export type DocsSettings = z.infer<typeof docsSettingsSchema>;
