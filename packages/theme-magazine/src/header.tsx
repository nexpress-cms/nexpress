import { getNavigation } from "@nexpress/core";
import type { NxNavItem } from "@nexpress/core";

/**
 * Caps masthead. Reads the `header` navigation menu (same
 * source as theme-default) but renders it differently — items
 * are bottom-aligned beneath a thick rule with letter-spaced
 * caps. The site name is rendered in display-serif and pulls
 * from the framework's logical site name slot.
 */
export async function MagazineHeader() {
  const items = await getNavigation("header");

  return (
    <header className="nx-site-header nx-magazine-header">
      <div className="nx-magazine-masthead">
        <a href="/" className="nx-site-logo nx-magazine-logo">
          NexPress
        </a>
        <p className="nx-magazine-tagline">
          Stories, essays, and reports
        </p>
      </div>
      {items.length > 0 ? (
        <nav aria-label="Sections" className="nx-magazine-sections">
          <ul>
            {items.map((item: NxNavItem, index: number) => (
              <li key={`magazine-nav-${index}`}>
                <a href={item.url}>{item.label}</a>
              </li>
            ))}
          </ul>
        </nav>
      ) : null}
    </header>
  );
}
