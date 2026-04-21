import { NxThemeStyle } from "@nexpress/theme";
import { getTheme, getNavigation } from "@nexpress/core";
import type { NxNavItem } from "@nexpress/core";

import { ensureCoreServices } from "@/lib/init-core";

export const dynamic = "force-dynamic";

export default async function SiteLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  ensureCoreServices();
  const theme = await getTheme();
  const headerNav = await getNavigation("header");
  const footerNav = await getNavigation("footer");

  return (
    <>
      <NxThemeStyle theme={theme} />
      <header className="nx-site-header">
        <nav>
          <a href="/" className="nx-site-logo">
            NexPress
          </a>
          <ul className="nx-site-nav">
            {headerNav.map((item: NxNavItem) => (
              <li key={item.label}>
                <a href={item.url}>{item.label}</a>
              </li>
            ))}
          </ul>
        </nav>
      </header>
      <main className="nx-site-main">{children}</main>
      <footer className="nx-site-footer">
        <nav>
          <ul>
            {footerNav.map((item: NxNavItem) => (
              <li key={item.label}>
                <a href={item.url}>{item.label}</a>
              </li>
            ))}
          </ul>
        </nav>
      </footer>
    </>
  );
}
