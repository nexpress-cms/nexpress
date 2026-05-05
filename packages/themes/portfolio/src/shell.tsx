import type { ReactNode } from "react";

export function PortfolioShell({ children }: { children: ReactNode }) {
  return <div className="np-portfolio">{children}</div>;
}
