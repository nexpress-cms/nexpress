import type { CSSProperties } from "react";

import type { NxBlockDefinition } from "./types.js";

interface BlockPaletteProps {
  blocks: NxBlockDefinition[];
  onAdd: (type: string) => void;
}

const cardStyle: CSSProperties = {
  display: "grid",
  gap: "0.45rem",
  textAlign: "left",
  padding: "1rem",
  borderRadius: "1rem",
  border: "1px solid rgba(15, 23, 42, 0.1)",
  background: "#ffffff",
  cursor: "pointer",
  boxShadow: "0 10px 24px rgba(15, 23, 42, 0.06)",
};

export const BlockPalette = ({ blocks, onAdd }: BlockPaletteProps) => (
  <div className="nx-block-palette" style={{ display: "grid", gap: "0.9rem", gridTemplateColumns: "repeat(auto-fit, minmax(14rem, 1fr))" }}>
    {blocks.map((block) => (
      <button key={block.type} type="button" onClick={() => onAdd(block.type)} style={cardStyle}>
        <span style={{ fontSize: "1.5rem" }}>{block.icon ?? "🧩"}</span>
        <span style={{ fontSize: "1rem", fontWeight: 700, color: "#0f172a" }}>{block.label}</span>
        <span style={{ fontSize: "0.92rem", lineHeight: 1.5, color: "#475569" }}>{block.description ?? "Add this block to the page."}</span>
      </button>
    ))}
  </div>
);
