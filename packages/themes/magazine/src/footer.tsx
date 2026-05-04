import type { NxNavItem } from "@nexpress/core";
import { getCachedNavigation } from "@nexpress/next";

import { MagazineNewsletterForm } from "./components/newsletter-form.js";

/**
 * Editorial footer. Three columns above a thin colophon line:
 *
 *   - Subscribe (newsletter form + blurb)
 *   - Sections (the `footer` navigation menu)
 *   - About (masthead echo + colophon links)
 *
 * Collapses to a single column on phones. Designed to feel like
 * the back-page colophon of a print magazine.
 */
export async function MagazineFooter() {
  const items = await getCachedNavigation("footer");
  const year = new Date().getFullYear();

  return (
    <footer className="nx-site-footer nx-magazine-footer">
      <div className="nx-magazine-footer-grid">
        <section className="nx-magazine-footer-col">
          <h2 className="nx-magazine-footer-heading">Subscribe</h2>
          <p className="nx-magazine-footer-blurb">
            Get the next issue in your inbox. Read at your own pace.
          </p>
          <MagazineNewsletterForm />
        </section>

        <section className="nx-magazine-footer-col">
          <h2 className="nx-magazine-footer-heading">Sections</h2>
          {items.length > 0 ? (
            <ul className="nx-magazine-footer-nav">
              {items.map((item: NxNavItem, index: number) => (
                <li key={`magazine-footer-${index.toString()}`}>
                  <a href={item.url}>{item.label}</a>
                  {item.children && item.children.length > 0 ? (
                    <ul className="nx-magazine-footer-subnav">
                      {item.children.map((child: NxNavItem, childIndex: number) => (
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
            <ul className="nx-magazine-footer-nav">
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

        <section className="nx-magazine-footer-col">
          <h2 className="nx-magazine-footer-heading">Colophon</h2>
          <p className="nx-magazine-footer-mark">NexPress</p>
          <p className="nx-magazine-footer-meta">
            Stories, essays, and reports.
            <br />© {year.toString()} · Built with NexPress
          </p>
        </section>
      </div>
    </footer>
  );
}
