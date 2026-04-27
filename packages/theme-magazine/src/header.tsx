import { getNavigation, t } from "@nexpress/core";
import type { NxNavItem } from "@nexpress/core";
import { headers } from "next/headers";

/**
 * Caps masthead. Reads the `header` navigation menu (same
 * source as theme-default) but renders it differently — items
 * are bottom-aligned beneath a thick rule with letter-spaced
 * caps. The site name is rendered in display-serif and pulls
 * from the framework's logical site name slot.
 *
 * Phase 12.5 — the masthead tagline is keyed in the theme's
 * i18n bundle (`magazine.tagline`) and rendered via `t()`.
 * The locale comes from the middleware-set `x-nx-locale`
 * request header.
 */
export async function MagazineHeader() {
  const items = await getNavigation("header");
  let locale: string | undefined;
  try {
    const headerList = await headers();
    locale = headerList.get("x-nx-locale") ?? undefined;
  } catch {
    // headers() throws outside a request scope; fall through
    // to the default-locale fallback in t().
  }

  // Phase D — t() is async (consults admin override layer).
  // Resolve before rendering since JSX can't await inline.
  const tagline = await t("magazine.tagline", locale);

  return (
    <header className="nx-site-header nx-magazine-header">
      <div className="nx-magazine-masthead">
        <a href="/" className="nx-site-logo nx-magazine-logo">
          NexPress
        </a>
        <p className="nx-magazine-tagline">{tagline}</p>
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
