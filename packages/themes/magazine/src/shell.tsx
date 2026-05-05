import type { ReactNode } from "react";

/**
 * Wraps the entire site in the magazine class so theme CSS
 * can scope everything under a single root attribute. The
 * shell adds zero DOM beyond a wrapper div — themes that
 * want to layer in providers / banners / skip-to-main do
 * it here.
 */
export function MagazineShell({ children }: { children: ReactNode }) {
  return <div className="np-magazine">{children}</div>;
}
