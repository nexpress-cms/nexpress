import type { NpNavItem } from "@nexpress/core";
import { getCachedNavigation } from "@nexpress/next";

import { PortfolioMobileNav } from "./components/mobile-nav.js";
import { resolvePortfolioSettings } from "./settings-helpers.js";

/**
 * Slim sticky top bar. Studio name on the inline-start, primary
 * nav on the inline-end. The inline list hides below ~720px and
 * the mobile drawer takes over.
 *
 * Phase F.9.1-A — `settings.studioName` controls the brand
 * label. Default ("Studio") falls through if operator hasn't
 * customized.
 */
export async function PortfolioHeader() {
  const items = await getCachedNavigation("header");
  const settings = await resolvePortfolioSettings();

  return (
    <header className="np-site-header np-portfolio-header">
      <a href="/" className="np-portfolio-logo">
        {settings.studioName}
      </a>
      {items.length > 0 ? (
        <>
          <nav aria-label="Main" className="np-portfolio-nav-desktop">
            <ul className="np-portfolio-nav">
              {items.map((item: NpNavItem, index: number) => (
                <li key={`portfolio-nav-${index.toString()}`} className="np-portfolio-nav-item">
                  <a href={item.url}>{item.label}</a>
                  {item.children && item.children.length > 0 ? (
                    <ul className="np-portfolio-subnav">
                      {item.children.map((child: NpNavItem, childIndex: number) => (
                        <li key={`portfolio-nav-${index.toString()}-${childIndex.toString()}`}>
                          <a href={child.url}>{child.label}</a>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </li>
              ))}
            </ul>
          </nav>
          <PortfolioMobileNav items={items} />
        </>
      ) : null}
    </header>
  );
}
