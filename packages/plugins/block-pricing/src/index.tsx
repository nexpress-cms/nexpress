import type { CSSProperties } from "react";

import type { NpBlockDefinition } from "@nexpress/blocks";
import { definePlugin } from "@nexpress/plugin-sdk";

function readString(value: unknown, fallback: string): string {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

function readBool(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

interface Tier {
  name: string;
  price: string;
  cadence: string;
  ctaText: string;
  ctaUrl: string;
  highlight: boolean;
  features: string;
}

function readTier(raw: unknown): Tier | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const name = readString(r.name, "");
  if (name.length === 0) return null;
  return {
    name,
    price: readString(r.price, ""),
    cadence: readString(r.cadence, "/mo"),
    ctaText: readString(r.ctaText, "Choose plan"),
    ctaUrl: readString(r.ctaUrl, "#"),
    highlight: readBool(r.highlight, false),
    features: readString(r.features, ""),
  };
}

const pricingBlock: NpBlockDefinition = {
  type: "pricing.table",
  label: "Pricing table",
  description: "Side-by-side pricing tiers. Add / remove tiers via the array field.",
  icon: "💰",
  defaultProps: {
    heading: "Pricing",
    subheading: "Pick the plan that fits.",
    tiers: [
      {
        name: "Starter",
        price: "$0",
        cadence: "forever",
        ctaText: "Get started",
        ctaUrl: "/signup",
        highlight: false,
        features: "Up to 1 user\nCommunity support\n100 MB storage",
      },
      {
        name: "Pro",
        price: "$19",
        cadence: "/mo",
        ctaText: "Start trial",
        ctaUrl: "/trial",
        highlight: true,
        features: "Up to 10 users\nEmail support\n10 GB storage\nCustom domain",
      },
    ],
  },
  propsSchema: [
    { name: "heading", label: "Heading", type: "text", defaultValue: "Pricing" },
    {
      name: "subheading",
      label: "Subheading",
      type: "text",
      defaultValue: "Pick the plan that fits.",
    },
    {
      name: "tiers",
      label: "Tiers",
      type: "array",
      description: "Each entry becomes a card in the pricing strip.",
      itemDefault: {
        name: "New tier",
        price: "$0",
        cadence: "/mo",
        ctaText: "Choose plan",
        ctaUrl: "#",
        highlight: false,
        features: "Feature one\nFeature two",
      },
      itemSchema: [
        { name: "name", label: "Tier name", type: "text", required: true, defaultValue: "" },
        { name: "price", label: "Price", type: "text", required: true, defaultValue: "$0" },
        { name: "cadence", label: "Cadence", type: "text", defaultValue: "/mo" },
        { name: "ctaText", label: "CTA text", type: "text", defaultValue: "Choose plan" },
        { name: "ctaUrl", label: "CTA URL", type: "url", defaultValue: "#" },
        {
          name: "highlight",
          label: "Highlight this tier",
          type: "boolean",
          defaultValue: false,
        },
        {
          name: "features",
          label: "Features",
          type: "textarea",
          description: "One per line.",
          defaultValue: "",
        },
      ],
    },
  ],
  render: (props) => {
    const heading = readString(props.heading, "Pricing");
    const subheading = readString(props.subheading, "");
    const tiers = (Array.isArray(props.tiers) ? props.tiers : [])
      .map(readTier)
      .filter((t): t is Tier => t !== null);

    const wrapperStyle: CSSProperties = {
      margin: "2rem 0",
      textAlign: "center" as const,
    };

    const stripStyle: CSSProperties = {
      display: "grid",
      gap: "1rem",
      gridTemplateColumns: `repeat(${Math.max(1, tiers.length)}, minmax(14rem, 1fr))`,
      marginTop: "1.25rem",
      textAlign: "left" as const,
    };

    return (
      <section className="np-block-pricing" style={wrapperStyle}>
        {heading.length > 0 ? (
          <h2 style={{ margin: 0, fontSize: "1.875rem", fontWeight: 700, color: "#0f172a" }}>
            {heading}
          </h2>
        ) : null}
        {subheading.length > 0 ? (
          <p style={{ margin: "0.375rem 0 0", color: "#475569" }}>{subheading}</p>
        ) : null}
        {tiers.length === 0 ? (
          <p style={{ marginTop: "1.5rem", color: "#94a3b8", fontStyle: "italic" }}>
            Add a tier in the block editor to see it here.
          </p>
        ) : (
          <div style={stripStyle}>
            {tiers.map((tier) => {
              const cardStyle: CSSProperties = {
                padding: "1.5rem",
                borderRadius: "0.875rem",
                border: tier.highlight ? "2px solid #0f172a" : "1px solid #e2e8f0",
                backgroundColor: tier.highlight ? "#0f172a" : "#ffffff",
                color: tier.highlight ? "#f8fafc" : "#0f172a",
                boxShadow: tier.highlight ? "0 12px 32px rgba(15, 23, 42, 0.18)" : "none",
              };
              return (
                <article key={tier.name} style={cardStyle}>
                  <h3 style={{ margin: "0 0 0.5rem", fontSize: "1.125rem", fontWeight: 600 }}>
                    {tier.name}
                  </h3>
                  <p style={{ margin: "0 0 0.75rem", fontSize: "1.875rem", fontWeight: 700 }}>
                    {tier.price}
                    <span
                      style={{
                        marginLeft: "0.25rem",
                        fontSize: "0.875rem",
                        fontWeight: 500,
                        opacity: 0.7,
                      }}
                    >
                      {tier.cadence}
                    </span>
                  </p>
                  <ul
                    style={{
                      listStyle: "none",
                      padding: 0,
                      margin: "0 0 1.25rem",
                      fontSize: "0.875rem",
                      lineHeight: 1.6,
                      opacity: tier.highlight ? 0.92 : 1,
                    }}
                  >
                    {tier.features
                      .split("\n")
                      .map((line) => line.trim())
                      .filter((line) => line.length > 0)
                      .map((line, idx) => (
                        <li key={idx} style={{ padding: "0.125rem 0" }}>
                          {line}
                        </li>
                      ))}
                  </ul>
                  <a
                    href={tier.ctaUrl}
                    style={{
                      display: "inline-block",
                      padding: "0.625rem 1.25rem",
                      borderRadius: "0.5rem",
                      textDecoration: "none",
                      fontWeight: 600,
                      backgroundColor: tier.highlight ? "#f8fafc" : "#0f172a",
                      color: tier.highlight ? "#0f172a" : "#f8fafc",
                    }}
                  >
                    {tier.ctaText}
                  </a>
                </article>
              );
            })}
          </div>
        )}
      </section>
    );
  },
};

export const pricingPlugin = definePlugin({
  manifest: {
    id: "block-pricing",
    version: "0.1.0",
    name: "Pricing table block",
    description: "Pricing tiers strip with array-typed nested entries.",
    author: { name: "NexPress" },
    license: "MIT",
    nexpress: { minVersion: "0.1.0" },
  },
  blocks: [pricingBlock] satisfies NpBlockDefinition[],
});

export default pricingPlugin;
