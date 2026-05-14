import type { NpNavItem } from "@nexpress/core";
import { getCachedNavigation } from "@nexpress/next";
import Link from "next/link";

import { NewsletterForm } from "./newsletter-form.js";
import { SocialLinks } from "./social-links.js";

/**
 * Production-grade footer with four columns:
 *
 *   1. Brand — logo mark + wordmark, tagline, social row
 *   2. Sitemap — the site's `footer` navigation menu
 *   3. Resources — feeds, search, sitemap
 *   4. Newsletter — inline subscribe form
 *
 * All four are server-rendered except `NewsletterForm`, which
 * needs a client island for submit handling. Columns collapse to
 * two columns at ~800px and to one column at ~480px (CSS-driven,
 * no JS). The bottom row carries the copyright and a small set
 * of secondary links (RSS / Sitemap / Privacy / Colophon).
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
              <span className="np-site-logo-mark" aria-hidden="true" />
              <span>NexPress</span>
            </Link>
            <p className="np-site-footer-tagline">
              A team blog about the systems we ship — built on NexPress.
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
                <a href="/feed.xml">RSS feed</a>
              </li>
              <li>
                <a href="/feed.json">JSON feed</a>
              </li>
              <li>
                <Link href="/now">Now page</Link>
              </li>
              <li>
                <Link href="/colophon">Colophon</Link>
              </li>
            </ul>
          </section>

          <section className="np-site-footer-col np-site-footer-subscribe">
            <h2 className="np-site-footer-heading">Newsletter</h2>
            <p className="np-site-footer-subscribe-blurb">
              One post every other Tuesday. No threads, no roundups.
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
              <a href="/feed.xml">RSS</a>
            </li>
            <li>
              <a href="/sitemap.xml">Sitemap</a>
            </li>
            <li>
              <Link href="/privacy">Privacy</Link>
            </li>
            <li>
              <Link href="/colophon">Colophon</Link>
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
