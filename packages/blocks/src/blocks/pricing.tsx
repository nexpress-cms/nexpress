import type { CSSProperties } from "react";

import type { NpBlockDefinition } from "../types.js";

interface PricingPlan {
  name: string;
  price: string;
  period: string;
  features: string[];
  ctaText: string;
  ctaUrl: string;
  highlighted: boolean;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const readString = (value: unknown, fallback: string): string =>
  typeof value === "string" && value.trim().length > 0 ? value : fallback;

const readBoolean = (value: unknown, fallback: boolean): boolean =>
  typeof value === "boolean" ? value : fallback;

// `features` is a one-per-line textarea on the editor side and a real
// `string[]` on the wire. Accept both to keep older pages renderable.
const parsePlanFeatures = (value: unknown): string[] => {
  if (Array.isArray(value)) {
    return value.filter(
      (item): item is string => typeof item === "string" && item.trim().length > 0,
    );
  }

  if (typeof value === "string") {
    return value
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
  }

  return [];
};

const DEFAULT_PLANS: PricingPlan[] = [
  {
    name: "Starter",
    price: "$19",
    period: "/month",
    features: ["Unlimited blocks", "Server rendering", "Email support"],
    ctaText: "Choose Starter",
    ctaUrl: "/pricing/starter",
    highlighted: false,
  },
  {
    name: "Growth",
    price: "$79",
    period: "/month",
    features: ["Advanced layouts", "Team collaboration", "Priority onboarding"],
    ctaText: "Choose Growth",
    ctaUrl: "/pricing/growth",
    highlighted: true,
  },
  {
    name: "Scale",
    price: "$199",
    period: "/month",
    features: ["Custom integrations", "Dedicated support", "Security review"],
    ctaText: "Talk to sales",
    ctaUrl: "/contact",
    highlighted: false,
  },
];

const parsePlans = (value: unknown): PricingPlan[] => {
  // Backward-compat: legacy pages stored a JSON string in this prop.
  const source =
    typeof value === "string"
      ? (() => {
          try {
            return JSON.parse(value) as unknown;
          } catch {
            return DEFAULT_PLANS;
          }
        })()
      : value;

  if (!Array.isArray(source)) {
    return DEFAULT_PLANS;
  }

  const plans = source.filter(isRecord).map((item) => ({
    name: readString(item.name, "Plan"),
    price: readString(item.price, "$0"),
    period: readString(item.period, "/month"),
    features: parsePlanFeatures(item.features),
    ctaText: readString(item.ctaText, "Get started"),
    ctaUrl: readString(item.ctaUrl, "/start"),
    highlighted: readBoolean(item.highlighted, false),
  }));

  return plans.length > 0 ? plans : DEFAULT_PLANS;
};

export const pricingBlock: NpBlockDefinition = {
  type: "pricing",
  label: "Pricing",
  description: "Structured pricing cards for subscription tiers or service packages.",
  icon: "CreditCard",
  iconKind: "lucide",
  summaryFields: ["heading"],
  category: "Commerce",
  source: "built-in",
  keywords: ["plans", "tiers", "subscription", "billing"],
  defaultProps: {
    heading: "Simple pricing for every stage",
    plans: DEFAULT_PLANS.map((plan) => ({ ...plan, features: plan.features.join("\n") })),
  },
  propsSchema: [
    {
      name: "heading",
      label: "Heading",
      type: "text",
      translatable: true,
      defaultValue: "Simple pricing for every stage",
    },
    {
      name: "plans",
      label: "Plans",
      type: "array",
      defaultValue: DEFAULT_PLANS.map((plan) => ({ ...plan, features: plan.features.join("\n") })),
      itemDefault: {
        name: "New plan",
        price: "$0",
        period: "/month",
        features: "Feature one\nFeature two\nFeature three",
        ctaText: "Get started",
        ctaUrl: "/start",
        highlighted: false,
      },
      itemSchema: [
        {
          name: "name",
          label: "Plan name",
          type: "text",
          translatable: true,
          defaultValue: "New plan",
        },
        {
          name: "price",
          label: "Price",
          type: "text",
          translatable: false,
          defaultValue: "$0",
        },
        {
          name: "period",
          label: "Period",
          type: "text",
          translatable: true,
          defaultValue: "/month",
        },
        {
          name: "features",
          label: "Features",
          type: "textarea",
          translatable: true,
          defaultValue: "Feature one\nFeature two\nFeature three",
          description: "One feature per line.",
        },
        {
          name: "ctaText",
          label: "CTA text",
          type: "text",
          translatable: true,
          defaultValue: "Get started",
        },
        { name: "ctaUrl", label: "CTA URL", type: "url", defaultValue: "/start" },
        { name: "highlighted", label: "Highlight this plan", type: "boolean", defaultValue: false },
      ],
    },
  ],
  render: (props) => {
    const heading = readString(props.heading, "Simple pricing for every stage");
    const plans = parsePlans(props.plans);
    const gridStyle: CSSProperties = {
      display: "grid",
      gap: "1.25rem",
      gridTemplateColumns: `repeat(${plans.length}, minmax(0, 1fr))`,
    };

    return (
      <section
        className="np-block-pricing"
        style={{ padding: "4rem 1.5rem", background: "#0f172a" }}
      >
        <div style={{ maxWidth: "72rem", margin: "0 auto", display: "grid", gap: "1.75rem" }}>
          <h2 style={{ margin: 0, color: "#f8fafc", fontSize: "clamp(2rem, 4vw, 3rem)" }}>
            {heading}
          </h2>
          <div style={gridStyle}>
            {plans.map((plan) => (
              <article
                key={plan.name}
                className="np-block-pricing__card"
                style={{
                  padding: "1.6rem",
                  borderRadius: "1.4rem",
                  background: plan.highlighted
                    ? "linear-gradient(180deg, #fff7ed, #ffffff)"
                    : "rgba(255, 255, 255, 0.08)",
                  color: plan.highlighted ? "#111827" : "#f8fafc",
                  border: plan.highlighted
                    ? "1px solid rgba(249, 115, 22, 0.24)"
                    : "1px solid rgba(255, 255, 255, 0.12)",
                }}
              >
                <h3 style={{ margin: 0 }}>{plan.name}</h3>
                <p style={{ margin: "0.85rem 0 1rem", fontSize: "2.4rem", fontWeight: 800 }}>
                  {plan.price}
                  <span style={{ fontSize: "1rem", fontWeight: 500, opacity: 0.7 }}>
                    {plan.period}
                  </span>
                </p>
                <ul style={{ margin: "0 0 1.4rem", paddingLeft: "1.1rem", lineHeight: 1.8 }}>
                  {plan.features.map((feature) => (
                    <li key={feature}>{feature}</li>
                  ))}
                </ul>
                <a
                  className="np-block-pricing__cta"
                  href={plan.ctaUrl}
                  style={{
                    display: "inline-flex",
                    justifyContent: "center",
                    alignItems: "center",
                    width: "100%",
                    padding: "0.85rem 1rem",
                    borderRadius: "999px",
                    textDecoration: "none",
                    fontWeight: 700,
                    color: plan.highlighted ? "#ffffff" : "#0f172a",
                    background: plan.highlighted ? "#f97316" : "#ffffff",
                  }}
                >
                  {plan.ctaText}
                </a>
              </article>
            ))}
          </div>
        </div>
      </section>
    );
  },
};
