import type { NpBlockDefinition } from "../types.js";

/**
 * Horizontal-rule atom block. No props — purely structural.
 * Operators insert via the slash menu (`/divider` / `/hr`) or
 * the toolbar's HR button.
 */
export const dividerBlock: NpBlockDefinition = {
  type: "divider",
  label: "Divider",
  description: "Horizontal rule that separates sections.",
  icon: "Minus",
  iconKind: "lucide",
  docBodyKind: "divider",
  category: "Content",
  source: "built-in",
  keywords: ["divider", "hr", "rule", "separator"],
  defaultProps: {},
  propsSchema: [],
  render: () => <hr className="np-divider" />,
};
