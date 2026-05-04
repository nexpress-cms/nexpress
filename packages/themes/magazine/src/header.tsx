import { t } from "@nexpress/core";
import type { NxNavItem } from "@nexpress/core";
import { getCachedNavigation } from "@nexpress/next";
import { headers } from "next/headers";

import { MagazineMobileNav } from "./components/mobile-nav.js";

/**
 * Editorial masthead. Display-serif logo over a thick rule with a
 * dateline above and tagline below; small-caps section nav sits
 * beneath the masthead. The inline section nav stays on desktop;
 * below ~768px it hides via CSS and the `<MagazineMobileNav />`
 * "Menu" button takes over.
 *
 * Phase 12.5 — the masthead tagline is keyed in the theme's
 * i18n bundle (`magazine.tagline`) and rendered via `t()`. The
 * locale comes from the middleware-set `x-nx-locale` header.
 */
export async function MagazineHeader() {
  const items = await getCachedNavigation("header");
  let locale: string | undefined;
  try {
    const headerList = await headers();
    locale = headerList.get("x-nx-locale") ?? undefined;
  } catch {
    // Outside a request scope; t()'s default-locale fallback handles it.
  }
  const tagline = await t("magazine.tagline", locale);
  const today = new Date().toLocaleDateString(undefined, {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  return (
    <header className="nx-site-header nx-magazine-header">
      <div className="nx-magazine-masthead">
        <p className="nx-magazine-dateline">{today}</p>
        <a href="/" className="nx-site-logo nx-magazine-logo">
          NexPress
        </a>
        <p className="nx-magazine-tagline">{tagline}</p>
      </div>
      {items.length > 0 ? (
        <>
          <nav aria-label="Sections" className="nx-magazine-sections">
            <ul>
              {items.map((item: NxNavItem, index: number) => (
                <li key={`magazine-nav-${index.toString()}`} className="nx-magazine-nav-item">
                  <a href={item.url}>{item.label}</a>
                  {item.children && item.children.length > 0 ? (
                    <ul className="nx-magazine-subnav">
                      {item.children.map((child: NxNavItem, childIndex: number) => (
                        <li key={`magazine-nav-${index.toString()}-${childIndex.toString()}`}>
                          <a href={child.url}>{child.label}</a>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </li>
              ))}
            </ul>
          </nav>
          <MagazineMobileNav items={items} />
        </>
      ) : null}
    </header>
  );
}
