import type { ReactNode } from "react";

export function PortfolioShell({ children }: { children: ReactNode }) {
  return <div className="nx-portfolio">{children}</div>;
}
