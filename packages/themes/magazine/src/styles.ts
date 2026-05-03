/**
 * Theme-owned CSS for `@nexpress/theme-magazine`. Scoped under
 * `.nx-magazine-*` so swapping back to a different theme doesn't
 * leave residue. The framework injects this string as a
 * `<style data-nx-theme="magazine">` tag at SSR time.
 */
export const magazineCss = `
.nx-magazine {
  font-family: var(--nx-font-body, "Source Serif 4", Georgia, serif);
}

/* ----------------------------------------------------------------
 * Masthead
 * --------------------------------------------------------------- */
.nx-magazine-header {
  background: var(--nx-color-background, #fff);
  border-bottom: 4px double var(--nx-color-foreground, #0f172a);
  padding: 2rem 1.5rem 1rem;
  text-align: center;
  position: relative;
}
.nx-magazine-masthead {
  max-width: 960px;
  margin: 0 auto 0.75rem;
}
.nx-magazine-dateline {
  font-family: var(--nx-font-body, "Source Serif 4", Georgia, serif);
  font-size: 0.7rem;
  text-transform: uppercase;
  letter-spacing: 0.18em;
  color: var(--nx-color-muted-foreground, #64748b);
  margin: 0 0 0.5rem;
}
.nx-magazine-logo {
  font-family: var(--nx-font-heading, "Fraunces", Georgia, serif);
  font-size: clamp(2rem, 4vw, 3rem);
  font-weight: 800;
  letter-spacing: -0.01em;
  color: inherit;
  text-decoration: none;
  display: block;
}
.nx-magazine-tagline {
  margin: 0.35rem 0 0;
  font-style: italic;
  color: var(--nx-color-muted-foreground, #64748b);
  font-size: 0.95rem;
}
.nx-magazine-sections > ul {
  list-style: none;
  margin: 0;
  padding: 0.85rem 0 0;
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 1.75rem;
  text-transform: uppercase;
  letter-spacing: 0.18em;
  font-size: 0.75rem;
}
.nx-magazine-sections a {
  color: inherit;
  text-decoration: none;
  border-bottom: 1px solid transparent;
  padding-bottom: 0.15rem;
  transition: border-color 0.15s ease;
}
.nx-magazine-sections a:hover {
  border-bottom-color: currentColor;
}

/* Mobile drawer */
.nx-magazine-nav-toggle {
  display: none;
  position: absolute;
  top: 1.25rem;
  inset-inline-end: 1.25rem;
  padding: 0.4rem 0.75rem;
  border: 1px solid var(--nx-color-foreground, #0f172a);
  border-radius: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  font-size: 0.7rem;
  text-transform: uppercase;
  letter-spacing: 0.18em;
  cursor: pointer;
}
.nx-magazine-nav-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.45);
  z-index: 40;
}
.nx-magazine-nav-drawer {
  position: fixed;
  top: 0;
  inset-inline-start: 0;
  inset-inline-end: 0;
  background: var(--nx-color-background, #fff);
  border-bottom: 4px double var(--nx-color-foreground, #0f172a);
  z-index: 50;
  transform: translateY(-100%);
  transition: transform 0.25s ease;
}
.nx-magazine-nav-drawer[data-open="true"] {
  transform: translateY(0);
}
.nx-magazine-nav-drawer-list {
  list-style: none;
  margin: 0;
  padding: 1.5rem;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  font-family: var(--nx-font-heading, "Fraunces", Georgia, serif);
  font-size: 1.25rem;
  text-align: center;
}
.nx-magazine-nav-drawer-list a {
  color: inherit;
  text-decoration: none;
}
@media (max-width: 768px) {
  .nx-magazine-sections {
    display: none;
  }
  .nx-magazine-nav-toggle {
    display: inline-flex;
  }
}
@media (min-width: 769px) {
  .nx-magazine-nav-drawer,
  .nx-magazine-nav-overlay {
    display: none;
  }
}

/* ----------------------------------------------------------------
 * Footer — three columns + colophon
 * --------------------------------------------------------------- */
.nx-magazine-footer {
  margin-top: 5rem;
  padding: 3.5rem 1.5rem 2.5rem;
  border-top: 4px double var(--nx-color-foreground, #0f172a);
  background: var(--nx-color-muted, #f8fafc);
}
.nx-magazine-footer-grid {
  max-width: 1100px;
  margin: 0 auto;
  display: grid;
  grid-template-columns: 1.3fr 1fr 1fr;
  gap: 3rem;
  align-items: start;
}
@media (max-width: 720px) {
  .nx-magazine-footer-grid {
    grid-template-columns: 1fr;
    gap: 2.5rem;
  }
}
.nx-magazine-footer-col { min-width: 0; }
.nx-magazine-footer-heading {
  font-family: var(--nx-font-body, "Source Serif 4", Georgia, serif);
  font-size: 0.7rem;
  text-transform: uppercase;
  letter-spacing: 0.18em;
  color: var(--nx-color-muted-foreground, #64748b);
  margin: 0 0 0.85rem;
  font-weight: 700;
}
.nx-magazine-footer-blurb {
  margin: 0 0 0.85rem;
  font-size: 0.95rem;
  line-height: 1.55;
  color: var(--nx-color-muted-foreground, #64748b);
}
.nx-magazine-footer-nav {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.55rem;
  font-family: var(--nx-font-heading, "Fraunces", Georgia, serif);
  font-size: 1.05rem;
}
.nx-magazine-footer-nav a {
  color: inherit;
  text-decoration: none;
  border-bottom: 1px solid transparent;
  transition: border-color 0.15s ease;
}
.nx-magazine-footer-nav a:hover {
  border-bottom-color: currentColor;
}
.nx-magazine-footer-mark {
  font-family: var(--nx-font-heading, "Fraunces", Georgia, serif);
  font-size: 1.5rem;
  font-weight: 800;
  letter-spacing: -0.01em;
  margin: 0 0 0.35rem;
}
.nx-magazine-footer-meta {
  margin: 0;
  font-size: 0.85rem;
  font-style: italic;
  color: var(--nx-color-muted-foreground, #64748b);
  line-height: 1.6;
}
.nx-magazine-subscribe-form {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  font-family: var(--nx-font-body, "Source Serif 4", Georgia, serif);
}
.nx-magazine-subscribe-form input[type="email"] {
  padding: 0.55rem 0.75rem;
  font: inherit;
  font-size: 0.95rem;
  border: 1px solid var(--nx-color-foreground, #0f172a);
  background: var(--nx-color-background, #fff);
  color: inherit;
}
.nx-magazine-subscribe-form input[type="email"]:focus {
  outline: 2px solid var(--nx-color-foreground, #0f172a);
  outline-offset: -1px;
  border-color: var(--nx-color-foreground, #0f172a);
}
.nx-magazine-subscribe-form button {
  padding: 0.55rem 0.75rem;
  font: inherit;
  font-size: 0.7rem;
  text-transform: uppercase;
  letter-spacing: 0.18em;
  font-weight: 700;
  background: var(--nx-color-foreground, #0f172a);
  color: var(--nx-color-background, #fff);
  border: 1px solid var(--nx-color-foreground, #0f172a);
  cursor: pointer;
}
.nx-magazine-subscribe-form button:disabled {
  opacity: 0.6;
  cursor: progress;
}
.nx-magazine-subscribe-success,
.nx-magazine-subscribe-error {
  margin: 0;
  font-size: 0.85rem;
  font-style: italic;
}
.nx-magazine-subscribe-error {
  color: var(--nx-color-destructive, #b91c1c);
}

/* ----------------------------------------------------------------
 * Page templates
 * --------------------------------------------------------------- */
.nx-page.nx-magazine-default {
  max-width: 720px;
  margin: 0 auto;
  padding: 2.5rem 1.5rem 4rem;
  font-size: 1.0625rem;
  line-height: 1.8;
}
.nx-magazine-cover {
  margin: 0;
  padding: 0;
}
.nx-magazine-cover-hero {
  position: relative;
  aspect-ratio: 21 / 9;
  background: var(--nx-color-muted, #1e293b);
  background-size: cover;
  background-position: center;
  display: flex;
  align-items: flex-end;
  padding: 2.5rem;
}
.nx-magazine-cover-title {
  margin: 0;
  color: #fff;
  font-family: var(--nx-font-heading, "Fraunces", Georgia, serif);
  font-size: clamp(2.25rem, 5vw, 4rem);
  font-weight: 700;
  text-shadow: 0 2px 16px rgba(0, 0, 0, 0.45);
  max-width: 28ch;
}
.nx-magazine-cover-body {
  max-width: 720px;
  margin: 2.5rem auto 4rem;
  padding: 0 1.5rem;
  font-size: 1.0625rem;
  line-height: 1.8;
}

/* ----------------------------------------------------------------
 * Feature post (existing)
 * --------------------------------------------------------------- */
.nx-magazine-feature {
  max-width: 720px;
  margin: 0 auto;
  padding: 3rem 1.5rem 4rem;
}
.nx-magazine-feature-kicker {
  text-transform: uppercase;
  letter-spacing: 0.22em;
  font-size: 0.75rem;
  color: var(--nx-color-muted-foreground, #64748b);
  margin: 0 0 0.75rem;
}
.nx-magazine-feature-title {
  font-family: var(--nx-font-heading, "Fraunces", Georgia, serif);
  font-size: clamp(2rem, 4.5vw, 3.5rem);
  font-weight: 700;
  line-height: 1.1;
  margin: 0 0 1rem;
  letter-spacing: -0.01em;
}
.nx-magazine-feature-byline {
  border-top: 1px solid var(--nx-color-border, #cbd5e1);
  border-bottom: 1px solid var(--nx-color-border, #cbd5e1);
  padding: 0.75rem 0;
  margin: 1.5rem 0 2rem;
  font-style: italic;
  color: var(--nx-color-muted-foreground, #64748b);
}
.nx-magazine-feature-body {
  font-size: 1.0625rem;
  line-height: 1.8;
}
.nx-magazine-feature-body > p:first-of-type::first-letter {
  font-family: var(--nx-font-heading, "Fraunces", Georgia, serif);
  float: inline-start;
  font-size: 4rem;
  line-height: 0.85;
  margin-block: 0.4rem 0;
  margin-inline: 0 0.6rem;
  font-weight: 700;
  color: var(--nx-color-accent, #0f766e);
}

/* ----------------------------------------------------------------
 * Index / archive
 * --------------------------------------------------------------- */
.nx-magazine-index {
  max-width: 1100px;
  margin: 0 auto;
  padding: 3rem 1.5rem 4rem;
}
.nx-magazine-index-header {
  text-align: center;
  margin-bottom: 2.5rem;
  border-bottom: 1px solid var(--nx-color-border, #e5e7eb);
  padding-bottom: 1.5rem;
}
.nx-magazine-index-header h1 {
  font-family: var(--nx-font-heading, "Fraunces", Georgia, serif);
  font-size: clamp(2rem, 4vw, 2.75rem);
  margin: 0 0 0.5rem;
  font-weight: 700;
}
.nx-magazine-index-intro {
  margin: 0 auto;
  max-width: 38rem;
  font-style: italic;
  color: var(--nx-color-muted-foreground, #64748b);
  line-height: 1.6;
}
.nx-magazine-index-empty header {
  text-align: center;
  padding: 4rem 1.5rem;
  color: var(--nx-color-muted-foreground, #64748b);
}
.nx-magazine-index-lead {
  margin-bottom: 2.5rem;
}
.nx-magazine-index-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 2rem;
  border-top: 1px solid var(--nx-color-border, #e5e7eb);
  padding-top: 2rem;
  margin-bottom: 3rem;
}
@media (max-width: 768px) {
  .nx-magazine-index-row { grid-template-columns: 1fr; }
}
.nx-magazine-index-archive-heading {
  font-family: var(--nx-font-body, "Source Serif 4", Georgia, serif);
  font-size: 0.75rem;
  text-transform: uppercase;
  letter-spacing: 0.22em;
  color: var(--nx-color-muted-foreground, #64748b);
  border-bottom: 1px solid var(--nx-color-foreground, #0f172a);
  padding-bottom: 0.5rem;
  margin: 0 0 1.5rem;
}
.nx-magazine-index-archive {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(18rem, 1fr));
  gap: 1.5rem;
}

/* ----------------------------------------------------------------
 * Magazine post cards
 * --------------------------------------------------------------- */
.nx-magazine-card-link {
  display: block;
  text-decoration: none;
  color: inherit;
}
.nx-magazine-card-feature .nx-magazine-card-link {
  display: grid;
  grid-template-columns: minmax(0, 1.1fr) minmax(0, 1fr);
  gap: 2rem;
  align-items: center;
}
@media (max-width: 768px) {
  .nx-magazine-card-feature .nx-magazine-card-link {
    grid-template-columns: 1fr;
  }
}
.nx-magazine-card-cover {
  margin: 0;
  aspect-ratio: 16 / 10;
  overflow: hidden;
  background: var(--nx-color-muted, #f1f5f9);
}
.nx-magazine-card-cover img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.nx-magazine-card-feature .nx-magazine-card-cover {
  aspect-ratio: 4 / 3;
}
.nx-magazine-card-grid .nx-magazine-card-cover,
.nx-magazine-card-list .nx-magazine-card-cover {
  aspect-ratio: 16 / 9;
}
.nx-magazine-card-body {
  padding: 1rem 0;
}
.nx-magazine-card-feature .nx-magazine-card-body {
  padding: 0;
}
.nx-magazine-card-kicker {
  margin: 0 0 0.4rem;
  font-size: 0.7rem;
  text-transform: uppercase;
  letter-spacing: 0.18em;
  font-weight: 600;
  color: var(--nx-color-accent, #0f766e);
}
.nx-magazine-card-title {
  font-family: var(--nx-font-heading, "Fraunces", Georgia, serif);
  font-weight: 700;
  letter-spacing: -0.01em;
  line-height: 1.15;
  margin: 0 0 0.5rem;
  font-size: 1.4rem;
}
.nx-magazine-card-feature .nx-magazine-card-title {
  font-size: clamp(1.85rem, 3vw, 2.5rem);
  line-height: 1.05;
}
.nx-magazine-card-list .nx-magazine-card-title {
  font-size: 1.65rem;
}
.nx-magazine-card-excerpt {
  margin: 0;
  font-size: 1rem;
  color: var(--nx-color-muted-foreground, #64748b);
  line-height: 1.55;
  font-style: italic;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.nx-magazine-card-meta {
  margin: 0.85rem 0 0;
  font-size: 0.75rem;
  text-transform: uppercase;
  letter-spacing: 0.16em;
  color: var(--nx-color-muted-foreground, #64748b);
}
`.trim();
