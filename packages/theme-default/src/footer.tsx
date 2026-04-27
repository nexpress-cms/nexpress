import type { NxNavItem } from "@nexpress/core";
import { getCachedNavigation } from "@nexpress/next";

/**
 * Default theme footer — server component. Reads the `footer`
 * navigation menu and renders it as a horizontal list. Themes
 * that want columns / social icons / newsletter signup override
 * `slots.footer` in their own `defineTheme()` call.
 */
export async function DefaultFooter() {
  const footerNav = await getCachedNavigation("footer");

  return (
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
  );
}
