import type { NpNavItem } from "@nexpress/core";
import { getCachedNavigation } from "@nexpress/next";

import { MagazineNewsletterForm } from "./components/newsletter-form.js";
import { resolveMagazineSettings } from "./settings-helpers.js";

/** Display labels for the supported social platform enum values
 *  in `magazineSettingsSchema.socialLinks[].platform`. Falls back
 *  to the raw value (lowercased) if a future platform isn't
 *  listed here. */
const SOCIAL_LABELS: Record<string, string> = {
  twitter: "Twitter",
  github: "GitHub",
  instagram: "Instagram",
  linkedin: "LinkedIn",
  rss: "RSS",
};

/**
 * Editorial footer. Three columns above a thin colophon line:
 *
 *   - Subscribe (newsletter form + blurb) — toggles via
 *     `settings.newsletterEnabled`
 *   - Sections (the `footer` navigation menu)
 *   - About (masthead echo + colophon + social links from
 *     `settings.socialLinks`)
 *
 * Collapses to a single column on phones. Designed to feel like
 * the back-page colophon of a print magazine.
 */
export async function MagazineFooter() {
  const items = await getCachedNavigation("footer");
  const settings = await resolveMagazineSettings();
  const year = new Date().getFullYear();

  return (
    <footer className="np-site-footer np-magazine-footer">
      <div className="np-magazine-footer-grid">
        {settings.newsletterEnabled ? (
          <section className="np-magazine-footer-col">
            <h2 className="np-magazine-footer-heading">Subscribe</h2>
            <p className="np-magazine-footer-blurb">
              Get the next issue in your inbox. Read at your own pace.
            </p>
            <MagazineNewsletterForm />
          </section>
        ) : null}

        <section className="np-magazine-footer-col">
          <h2 className="np-magazine-footer-heading">Sections</h2>
          {items.length > 0 ? (
            <ul className="np-magazine-footer-nav">
              {items.map((item: NpNavItem, index: number) => (
                <li key={`magazine-footer-${index.toString()}`}>
                  <a href={item.url}>{item.label}</a>
                  {item.children && item.children.length > 0 ? (
                    <ul className="np-magazine-footer-subnav">
                      {item.children.map((child: NpNavItem, childIndex: number) => (
                        <li key={`magazine-footer-${index.toString()}-${childIndex.toString()}`}>
                          <a href={child.url}>{child.label}</a>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            <ul className="np-magazine-footer-nav">
              <li>
                <a href="/blog">Stories</a>
              </li>
              <li>
                <a href="/about">About</a>
              </li>
              <li>
                <a href="/feed.xml">RSS</a>
              </li>
            </ul>
          )}
        </section>

        <section className="np-magazine-footer-col">
          <h2 className="np-magazine-footer-heading">Colophon</h2>
          <p className="np-magazine-footer-mark">NexPress</p>
          <p className="np-magazine-footer-meta">
            Stories, essays, and reports.
            <br />© {year.toString()} · Built with NexPress
          </p>
          {settings.socialLinks.length > 0 ? (
            <ul
              className="np-magazine-footer-social"
              style={{
                listStyle: "none",
                padding: 0,
                margin: "1rem 0 0",
                display: "flex",
                flexWrap: "wrap",
                gap: "0.75rem",
                fontSize: "0.875rem",
              }}
            >
              {settings.socialLinks.map((link, i) => (
                <li key={`magazine-social-${i.toString()}`}>
                  <a href={link.url} target="_blank" rel="noreferrer">
                    {SOCIAL_LABELS[link.platform] ?? link.platform}
                  </a>
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      </div>
    </footer>
  );
}
