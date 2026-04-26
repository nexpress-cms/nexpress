import { getNavigation } from "@nexpress/core";
import type { NxNavItem } from "@nexpress/core";

/**
 * Slim top bar. Studio name on the left, menu items on the
 * right. Keeps chrome out of the way so the gallery grid below
 * carries the visual weight.
 */
export async function PortfolioHeader() {
  const items = await getNavigation("header");

  return (
    <header className="nx-site-header nx-portfolio-header">
      <a href="/" className="nx-portfolio-logo">
        NexPress
      </a>
      {items.length > 0 ? (
        <nav aria-label="Main">
          <ul className="nx-portfolio-nav">
            {items.map((item: NxNavItem, index: number) => (
              <li key={`portfolio-nav-${index}`}>
                <a href={item.url}>{item.label}</a>
              </li>
            ))}
          </ul>
        </nav>
      ) : null}
    </header>
  );
}
