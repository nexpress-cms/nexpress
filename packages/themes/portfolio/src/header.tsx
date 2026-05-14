import * as React from "react";
import type { NpNavItem } from "@nexpress/core";
import { getCachedNavigation } from "@nexpress/next";

import { PortfolioMobileNav } from "./components/mobile-nav.js";
import { resolvePortfolioSettings } from "./settings-helpers.js";

/**
 * Portfolio sticky masthead.
 *
 *   - **Logo** — Instrument-Serif italic studio name. When the
 *     name contains a literal `&`, the ampersand is wrapped in
 *     a span so CSS tints it with the accent color (matches the
 *     design's "Owen & Spruce" treatment).
 *   - **Nav** — primary sections, centered.
 *   - **Local-time pill** — small monospaced label showing the
 *     studio's current local time. Pulled from
 *     `settings.timezone` so multi-site portfolios can show
 *     their own location. Defaults to Asia/Seoul.
 *   - **Start a project** — primary CTA on the far right.
 *     Hidden when `settings.contactEmail` is unset (no
 *     destination to send the click to).
 *
 * Mobile collapses to the logo + a hamburger drawer via
 * `<PortfolioMobileNav />`.
 */
export async function PortfolioHeader() {
  const items = await getCachedNavigation("header");
  const settings = await resolvePortfolioSettings();
  const localTime = formatLocalTime(settings.timezone);
  const ctaHref = settings.contactEmail ? `mailto:${settings.contactEmail}` : null;

  return (
    <header className="np-portfolio-header">
      <div className="np-portfolio-header-inner">
        <a href="/" className="np-portfolio-logo">
          {renderLogoText(settings.studioName)}
        </a>
        {items.length > 0 ? (
          <nav aria-label="Main" className="np-portfolio-nav-desktop">
            <ul className="np-portfolio-nav">
              {items.map((item: NpNavItem, index: number) => (
                <li
                  key={`portfolio-nav-${index.toString()}`}
                  className="np-portfolio-nav-item"
                >
                  <a href={item.url}>{item.label}</a>
                  {item.children && item.children.length > 0 ? (
                    <ul className="np-portfolio-subnav">
                      {item.children.map(
                        (child: NpNavItem, childIndex: number) => (
                          <li
                            key={`portfolio-nav-${index.toString()}-${childIndex.toString()}`}
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
        ) : (
          <span aria-hidden="true" />
        )}
        <div className="np-portfolio-header-tools">
          <span className="np-portfolio-header-meta">{localTime}</span>
          {ctaHref ? (
            <a href={ctaHref} className="np-portfolio-cta">
              Start a project
            </a>
          ) : null}
          {items.length > 0 ? <PortfolioMobileNav items={items} /> : null}
        </div>
      </div>
    </header>
  );
}

/**
 * Wrap a literal `&` in a span so CSS can accent it. Studio
 * names without one render as a single text node.
 */
function renderLogoText(name: string): React.ReactNode {
  const ampIndex = name.indexOf("&");
  if (ampIndex < 0) return name;
  const before = name.slice(0, ampIndex);
  const after = name.slice(ampIndex + 1);
  return (
    <>
      {before}
      <span className="np-portfolio-logo-amp">&amp;</span>
      {after}
    </>
  );
}

/**
 * Studio-local time label. Format: `"<City> · HH:MM"` — city
 * derived from the IANA zone's tail (`Asia/Seoul` → `Seoul`).
 * Updates at SSR time only; sites that want a live-ticking
 * clock add a small client island on top.
 */
function formatLocalTime(zone: string): string {
  try {
    const formatter = new Intl.DateTimeFormat("en-GB", {
      timeZone: zone,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
    const time = formatter.format(new Date());
    const tail = zone.split("/").pop() ?? zone;
    const city = tail.replace(/_/g, " ");
    return `${city} · ${time}`;
  } catch {
    // Bad IANA zone — render city only so the masthead still
    // reads cleanly. Operator sees the typo in admin's auto-
    // form and corrects it.
    return zone;
  }
}
