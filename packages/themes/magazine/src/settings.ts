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
      "Layout for the homepage hero — single featured story, scrolling carousel, or 3-column grid. Currently a no-op (F.9.2 follow-up): the magazine theme renders one hero style regardless of this value because the `magazine.hero-feature` block carries a single image and can't shape-shift into a carousel/grid of stories. A future PR ships dedicated hero block variants that read this setting.",
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
});

export type MagazineSettings = z.infer<typeof magazineSettingsSchema>;
