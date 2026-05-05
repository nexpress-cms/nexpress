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
 * The framework injects this string as a `<style data-nx-theme="default">`
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
  --np-content-max: 720px;
  --np-content-max-wide: 1100px;
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
 * Header — sticky desktop bar + mobile drawer
 * --------------------------------------------------------------- */
.np-site-header {
  position: sticky;
  top: 0;
  z-index: 30;
  background: color-mix(in oklch, var(--np-color-background, #fff) 92%, transparent);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  border-bottom: 1px solid var(--np-color-border, #e5e7eb);
}
.np-site-header-inner {
  display: flex;
  align-items: center;
  gap: 1.5rem;
  max-width: 1200px;
  margin: 0 auto;
  padding: 0.85rem 1.5rem;
}
.np-site-logo {
  font-weight: 800;
  font-size: 1.15rem;
  text-decoration: none;
  color: inherit;
  letter-spacing: -0.02em;
  white-space: nowrap;
}
.np-site-nav-desktop {
  flex: 1;
}
.np-site-nav {
  display: flex;
  align-items: center;
  gap: 1.4rem;
  list-style: none;
  padding: 0;
  margin: 0;
}
.np-site-nav a {
  color: var(--np-color-muted-foreground, #64748b);
  text-decoration: none;
  font-size: 0.9375rem;
  font-weight: 500;
  transition: color 0.15s ease;
}
.np-site-nav a:hover {
  color: var(--np-color-foreground, #0f172a);
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
  gap: 0.6rem;
  margin-inline-start: auto;
}
.np-site-search {
  display: contents;
}
.np-site-search-input {
  padding: 0.4rem 0.75rem;
  font: inherit;
  font-size: 0.875rem;
  color: inherit;
  background: var(--np-color-muted, #f8fafc);
  border: 1px solid var(--np-color-border, #e5e7eb);
  border-radius: var(--np-radius-md, 0.5rem);
  width: 12rem;
  transition: border-color 0.15s ease, box-shadow 0.15s ease, width 0.15s ease;
}
.np-site-search-input:focus {
  outline: none;
  border-color: var(--np-color-ring, #4f46e5);
  box-shadow: 0 0 0 3px color-mix(in oklch, var(--np-color-ring, #4f46e5) 20%, transparent);
  width: 14rem;
}

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
  transition: transform 0.2s ease;
  display: flex;
  flex-direction: column;
}
.np-mobile-nav-drawer[data-open="true"] {
  transform: translateX(0);
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

@media (max-width: 768px) {
  .np-site-nav-desktop,
  .np-site-search,
  .np-site-search-input {
    display: none;
  }
  .np-mobile-nav-toggle {
    display: inline-flex;
  }
}
@media (min-width: 769px) {
  .np-mobile-nav-drawer,
  .np-mobile-nav-overlay {
    display: none;
  }
}

/* ----------------------------------------------------------------
 * Footer — 4-column grid, social strip, newsletter signup
 * --------------------------------------------------------------- */
.np-site-footer {
  margin-top: 6rem;
  background: var(--np-color-muted, #f8fafc);
  border-top: 1px solid var(--np-color-border, #e5e7eb);
}
.np-site-footer-inner {
  max-width: 1200px;
  margin: 0 auto;
  padding: 3rem 1.5rem 1.5rem;
}
.np-site-footer-grid {
  display: grid;
  grid-template-columns: 1.4fr 1fr 1fr 1.2fr;
  gap: 2.5rem;
  align-items: start;
}
@media (max-width: 768px) {
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
  font-weight: 800;
  font-size: 1.15rem;
  text-decoration: none;
  color: inherit;
  letter-spacing: -0.02em;
}
.np-site-footer-tagline {
  margin: 0.5rem 0 1rem;
  color: var(--np-color-muted-foreground, #64748b);
  font-size: 0.9rem;
  line-height: 1.5;
}
.np-site-footer-heading {
  font-size: 0.75rem;
  text-transform: uppercase;
  letter-spacing: 0.12em;
  color: var(--np-color-muted-foreground, #64748b);
  margin: 0 0 0.85rem;
  font-weight: 700;
}
.np-site-footer-links {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.55rem;
  font-size: 0.9rem;
}
.np-site-footer-links a {
  color: var(--np-color-muted-foreground, #64748b);
  text-decoration: none;
  transition: color 0.15s ease;
}
.np-site-footer-links a:hover {
  color: var(--np-color-foreground, #0f172a);
}
.np-site-footer-social {
  list-style: none;
  margin: 1rem 0 0;
  padding: 0;
  display: flex;
  gap: 0.5rem;
}
.np-site-footer-social a {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 2.25rem;
  height: 2.25rem;
  border: 1px solid var(--np-color-border, #e5e7eb);
  border-radius: var(--np-radius-md, 0.5rem);
  color: var(--np-color-muted-foreground, #64748b);
  text-decoration: none;
  transition: all 0.15s ease;
}
.np-site-footer-social a:hover {
  color: var(--np-color-foreground, #0f172a);
  border-color: var(--np-color-foreground, #0f172a);
  transform: translateY(-1px);
}
.np-site-footer-subscribe-blurb {
  margin: 0 0 0.75rem;
  font-size: 0.85rem;
  color: var(--np-color-muted-foreground, #64748b);
}
.np-site-footer-subscribe-form {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}
.np-site-footer-subscribe-form input[type="email"] {
  padding: 0.55rem 0.75rem;
  font: inherit;
  font-size: 0.9rem;
  border: 1px solid var(--np-color-border, #e5e7eb);
  border-radius: var(--np-radius-md, 0.5rem);
  background: var(--np-color-background, #fff);
  color: inherit;
}
.np-site-footer-subscribe-form input[type="email"]:focus {
  outline: none;
  border-color: var(--np-color-ring, #4f46e5);
  box-shadow: 0 0 0 3px color-mix(in oklch, var(--np-color-ring, #4f46e5) 20%, transparent);
}
.np-site-footer-subscribe-form button {
  padding: 0.55rem 0.75rem;
  font: inherit;
  font-size: 0.9rem;
  font-weight: 600;
  background: var(--np-color-foreground, #0f172a);
  color: var(--np-color-background, #fff);
  border: none;
  border-radius: var(--np-radius-md, 0.5rem);
  cursor: pointer;
  transition: opacity 0.15s ease;
}
.np-site-footer-subscribe-form button:hover { opacity: 0.9; }
.np-site-footer-subscribe-form button:disabled { opacity: 0.6; cursor: progress; }
.np-site-footer-subscribe-success {
  margin: 0;
  font-size: 0.9rem;
  color: var(--np-color-foreground, #0f172a);
  background: color-mix(in oklch, var(--np-color-primary, #4f46e5) 12%, transparent);
  padding: 0.6rem 0.75rem;
  border-radius: var(--np-radius-md, 0.5rem);
}
.np-site-footer-subscribe-error {
  margin: 0;
  font-size: 0.8rem;
  color: var(--np-color-destructive, #b91c1c);
}
.np-site-footer-bottom {
  margin-top: 2.5rem;
  padding-top: 1.25rem;
  border-top: 1px solid color-mix(in oklch, var(--np-color-border, #e5e7eb) 70%, transparent);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  flex-wrap: wrap;
}
.np-site-footer-copy {
  margin: 0;
  font-size: 0.8rem;
  color: var(--np-color-muted-foreground, #64748b);
}
.np-site-footer-meta {
  display: flex;
  list-style: none;
  margin: 0;
  padding: 0;
  gap: 1rem;
  font-size: 0.8rem;
}
.np-site-footer-meta a {
  color: var(--np-color-muted-foreground, #64748b);
  text-decoration: none;
}
.np-site-footer-meta a:hover { color: var(--np-color-foreground, #0f172a); }

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
  padding: 2.5rem 1.5rem 4rem;
}
.np-post-cover {
  margin: 0 0 2rem;
  aspect-ratio: 16 / 9;
  border-radius: var(--np-radius-lg, 0.75rem);
  overflow: hidden;
}
.np-post-cover img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
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
.np-post-body > * + * { margin-top: 1rem; }

/* ----------------------------------------------------------------
 * Post list (blog index)
 * --------------------------------------------------------------- */
.np-post-list {
  max-width: var(--np-content-max-wide);
  margin: 0 auto;
  padding: 3rem 1.5rem 4rem;
}
.np-post-list-header {
  margin-bottom: 2.5rem;
  text-align: center;
}
.np-post-list-header h1 { margin: 0; }
.np-post-list-intro {
  margin: 0.75rem auto 0;
  max-width: 38rem;
  color: var(--np-color-muted-foreground, #64748b);
  font-size: 1.05rem;
  line-height: 1.6;
}
.np-post-list-feature { margin-bottom: 2rem; }
.np-post-list-feature .np-post-card { display: block; }
.np-post-list-feature .np-post-card-link {
  display: grid;
  grid-template-columns: minmax(0, 1.2fr) minmax(0, 1fr);
  gap: 0;
  align-items: stretch;
  background: var(--np-color-card, #fff);
  border: 1px solid var(--np-color-border, #e5e7eb);
  border-radius: var(--np-radius-lg, 0.75rem);
  overflow: hidden;
  text-decoration: none;
  color: inherit;
  transition: border-color 0.15s ease, transform 0.2s ease;
}
.np-post-list-feature .np-post-card-link:hover {
  border-color: var(--np-color-foreground, #0f172a);
  transform: translateY(-2px);
}
.np-post-list-feature .np-post-card-cover {
  aspect-ratio: 16 / 10;
  margin: 0;
  overflow: hidden;
}
.np-post-list-feature .np-post-card-cover img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.np-post-list-feature .np-post-card-body {
  padding: 1.75rem;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  justify-content: center;
}
.np-post-list-feature .np-post-card-title {
  font-size: clamp(1.4rem, 2.4vw, 1.85rem);
  margin: 0;
  letter-spacing: -0.015em;
}
@media (max-width: 768px) {
  .np-post-list-feature .np-post-card-link { grid-template-columns: 1fr; }
  .np-post-list-feature .np-post-card-cover { aspect-ratio: 16 / 9; }
}
.np-post-list-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(18rem, 1fr));
  gap: 1.5rem;
}
.np-post-card {
  background: var(--np-color-card, #fff);
  border: 1px solid var(--np-color-border, #e5e7eb);
  border-radius: var(--np-radius-lg, 0.75rem);
  overflow: hidden;
  transition: border-color 0.15s ease, transform 0.2s ease;
}
.np-post-card:hover {
  border-color: var(--np-color-foreground, #0f172a);
  transform: translateY(-2px);
}
.np-post-card-link {
  display: block;
  text-decoration: none;
  color: inherit;
}
.np-post-card-cover {
  margin: 0;
  aspect-ratio: 16 / 9;
  overflow: hidden;
  background: var(--np-color-muted, #f1f5f9);
}
.np-post-card-cover img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.np-post-card-body {
  padding: 1.25rem;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}
.np-post-card-title {
  margin: 0;
  font-size: 1.15rem;
  line-height: 1.3;
  letter-spacing: -0.01em;
}
.np-post-card-excerpt {
  margin: 0;
  font-size: 0.9rem;
  color: var(--np-color-muted-foreground, #64748b);
  line-height: 1.55;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.np-post-card-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 0.6rem;
  font-size: 0.78rem;
  color: var(--np-color-muted-foreground, #64748b);
  margin-top: 0.25rem;
}
.np-post-list-empty header {
  text-align: center;
  padding: 4rem 1.5rem;
  color: var(--np-color-muted-foreground, #64748b);
}
.np-post-list-empty h1 { color: var(--np-color-foreground, #0f172a); }

/* ----------------------------------------------------------------
 * Pagination
 * --------------------------------------------------------------- */
.np-pagination {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.75rem;
  margin: 3rem auto 0;
}
.np-pagination-step,
.np-pagination-page,
.np-pagination-gap {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 2.25rem;
  height: 2.25rem;
  padding: 0 0.6rem;
  font-size: 0.875rem;
  border: 1px solid var(--np-color-border, #e5e7eb);
  border-radius: var(--np-radius-md, 0.5rem);
  text-decoration: none;
  color: inherit;
  background: transparent;
  transition: all 0.15s ease;
}
.np-pagination-page:hover,
.np-pagination-step:hover { border-color: var(--np-color-foreground, #0f172a); }
.np-pagination-current {
  background: var(--np-color-foreground, #0f172a);
  color: var(--np-color-background, #fff);
  border-color: var(--np-color-foreground, #0f172a);
}
.np-pagination-disabled {
  color: var(--np-color-muted-foreground, #94a3b8);
  border-color: var(--np-color-border, #e5e7eb);
  pointer-events: none;
}
.np-pagination-pages {
  list-style: none;
  display: flex;
  gap: 0.4rem;
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
