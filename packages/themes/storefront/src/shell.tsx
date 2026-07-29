import type { CSSProperties, ReactNode } from "react";

import { resolveStorefrontSettings } from "./settings-helpers.js";

type StorefrontStyle = CSSProperties & Record<`--${string}`, string>;

export async function StorefrontShell({ children }: { children: ReactNode }) {
  const settings = await resolveStorefrontSettings();
  const style: StorefrontStyle = {};
  if (settings.accentColor) style["--np-color-primary"] = settings.accentColor;
  return (
    <div
      className="np-storefront-shell"
      data-np-storefront-density={settings.productDensity}
      style={Object.keys(style).length > 0 ? style : undefined}
    >
      {children}
    </div>
  );
}
