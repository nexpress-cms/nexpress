import type { NpBlockInstance } from "@nexpress/blocks";

/**
 * Issue #467 phase 4 — section patterns.
 *
 * A "pattern" is a pre-shaped subtree of blocks the operator can
 * drop into a page in one click. Built-ins ship with the editor;
 * custom patterns get persisted in `localStorage` so an operator
 * can save a section they like and reuse it across pages without
 * exporting / importing JSON.
 *
 * The wire format is the same `NpBlockInstance` shape as the
 * page-builder reducer's state; the reducer's `INSERT_PATTERN`
 * action runs `cloneBlockDeep` over the pattern's `blocks` so
 * every insertion gets fresh ids.
 */
export interface NpPattern {
  id: string;
  label: string;
  description?: string;
  source: "built-in" | "custom";
  blocks: NpBlockInstance[];
}

const STORAGE_KEY = "np-page-builder.custom-patterns";

// Built-in patterns. Block ids are *templates* — the reducer's
// INSERT_PATTERN action regenerates ids before pushing into the
// tree, so the literal strings below never reach the live state.
const BUILT_IN_PATTERNS: NpPattern[] = [
  {
    id: "landing-hero",
    label: "Landing hero",
    description: "Hero block with headline + CTA, primed for a product landing page.",
    source: "built-in",
    blocks: [
      {
        id: "tpl-hero",
        type: "hero",
        props: {
          title: "Build pages block by block",
          subtitle:
            "Compose elegant landing pages with reusable, server-renderable content blocks.",
          ctaText: "Start building",
          ctaUrl: "/start",
          backgroundImage:
            "https://images.unsplash.com/photo-1493246507139-91e8fad9978e?auto=format&fit=crop&w=1600&q=80",
        },
      },
    ],
  },
  {
    id: "faq-section",
    label: "FAQ section",
    description: "Heading + three expandable questions you can edit in place.",
    source: "built-in",
    blocks: [
      {
        id: "tpl-faq",
        type: "faq",
        props: {
          heading: "Frequently asked questions",
          items: [
            {
              question: "How do I get started?",
              answer:
                "Sign up, create your first page, and start dropping blocks. The editor handles the rest.",
            },
            {
              question: "Can I switch plans later?",
              answer: "Yes — upgrades take effect immediately, downgrades at the next billing cycle.",
            },
            {
              question: "Is there a free trial?",
              answer:
                "Every paid plan includes a 14-day free trial. No credit card required to start.",
            },
          ],
        },
      },
    ],
  },
  {
    id: "pricing-section",
    label: "Pricing section",
    description: "Three-tier pricing strip with Starter / Growth / Scale defaults.",
    source: "built-in",
    blocks: [
      {
        id: "tpl-pricing",
        type: "pricing",
        props: {
          heading: "Simple pricing for every stage",
          plans: [
            {
              name: "Starter",
              price: "$19",
              period: "/month",
              features: "Unlimited blocks\nServer rendering\nEmail support",
              ctaText: "Choose Starter",
              ctaUrl: "/pricing/starter",
              highlighted: false,
            },
            {
              name: "Growth",
              price: "$79",
              period: "/month",
              features: "Advanced layouts\nTeam collaboration\nPriority onboarding",
              ctaText: "Choose Growth",
              ctaUrl: "/pricing/growth",
              highlighted: true,
            },
            {
              name: "Scale",
              price: "$199",
              period: "/month",
              features: "Custom integrations\nDedicated support\nSecurity review",
              ctaText: "Talk to sales",
              ctaUrl: "/contact",
              highlighted: false,
            },
          ],
        },
      },
    ],
  },
];

export function getBuiltInPatterns(): NpPattern[] {
  return BUILT_IN_PATTERNS;
}

export function getCustomPatterns(): NpPattern[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isPattern);
  } catch {
    return [];
  }
}

export function saveCustomPattern(pattern: NpPattern): NpPattern[] {
  if (typeof window === "undefined") return [];
  const existing = getCustomPatterns();
  // Replace by id when the operator overwrites a previously-saved
  // pattern; otherwise prepend so newest sits at the top of the
  // command-menu list.
  const filtered = existing.filter((p) => p.id !== pattern.id);
  const next = [pattern, ...filtered];
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Quota / private mode — don't crash the editor.
  }
  return next;
}

export function deleteCustomPattern(id: string): NpPattern[] {
  if (typeof window === "undefined") return [];
  const existing = getCustomPatterns();
  const next = existing.filter((p) => p.id !== id);
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Same as above — silent.
  }
  return next;
}

function isPattern(value: unknown): value is NpPattern {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.id !== "string") return false;
  if (typeof candidate.label !== "string") return false;
  if (!Array.isArray(candidate.blocks)) return false;
  return true;
}
