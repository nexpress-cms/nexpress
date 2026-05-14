import type { NpNavItem } from "@nexpress/core";
import { getCachedNavigation } from "@nexpress/next";

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

const FOOTER_MARK = "The Northbound Review";

/**
 * Magazine colophon footer — three columns above a thin meta
 * row.
 *
 *   - Brand block: display-italic mark + italic colophon
 *     paragraph + small-caps editor / art / web credit, plus
 *     any social links from `settings.socialLinks`.
 *   - Sections (left of the two right columns): the site's
 *     `footer` (or `footerSections`) navigation menu. Falls
 *     back to a short stub when nothing is wired so the column
 *     never reads as empty on a fresh install.
 *   - Colophon: about / masthead / submissions / contact-style
 *     secondary links from the `footerColophon` location.
 *
 * Subscribe form lives in its own subscribe band rendered by
 * the post-list template — keeping it out of the footer matches
 * the design and lets pages that aren't post-list still include
 * the band when they want it.
 *
 * Bottom row: copyright + RSS / Newsletter / Privacy / Terms,
 * separated by a hairline rule.
 */
export async function MagazineFooter() {
  const sectionsNav = await getCachedNavigation("footer");
  const colophonNav = await getCachedNavigation("footerColophon");
  const settings = await resolveMagazineSettings();
  const year = new Date().getFullYear();

  return (
    <footer className="np-magazine-footer">
      <div className="np-magazine-footer-grid">
        <section>
          <p className="np-magazine-footer-mark">{FOOTER_MARK}</p>
          <p className="np-magazine-footer-colophon">
            A small, independent magazine — set in Newsreader and Hanken
            Grotesk, published online and (when the issue calls for it) in
            print.
          </p>
          <p className="np-magazine-footer-meta">
            Editor · Art · Web — Built on NexPress
          </p>
          {settings.socialLinks.length > 0 ? (
            <ul
              className="np-magazine-footer-social"
              style={{
                listStyle: "none",
                padding: 0,
                margin: "1.25rem 0 0",
                display: "flex",
                flexWrap: "wrap",
                gap: "0.85rem",
                fontFamily:
                  'var(--np-font-chrome, "Hanken Grotesk", sans-serif)',
                fontSize: "0.72rem",
                letterSpacing: "0.14em",
                textTransform: "uppercase",
              }}
            >
              {settings.socialLinks.map((link, i) => (
                <li key={`magazine-social-${i.toString()}`}>
                  <a
                    href={link.url}
                    target="_blank"
                    rel="noreferrer"
                    style={{ textDecoration: "none" }}
                  >
                    {SOCIAL_LABELS[link.platform] ?? link.platform}
                  </a>
                </li>
              ))}
            </ul>
          ) : null}
        </section>

        <section>
          <h2 className="np-magazine-footer-heading">Sections</h2>
          <ul className="np-magazine-footer-nav">
            {sectionsNav.length > 0 ? (
              sectionsNav.map((item: NpNavItem, index: number) => (
                <li key={`magazine-footer-sections-${index.toString()}`}>
                  <a href={item.url}>{item.label}</a>
                </li>
              ))
            ) : (
              <FooterSectionsFallback />
            )}
          </ul>
        </section>

        <section>
          <h2 className="np-magazine-footer-heading">Colophon</h2>
          <ul className="np-magazine-footer-nav">
            {colophonNav.length > 0 ? (
              colophonNav.map((item: NpNavItem, index: number) => (
                <li key={`magazine-footer-colophon-${index.toString()}`}>
                  <a href={item.url}>{item.label}</a>
                </li>
              ))
            ) : (
              <FooterColophonFallback />
            )}
          </ul>
        </section>
      </div>

      <div className="np-magazine-footer-bottom">
        <span>© {year.toString()} · All rights reserved</span>
        <div className="np-magazine-footer-bottom-right">
          <a href="/feed.xml">RSS</a>
          <a href="/newsletter">Newsletter</a>
          <a href="/privacy">Privacy</a>
          <a href="/terms">Terms</a>
        </div>
      </div>
    </footer>
  );
}

function FooterSectionsFallback() {
  return (
    <>
      <li>
        <a href="/features">Features</a>
      </li>
      <li>
        <a href="/dispatches">Dispatches</a>
      </li>
      <li>
        <a href="/profiles">Profiles</a>
      </li>
      <li>
        <a href="/essays">Essays</a>
      </li>
      <li>
        <a href="/photography">Photography</a>
      </li>
    </>
  );
}

function FooterColophonFallback() {
  return (
    <>
      <li>
        <a href="/about">About</a>
      </li>
      <li>
        <a href="/masthead">Masthead</a>
      </li>
      <li>
        <a href="/submissions">Submissions</a>
      </li>
      <li>
        <a href="/archive">Print archive</a>
      </li>
      <li>
        <a href="/contact">Contact</a>
      </li>
    </>
  );
}
