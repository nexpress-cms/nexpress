import type { NpNavItem } from "@nexpress/core";
import { getCachedNavigation } from "@nexpress/next";
import Link from "next/link";

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
    <footer className="np-site-footer">
      <div className="np-site-footer-inner">
        <div className="np-site-footer-grid">
          <section className="np-site-footer-col np-site-footer-brand">
            <Link href="/" className="np-site-footer-logo">
              NexPress
            </Link>
            <p className="np-site-footer-tagline">
              The Next.js-native CMS for content-led teams.
            </p>
            <SocialLinks />
          </section>

          <section className="np-site-footer-col">
            <h2 className="np-site-footer-heading">Sitemap</h2>
            <ul className="np-site-footer-links">
              {footerNav.length > 0 ? (
                footerNav.map((item: NpNavItem, index: number) => (
                  <li key={`footer-sitemap-${index.toString()}`}>
                    {item.url ? <Link href={item.url}>{item.label}</Link> : <span>{item.label}</span>}
                    {item.children && item.children.length > 0 ? (
                      <ul className="np-site-footer-subnav">
                        {item.children.map((child: NpNavItem, childIndex: number) => (
                          <li
                            key={`footer-sitemap-${index.toString()}-${childIndex.toString()}`}
                          >
                            {child.url ? <Link href={child.url}>{child.label}</Link> : <span>{child.label}</span>}
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

          <section className="np-site-footer-col">
            <h2 className="np-site-footer-heading">Resources</h2>
            <ul className="np-site-footer-links">
              <li>
                <Link href="/blog">Blog</Link>
              </li>
              <li>
                <Link href="/search">Search</Link>
              </li>
              <li>
                <a href="/feed.xml">RSS feed</a>
              </li>
              <li>
                <a href="/sitemap.xml">Sitemap.xml</a>
              </li>
            </ul>
          </section>

          <section className="np-site-footer-col np-site-footer-subscribe">
            <h2 className="np-site-footer-heading">Subscribe</h2>
            <p className="np-site-footer-subscribe-blurb">
              Occasional updates. No spam.
            </p>
            <NewsletterForm />
          </section>
        </div>

        <div className="np-site-footer-bottom">
          <p className="np-site-footer-copy">
            © {year.toString()} · Built with NexPress
          </p>
          <ul className="np-site-footer-meta">
            <li>
              <Link href="/privacy">Privacy</Link>
            </li>
            <li>
              <Link href="/terms">Terms</Link>
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
        <Link href="/">Home</Link>
      </li>
      <li>
        <Link href="/about">About</Link>
      </li>
      <li>
        <Link href="/blog">Blog</Link>
      </li>
      <li>
        <Link href="/contact">Contact</Link>
      </li>
    </>
  );
}
