import {
  getDb,
  getI18nConfig,
  getMemberFromTokenPayload,
  isTokenVerificationError,
  verifyMemberToken,
  type NpMemberAuthRow,
  type NpNavItem,
} from "@nexpress/core";
import { getCachedNavigation, getCachedSite, resolveAvailableLocales } from "@nexpress/next";
import Link from "next/link";

// `next/headers` lives in the Next-build-context-only world —
// outside a Next bundle (e.g. when `pnpm exec nexpress theme add`
// dynamically imports this module to probe its export shape)
// resolution fails with ERR_MODULE_NOT_FOUND. Lazy-importing
// inside the request-scoped function body keeps the top-level
// import graph free of Next-only specifiers, so CLI tooling can
// load this theme module without booting a Next bundle.

import { DarkModeToggle } from "./components/dark-mode-toggle.js";
import { LanguagePicker } from "./components/language-picker.js";
import { MemberStatusWidget } from "./components/member-status-widget.js";
import { MobileNav } from "./components/mobile-nav.js";
import { SearchKeyboardShortcut } from "./components/search-keyboard-shortcut.js";

/**
 * Default theme header — server component. Reads the
 * `header` navigation menu and renders the desktop / mobile
 * surfaces in one go:
 *
 *   - Desktop (≥1181px): logo mark + wordmark, centered nav,
 *     search pill with a ⌘K affordance, Subscribe CTA, plus
 *     the language picker / dark toggle / member widget when
 *     enabled.
 *   - Mobile (≤1180px): the nav + search collapse (CSS-only).
 *     A hamburger button opens a slide-in drawer (`<MobileNav />`,
 *     a small client component that owns its own open/closed
 *     state). The same nav items feed both surfaces — markup is
 *     server-rendered once and reused.
 *
 * The header is `position: sticky` with a blurred translucent
 * surface (see styles.ts) so the search + member widget stay
 * reachable as the page scrolls.
 */
const FALLBACK_SITE_NAME = "Equilibrium";

export async function DefaultHeader() {
  const [headerNav, site, member] = await Promise.all([
    getCachedNavigation("header"),
    getCachedSite(),
    resolveHeaderMember(),
  ]);
  const siteName = site?.name?.trim() || FALLBACK_SITE_NAME;
  const i18n = getI18nConfig();
  const showLanguagePicker = (i18n?.locales.length ?? 0) > 1;

  let availableLocales: string[] | null = null;
  if (showLanguagePicker) {
    const { headers } = await import("next/headers");
    const headerList = await headers();
    const pathname = headerList.get("x-np-pathname");
    if (pathname) {
      try {
        availableLocales = await resolveAvailableLocales(pathname);
      } catch {
        availableLocales = null;
      }
    }
  }

  return (
    <header className="np-site-header">
      <div className="np-site-header-inner">
        <Link href="/" className="np-site-logo">
          <span className="np-site-logo-mark" aria-hidden="true" />
          <span>{siteName}</span>
        </Link>
        <nav className="np-site-nav-desktop" aria-label="Primary">
          <ul className="np-site-nav">
            {headerNav.map((item: NpNavItem, index: number) => (
              <li key={`nav-${index.toString()}`} className="np-site-nav-item">
                {item.url ? <Link href={item.url}>{item.label}</Link> : <span>{item.label}</span>}
                {item.children && item.children.length > 0 ? (
                  <ul className="np-site-subnav">
                    {item.children.map((child: NpNavItem, childIndex: number) => (
                      <li key={`nav-${index.toString()}-${childIndex.toString()}`}>
                        {child.url ? (
                          <Link href={child.url}>{child.label}</Link>
                        ) : (
                          <span>{child.label}</span>
                        )}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </li>
            ))}
          </ul>
        </nav>
        <div className="np-site-header-tools">
          <form action="/search" method="GET" role="search" className="np-site-search">
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              aria-hidden="true"
            >
              <circle cx="11" cy="11" r="7" />
              <path d="m21 21-4.3-4.3" />
            </svg>
            <label className="sr-only" htmlFor="np-site-search-input">
              Search
            </label>
            <input
              id="np-site-search-input"
              type="search"
              name="q"
              placeholder="Search writing"
              autoComplete="off"
              className="np-site-search-input"
            />
            <kbd>⌘K</kbd>
          </form>
          <SearchKeyboardShortcut targetId="np-site-search-input" />
          <Link href="/subscribe" className="np-site-cta">
            Subscribe
          </Link>
          {showLanguagePicker && i18n ? (
            <LanguagePicker
              locales={i18n.locales}
              availableLocales={availableLocales ?? undefined}
            />
          ) : null}
          <DarkModeToggle />
          <MemberStatusWidget initialMember={member} />
          <MobileNav items={headerNav} />
        </div>
      </div>
    </header>
  );
}

type HeaderMember = Pick<NpMemberAuthRow, "id" | "handle" | "displayName">;

async function resolveHeaderMember(): Promise<HeaderMember | null> {
  const { cookies } = await import("next/headers");
  const cookieStore = await cookies();
  const token = cookieStore.get("np-mb-session")?.value;
  if (!token) return null;

  const secret = process.env.NP_SECRET ?? process.env.NP_AUTH_SECRET ?? process.env.AUTH_SECRET;
  if (!secret) return null;

  try {
    const payload = await verifyMemberToken(token, secret, "access");
    const member = await getMemberFromTokenPayload(getDb(), payload, token);
    if (!member || member.status !== "active") return null;
    return {
      id: member.id,
      handle: member.handle,
      displayName: member.displayName,
    };
  } catch (error) {
    if (isTokenVerificationError(error)) return null;
    throw error;
  }
}
