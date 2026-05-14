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
  // Layout
  gridColumns: z
    .number()
    .int()
    .min(1)
    .max(6)
    .default(3)
    .describe("Number of columns in the project archive grid (1–6)."),
  cardAspect: z
    .enum(["square", "portrait", "landscape", "golden"])
    .default("square")
    .describe(
      "Aspect ratio of project cards: square (1:1), portrait (3:4), landscape (4:3), or golden (1:1.618).",
    ),
  hoverStyle: z
    .enum(["fade", "scale", "slide", "lift"])
    .default("fade")
    .describe(
      "Hover effect on project cards. fade: caption fades in. scale: image zooms 1.05x. slide: caption slides up. lift: card lifts with shadow.",
    ),
  galleryGutter: z
    .number()
    .int()
    .min(0)
    .max(64)
    .default(16)
    .describe("Gap between project cards in pixels (0–64)."),
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
});

export type PortfolioSettings = z.infer<typeof portfolioSettingsSchema>;
