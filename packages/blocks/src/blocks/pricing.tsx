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

const parseStringArray = (value: unknown): string[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
};

const parsePlans = (value: unknown): PricingPlan[] => {
  const fallback: PricingPlan[] = [
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

  const source = typeof value === "string" ? (() => {
    try {
      const parsed: unknown = JSON.parse(value);
      return parsed;
    } catch {
      return fallback;
    }
  })() : value;

  if (!Array.isArray(source)) {
    return fallback;
  }

  const plans = source
    .filter(isRecord)
    .map((item) => ({
      name: readString(item.name, "Plan"),
      price: readString(item.price, "$0"),
      period: readString(item.period, "/month"),
      features: parseStringArray(item.features),
      ctaText: readString(item.ctaText, "Get started"),
      ctaUrl: readString(item.ctaUrl, "/start"),
      highlighted: readBoolean(item.highlighted, false),
    }));

  return plans.length > 0 ? plans : fallback;
};

export const pricingBlock: NpBlockDefinition = {
  type: "pricing",
  label: "Pricing",
  description: "Structured pricing cards for subscription tiers or service packages.",
  icon: "💳",
  defaultProps: {
    heading: "Simple pricing for every stage",
    plans: JSON.stringify(
      [
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
      ],
      null,
      2,
    ),
  },
  propsSchema: [
    { name: "heading", label: "Heading", type: "text", defaultValue: "Simple pricing for every stage" },
    {
      name: "plans",
      label: "Plans",
      type: "textarea",
      defaultValue: JSON.stringify(
        [
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
        ],
        null,
        2,
      ),
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
      <section className="np-block-pricing" style={{ padding: "4rem 1.5rem", background: "#0f172a" }}>
        <div style={{ maxWidth: "72rem", margin: "0 auto", display: "grid", gap: "1.75rem" }}>
          <h2 style={{ margin: 0, color: "#f8fafc", fontSize: "clamp(2rem, 4vw, 3rem)" }}>{heading}</h2>
          <div style={gridStyle}>
            {plans.map((plan) => (
              <article
                key={plan.name}
                className="np-block-pricing__card"
                style={{
                  padding: "1.6rem",
                  borderRadius: "1.4rem",
                  background: plan.highlighted ? "linear-gradient(180deg, #fff7ed, #ffffff)" : "rgba(255, 255, 255, 0.08)",
                  color: plan.highlighted ? "#111827" : "#f8fafc",
                  border: plan.highlighted ? "1px solid rgba(249, 115, 22, 0.24)" : "1px solid rgba(255, 255, 255, 0.12)",
                }}
              >
                <h3 style={{ margin: 0 }}>{plan.name}</h3>
                <p style={{ margin: "0.85rem 0 1rem", fontSize: "2.4rem", fontWeight: 800 }}>
                  {plan.price}
                  <span style={{ fontSize: "1rem", fontWeight: 500, opacity: 0.7 }}>{plan.period}</span>
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
