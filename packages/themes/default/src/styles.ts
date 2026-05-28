/**
 * Layout-level CSS for `@nexpress/theme-default`. Production polish
 * lives here: sticky header with mobile drawer, four-column footer
 * with social + newsletter, post detail / list, page templates
 * (default / wide / landing / sidebar), pagination, and a typography
 * ramp that holds together across page widths.
 *
 * Design tokens come from `--np-color-*` / `--np-radius-*` /
 * `--np-font-*` (set in apps/web/src/app/globals.css and switched
 * by `[data-theme="dark"]` further down). Themes that want a
 * different palette override the same custom properties — this
 * file is structural.
 *
 * The framework injects this string as a `<style data-np-theme="default">`
 * tag at SSR time so the rules race the document with no extra
 * stylesheet round-trip.
 */
export const defaultThemeCss = `
/* ----------------------------------------------------------------
 * Typography ramp
 * --------------------------------------------------------------- */
.np-page,
.np-post,
.np-post-list {
  --np-content-max: 1180px;
  --np-content-max-wide: 1300px;
}
.np-page h1,
.np-post-title,
.np-post-list-header h1 {
  font-size: clamp(2rem, 4vw, 2.75rem);
  line-height: 1.15;
  letter-spacing: -0.02em;
  font-weight: 800;
  margin: 0 0 1rem;
}
.np-page h2,
.np-post-body h2 {
  font-size: clamp(1.4rem, 2.4vw, 1.75rem);
  letter-spacing: -0.015em;
  margin: 2.5rem 0 1rem;
}
.np-page h3,
.np-post-body h3 {
  font-size: 1.25rem;
  margin: 2rem 0 0.75rem;
}
.np-page p,
.np-post-body p {
  font-size: 1.0625rem;
  line-height: 1.7;
  margin: 0 0 1rem;
}
.np-post-body a {
  color: var(--np-color-primary, #4f46e5);
  text-decoration: underline;
  text-underline-offset: 0.2em;
}
.np-post-body code {
  background: var(--np-color-muted, #f1f5f9);
  padding: 0.1em 0.35em;
  border-radius: 4px;
  font-size: 0.95em;
}
.np-post-body pre {
  background: var(--np-color-muted, #f1f5f9);
  padding: 1rem;
  border-radius: var(--np-radius-md, 0.5rem);
  overflow-x: auto;
  font-size: 0.875rem;
  line-height: 1.6;
}
.np-post-body blockquote {
  border-inline-start: 3px solid var(--np-color-primary, #4f46e5);
  margin: 1.5rem 0;
  padding: 0.25rem 0 0.25rem 1rem;
  color: var(--np-color-muted-foreground, #64748b);
  font-style: italic;
}
.np-post-body img {
  max-width: 100%;
  height: auto;
  border-radius: var(--np-radius-md, 0.5rem);
}

/* ----------------------------------------------------------------
 * Designed about + tag archive pages.
 * --------------------------------------------------------------- */
.np-default-about,
.np-default-tag {
  --np-default-page-max: 1180px;
  max-width: var(--np-default-page-max);
  margin: 0 auto;
  padding: 4rem 1.75rem 5rem;
}
.np-default-about-hero,
.np-default-tag-hero {
  max-width: 820px;
  padding: 3rem 0;
}
.np-default-about-eyebrow,
.np-default-tag-mark,
.np-default-tag-crumbs {
  font-family: var(--np-font-mono, ui-monospace, monospace);
  font-size: 0.78rem;
  color: var(--np-color-primary, #4f46e5);
}
.np-default-about-hero h1,
.np-default-tag-hero h1 {
  font-size: clamp(2.6rem, 6vw, 5rem);
  line-height: 0.98;
  letter-spacing: -0.045em;
  margin: 1rem 0;
  max-width: 12ch;
}
.np-default-tag-hero h1 span {
  color: var(--np-color-muted-foreground, #6b6b74);
  font-weight: 500;
  font-size: 0.45em;
  letter-spacing: -0.02em;
}
.np-default-about-lede,
.np-default-tag-hero p {
  color: var(--np-color-muted-foreground, #6b6b74);
  font-size: 1.125rem;
  line-height: 1.65;
  max-width: 42rem;
}
.np-default-about-stats {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  border-block: 1px solid var(--np-color-border, #ececef);
}
.np-default-about-stat {
  padding: 1.4rem 1.2rem;
  border-inline-end: 1px solid var(--np-color-border, #ececef);
}
.np-default-about-stat:last-child { border-inline-end: 0; }
.np-default-about-stat span,
.np-default-about-stat small {
  display: block;
  color: var(--np-color-muted-foreground, #6b6b74);
  font-size: 0.8rem;
}
.np-default-about-stat strong {
  display: block;
  font-size: clamp(2rem, 4vw, 3.4rem);
  letter-spacing: -0.05em;
  line-height: 1;
  margin: 0.45rem 0;
}
.np-default-about-split {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 320px;
  gap: 4rem;
  padding: 4rem 0;
}
.np-default-about-prose p {
  font-size: 1.125rem;
  line-height: 1.75;
  color: var(--np-color-foreground, #0a0a0c);
}
.np-default-about-card,
.np-default-about-now-card {
  border: 1px solid var(--np-color-border, #ececef);
  border-radius: 18px;
  background: var(--np-color-card, #fff);
}
.np-default-about-card { padding: 1.4rem; align-self: start; }
.np-default-about-card h2 { margin: 0 0 1rem; font-size: 1rem; }
.np-default-about-card dl { margin: 0; display: grid; gap: 0.8rem; }
.np-default-about-card div {
  display: flex;
  justify-content: space-between;
  gap: 1rem;
  border-top: 1px solid var(--np-color-border, #ececef);
  padding-top: 0.8rem;
}
.np-default-about-card dt {
  color: var(--np-color-muted-foreground, #6b6b74);
  font-size: 0.8rem;
}
.np-default-about-card dd { margin: 0; font-size: 0.9rem; text-align: end; }
.np-default-about-now { padding-top: 1rem; }
.np-default-about-now-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 1rem;
}
.np-default-about-now-card { padding: 1.2rem; }
.np-default-about-now-card span {
  color: var(--np-color-primary, #4f46e5);
  font-family: var(--np-font-mono, ui-monospace, monospace);
  font-size: 0.72rem;
}
.np-default-about-now-card h3 { margin: 0.45rem 0 1rem; font-size: 1rem; }
.np-default-about-progress {
  height: 6px;
  border-radius: 999px;
  background: var(--np-color-muted, #f5f5f7);
  overflow: hidden;
}
.np-default-about-progress i {
  display: block;
  block-size: 100%;
  border-radius: inherit;
  background: var(--np-color-primary, #4f46e5);
}
.np-default-tag-crumbs {
  display: flex;
  gap: 0.55rem;
  margin-bottom: 1rem;
}
.np-default-tag-crumbs a { text-decoration: none; color: inherit; }
.np-default-tag-metrics {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 1px;
  margin: 0 0 2.5rem;
  border: 1px solid var(--np-color-border, #ececef);
  background: var(--np-color-border, #ececef);
  border-radius: 18px;
  overflow: hidden;
}
.np-default-tag-metrics div {
  background: var(--np-color-card, #fff);
  padding: 1.15rem;
}
.np-default-tag-metrics span {
  color: var(--np-color-primary, #4f46e5);
  font-family: var(--np-font-mono, ui-monospace, monospace);
  font-size: 0.72rem;
}
.np-default-tag-metrics strong {
  display: block;
  margin: 0.45rem 0;
  font-size: 0.95rem;
}
.np-default-tag-metrics p {
  margin: 0;
  color: var(--np-color-muted-foreground, #6b6b74);
  font-size: 0.9rem;
  line-height: 1.55;
}
.np-default-tag-feature a {
  display: grid;
  grid-template-columns: minmax(280px, 0.9fr) minmax(0, 1fr);
  gap: 2rem;
  align-items: stretch;
  color: inherit;
  text-decoration: none;
  border: 1px solid var(--np-color-border, #ececef);
  border-radius: 22px;
  overflow: hidden;
  background: var(--np-color-card, #fff);
}
.np-default-tag-feature-cover {
  min-height: 320px;
  background: linear-gradient(135deg, #1e1b4b, #4f46e5 55%, #818cf8);
}
.np-default-tag-feature div:last-child { padding: 2rem; }
.np-default-tag-feature span {
  color: var(--np-color-primary, #4f46e5);
  font-family: var(--np-font-mono, ui-monospace, monospace);
  font-size: 0.72rem;
  text-transform: uppercase;
  letter-spacing: 0.08em;
}
.np-default-tag-feature h2 {
  font-size: clamp(1.8rem, 4vw, 3rem);
  line-height: 1.05;
  letter-spacing: -0.035em;
  margin: 0.7rem 0;
}
.np-default-tag-feature p {
  color: var(--np-color-muted-foreground, #6b6b74);
  line-height: 1.65;
}
.np-default-tag-list-wrap { padding-top: 3rem; }
.np-default-tag-list {
  list-style: none;
  margin: 0;
  padding: 0;
  border-top: 1px solid var(--np-color-border, #ececef);
}
.np-default-tag-list li {
  display: grid;
  grid-template-columns: 8rem minmax(0, 1fr) 3rem;
  gap: 1.5rem;
  padding: 1.35rem 0;
  border-bottom: 1px solid var(--np-color-border, #ececef);
}
.np-default-tag-list time,
.np-default-tag-list > li > span {
  font-family: var(--np-font-mono, ui-monospace, monospace);
  color: var(--np-color-muted-foreground, #6b6b74);
  font-size: 0.78rem;
}
.np-default-tag-list h3 { margin: 0 0 0.35rem; }
.np-default-tag-list h3 a { color: inherit; text-decoration: none; }
.np-default-tag-list p {
  margin: 0;
  color: var(--np-color-muted-foreground, #6b6b74);
}
.np-default-tag-empty {
  color: var(--np-color-muted-foreground, #6b6b74);
}
.np-default-tag-cloud {
  padding-top: 3rem;
}
.np-default-tag-cloud ul {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 0.75rem;
}
.np-default-tag-cloud a {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  border: 1px solid var(--np-color-border, #ececef);
  border-radius: 999px;
  padding: 0.72rem 0.9rem;
  color: inherit;
  text-decoration: none;
  background: var(--np-color-card, #fff);
}
.np-default-tag-cloud a[data-active="true"] {
  color: var(--np-color-primary, #4f46e5);
  border-color: color-mix(in oklab, var(--np-color-primary, #4f46e5) 42%, var(--np-color-border, #ececef));
  background: color-mix(in oklab, var(--np-color-primary, #4f46e5) 7%, var(--np-color-card, #fff));
}
.np-default-tag-cloud span {
  font-weight: 650;
}
.np-default-tag-cloud strong {
  font-family: var(--np-font-mono, ui-monospace, monospace);
  font-size: 0.72rem;
  color: var(--np-color-muted-foreground, #6b6b74);
}
@media (max-width: 800px) {
  .np-default-about-stats,
  .np-default-about-now-grid,
  .np-default-about-split,
  .np-default-tag-metrics,
  .np-default-tag-feature a,
  .np-default-tag-list li {
    grid-template-columns: 1fr;
  }
  .np-default-about-stat {
    border-inline-end: 0;
    border-block-end: 1px solid var(--np-color-border, #ececef);
  }
  .np-default-tag-cloud ul {
    grid-template-columns: 1fr;
  }
}

/* ----------------------------------------------------------------
 * Header — sticky bar, hairline border, blurred translucent surface.
 * Grid keeps logo on the left, nav centered, tools (search +
 * Subscribe CTA) on the right at desktop widths. Mobile drawer
 * machinery lives further down — collapses the nav into a hamburger.
 * --------------------------------------------------------------- */
.np-site-header {
  position: sticky;
  top: 0;
  z-index: 30;
  background: color-mix(in oklab, var(--np-color-background, #fff) 78%, transparent);
  backdrop-filter: saturate(140%) blur(14px);
  -webkit-backdrop-filter: saturate(140%) blur(14px);
  border-bottom: 1px solid var(--np-color-border, #ececef);
}
.np-site-header-inner {
  max-width: var(--np-content-max, 1180px);
  margin: 0 auto;
  padding: 0.85rem 1.75rem;
  display: grid;
  grid-template-columns: auto 1fr auto;
  align-items: center;
  gap: 2rem;
  min-width: 0;
}
.np-site-logo {
  display: inline-flex;
  align-items: center;
  gap: 0.55rem;
  font-weight: 700;
  letter-spacing: -0.02em;
  font-size: 1.0625rem;
  text-decoration: none;
  color: inherit;
  white-space: nowrap;
}
.np-site-logo-mark {
  width: 1.65rem;
  height: 1.65rem;
  border-radius: 7px;
  background: linear-gradient(135deg, var(--np-color-primary, #4f46e5) 0%, color-mix(in oklab, var(--np-color-primary, #4f46e5) 60%, #7c3aed) 100%);
  position: relative;
  flex: none;
}
.np-site-logo-mark::after {
  content: "";
  position: absolute;
  inset: 6px;
  border-radius: 3px;
  background: var(--np-color-background, #fff);
  opacity: 0.95;
  clip-path: polygon(0 0, 100% 0, 100% 100%, 60% 100%, 0 35%);
}
.np-site-nav-desktop {
  justify-self: center;
  min-width: 0;
}
.np-site-nav {
  display: flex;
  align-items: center;
  gap: 1.5rem;
  list-style: none;
  padding: 0;
  margin: 0;
}
.np-site-nav a {
  color: var(--np-color-muted-foreground, #6b6b74);
  text-decoration: none;
  font-size: 0.9375rem;
  font-weight: 500;
  transition: color 0.15s ease;
}
.np-site-nav a:hover,
.np-site-nav a[aria-current="page"] {
  color: var(--np-color-foreground, #0a0a0c);
}
/* Sub-menu — desktop hover dropdown. Hidden until parent <li> is
 * hovered or focus enters the subtree. Shallow drop, neutral
 * surface so it inherits theme tokens automatically. */
.np-site-nav-item {
  position: relative;
}
.np-site-subnav {
  position: absolute;
  top: 100%;
  left: 0;
  display: none;
  min-width: 11rem;
  padding: 0.5rem 0;
  margin: 0;
  list-style: none;
  background: var(--np-color-card, #fff);
  border: 1px solid var(--np-color-border, #e5e7eb);
  border-radius: var(--np-radius-md, 0.5rem);
  box-shadow: 0 4px 16px -8px rgba(0, 0, 0, 0.08);
  z-index: 10;
}
.np-site-nav-item:hover > .np-site-subnav,
.np-site-nav-item:focus-within > .np-site-subnav {
  display: block;
}
.np-site-subnav li {
  padding: 0;
}
.np-site-subnav a {
  display: block;
  padding: 0.4rem 1rem;
  font-size: 0.875rem;
}
.np-site-header-tools {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  min-width: 0;
}
.np-site-search {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.4rem 0.7rem 0.4rem 0.55rem;
  font-size: 0.85rem;
  color: var(--np-color-muted-foreground, #6b6b74);
  background: var(--np-color-muted, #f5f5f7);
  border: 1px solid var(--np-color-border, #ececef);
  border-radius: var(--np-radius-md, 10px);
  min-width: 16rem;
  cursor: text;
  text-decoration: none;
}
.np-site-search svg {
  flex: none;
  opacity: 0.7;
}
.np-site-search kbd {
  margin-left: auto;
  font-family: var(--np-font-mono, ui-monospace, monospace);
  font-size: 0.7rem;
  padding: 0.05rem 0.35rem;
  border-radius: 4px;
  background: var(--np-color-background, #fff);
  border: 1px solid var(--np-color-border, #ececef);
  color: var(--np-color-muted-foreground, #6b6b74);
}
.np-site-search-input {
  flex: 1;
  padding: 0;
  font: inherit;
  font-size: 0.85rem;
  color: inherit;
  background: transparent;
  border: 0;
  outline: 0;
  min-width: 0;
}
.np-site-search-input::placeholder { color: color-mix(in oklab, currentColor 75%, transparent); }
.np-site-cta {
  display: inline-flex;
  align-items: center;
  padding: 0.45rem 0.95rem;
  font-size: 0.875rem;
  font-weight: 600;
  color: var(--np-color-primary-foreground, #fff);
  background: var(--np-color-foreground, #0a0a0c);
  border-radius: var(--np-radius-md, 10px);
  text-decoration: none;
  white-space: nowrap;
  transition: opacity 0.15s ease;
}
.np-site-cta:hover { opacity: 0.9; }
/* Mobile drawer machinery */
.np-mobile-nav-toggle {
  display: none;
  align-items: center;
  justify-content: center;
  width: 2.25rem;
  height: 2.25rem;
  padding: 0;
  border: 1px solid var(--np-color-border, #e5e7eb);
  border-radius: var(--np-radius-md, 0.5rem);
  background: transparent;
  color: inherit;
  cursor: pointer;
}
.np-mobile-nav-toggle:hover {
  background: var(--np-color-muted, #f8fafc);
}
.np-mobile-nav-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.4);
  z-index: 40;
}
.np-mobile-nav-drawer {
  position: fixed;
  top: 0;
  inset-inline-end: 0;
  width: min(20rem, 85vw);
  height: 100dvh;
  background: var(--np-color-background, #fff);
  border-inline-start: 1px solid var(--np-color-border, #e5e7eb);
  z-index: 50;
  transform: translateX(100%);
  display: none;
  flex-direction: column;
}
.np-mobile-nav-drawer[data-open="true"] {
  display: flex;
  transform: translateX(0);
  animation: np-mobile-nav-drawer-in 0.2s ease both;
}
@keyframes np-mobile-nav-drawer-in {
  from { transform: translateX(100%); }
  to { transform: translateX(0); }
}
.np-mobile-nav-drawer-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 1rem 1.25rem;
  border-bottom: 1px solid var(--np-color-border, #e5e7eb);
}
.np-mobile-nav-drawer-label {
  font-weight: 700;
  letter-spacing: 0.02em;
  text-transform: uppercase;
  font-size: 0.75rem;
  color: var(--np-color-muted-foreground, #64748b);
}
.np-mobile-nav-close {
  background: transparent;
  border: none;
  color: inherit;
  cursor: pointer;
  padding: 0.25rem;
  border-radius: var(--np-radius-md, 0.5rem);
}
.np-mobile-nav-close:hover {
  background: var(--np-color-muted, #f8fafc);
}
.np-mobile-nav-list {
  list-style: none;
  margin: 0;
  padding: 0.75rem 0;
  overflow-y: auto;
  flex: 1;
}
.np-mobile-subnav,
.np-site-footer-subnav {
  list-style: none;
  margin: 0;
  padding-left: 1.25rem;
}
.np-mobile-subnav a {
  font-size: 0.9375rem;
}
.np-site-footer-subnav a {
  font-size: 0.85rem;
  opacity: 0.85;
}
.np-mobile-nav-list a {
  display: block;
  padding: 0.85rem 1.25rem;
  text-decoration: none;
  color: inherit;
  font-size: 1rem;
  border-bottom: 1px solid color-mix(in oklch, var(--np-color-border, #e5e7eb) 50%, transparent);
}
.np-mobile-nav-list a:hover {
  background: var(--np-color-muted, #f8fafc);
}

@media (max-width: 1180px) {
  .np-site-header-inner {
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 0.75rem;
    padding-inline: 1rem;
  }
  .np-site-logo {
    min-width: 0;
  }
  .np-site-logo span:last-child {
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .np-site-nav-desktop { display: none; }
  .np-site-header-tools {
    justify-self: end;
    flex: none;
    min-width: 0;
    gap: 0.4rem;
  }
  .np-site-search { display: none; }
  .np-site-search-input { display: none; }
  .np-site-cta,
  .np-language-picker,
  .np-color-scheme-toggle,
  .np-member-status {
    display: none;
  }
  .np-mobile-nav-toggle { display: inline-flex; }
}
@media (min-width: 1181px) {
  .np-mobile-nav-drawer,
  .np-mobile-nav-overlay {
    display: none;
  }
}

/* ----------------------------------------------------------------
 * Footer — 4-column grid: brand+colophon+social / sitemap /
 * resources / newsletter. Slightly muted surface (np-color-muted)
 * so the page break reads even on white backgrounds. Bottom row
 * carries copyright + secondary links.
 * --------------------------------------------------------------- */
.np-site-footer {
  margin-top: 4rem;
  background: var(--np-color-muted, #f5f5f7);
  border-top: 1px solid var(--np-color-border, #ececef);
}
.np-site-footer-inner {
  max-width: var(--np-content-max, 1180px);
  margin: 0 auto;
  padding: 4rem 1.75rem 1.5rem;
}
.np-site-footer-grid {
  display: grid;
  grid-template-columns: 1.5fr 1fr 1fr 1.2fr;
  gap: 3rem;
  align-items: start;
}
@media (max-width: 800px) {
  .np-site-footer-grid {
    grid-template-columns: 1fr 1fr;
    gap: 2rem;
  }
  .np-site-footer-brand,
  .np-site-footer-subscribe {
    grid-column: span 2;
  }
}
@media (max-width: 480px) {
  .np-site-footer-grid {
    grid-template-columns: 1fr;
  }
  .np-site-footer-brand,
  .np-site-footer-subscribe {
    grid-column: span 1;
  }
}
.np-site-footer-col { min-width: 0; }
.np-site-footer-logo {
  display: inline-flex;
  align-items: center;
  gap: 0.55rem;
  font-weight: 700;
  font-size: 1.1rem;
  text-decoration: none;
  color: inherit;
  letter-spacing: -0.02em;
}
.np-site-footer-tagline {
  margin: 0.65rem 0 1.25rem;
  color: var(--np-color-muted-foreground, #6b6b74);
  font-size: 0.9rem;
  line-height: 1.55;
  max-width: 22rem;
}
.np-site-footer-heading {
  font-family: var(--np-font-mono, ui-monospace, monospace);
  font-size: 0.7rem;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--np-color-muted-foreground, #6b6b74);
  margin: 0 0 1rem;
  font-weight: 500;
}
.np-site-footer-links {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
  font-size: 0.9rem;
}
.np-site-footer-links a {
  color: var(--np-color-muted-foreground, #6b6b74);
  text-decoration: none;
  transition: color 0.15s ease;
}
.np-site-footer-links a:hover {
  color: var(--np-color-foreground, #0a0a0c);
}
.np-site-footer-social {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  gap: 0.45rem;
}
.np-site-footer-social a {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 2.25rem;
  height: 2.25rem;
  border: 1px solid var(--np-color-border, #ececef);
  border-radius: var(--np-radius-md, 10px);
  color: var(--np-color-muted-foreground, #6b6b74);
  text-decoration: none;
  background: var(--np-color-background, #fff);
  transition: color 0.15s ease, border-color 0.15s ease;
}
.np-site-footer-social a:hover {
  color: var(--np-color-foreground, #0a0a0c);
  border-color: var(--np-color-foreground, #0a0a0c);
}
.np-site-footer-subscribe-blurb {
  margin: 0 0 0.75rem;
  font-size: 0.85rem;
  color: var(--np-color-muted-foreground, #6b6b74);
  line-height: 1.5;
}
.np-site-footer-subscribe-form {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}
.np-site-footer-subscribe-form input[type="email"] {
  padding: 0.6rem 0.8rem;
  font: inherit;
  font-size: 0.875rem;
  border: 1px solid var(--np-color-border, #ececef);
  border-radius: var(--np-radius-md, 10px);
  background: var(--np-color-background, #fff);
  color: inherit;
}
.np-site-footer-subscribe-form input[type="email"]:focus {
  outline: none;
  border-color: var(--np-color-ring, #4f46e5);
  box-shadow: 0 0 0 3px color-mix(in oklab, var(--np-color-ring, #4f46e5) 18%, transparent);
}
.np-site-footer-subscribe-form button {
  padding: 0.6rem 0.8rem;
  font: inherit;
  font-size: 0.875rem;
  font-weight: 600;
  background: var(--np-color-foreground, #0a0a0c);
  color: var(--np-color-background, #fff);
  border: none;
  border-radius: var(--np-radius-md, 10px);
  cursor: pointer;
  transition: opacity 0.15s ease;
}
.np-site-footer-subscribe-form button:hover { opacity: 0.9; }
.np-site-footer-subscribe-form button:disabled { opacity: 0.6; cursor: progress; }
.np-site-footer-subscribe-success {
  margin: 0;
  font-size: 0.9rem;
  color: var(--np-color-foreground, #0a0a0c);
  background: color-mix(in oklab, var(--np-color-primary, #4f46e5) 12%, transparent);
  padding: 0.6rem 0.75rem;
  border-radius: var(--np-radius-md, 10px);
}
.np-site-footer-subscribe-error {
  margin: 0;
  font-size: 0.8rem;
  color: var(--np-color-destructive, #b91c1c);
}
.np-site-footer-bottom {
  margin-top: 3rem;
  padding-top: 1.25rem;
  border-top: 1px solid color-mix(in oklab, var(--np-color-border, #ececef) 60%, transparent);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  flex-wrap: wrap;
  color: var(--np-color-muted-foreground, #6b6b74);
  font-size: 0.8125rem;
}
.np-site-footer-copy { margin: 0; }
.np-site-footer-meta {
  display: flex;
  list-style: none;
  margin: 0;
  padding: 0;
  gap: 1.25rem;
}
.np-site-footer-meta a {
  color: inherit;
  text-decoration: none;
}
.np-site-footer-meta a:hover { color: var(--np-color-foreground, #0a0a0c); }

/* ----------------------------------------------------------------
 * Page templates: default, wide, landing, sidebar
 * --------------------------------------------------------------- */
.np-page-default {
  max-width: var(--np-content-max);
  margin: 0 auto;
  padding: 3rem 1.5rem 4rem;
}
.np-page-wide {
  max-width: none;
  margin: 0;
  padding: 0;
}
.np-page-landing {
  max-width: none;
  margin: 0;
  padding: 0;
}
.np-page-landing-blocks > * + * { margin-top: 0; }
.np-page-landing-hero {
  max-width: var(--np-content-max-wide);
  margin: 0 auto;
  padding: 6rem 1.5rem 4rem;
  text-align: center;
}
.np-page-landing-intro {
  font-size: clamp(1.1rem, 1.6vw, 1.25rem);
  color: var(--np-color-muted-foreground, #64748b);
  max-width: 38rem;
  margin: 1rem auto 0;
  line-height: 1.6;
}
.np-page-sidebar {
  max-width: var(--np-content-max-wide);
  margin: 0 auto;
  padding: 3rem 1.5rem 4rem;
  display: grid;
  grid-template-columns: minmax(0, 1fr) 18rem;
  gap: 3rem;
}
@media (max-width: 900px) {
  .np-page-sidebar { grid-template-columns: 1fr; }
  .np-page-sidebar-aside { order: -1; }
}
.np-page-sidebar-aside {
  position: sticky;
  top: 5rem;
  align-self: start;
  font-size: 0.9rem;
}
.np-page-sidebar-placeholder {
  border: 1px dashed var(--np-color-border, #e5e7eb);
  border-radius: var(--np-radius-md, 0.5rem);
  padding: 1rem;
}
.np-page-sidebar-placeholder-label {
  margin: 0 0 0.5rem;
  font-weight: 600;
  font-size: 0.75rem;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: var(--np-color-muted-foreground, #64748b);
}
.np-page-sidebar-placeholder-hint {
  margin: 0;
  color: var(--np-color-muted-foreground, #64748b);
  font-size: 0.85rem;
  line-height: 1.5;
}
.np-page-sidebar-placeholder code {
  background: var(--np-color-muted, #f1f5f9);
  padding: 0.1em 0.3em;
  border-radius: 3px;
  font-size: 0.9em;
}

/* ----------------------------------------------------------------
 * Post detail
 * --------------------------------------------------------------- */
.np-post-default {
  max-width: var(--np-content-max);
  margin: 0 auto;
  padding: 3.25rem 1.5rem 5rem;
}
.np-post-crumbs {
  display: flex;
  gap: 0.55rem;
  margin: 0 0 2rem;
  color: var(--np-color-primary, #4f46e5);
  font-family: var(--np-font-mono, ui-monospace, monospace);
  font-size: 0.78rem;
}
.np-post-crumbs a {
  color: inherit;
  text-decoration: none;
}
.np-post-hero {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 300px;
  gap: 4rem;
  align-items: end;
  margin-bottom: 2rem;
}
.np-post-hero-copy {
  max-width: 780px;
}
.np-post-kicker {
  display: inline-flex;
  width: fit-content;
  margin-bottom: 1rem;
  border: 1px solid color-mix(in oklab, var(--np-color-primary, #4f46e5) 28%, var(--np-color-border, #ececef));
  border-radius: 999px;
  padding: 0.35rem 0.7rem;
  color: var(--np-color-primary, #4f46e5);
  background: color-mix(in oklab, var(--np-color-primary, #4f46e5) 7%, transparent);
  font-family: var(--np-font-mono, ui-monospace, monospace);
  font-size: 0.72rem;
  text-transform: uppercase;
  letter-spacing: 0.08em;
}
.np-post-rail {
  border: 1px solid var(--np-color-border, #e5e7eb);
  border-radius: 18px;
  background: var(--np-color-card, #fff);
  padding: 1.1rem;
}
.np-post-rail dl {
  display: grid;
  gap: 0.9rem;
  margin: 0;
}
.np-post-rail div {
  display: flex;
  justify-content: space-between;
  gap: 1rem;
  border-top: 1px solid var(--np-color-border, #e5e7eb);
  padding-top: 0.9rem;
}
.np-post-rail div:first-child {
  border-top: 0;
  padding-top: 0;
}
.np-post-rail dt {
  color: var(--np-color-muted-foreground, #64748b);
  font-size: 0.78rem;
}
.np-post-rail dd {
  margin: 0;
  text-align: end;
  font-size: 0.9rem;
  font-weight: 650;
}
.np-post-cover {
  margin: 0 0 2rem;
  aspect-ratio: 2.1 / 1;
  border-radius: 24px;
  overflow: hidden;
  background: linear-gradient(135deg, #111827, #4f46e5 48%, #a5b4fc);
}
.np-post-cover img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.np-post-cover-fallback {
  display: grid;
  place-items: center;
  min-height: 320px;
  color: rgba(255,255,255,0.86);
  position: relative;
}
.np-post-cover-fallback span {
  position: absolute;
  left: 1.25rem;
  bottom: 1.15rem;
  font-family: var(--np-font-mono, ui-monospace, monospace);
  font-size: 0.78rem;
  letter-spacing: 0.08em;
}
.np-post-cover-fallback strong {
  font-size: clamp(5rem, 20vw, 14rem);
  line-height: 0.8;
  letter-spacing: -0.12em;
  opacity: 0.18;
}
.np-post-header { margin-bottom: 2rem; }
.np-post-tags {
  list-style: none;
  margin: 0 0 0.75rem;
  padding: 0;
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
}
.np-post-tags a,
.np-post-tags span {
  display: inline-block;
  font-size: 0.75rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  padding: 0.25rem 0.6rem;
  border-radius: 999px;
  background: var(--np-color-muted, #f1f5f9);
  color: var(--np-color-muted-foreground, #64748b);
  text-decoration: none;
}
.np-post-tags a:hover { color: var(--np-color-foreground, #0f172a); }
.np-post-excerpt {
  font-size: 1.125rem;
  color: var(--np-color-muted-foreground, #64748b);
  margin: 0 0 1.25rem;
  line-height: 1.6;
}
.np-post-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 1rem;
  font-size: 0.875rem;
  color: var(--np-color-muted-foreground, #64748b);
  border-top: 1px solid var(--np-color-border, #e5e7eb);
  padding-top: 1rem;
}
.np-post-meta-author {
  font-weight: 600;
  color: var(--np-color-foreground, #0f172a);
}
.np-post-body {
  max-width: 760px;
  margin: 0 auto;
}
.np-post-body > * + * { margin-top: 1rem; }
.np-post-footer {
  max-width: 760px;
  margin: 2.75rem auto 0;
  padding-top: 1.3rem;
  border-top: 1px solid var(--np-color-border, #e5e7eb);
}
.np-post-footer > span {
  display: block;
  margin-bottom: 0.75rem;
  color: var(--np-color-muted-foreground, #64748b);
  font-family: var(--np-font-mono, ui-monospace, monospace);
  font-size: 0.76rem;
}
.np-post-related {
  margin-top: 4rem;
}
.np-post-related-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 1rem;
}
.np-post-related-list a {
  display: block;
  min-height: 100%;
  border: 1px solid var(--np-color-border, #e5e7eb);
  border-radius: 18px;
  padding: 1.1rem;
  color: inherit;
  text-decoration: none;
  background: var(--np-color-card, #fff);
}
.np-post-related-list span {
  color: var(--np-color-primary, #4f46e5);
  font-family: var(--np-font-mono, ui-monospace, monospace);
  font-size: 0.72rem;
}
.np-post-related-list strong {
  display: block;
  margin: 0.55rem 0;
  font-size: 1.05rem;
  line-height: 1.25;
}
.np-post-related-list p {
  margin: 0;
  color: var(--np-color-muted-foreground, #64748b);
  font-size: 0.9rem;
  line-height: 1.5;
}
@media (max-width: 800px) {
  .np-post-hero,
  .np-post-related-list {
    grid-template-columns: 1fr;
  }
  .np-post-hero {
    gap: 1.5rem;
  }
  .np-post-cover {
    aspect-ratio: 16 / 10;
    border-radius: 18px;
  }
  .np-post-cover-fallback {
    min-height: 12rem;
  }
  .np-post-cover-fallback strong {
    font-size: clamp(4rem, 18vw, 7rem);
    letter-spacing: -0.04em;
  }
}

/* ----------------------------------------------------------------
 * Post list (blog index)
 *
 * Page header centers on a small eyebrow pill + display headline
 * + intro lede + categorical tax-strip. The feature card sits in
 * its own row above the 3-up grid; each grid card pairs a colored
 * cover gradient with a small kicker, title, excerpt, and author/
 * read-time meta. Inline newsletter (dark slab) follows the grid;
 * pagination closes the page.
 * --------------------------------------------------------------- */
.np-post-list {
  max-width: var(--np-content-max, 1180px);
  margin: 0 auto;
  padding: 0 1.75rem 4rem;
}
.np-post-list-header {
  padding: 5rem 0 3rem;
  text-align: center;
}
.np-post-list-header h1 {
  font-size: clamp(2.5rem, 4.5vw, 3.75rem);
  font-weight: 700;
  letter-spacing: -0.035em;
  line-height: 1.02;
  margin: 0 0 1rem;
  text-wrap: balance;
}
.np-post-list-eyebrow {
  display: inline-block;
  font-family: var(--np-font-mono, ui-monospace, monospace);
  font-size: 0.75rem;
  letter-spacing: 0.05em;
  color: var(--np-color-primary, #4f46e5);
  background: color-mix(in oklab, var(--np-color-primary, #4f46e5) 10%, transparent);
  padding: 0.3rem 0.7rem;
  border-radius: 999px;
  margin-bottom: 1.25rem;
}
.np-post-list-intro {
  margin: 0 auto;
  max-width: 38rem;
  color: var(--np-color-muted-foreground, #6b6b74);
  font-size: 1.125rem;
  line-height: 1.55;
  text-wrap: pretty;
}
/* Category strip — pill links under the page header. */
.np-tax-strip {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
  justify-content: center;
  margin-top: 2rem;
}
.np-tax-strip a {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.4rem 0.85rem;
  font-size: 0.8125rem;
  font-weight: 500;
  color: var(--np-color-muted-foreground, #6b6b74);
  background: var(--np-color-background, #fff);
  border: 1px solid var(--np-color-border, #ececef);
  border-radius: 999px;
  text-decoration: none;
  transition: color 0.15s ease, border-color 0.15s ease, background 0.15s ease;
}
.np-tax-strip a:hover {
  color: var(--np-color-foreground, #0a0a0c);
  border-color: var(--np-color-foreground, #0a0a0c);
}
.np-tax-strip a[data-active="true"] {
  background: var(--np-color-foreground, #0a0a0c);
  color: var(--np-color-background, #fff);
  border-color: var(--np-color-foreground, #0a0a0c);
}
.np-tax-strip span { color: color-mix(in oklab, currentColor 50%, transparent); }

/* Feature card — 2-col split with a gradient cover on the left and
 * a typographic body block on the right. Bigger headline, more
 * generous padding, and a subtle lift on hover. */
.np-post-list-feature {
  margin: 1.5rem 0 4rem;
}
.np-post-card.np-post-card-feature {
  display: block;
  background: transparent;
  border: 0;
  border-radius: 0;
  overflow: visible;
  transform: none;
  transition: none;
}
.np-post-card.np-post-card-feature .np-post-card-link {
  display: grid;
  grid-template-columns: minmax(0, 1.15fr) minmax(0, 1fr);
  gap: 0;
  align-items: stretch;
  background: var(--np-color-card, #fff);
  border: 1px solid var(--np-color-border, #ececef);
  border-radius: var(--np-radius-xl, 20px);
  overflow: hidden;
  text-decoration: none;
  color: inherit;
  transition: border-color 0.2s ease, transform 0.3s ease, box-shadow 0.3s ease;
}
.np-post-card.np-post-card-feature .np-post-card-link:hover {
  border-color: color-mix(in oklab, var(--np-color-foreground, #0a0a0c) 25%, var(--np-color-border, #ececef));
  transform: translateY(-2px);
  box-shadow: 0 24px 48px -32px rgba(0,0,0,0.18);
}
.np-post-card.np-post-card-feature .np-post-card-cover {
  aspect-ratio: auto;
  min-height: 22rem;
  background: linear-gradient(135deg, #1e1b4b 0%, var(--np-color-primary, #4f46e5) 45%, #818cf8 100%);
  position: relative;
  overflow: hidden;
}
.np-post-card.np-post-card-feature .np-post-card-cover::before {
  content: "";
  position: absolute;
  inset: 0;
  background:
    radial-gradient(ellipse 60% 40% at 25% 35%, rgba(255,255,255,0.25), transparent 60%),
    radial-gradient(ellipse 50% 60% at 80% 70%, rgba(124,58,237,0.6), transparent 60%);
}
.np-post-card.np-post-card-feature .np-post-card-cover-figure {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  color: rgba(255,255,255,0.18);
  font-family: var(--np-font-mono, ui-monospace, monospace);
  font-size: 6rem;
  font-weight: 800;
  letter-spacing: -0.05em;
}
.np-post-card.np-post-card-feature .np-post-card-cover-overlay {
  position: absolute;
  inset: auto 0 0 0;
  padding: 1.5rem 1.75rem;
  font-family: var(--np-font-mono, ui-monospace, monospace);
  font-size: 0.75rem;
  color: rgba(255,255,255,0.85);
  letter-spacing: 0.04em;
  display: flex;
  justify-content: space-between;
  align-items: end;
}
.np-post-card.np-post-card-feature .np-post-card-body {
  padding: 2.5rem 2.75rem;
  display: flex;
  flex-direction: column;
  gap: 0.85rem;
  justify-content: center;
}
.np-post-card.np-post-card-feature .np-post-card-kicker {
  display: inline-flex;
  gap: 0.5rem;
  font-family: var(--np-font-mono, ui-monospace, monospace);
  font-size: 0.75rem;
  letter-spacing: 0.04em;
  color: var(--np-color-primary, #4f46e5);
  text-transform: uppercase;
}
.np-post-card.np-post-card-feature .np-post-card-title {
  font-size: clamp(1.65rem, 2.6vw, 2.25rem);
  font-weight: 700;
  letter-spacing: -0.025em;
  line-height: 1.1;
  margin: 0;
  text-wrap: balance;
}
.np-post-card.np-post-card-feature .np-post-card-excerpt {
  font-size: 1rem;
  color: var(--np-color-muted-foreground, #6b6b74);
  line-height: 1.6;
  margin: 0;
  max-width: 30rem;
}
@media (max-width: 900px) {
  .np-post-list-feature,
  .np-post-card.np-post-card-feature,
  .np-post-card.np-post-card-feature .np-post-card-link,
  .np-post-card.np-post-card-feature .np-post-card-cover {
    min-width: 0;
    max-width: 100%;
  }
  .np-post-card.np-post-card-feature .np-post-card-link {
    grid-template-columns: 1fr;
  }
  .np-post-card.np-post-card-feature .np-post-card-cover {
    min-height: 16rem;
    aspect-ratio: 16/10;
  }
  .np-post-card.np-post-card-feature .np-post-card-cover-figure {
    font-size: clamp(3.5rem, 18vw, 6rem);
  }
  .np-post-card.np-post-card-feature .np-post-card-cover-overlay {
    padding: 1.1rem 1.2rem;
    gap: 0.75rem;
    flex-wrap: wrap;
  }
  .np-post-card.np-post-card-feature .np-post-card-body {
    padding: 1.75rem;
  }
}

/* Section head — small h2 over the grid with right-justified
 * meta (count, sort). The 1px rule separates it from the grid. */
.np-section-head {
  display: flex;
  align-items: end;
  justify-content: space-between;
  gap: 1rem;
  margin: 1rem 0 1.75rem;
  padding-bottom: 1rem;
  border-bottom: 1px solid var(--np-color-border, #ececef);
}
.np-section-head h2 {
  font-size: 1.25rem;
  letter-spacing: -0.015em;
  font-weight: 600;
  margin: 0;
}
.np-section-head-meta {
  font-family: var(--np-font-mono, ui-monospace, monospace);
  font-size: 0.8125rem;
  color: var(--np-color-muted-foreground, #6b6b74);
}

/* Grid + grid card — cover on top, kicker tags row, title, excerpt,
 * author+reading-time meta. Card itself is borderless; the cover
 * carries the only visible boundary. */
.np-post-list-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 2rem;
  list-style: none;
  padding: 0;
  margin: 0;
}
@media (max-width: 900px) { .np-post-list-grid { grid-template-columns: repeat(2, 1fr); } }
@media (max-width: 640px) { .np-post-list-grid { grid-template-columns: 1fr; } }

.np-post-card {
  display: flex;
  flex-direction: column;
  gap: 0.95rem;
  background: transparent;
  border: 0;
  border-radius: 0;
  overflow: visible;
  transition: transform 0.25s ease;
}
.np-post-card:hover { transform: translateY(-2px); }
.np-post-card-link {
  display: flex;
  flex-direction: column;
  gap: 0.95rem;
  text-decoration: none;
  color: inherit;
}
.np-post-card-cover {
  aspect-ratio: 16 / 10;
  border-radius: var(--np-radius-lg, 14px);
  overflow: hidden;
  position: relative;
  background: var(--np-color-muted, #f5f5f7);
}
.np-post-card-cover img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.np-post-card-cover-figure {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-family: var(--np-font-mono, ui-monospace, monospace);
  font-weight: 700;
  letter-spacing: -0.04em;
}
/* Cover gradient variants — referenced from the template by
 * cycling .np-cover-grad-1 through 6 across the grid index.
 * Each variant ships its own foreground figure color so the
 * monogram reads at low contrast against its background. */
.np-cover-grad-1 { background: linear-gradient(135deg, #0f172a, #334155); }
.np-cover-grad-1 .np-post-card-cover-figure { color: rgba(255,255,255,0.18); font-size: 4rem; }
.np-cover-grad-2 { background: linear-gradient(135deg, #fef3c7, #f59e0b); }
.np-cover-grad-2 .np-post-card-cover-figure { color: rgba(120,53,15,0.2); font-size: 4rem; }
.np-cover-grad-3 { background: linear-gradient(135deg, #ecfeff 0%, #06b6d4 100%); }
.np-cover-grad-3 .np-post-card-cover-figure { color: rgba(8,47,73,0.18); font-size: 4rem; }
.np-cover-grad-4 { background: linear-gradient(135deg, #fce7f3, #be185d); }
.np-cover-grad-4 .np-post-card-cover-figure { color: rgba(159,18,57,0.2); font-size: 4rem; }
.np-cover-grad-5 { background: linear-gradient(135deg, #ddd6fe, #6d28d9); }
.np-cover-grad-5 .np-post-card-cover-figure { color: rgba(76,29,149,0.2); font-size: 4rem; }
.np-cover-grad-6 { background: linear-gradient(135deg, #d1fae5, #047857); }
.np-cover-grad-6 .np-post-card-cover-figure { color: rgba(6,78,59,0.22); font-size: 4rem; }

.np-post-card-tags {
  display: flex;
  gap: 0.4rem;
  flex-wrap: wrap;
  margin: 0;
  margin-top: -0.25rem;
  list-style: none;
  padding: 0;
  font-family: var(--np-font-mono, ui-monospace, monospace);
  font-size: 0.7rem;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--np-color-muted-foreground, #6b6b74);
}
.np-post-card-tags li {
  display: inline-flex;
  align-items: baseline;
}
/* Mid-dot separator between tags. Visual only — aria-hidden
 * isn't needed because ::before content doesn't reach the
 * accessibility tree. */
.np-post-card-tags li:not(:first-child)::before {
  content: "·";
  margin: 0 0.35rem 0 0;
  color: color-mix(in oklab, currentColor 50%, transparent);
}
.np-post-card-tags a { color: inherit; text-decoration: none; }
.np-post-card-title {
  font-size: 1.1875rem;
  font-weight: 600;
  line-height: 1.3;
  letter-spacing: -0.015em;
  margin: 0;
  text-wrap: balance;
  color: inherit;
}
.np-post-card-excerpt {
  margin: 0;
  font-size: 0.9375rem;
  color: var(--np-color-muted-foreground, #6b6b74);
  line-height: 1.55;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.np-post-card-meta {
  display: flex;
  align-items: center;
  gap: 0.7rem;
  font-size: 0.8125rem;
  color: var(--np-color-muted-foreground, #6b6b74);
  margin-top: 0.3rem;
}
.np-post-card-meta-author {
  display: inline-flex;
  align-items: center;
  gap: 0.45rem;
  color: var(--np-color-foreground, #0a0a0c);
  font-weight: 500;
}
.np-post-card-meta-avatar {
  width: 1.45rem;
  height: 1.45rem;
  border-radius: 50%;
  background: linear-gradient(135deg, #fbbf24, #ef4444);
  flex-shrink: 0;
}
.np-post-card-meta-avatar.tone-1 { background: linear-gradient(135deg, #10b981, #0ea5e9); }
.np-post-card-meta-avatar.tone-2 { background: linear-gradient(135deg, #f472b6, #a855f7); }
.np-post-card-meta-avatar.tone-3 { background: linear-gradient(135deg, #fb7185, #fb923c); }
.np-post-card-meta-avatar.tone-4 { background: linear-gradient(135deg, var(--np-color-primary, #4f46e5), #06b6d4); }
.np-post-card-meta-sep::before {
  content: "·";
  margin: 0 0.1rem;
}
.np-post-list-empty header {
  text-align: center;
  padding: 4rem 1.5rem;
  color: var(--np-color-muted-foreground, #6b6b74);
}
.np-post-list-empty h1 { color: var(--np-color-foreground, #0a0a0c); }

/* Inline newsletter — dark slab with a radial glow on the right.
 * Two-column on desktop (copy / form), stacks on mobile. */
.np-newsletter-inline {
  margin: 5rem 0 4rem;
  padding: 3rem 3rem;
  background: var(--np-color-foreground, #0a0a0c);
  color: var(--np-color-background, #fff);
  border-radius: var(--np-radius-xl, 20px);
  box-sizing: border-box;
  display: grid;
  grid-template-columns: 1.1fr 1fr;
  gap: 3rem;
  align-items: center;
  position: relative;
  overflow: hidden;
}
.np-newsletter-inline::after {
  content: "";
  position: absolute;
  right: -10%;
  top: -50%;
  width: 70%;
  height: 200%;
  background: radial-gradient(ellipse, rgba(124,58,237,0.3), transparent 65%);
  pointer-events: none;
}
.np-newsletter-inline h3 {
  font-size: 1.75rem;
  font-weight: 700;
  letter-spacing: -0.02em;
  margin: 0 0 0.5rem;
  line-height: 1.15;
  text-wrap: balance;
}
.np-newsletter-inline p {
  margin: 0;
  color: color-mix(in oklab, var(--np-color-background, #fff) 70%, transparent);
  font-size: 0.95rem;
  line-height: 1.55;
  max-width: 32rem;
}
.np-newsletter-form {
  display: flex;
  gap: 0.5rem;
  min-width: 0;
  max-width: 100%;
  position: relative;
  z-index: 1;
}
.np-newsletter-form input {
  flex: 1;
  min-width: 0;
  padding: 0.85rem 1rem;
  font: inherit;
  font-size: 0.9375rem;
  color: var(--np-color-background, #fff);
  background: color-mix(in oklab, var(--np-color-background, #fff) 8%, transparent);
  border: 1px solid color-mix(in oklab, var(--np-color-background, #fff) 18%, transparent);
  border-radius: var(--np-radius-md, 10px);
  outline: none;
}
.np-newsletter-form input::placeholder {
  color: color-mix(in oklab, var(--np-color-background, #fff) 45%, transparent);
}
.np-newsletter-form input:focus {
  border-color: color-mix(in oklab, var(--np-color-background, #fff) 60%, transparent);
}
.np-newsletter-form button {
  padding: 0.85rem 1.4rem;
  font: inherit;
  font-size: 0.9375rem;
  font-weight: 600;
  color: var(--np-color-foreground, #0a0a0c);
  background: var(--np-color-background, #fff);
  border: none;
  border-radius: var(--np-radius-md, 10px);
  cursor: pointer;
  transition: opacity 0.15s ease;
}
.np-newsletter-form button:hover { opacity: 0.9; }
@media (max-width: 800px) {
  .np-newsletter-inline {
    grid-template-columns: 1fr;
    padding: 2.25rem 1.75rem;
    gap: 1.5rem;
  }
}
@media (max-width: 480px) {
  .np-newsletter-inline {
    padding: 2rem 1.25rem;
  }
  .np-newsletter-form {
    flex-direction: column;
  }
  .np-newsletter-form button {
    width: 100%;
  }
}

/* ----------------------------------------------------------------
 * Pagination — pill row centered under the grid. Current page
 * inverts to the foreground color so the cursor lands obviously;
 * gap (…) drops its border so the row breathes between numbers.
 * --------------------------------------------------------------- */
.np-pagination {
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 0.45rem;
  margin: 3rem 0 2rem;
}
.np-pagination-step,
.np-pagination-page,
.np-pagination-gap {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 2.4rem;
  height: 2.4rem;
  padding: 0 0.6rem;
  font-size: 0.875rem;
  font-weight: 500;
  color: var(--np-color-muted-foreground, #6b6b74);
  background: var(--np-color-background, #fff);
  border: 1px solid var(--np-color-border, #ececef);
  border-radius: var(--np-radius-md, 10px);
  text-decoration: none;
  transition: color 0.15s ease, border-color 0.15s ease, background 0.15s ease;
}
.np-pagination-page:hover,
.np-pagination-step:hover {
  color: var(--np-color-foreground, #0a0a0c);
  border-color: var(--np-color-foreground, #0a0a0c);
}
.np-pagination-current {
  color: var(--np-color-background, #fff);
  background: var(--np-color-foreground, #0a0a0c);
  border-color: var(--np-color-foreground, #0a0a0c);
}
.np-pagination-disabled {
  color: color-mix(in oklab, var(--np-color-muted-foreground, #6b6b74) 60%, transparent);
  pointer-events: none;
}
.np-pagination-pages {
  list-style: none;
  display: flex;
  gap: 0.45rem;
  margin: 0;
  padding: 0;
}
.np-pagination-gap {
  border-color: transparent;
  cursor: default;
}

/* ----------------------------------------------------------------
 * Color-mode toggle (Phase 11.5) + language picker (12.6)
 * --------------------------------------------------------------- */
.np-color-scheme-toggle {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 2.25rem;
  height: 2.25rem;
  padding: 0;
  border: 1px solid var(--np-color-border, #e5e7eb);
  border-radius: var(--np-radius-md, 0.5rem);
  background: transparent;
  color: inherit;
  cursor: pointer;
  transition: background 0.15s ease, border-color 0.15s ease;
}
.np-color-scheme-toggle:hover {
  background: var(--np-color-muted, #f8fafc);
  border-color: var(--np-color-muted-foreground, #94a3b8);
}
.np-color-scheme-toggle:focus-visible {
  outline: 2px solid var(--np-color-ring, #4f46e5);
  outline-offset: 2px;
}
.np-color-scheme-toggle-placeholder {
  width: 2.25rem;
  height: 2.25rem;
  border: 1px solid transparent;
}
.np-language-picker {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  font-size: 0.75rem;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}
.np-language-picker-link {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 2rem;
  height: 1.85rem;
  padding: 0 0.55rem;
  border-radius: var(--np-radius-md, 0.5rem);
  text-decoration: none;
  color: inherit;
  opacity: 0.6;
  transition: opacity 0.15s ease, background 0.15s ease;
}
.np-language-picker-link:hover {
  opacity: 1;
  background: var(--np-color-muted, #f8fafc);
}
.np-language-picker-link[data-active="true"] {
  opacity: 1;
  font-weight: 600;
  background: var(--np-color-muted, #f8fafc);
}

/* ----------------------------------------------------------------
 * Member-status widget
 *
 * Compact sign-in / sign-out chrome the operator drops into the
 * site header. Three states: loading (placeholder span), signed-
 * in (@handle link + sign-out text-button), signed-out (sign in
 * + register CTAs). Two button classes — np-button-primary for
 * the register CTA, np-text-button for the sign-out — are also
 * reusable outside the widget when the operator wants a matching
 * pair elsewhere.
 * --------------------------------------------------------------- */
.np-member-status {
  display: inline-flex;
  align-items: center;
  gap: 0.75rem;
  font-size: 0.875rem;
}
.np-member-status a {
  color: inherit;
  text-decoration: none;
}
.np-member-status a:hover {
  text-decoration: underline;
  text-underline-offset: 0.2em;
}
.np-member-status-handle {
  font-weight: 500;
}
.np-member-status-loading {
  display: inline-block;
  width: 5.5rem;
  height: 1.1rem;
  border-radius: 999px;
  background: var(--np-color-muted, #f1f5f9);
  opacity: 0.6;
  animation: np-member-status-pulse 1.4s ease-in-out infinite;
}
@keyframes np-member-status-pulse {
  0%, 100% { opacity: 0.4; }
  50% { opacity: 0.7; }
}
.np-button-primary {
  display: inline-flex;
  align-items: center;
  padding: 0.4rem 0.9rem;
  border-radius: 0.375rem;
  background: var(--np-color-primary, #4f46e5);
  color: var(--np-color-primary-foreground, #ffffff);
  text-decoration: none;
  font-size: 0.825rem;
  font-weight: 500;
  border: none;
  cursor: pointer;
  transition: opacity 0.15s ease;
}
.np-button-primary:hover {
  opacity: 0.9;
  text-decoration: none;
}
.np-text-button {
  background: transparent;
  border: none;
  padding: 0;
  color: inherit;
  font: inherit;
  font-size: 0.825rem;
  cursor: pointer;
  opacity: 0.7;
  transition: opacity 0.15s ease;
}
.np-text-button:hover:not(:disabled) {
  opacity: 1;
  text-decoration: underline;
  text-underline-offset: 0.2em;
}
.np-text-button:disabled {
  cursor: default;
  opacity: 0.4;
}

/* ----------------------------------------------------------------
 * Dark mode — re-skin the design tokens
 * --------------------------------------------------------------- */
[data-theme="dark"] {
  --np-color-background: oklch(0.145 0.004 285.823);
  --np-color-foreground: oklch(0.985 0.001 106.423);
  --np-color-muted: oklch(0.215 0.006 286.033);
  --np-color-muted-foreground: oklch(0.711 0.008 285.879);
  --np-color-border: oklch(0.269 0.006 286.033);
  --np-color-card: oklch(0.18 0.005 285.5);
  --np-color-card-foreground: oklch(0.985 0.001 106.423);
  --np-color-accent: oklch(0.269 0.006 286.033);
  --np-color-accent-foreground: oklch(0.985 0.001 106.423);
}
`.trim();
