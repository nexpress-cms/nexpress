import * as React from "react";
import type { NpNavItem } from "@nexpress/core";
import { getCachedNavigation } from "@nexpress/next";

import { LocalTimeTicker } from "./components/local-time-ticker.js";
import { PortfolioMobileNav } from "./components/mobile-nav.js";
import { resolvePortfolioSettings } from "./settings-helpers.js";

/**
 * Portfolio sticky masthead.
 *
 *   - **Logo** — Instrument-Serif italic studio name. When the
 *     name contains a literal `&`, the ampersand is wrapped in
 *     a span so CSS tints it with the accent color (matches the
 *     design's "Owen & Spruce" treatment).
 *   - **Nav** — primary sections, centered. Flat `<ul>` directly
 *     under the header-inner grid track — no nested `<nav>` wrapper,
 *     no hover subnav. The design intent is editorial / studio-
 *     minimal; operators who need a multi-level menu pick a
 *     different theme (default / docs both ship subnav).
 *   - **Local-time pill** — small monospaced label showing the
 *     studio's current local time. Pulled from
 *     `settings.timezone` so multi-site portfolios can show
 *     their own location. Defaults to Asia/Seoul.
 *   - **Start a project** — primary CTA on the far right.
 *     Hidden when `settings.contactEmail` is unset (no
 *     destination to send the click to).
 *
 * Mobile collapses to the logo + a hamburger drawer via
 * `<PortfolioMobileNav />`. The drawer DOES surface nav-item
 * children — desktop deliberately omits them per the design.
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
          <ul className="np-portfolio-nav" aria-label="Main">
            {items.map((item: NpNavItem, index: number) => (
              <li key={`portfolio-nav-${index.toString()}`}>
                <a href={item.url}>{item.label}</a>
              </li>
            ))}
          </ul>
        ) : (
          <span aria-hidden="true" />
        )}
        <div className="np-portfolio-header-tools">
          <span className="np-portfolio-header-meta">
            <LocalTimeTicker zone={settings.timezone} initial={localTime} />
          </span>
          <a href="/search" className="np-portfolio-search-link">
            Search
          </a>
          {ctaHref ? (
            <a href={ctaHref} className="np-portfolio-cta">
              Start a project →
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
