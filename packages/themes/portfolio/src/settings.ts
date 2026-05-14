import { z } from "zod";

/**
 * Phase F.9-C — operator-tunable portfolio settings.
 *
 * Stresses F.3's auto-form on **deep settings**: many fields,
 * mixed types, range-constrained numbers, color picker (hex
 * regex heuristic), nested array of objects with required
 * sub-fields. Combined with magazine's enum/array shape and
 * docs' text-heavy shape, this round-trips F.3's full
 * widget surface.
 */
export const portfolioSettingsSchema = z.object({
  // Project meta
  showProjectMeta: z
    .boolean()
    .default(true)
    .describe("Show role / year / client meta strip on project detail pages."),
  showProjectTags: z
    .boolean()
    .default(false)
    .describe("Show tag chips below project titles on the index grid."),
  // Brand
  accentColor: z
    .string()
    .regex(/^#[0-9a-f]{6}$/i)
    .optional()
    .describe(
      "Optional accent color override (hex). Used for hover states and the masthead underline.",
    ),
  studioName: z
    .string()
    .default("Studio")
    .describe("Studio / personal name shown in the masthead and footer."),
  timezone: z
    .string()
    .default("Asia/Seoul")
    .describe(
      "IANA timezone for the masthead's local-time pill (e.g. 'Asia/Seoul', 'America/New_York'). Leave at default to use studio-local time.",
    ),
  contactEmail: z
    .string()
    .email()
    .optional()
    .describe(
      "Studio mailto target rendered as a large heading in the contact strip. When omitted, the contact strip is hidden.",
    ),
  bookingNotice: z
    .string()
    .default("Currently — booking late 2026")
    .describe(
      "Short availability eyebrow above the contact mailto (e.g. 'Currently — booking late 2026').",
    ),
  aboutCopy: z
    .string()
    .default("")
    .meta({ widget: "textarea", rows: 4 })
    .describe(
      "Optional short bio for the studio. Renders as a multi-line textarea in admin (4 rows) and as a small paragraph above the footer contact line on the public site.",
    ),
  // Footer
  showFooterCredit: z
    .boolean()
    .default(true)
    .describe(
      "Show 'Built with NexPress' credit in the footer. Some studios prefer an unbranded footer.",
    ),
  copyrightYear: z
    .number()
    .int()
    .min(2000)
    .max(2100)
    .optional()
    .describe(
      "Optional fixed copyright year. Defaults to the current year when omitted.",
    ),
  // Client logos
  clientLogos: z
    .array(
      z.object({
        name: z.string().describe("Client name (alt text + caption)"),
        logoUrl: z.string().url().describe("Logo image URL"),
        link: z.string().url().optional().describe("Optional case-study link"),
      }),
    )
    .default([])
    .describe(
      "Client logos rendered in the homepage 'Selected clients' strip. Edit per project.",
    ),
  // Social links — rendered under the contact strip as a mid-
  // dot–separated list. Each entry is { platform, url }; the
  // platform name is title-cased and shown verbatim ("Instagram",
  // "Are.na", "Dribbble", …) so a studio can list any service
  // without us shipping a per-platform icon set.
  socialLinks: z
    .array(
      z.object({
        platform: z
          .string()
          .describe("Display label (e.g. 'Instagram', 'Are.na', 'Dribbble')"),
        url: z.string().url().describe("Profile URL"),
      }),
    )
    .default([])
    .describe(
      "Social profiles linked from the contact strip below the mailto line. Empty array hides the section.",
    ),
});

export type PortfolioSettings = z.infer<typeof portfolioSettingsSchema>;
