import { t } from "@nexpress/core";
import type { NpNavItem } from "@nexpress/core";
import { getCachedNavigation } from "@nexpress/next";

import { MagazineMobileNav } from "./components/mobile-nav.js";

// `next/headers` is a Next-build-context-only specifier — Next's
// bundler resolves it, but a plain `node` / `tsx` import from
// outside Next (e.g. `pnpm nexpress theme:install` walking this
// theme module to read its `requires` field) blows up with
// `ERR_MODULE_NOT_FOUND` at module load. Lazy-importing inside
// the request-scoped function body keeps the top-level evaluation
// free of Next-only specifiers, so CLI tooling can load the
// theme module without booting a Next bundle.

/**
 * Editorial masthead. Display-serif logo over a thick rule with a
 * dateline above and tagline below; small-caps section nav sits
 * beneath the masthead. The inline section nav stays on desktop;
 * below ~768px it hides via CSS and the `<MagazineMobileNav />`
 * "Menu" button takes over.
 *
 * Phase 12.5 — the masthead tagline is keyed in the theme's
 * i18n bundle (`magazine.tagline`) and rendered via `t()`. The
 * locale comes from the middleware-set `x-np-locale` header.
 */
export async function MagazineHeader() {
  const items = await getCachedNavigation("header");
  let locale: string | undefined;
  try {
    const { headers } = await import("next/headers");
    const headerList = await headers();
    locale = headerList.get("x-np-locale") ?? undefined;
  } catch {
    // Outside a request scope (or outside Next entirely — e.g.
    // CLI tooling that loaded this module). t()'s default-locale
    // fallback handles it.
  }
  const tagline = await t("magazine.tagline", locale);
  const today = new Date().toLocaleDateString(undefined, {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  return (
    <header className="np-site-header np-magazine-header">
      <div className="np-magazine-masthead">
        <p className="np-magazine-dateline">{today}</p>
        <a href="/" className="np-site-logo np-magazine-logo">
          NexPress
        </a>
        <p className="np-magazine-tagline">{tagline}</p>
      </div>
      {items.length > 0 ? (
        <>
          <nav aria-label="Sections" className="np-magazine-sections">
            <ul>
              {items.map((item: NpNavItem, index: number) => (
                <li key={`magazine-nav-${index.toString()}`} className="np-magazine-nav-item">
                  <a href={item.url}>{item.label}</a>
                  {item.children && item.children.length > 0 ? (
                    <ul className="np-magazine-subnav">
                      {item.children.map((child: NpNavItem, childIndex: number) => (
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
