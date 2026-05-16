import { z } from "zod";

/**
 * Phase F.9 — operator-tunable magazine settings.
 *
 * Each field maps to an admin auto-form widget via the F.3
 * introspector. The schema also drives the `getThemeSettings`
 * call site here in the theme; type narrowing happens at the
 * theme component via `z.infer<typeof magazineSettingsSchema>`.
 */
export const magazineSettingsSchema = z.object({
  heroStyle: z
    .enum(["featured", "carousel", "grid"])
    .default("featured")
    .describe(
      "Layout for the magazine.hero-feature block: featured (single lead story with background image), carousel (horizontally scrollable cards), or grid (3-column tile grid). Each block carries its own optional `styleOverride` prop — set it to `auto` (default) to follow this site-level setting, or pin one variant per block.",
    ),
  showAuthorByline: z
    .boolean()
    .default(true)
    .describe("Show the author byline + dateline above each post body."),
  postsPerPage: z
    .number()
    .int()
    .min(1)
    .max(50)
    .default(10)
    .describe("Posts per page on archive listings (category, tag, author)."),
  accentColor: z
    .string()
    .regex(/^#[0-9a-f]{6}$/i)
    .optional()
    .describe("Optional override for the masthead accent color (hex). Falls back to the theme token."),
  newsletterEnabled: z
    .boolean()
    .default(true)
    .describe("Show the footer newsletter signup form."),
  leadIssueNumber: z
    .number()
    .int()
    .min(1)
    .max(9999)
    .optional()
    .describe(
      "Issue number rendered on the cover-story lead card (e.g. 47). When unset, the masthead's week-of-year computation is used so a fresh install never shows '0'.",
    ),
  socialLinks: z
    .array(
      z.object({
        platform: z
          .enum(["twitter", "github", "instagram", "linkedin", "rss"])
          .describe("Social platform"),
        url: z.string().url().describe("Profile URL"),
      }),
    )
    .default([])
    .describe("Social profile links rendered in the footer's Colophon column."),
  footerColophon: z
    .string()
    .optional()
    .describe(
      "Italic colophon paragraph in the footer's brand column. Falls back to the theme-shipped default when unset.",
    ),
  footerCredits: z
    .string()
    .optional()
    .describe(
      "Single-line credit under the colophon (e.g. \"Editor — Helena Park · Art — Iseul Ha · Web — Built on NexPress\"). Falls back to a neutral default when unset.",
    ),
  subscribeStats: z
    .string()
    .optional()
    .describe(
      "Optional stats line under the subscribe button (e.g. \"28,412 readers · 54 countries · 0 ads\"). Hidden when unset.",
    ),
});

export type MagazineSettings = z.infer<typeof magazineSettingsSchema>;
