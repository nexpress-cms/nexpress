import type { CSSProperties, ReactNode } from "react";

import { CommunityFooter } from "./footer.js";
import { CommunityHeader } from "./header.js";
import { resolveCommunitySettings } from "./settings-helpers.js";

type CommunityStyle = CSSProperties & Record<`--${string}`, string>;

export async function CommunityMembersShell({ children }: { children: ReactNode }) {
  const settings = await resolveCommunitySettings();
  const style: CommunityStyle = {};
  if (settings.accentColor) style["--np-color-primary"] = settings.accentColor;

  return (
    <div
      className="np-community-shell"
      data-np-community-density={settings.denseLists ? "compact" : "comfortable"}
      style={Object.keys(style).length > 0 ? style : undefined}
    >
      <CommunityHeader />
      <div className="np-community-members">
        <div className="np-community-members-card">{children}</div>
      </div>
      <CommunityFooter />
    </div>
  );
}
