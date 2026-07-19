import type { CSSProperties, ReactNode } from "react";

import { resolveCommunitySettings } from "./settings-helpers.js";

type CommunityStyle = CSSProperties & Record<`--${string}`, string>;

export async function CommunityShell({ children }: { children: ReactNode }) {
  const settings = await resolveCommunitySettings();
  const style: CommunityStyle = {};
  if (settings.accentColor) style["--np-color-primary"] = settings.accentColor;

  return (
    <div
      className="np-community-shell"
      data-np-community-density={settings.denseLists ? "compact" : "comfortable"}
      style={Object.keys(style).length > 0 ? style : undefined}
    >
      {children}
    </div>
  );
}
