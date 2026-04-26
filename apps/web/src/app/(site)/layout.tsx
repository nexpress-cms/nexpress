import { NxThemeStyle } from "@nexpress/theme";
import { getTheme, getNavigation } from "@nexpress/core";
import type { NxNavItem } from "@nexpress/core";

import { MemberStatusWidget } from "@/components/member-status-widget";
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
          <form
            action="/search"
            method="GET"
            role="search"
            className="nx-site-search"
          >
            <label className="sr-only" htmlFor="nx-site-search-input">
              Search
            </label>
            <input
              id="nx-site-search-input"
              type="search"
              name="q"
              placeholder="Search…"
              autoComplete="off"
              className="nx-site-search-input"
            />
          </form>
          <MemberStatusWidget />
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
