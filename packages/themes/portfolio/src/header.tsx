import type { NpNavItem } from "@nexpress/core";
import { getCachedNavigation } from "@nexpress/next";

import { PortfolioMobileNav } from "./components/mobile-nav.js";

/**
 * Slim sticky top bar. Studio name on the inline-start, primary
 * nav on the inline-end. The inline list hides below ~720px and
 * the mobile drawer takes over.
 */
export async function PortfolioHeader() {
  const items = await getCachedNavigation("header");

  return (
    <header className="nx-site-header nx-portfolio-header">
      <a href="/" className="nx-portfolio-logo">
        NexPress Studio
      </a>
      {items.length > 0 ? (
        <>
          <nav aria-label="Main" className="nx-portfolio-nav-desktop">
            <ul className="nx-portfolio-nav">
              {items.map((item: NpNavItem, index: number) => (
                <li key={`portfolio-nav-${index.toString()}`} className="nx-portfolio-nav-item">
                  <a href={item.url}>{item.label}</a>
                  {item.children && item.children.length > 0 ? (
                    <ul className="nx-portfolio-subnav">
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
