import { t } from "@nexpress/core";
import type { NpNavItem } from "@nexpress/core";
import { getCachedNavigation } from "@nexpress/next";

import { MagazineMobileNav } from "./components/mobile-nav.js";
import { toRoman } from "./lib/roman.js";

// `next/headers` is a Next-build-context-only specifier — Next's
// bundler resolves it, but a plain `node` / `tsx` import from
// outside Next (e.g. `pnpm nexpress theme add` probing this
// theme module's export shape) blows up with
// `ERR_MODULE_NOT_FOUND` at module load. Lazy-importing inside
// the request-scoped function body keeps the top-level evaluation
// free of Next-only specifiers, so CLI tooling can load the
// theme module without booting a Next bundle.

const MASTHEAD_TITLE = "The Northbound Review";
const MASTHEAD_ORNAMENT = "Est. 2014 · Seoul · New York";

/**
 * Magazine masthead.
 *
 *   1. **Dateline strip** — full-width top band. Today's date +
 *      a volume / issue label on the left, secondary chrome
 *      links (Print archive / Today's edition / Sign in) on the
 *      right.
 *   2. **Masthead** — display-italic title flanked by ornamental
 *      rules with a small-caps middle ornament. Tagline below
 *      the title. The whole block sits over a double-rule
 *      bottom border.
 *   3. **Section nav** — primary sections under the masthead,
 *      separated from the title by a hairline rule. Mobile
 *      collapses to a `Menu` button via `<MagazineMobileNav />`.
 *
 * Phase 12.5 — the tagline is keyed in the theme's i18n bundle
 * (`magazine.tagline`) and rendered via `t()`. The locale comes
 * from the middleware-set `x-np-locale` header.
 *
 * The publication title + ornament are intentionally
 * design-baked rather than read from settings — operators that
 * want to rename the masthead override these via
 * `i18n.<locale>.magazine.title` / `magazine.ornament` after
 * activating the theme (last-writer-wins on the same key, so
 * site-level UI strings beat the theme-shipped defaults).
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
  const titleString = await t("magazine.title", locale);
  const title =
    typeof titleString === "string" && titleString !== "magazine.title"
      ? titleString
      : MASTHEAD_TITLE;
  const ornamentString = await t("magazine.ornament", locale);
  const ornament =
    typeof ornamentString === "string" && ornamentString !== "magazine.ornament"
      ? ornamentString
      : MASTHEAD_ORNAMENT;

  const today = new Date();
  const dateline = today.toLocaleDateString(undefined, {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  // Volume / issue derived from the year so the masthead stays
  // editorially accurate without an admin step. Sites that want
  // a fixed cadence override the issue label by editing the
  // header component or by feeding it through i18n. Week-of-year
  // is computed as ms-since-Jan-1 / 1-week, floored and
  // 1-indexed; close enough for an editorial label without
  // adopting ISO 8601's week-numbering edge cases.
  const year = today.getFullYear();
  const volume = year - 2014; // matches MASTHEAD_TITLE's "Est. 2014"
  const msSinceYearStart = today.getTime() - new Date(year, 0, 1).getTime();
  const weekOfYear =
    Math.floor(msSinceYearStart / (1000 * 60 * 60 * 24 * 7)) + 1;
  const issueLabel = `Volume ${toRoman(volume)} · Issue ${weekOfYear.toString()}`;

  return (
    <>
      <div className="np-magazine-dateline">
        <div className="np-magazine-dateline-inner">
          <div className="np-magazine-dateline-left">
            <span>{dateline}</span>
            <span className="np-magazine-dateline-issue">{issueLabel}</span>
          </div>
          <div className="np-magazine-dateline-right">
            <a href="/archive">Print archive</a>
            <a href="/today">Today's edition</a>
            <a href="/members/login">Sign in</a>
          </div>
        </div>
      </div>
      <header className="np-magazine-header">
        <div className="np-magazine-container">
          <div className="np-magazine-masthead-ornaments">
            <span className="np-magazine-masthead-rule" aria-hidden="true" />
            <span>{ornament}</span>
            <span className="np-magazine-masthead-rule" aria-hidden="true" />
          </div>
          <a className="np-magazine-logo" href="/">
            {title}
          </a>
          <p className="np-magazine-tagline">{tagline}</p>
          {items.length > 0 ? (
            <>
              <nav aria-label="Sections">
                <ul className="np-magazine-sections">
                  {items.map((item: NpNavItem, index: number) => (
                    <li
                      key={`magazine-nav-${index.toString()}`}
                      className="np-magazine-nav-item"
                    >
                      <a href={item.url}>{item.label}</a>
                      {item.children && item.children.length > 0 ? (
                        <ul className="np-magazine-subnav">
                          {item.children.map(
                            (child: NpNavItem, childIndex: number) => (
                              <li
                                key={`magazine-nav-${index.toString()}-${childIndex.toString()}`}
                              >
                                <a href={child.url}>{child.label}</a>
                              </li>
                            ),
                          )}
                        </ul>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </nav>
              <MagazineMobileNav items={items} />
            </>
          ) : null}
        </div>
      </header>
    </>
  );
}

