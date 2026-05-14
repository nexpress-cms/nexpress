import { resolvePortfolioSettings } from "./settings-helpers.js";

/**
 * Portfolio footer — single thin row.
 *
 *   - **Left**: studio copyright + a small clock pill ("Open ·
 *     Mon — Fri") with a pulse dot indicator. The pulse is
 *     decorative; sites that want a real on/off signal flip
 *     the copy via a future setting or a custom slot.
 *   - **Right**: secondary meta links — Index / Colophon /
 *     "Built on NexPress" credit. The credit is gated by
 *     `settings.showFooterCredit` for studios that prefer an
 *     unbranded footer.
 *
 * Optional `settings.aboutCopy` renders as a short bio
 * paragraph above the meta row when set. Sticks to a single
 * row at desktop widths; wraps on narrow viewports via the
 * CSS `flex-wrap` rule.
 */
export async function PortfolioFooter() {
  const settings = await resolvePortfolioSettings();
  const year = settings.copyrightYear ?? new Date().getFullYear();
  return (
    <footer className="np-portfolio-footer">
      {settings.aboutCopy.length > 0 ? (
        <div
          className="np-portfolio-container"
          style={{ marginBottom: "1.5rem" }}
        >
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
            <span
              className="np-portfolio-footer-clock-dot"
              aria-hidden="true"
            />
            Open · Mon — Fri
          </span>
        </div>
        <div className="np-portfolio-footer-right">
          <a href="/index">Index</a>
          <a href="/colophon">Colophon</a>
          {settings.showFooterCredit ? (
            <a href="https://nexpress.dev">Built on NexPress</a>
          ) : null}
        </div>
      </div>
    </footer>
  );
}
