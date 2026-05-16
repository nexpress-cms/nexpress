import type { NpNavItem } from "@nexpress/core";
import { getCachedNavigation } from "@nexpress/next";

import { resolveMagazineSettings } from "./settings-helpers.js";

const SOCIAL_LABELS: Record<string, string> = {
  twitter: "Twitter",
  github: "GitHub",
  instagram: "Instagram",
  linkedin: "LinkedIn",
  rss: "RSS",
};

const FOOTER_MARK = "The Northbound Review";
const FOOTER_COLOPHON_DEFAULT =
  "A small, independent magazine — set in Newsreader and Hanken Grotesk, published online and (when the issue calls for it) in print.";
const FOOTER_CREDITS_DEFAULT = "Editor · Art · Web — Built on NexPress";

/**
 * Magazine colophon footer — three columns above a thin meta
 * row.
 *
 *   - Brand block: display-italic mark + italic colophon
 *     paragraph + small-caps editor / art / web credit, plus
 *     any social links from `settings.socialLinks`. Colophon
 *     paragraph and credit line are overridable from theme
 *     settings (`footerColophon` / `footerCredits`).
 *   - Sections: the `footer` navigation menu, fallback stub on
 *     fresh installs.
 *   - Colophon: the `footerColophon` location's nav.
 *
 * Subscribe form lives in the post-list template's subscribe
 * band — keeping it out of the footer matches the design.
 */
export async function MagazineFooter() {
  const sectionsNav = await getCachedNavigation("footer");
  const colophonNav = await getCachedNavigation("footerColophon");
  const settings = await resolveMagazineSettings();
  const year = new Date().getFullYear();
  const colophon = settings.footerColophon ?? FOOTER_COLOPHON_DEFAULT;
  const credits = settings.footerCredits ?? FOOTER_CREDITS_DEFAULT;

  return (
    <footer className="np-magazine-footer">
      <div className="np-magazine-footer-grid">
        <section>
          <p className="np-magazine-footer-mark">{FOOTER_MARK}</p>
          <p className="np-magazine-footer-colophon">{colophon}</p>
          <p className="np-magazine-footer-meta">{credits}</p>
          {settings.socialLinks.length > 0 ? (
            <ul className="np-magazine-footer-social">
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
