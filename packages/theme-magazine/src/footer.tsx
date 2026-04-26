import { getNavigation } from "@nexpress/core";
import type { NxNavItem } from "@nexpress/core";

/**
 * Quiet bottom rule with footer-menu links centered below a
 * masthead echo. No newsletter / social block — themes that
 * want those compose them in the consuming app's blocks rather
 * than baking them into the theme.
 */
export async function MagazineFooter() {
  const items = await getNavigation("footer");

  return (
    <footer className="nx-site-footer nx-magazine-footer">
      <p className="nx-magazine-footer-mark">NexPress</p>
      {items.length > 0 ? (
        <nav aria-label="Footer">
          <ul className="nx-magazine-footer-nav">
            {items.map((item: NxNavItem, index: number) => (
              <li key={`magazine-footer-${index}`}>
                <a href={item.url}>{item.label}</a>
              </li>
            ))}
          </ul>
        </nav>
      ) : null}
    </footer>
  );
}
