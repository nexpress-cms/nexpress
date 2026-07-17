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
    .default("Owen & Spruce")
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
  // Hero meta — three label/value pairs shown under the hero
  // headline. Matches the prototype's What we do / Selected
  // clients / Recognition triplet. Empty array hides the meta
  // row entirely.
  heroMeta: z
    .array(
      z.object({
        label: z.string().describe("Block label (e.g. 'What we do')"),
        value: z.string().describe("Block value text"),
      }),
    )
    .default([
      {
        label: "What we do",
        value:
          "Identity systems, custom typefaces, art direction. Twelve projects a year, no more.",
      },
      {
        label: "Selected clients",
        value: "Aperture, MoMA PS1, Pentagram (NY), Hanmi Gallery, the City of Seoul.",
      },
      {
        label: "Recognition",
        value: "D&AD Yellow Pencil, TDC Tokyo, ADC Gold, Brand New of the Year.",
      },
    ])
    .describe(
      "Three meta blocks rendered under the hero headline (label + value). Empty array hides the row.",
    ),
  // Studio strip — eyebrow + display headline + body paragraphs
  // + 2x2 stats grid. The strip is hidden when both `studioBody`
  // and `studioStats` are empty.
  studioHeading: z
    .string()
    .default(
      "A four-person practice that <em>thinks</em> in book pages and <em>ships</em> in vector files.",
    )
    .describe(
      "Studio strip headline. Supports inline <em>...</em> runs for the italic-accent color.",
    ),
  studioBody: z
    .array(z.string())
    .default([
      "We work with one client at a time, on contracts that last between three months and two years. Every project goes through a small standing weekly review with the whole studio — the four of us and a long table.",
      "We share two desks with a typeface foundry in Hapjeong, two streets back from the river. Visitors are welcome on Fridays.",
    ])
    .meta({ widget: "textarea", rows: 3 })
    .describe(
      "Studio strip body paragraphs. Each entry renders as one <p>. Empty array hides the body column.",
    ),
  studioStats: z
    .array(
      z.object({
        value: z.string().describe("Stat figure (e.g. '2018', '04', '96')"),
        label: z.string().describe("Stat label (e.g. 'Projects shipped')"),
      }),
    )
    .default([
      { value: "2018", label: "Founded — Seoul, MA" },
      { value: "04", label: "People in the room" },
      { value: "96", label: "Projects shipped" },
      { value: "12 / yr", label: "Our annual ceiling" },
    ])
    .describe("2x2 grid of studio stats. Empty array hides the stats column."),
  footerHoursLine: z
    .string()
    .default("Open · Mon — Fri")
    .describe(
      "Short status / hours line rendered next to the pulse dot in the footer's left column.",
    ),
  // View toggle — decorative in v0.1 (no client island wired).
  // Hidden by default; operators flip it on when they wire a
  // list-view template themselves.
  showViewToggle: z
    .boolean()
    .default(false)
    .describe(
      "Show the grid / list view toggle in the index controls strip. Off by default — the toggle is decorative until a list template is wired.",
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
    .describe("Optional fixed copyright year. Defaults to the current year when omitted."),
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
    .describe("Client logos rendered in the homepage 'Selected clients' strip. Edit per project."),
  // Social links — rendered under the contact strip as a mid-
  // dot–separated list. Each entry is { platform, url }; the
  // platform name is title-cased and shown verbatim ("Instagram",
  // "Are.na", "Dribbble", …) so a studio can list any service
  // without us shipping a per-platform icon set.
  socialLinks: z
    .array(
      z.object({
        platform: z.string().describe("Display label (e.g. 'Instagram', 'Are.na', 'Dribbble')"),
        url: z.string().url().describe("Profile URL"),
      }),
    )
    .default([])
    .describe(
      "Social profiles linked from the contact strip below the mailto line. Empty array hides the section.",
    ),
});

export type PortfolioSettings = z.infer<typeof portfolioSettingsSchema>;
