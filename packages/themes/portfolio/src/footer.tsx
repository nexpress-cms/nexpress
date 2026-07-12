import type { NpResolvedNavItem } from "@nexpress/core/navigation";
import { getCachedNavigation } from "@nexpress/next";

import { resolvePortfolioSettings } from "./settings-helpers.js";

/**
 * Portfolio footer — single thin row.
 *
 *   - **Left**: studio copyright + a small clock pill with a
 *     pulse dot indicator. The pulse is decorative; the pill
 *     text is driven by `settings.footerHoursLine`.
 *   - **Right**: secondary meta links. Pulls from the
 *     `footer-secondary` nav location when the operator has wired
 *     one; falls back to Index / Colophon / "Built on NexPress"
 *     so a fresh install matches the design out of the box. The
 *     "Built on NexPress" credit is still gated by
 *     `settings.showFooterCredit` for studios that prefer an
 *     unbranded footer.
 *
 * Optional `settings.aboutCopy` renders as a short bio
 * paragraph above the meta row when set.
 */
export async function PortfolioFooter() {
  const settings = await resolvePortfolioSettings();
  const secondary = await getCachedNavigation("footer-secondary");
  const year = settings.copyrightYear ?? new Date().getFullYear();
  const links: NpResolvedNavItem[] = secondary.length > 0 ? secondary : [];

  return (
    <footer className="np-portfolio-footer">
      {settings.aboutCopy.length > 0 ? (
        <div className="np-portfolio-container" style={{ marginBottom: "1.5rem" }}>
          <p
            style={{
              maxWidth: "60ch",
              fontSize: "0.875rem",
              color: "var(--np-color-muted-foreground)",
              margin: 0,
            }}
          >
            {settings.aboutCopy}
          </p>
        </div>
      ) : null}
      <div className="np-portfolio-footer-inner">
        <div className="np-portfolio-footer-left">
          <span>
            © {year.toString()} {settings.studioName}
          </span>
          <span className="np-portfolio-footer-clock">
            <span className="np-portfolio-footer-clock-dot" aria-hidden="true" />
            {settings.footerHoursLine}
          </span>
        </div>
        <div className="np-portfolio-footer-right">
          {links.length > 0 ? (
            links.map((item, index) => (
              <a key={`portfolio-footer-link-${index.toString()}`} href={item.url}>
                {item.label}
              </a>
            ))
          ) : (
            <>
              <a href="/index">Index</a>
              <a href="/colophon">Colophon</a>
            </>
          )}
          {settings.showFooterCredit ? <a href="https://nexpress.dev">Built on NexPress</a> : null}
        </div>
      </div>
    </footer>
  );
}
