import type { NpNavItem } from "@nexpress/core";
import { getCachedNavigation } from "@nexpress/next";

import { NewsletterForm } from "./newsletter-form.js";
import { SocialLinks } from "./social-links.js";

/**
 * Production-grade footer with four columns:
 *
 *   1. Brand (logo + tagline + social)
 *   2. Sitemap (the site's `footer` navigation menu)
 *   3. Resources (links to /blog, /search, /sitemap.xml, /feed.xml)
 *   4. Subscribe (newsletter form)
 *
 * All four are server-rendered except `NewsletterForm`, which
 * needs a client island for submit handling. Columns collapse
 * to a single column below ~640px (CSS-driven, no JS).
 */
export async function DefaultFooter() {
  const footerNav = await getCachedNavigation("footer");
  const year = new Date().getFullYear();

  return (
    <footer className="nx-site-footer">
      <div className="nx-site-footer-inner">
        <div className="nx-site-footer-grid">
          <section className="nx-site-footer-col nx-site-footer-brand">
            <a href="/" className="nx-site-footer-logo">
              NexPress
            </a>
            <p className="nx-site-footer-tagline">
              The Next.js-native CMS for content-led teams.
            </p>
            <SocialLinks />
          </section>

          <section className="nx-site-footer-col">
            <h2 className="nx-site-footer-heading">Sitemap</h2>
            <ul className="nx-site-footer-links">
              {footerNav.length > 0 ? (
                footerNav.map((item: NpNavItem, index: number) => (
                  <li key={`footer-sitemap-${index.toString()}`}>
                    <a href={item.url}>{item.label}</a>
                    {item.children && item.children.length > 0 ? (
                      <ul className="nx-site-footer-subnav">
                        {item.children.map((child: NpNavItem, childIndex: number) => (
                          <li
                            key={`footer-sitemap-${index.toString()}-${childIndex.toString()}`}
                          >
                            <a href={child.url}>{child.label}</a>
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </li>
                ))
              ) : (
                <FooterNavFallback />
              )}
            </ul>
          </section>

          <section className="nx-site-footer-col">
            <h2 className="nx-site-footer-heading">Resources</h2>
            <ul className="nx-site-footer-links">
              <li>
                <a href="/blog">Blog</a>
              </li>
              <li>
                <a href="/search">Search</a>
              </li>
              <li>
                <a href="/feed.xml">RSS feed</a>
              </li>
              <li>
                <a href="/sitemap.xml">Sitemap.xml</a>
              </li>
            </ul>
          </section>

          <section className="nx-site-footer-col nx-site-footer-subscribe">
            <h2 className="nx-site-footer-heading">Subscribe</h2>
            <p className="nx-site-footer-subscribe-blurb">
              Occasional updates. No spam.
            </p>
            <NewsletterForm />
          </section>
        </div>

        <div className="nx-site-footer-bottom">
          <p className="nx-site-footer-copy">
            © {year.toString()} · Built with NexPress
          </p>
          <ul className="nx-site-footer-meta">
            <li>
              <a href="/privacy">Privacy</a>
            </li>
            <li>
              <a href="/terms">Terms</a>
            </li>
          </ul>
        </div>
      </div>
    </footer>
  );
}

function FooterNavFallback() {
  // Keeps the column from looking empty on a fresh install
  // before the operator wires up a footer menu in /admin.
  return (
    <>
      <li>
        <a href="/">Home</a>
      </li>
      <li>
        <a href="/about">About</a>
      </li>
      <li>
        <a href="/blog">Blog</a>
      </li>
      <li>
        <a href="/contact">Contact</a>
      </li>
    </>
  );
}
