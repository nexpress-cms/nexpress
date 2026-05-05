import type { CSSProperties } from "react";

import type { NpBlockDefinition } from "@nexpress/blocks";
import { definePlugin } from "@nexpress/plugin-sdk";

const TONE_PALETTES = {
  info: { bg: "#eff6ff", border: "#3b82f6", icon: "ℹ️", title: "#1e40af" },
  success: { bg: "#ecfdf5", border: "#10b981", icon: "✓", title: "#065f46" },
  warn: { bg: "#fffbeb", border: "#f59e0b", icon: "⚠", title: "#92400e" },
  danger: { bg: "#fef2f2", border: "#ef4444", icon: "✕", title: "#991b1b" },
} as const;

type Tone = keyof typeof TONE_PALETTES;

function readString(value: unknown, fallback: string): string {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

function readTone(value: unknown): Tone {
  return value === "success" || value === "warn" || value === "danger" ? value : "info";
}

function readBool(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function readColor(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  return trimmed;
}

const calloutBlock: NpBlockDefinition = {
  type: "callout",
  label: "Callout",
  description: "Info / warn / danger notice card with a title and body.",
  icon: "💡",
  defaultProps: {
    tone: "info",
    title: "Heads up",
    body: "Use this block to flag something the reader shouldn't miss.",
    showIcon: true,
  },
  propsSchema: [
    {
      name: "tone",
      label: "Tone",
      type: "select",
      defaultValue: "info",
      options: [
        { label: "Info (blue)", value: "info" },
        { label: "Success (green)", value: "success" },
        { label: "Warn (amber)", value: "warn" },
        { label: "Danger (red)", value: "danger" },
      ],
    },
    { name: "title", label: "Title", type: "text", defaultValue: "Heads up" },
    {
      name: "body",
      label: "Body",
      type: "textarea",
      defaultValue: "Use this block to flag something the reader shouldn't miss.",
    },
    {
      name: "showIcon",
      label: "Show icon",
      type: "boolean",
      defaultValue: true,
    },
    {
      name: "accentColor",
      label: "Accent color (override)",
      type: "color",
      description: "Optional. Overrides the tone's default border + icon color.",
    },
  ],
  render: (props) => {
    const tone = readTone(props.tone);
    const palette = TONE_PALETTES[tone];
    const title = readString(props.title, "Heads up");
    const body = readString(props.body, "");
    const showIcon = readBool(props.showIcon, true);
    const accent = readColor(props.accentColor) ?? palette.border;

    const wrapperStyle: CSSProperties = {
      display: "flex",
      gap: "0.875rem",
      padding: "1.125rem 1.25rem",
      borderLeft: `4px solid ${accent}`,
      borderRadius: "0.5rem",
      backgroundColor: palette.bg,
      margin: "1.25rem 0",
    };

    const iconStyle: CSSProperties = {
      flexShrink: 0,
      width: "1.5rem",
      height: "1.5rem",
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      fontSize: "1rem",
      color: accent,
      fontWeight: 700,
    };

    return (
      <aside className={`np-block-callout np-block-callout--${tone}`} style={wrapperStyle}>
        {showIcon ? (
          <span aria-hidden="true" style={iconStyle}>
            {palette.icon}
          </span>
        ) : null}
        <div style={{ minWidth: 0 }}>
          {title.length > 0 ? (
            <p
              style={{
                margin: 0,
                fontWeight: 600,
                color: palette.title,
                lineHeight: 1.3,
              }}
            >
              {title}
            </p>
          ) : null}
          {body.length > 0 ? (
            <p
              style={{
                margin: title.length > 0 ? "0.25rem 0 0" : 0,
                color: "#1f2937",
                lineHeight: 1.55,
                whiteSpace: "pre-wrap",
              }}
            >
              {body}
            </p>
          ) : null}
        </div>
      </aside>
    );
  },
};

export const calloutPlugin = definePlugin({
  manifest: {
    id: "block-callout",
    version: "0.1.0",
    name: "Callout block",
    description: "Adds an info / warn / danger callout card to the page-builder block library.",
    author: { name: "NexPress" },
    license: "MIT",
    nexpress: { minVersion: "0.1.0" },
    // capabilities, allowedHosts, provides, agent, usesTokens, styleSlots
    // all default sensibly — `definePlugin` derives `provides.blocks` from
    // the `blocks: [...]` array below, so we don't repeat ourselves.
  },
  blocks: [calloutBlock],
});

export default calloutPlugin;
