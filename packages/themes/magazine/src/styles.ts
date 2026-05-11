/**
 * Theme-owned CSS for `@nexpress/theme-magazine`. Scoped under
 * `.np-magazine-*` so swapping back to a different theme doesn't
 * leave residue. The framework injects this string as a
 * `<style data-np-theme="magazine">` tag at SSR time.
 */
export const magazineCss = `
.np-magazine {
  font-family: var(--np-font-body, "Source Serif 4", Georgia, serif);
}

/* ----------------------------------------------------------------
 * Masthead
 * --------------------------------------------------------------- */
.np-magazine-header {
  background: var(--np-color-background, #fff);
  border-bottom: 4px double var(--np-color-foreground, #0f172a);
  padding: 2rem 1.5rem 1rem;
  text-align: center;
  position: relative;
}
.np-magazine-masthead {
  max-width: 960px;
  margin: 0 auto 0.75rem;
}
.np-magazine-dateline {
  font-family: var(--np-font-body, "Source Serif 4", Georgia, serif);
  font-size: 0.7rem;
  text-transform: uppercase;
  letter-spacing: 0.18em;
  color: var(--np-color-muted-foreground, #64748b);
  margin: 0 0 0.5rem;
}
.np-magazine-logo {
  font-family: var(--np-font-heading, "Fraunces", Georgia, serif);
  font-size: clamp(2rem, 4vw, 3rem);
  font-weight: 800;
  letter-spacing: -0.01em;
  color: inherit;
  text-decoration: none;
  display: block;
}
.np-magazine-tagline {
  margin: 0.35rem 0 0;
  font-style: italic;
  color: var(--np-color-muted-foreground, #64748b);
  font-size: 0.95rem;
}
.np-magazine-sections > ul {
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
.np-magazine-sections a {
  color: inherit;
  text-decoration: none;
  border-bottom: 1px solid transparent;
  padding-bottom: 0.15rem;
  transition: border-color 0.15s ease;
}
.np-magazine-sections a:hover {
  border-bottom-color: currentColor;
}
.np-magazine-nav-item {
  position: relative;
}
.np-magazine-subnav {
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
.np-magazine-nav-item:hover > .np-magazine-subnav,
.np-magazine-nav-item:focus-within > .np-magazine-subnav {
  display: block;
}
.np-magazine-subnav a {
  display: block;
  padding: 0.4rem 1rem;
  font-size: 0.875rem;
  border-bottom: 0;
}
.np-magazine-mobile-subnav,
.np-magazine-footer-subnav {
  list-style: none;
  margin: 0;
  padding-inline-start: 1.25rem;
}
.np-magazine-footer-subnav a {
  font-size: 0.85rem;
  opacity: 0.85;
}

/* Mobile drawer */
.np-magazine-nav-toggle {
  display: none;
  position: absolute;
  top: 1.25rem;
  inset-inline-end: 1.25rem;
  padding: 0.4rem 0.75rem;
  border: 1px solid var(--np-color-foreground, #0f172a);
  border-radius: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  font-size: 0.7rem;
  text-transform: uppercase;
  letter-spacing: 0.18em;
  cursor: pointer;
}
.np-magazine-nav-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.45);
  z-index: 40;
}
.np-magazine-nav-drawer {
  position: fixed;
  top: 0;
  inset-inline-start: 0;
  inset-inline-end: 0;
  background: var(--np-color-background, #fff);
  border-bottom: 4px double var(--np-color-foreground, #0f172a);
  z-index: 50;
  transform: translateY(-100%);
  transition: transform 0.25s ease;
}
.np-magazine-nav-drawer[data-open="true"] {
  transform: translateY(0);
}
.np-magazine-nav-drawer-list {
  list-style: none;
  margin: 0;
  padding: 1.5rem;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  font-family: var(--np-font-heading, "Fraunces", Georgia, serif);
  font-size: 1.25rem;
  text-align: center;
}
.np-magazine-nav-drawer-list a {
  color: inherit;
  text-decoration: none;
}
@media (max-width: 768px) {
  .np-magazine-sections {
    display: none;
  }
  .np-magazine-nav-toggle {
    display: inline-flex;
  }
}
@media (min-width: 769px) {
  .np-magazine-nav-drawer,
  .np-magazine-nav-overlay {
    display: none;
  }
}

/* ----------------------------------------------------------------
 * Footer — three columns + colophon
 * --------------------------------------------------------------- */
.np-magazine-footer {
  margin-top: 5rem;
  padding: 3.5rem 1.5rem 2.5rem;
  border-top: 4px double var(--np-color-foreground, #0f172a);
  background: var(--np-color-muted, #f8fafc);
}
.np-magazine-footer-grid {
  max-width: 1100px;
  margin: 0 auto;
  display: grid;
  grid-template-columns: 1.3fr 1fr 1fr;
  gap: 3rem;
  align-items: start;
}
@media (max-width: 720px) {
  .np-magazine-footer-grid {
    grid-template-columns: 1fr;
    gap: 2.5rem;
  }
}
.np-magazine-footer-col { min-width: 0; }
.np-magazine-footer-heading {
  font-family: var(--np-font-body, "Source Serif 4", Georgia, serif);
  font-size: 0.7rem;
  text-transform: uppercase;
  letter-spacing: 0.18em;
  color: var(--np-color-muted-foreground, #64748b);
  margin: 0 0 0.85rem;
  font-weight: 700;
}
.np-magazine-footer-blurb {
  margin: 0 0 0.85rem;
  font-size: 0.95rem;
  line-height: 1.55;
  color: var(--np-color-muted-foreground, #64748b);
}
.np-magazine-footer-nav {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.55rem;
  font-family: var(--np-font-heading, "Fraunces", Georgia, serif);
  font-size: 1.05rem;
}
.np-magazine-footer-nav a {
  color: inherit;
  text-decoration: none;
  border-bottom: 1px solid transparent;
  transition: border-color 0.15s ease;
}
.np-magazine-footer-nav a:hover {
  border-bottom-color: currentColor;
}
.np-magazine-footer-mark {
  font-family: var(--np-font-heading, "Fraunces", Georgia, serif);
  font-size: 1.5rem;
  font-weight: 800;
  letter-spacing: -0.01em;
  margin: 0 0 0.35rem;
}
.np-magazine-footer-meta {
  margin: 0;
  font-size: 0.85rem;
  font-style: italic;
  color: var(--np-color-muted-foreground, #64748b);
  line-height: 1.6;
}
.np-magazine-subscribe-form {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  font-family: var(--np-font-body, "Source Serif 4", Georgia, serif);
}
.np-magazine-subscribe-form input[type="email"] {
  padding: 0.55rem 0.75rem;
  font: inherit;
  font-size: 0.95rem;
  border: 1px solid var(--np-color-foreground, #0f172a);
  background: var(--np-color-background, #fff);
  color: inherit;
}
.np-magazine-subscribe-form input[type="email"]:focus {
  outline: 2px solid var(--np-color-foreground, #0f172a);
  outline-offset: -1px;
  border-color: var(--np-color-foreground, #0f172a);
}
.np-magazine-subscribe-form button {
  padding: 0.55rem 0.75rem;
  font: inherit;
  font-size: 0.7rem;
  text-transform: uppercase;
  letter-spacing: 0.18em;
  font-weight: 700;
  background: var(--np-color-foreground, #0f172a);
  color: var(--np-color-background, #fff);
  border: 1px solid var(--np-color-foreground, #0f172a);
  cursor: pointer;
}
.np-magazine-subscribe-form button:disabled {
  opacity: 0.6;
  cursor: progress;
}
.np-magazine-subscribe-success,
.np-magazine-subscribe-error {
  margin: 0;
  font-size: 0.85rem;
  font-style: italic;
}
.np-magazine-subscribe-error {
  color: var(--np-color-destructive, #b91c1c);
}

/* ----------------------------------------------------------------
 * Page templates
 * --------------------------------------------------------------- */
.np-page.np-magazine-default {
  max-width: 720px;
  margin: 0 auto;
  padding: 2.5rem 1.5rem 4rem;
  font-size: 1.0625rem;
  line-height: 1.8;
}
.np-magazine-cover {
  margin: 0;
  padding: 0;
}
.np-magazine-cover-hero {
  position: relative;
  aspect-ratio: 21 / 9;
  background: var(--np-color-muted, #1e293b);
  background-size: cover;
  background-position: center;
  display: flex;
  align-items: flex-end;
  padding: 2.5rem;
}
.np-magazine-cover-title {
  margin: 0;
  color: #fff;
  font-family: var(--np-font-heading, "Fraunces", Georgia, serif);
  font-size: clamp(2.25rem, 5vw, 4rem);
  font-weight: 700;
  text-shadow: 0 2px 16px rgba(0, 0, 0, 0.45);
  max-width: 28ch;
}
.np-magazine-cover-body {
  max-width: 720px;
  margin: 2.5rem auto 4rem;
  padding: 0 1.5rem;
  font-size: 1.0625rem;
  line-height: 1.8;
}

/* ----------------------------------------------------------------
 * Feature post (existing)
 * --------------------------------------------------------------- */
.np-magazine-feature {
  max-width: 720px;
  margin: 0 auto;
  padding: 3rem 1.5rem 4rem;
}
.np-magazine-feature-kicker {
  text-transform: uppercase;
  letter-spacing: 0.22em;
  font-size: 0.75rem;
  color: var(--np-color-muted-foreground, #64748b);
  margin: 0 0 0.75rem;
}
.np-magazine-feature-title {
  font-family: var(--np-font-heading, "Fraunces", Georgia, serif);
  font-size: clamp(2rem, 4.5vw, 3.5rem);
  font-weight: 700;
  line-height: 1.1;
  margin: 0 0 1rem;
  letter-spacing: -0.01em;
}
.np-magazine-feature-byline {
  border-top: 1px solid var(--np-color-border, #cbd5e1);
  border-bottom: 1px solid var(--np-color-border, #cbd5e1);
  padding: 0.75rem 0;
  margin: 1.5rem 0 2rem;
  font-style: italic;
  color: var(--np-color-muted-foreground, #64748b);
}
.np-magazine-feature-body {
  font-size: 1.0625rem;
  line-height: 1.8;
}
.np-magazine-feature-body > p:first-of-type::first-letter {
  font-family: var(--np-font-heading, "Fraunces", Georgia, serif);
  float: inline-start;
  font-size: 4rem;
  line-height: 0.85;
  margin-block: 0.4rem 0;
  margin-inline: 0 0.6rem;
  font-weight: 700;
  color: var(--np-color-accent, #0f766e);
}

/* ----------------------------------------------------------------
 * Index / archive
 * --------------------------------------------------------------- */
.np-magazine-index {
  max-width: 1100px;
  margin: 0 auto;
  padding: 3rem 1.5rem 4rem;
}
.np-magazine-index-header {
  text-align: center;
  margin-bottom: 2.5rem;
  border-bottom: 1px solid var(--np-color-border, #e5e7eb);
  padding-bottom: 1.5rem;
}
.np-magazine-index-header h1 {
  font-family: var(--np-font-heading, "Fraunces", Georgia, serif);
  font-size: clamp(2rem, 4vw, 2.75rem);
  margin: 0 0 0.5rem;
  font-weight: 700;
}
.np-magazine-index-intro {
  margin: 0 auto;
  max-width: 38rem;
  font-style: italic;
  color: var(--np-color-muted-foreground, #64748b);
  line-height: 1.6;
}
.np-magazine-index-empty header {
  text-align: center;
  padding: 4rem 1.5rem;
  color: var(--np-color-muted-foreground, #64748b);
}
.np-magazine-index-lead {
  margin-bottom: 2.5rem;
}
.np-magazine-index-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 2rem;
  border-top: 1px solid var(--np-color-border, #e5e7eb);
  padding-top: 2rem;
  margin-bottom: 3rem;
}
@media (max-width: 768px) {
  .np-magazine-index-row { grid-template-columns: 1fr; }
}
.np-magazine-index-archive-heading {
  font-family: var(--np-font-body, "Source Serif 4", Georgia, serif);
  font-size: 0.75rem;
  text-transform: uppercase;
  letter-spacing: 0.22em;
  color: var(--np-color-muted-foreground, #64748b);
  border-bottom: 1px solid var(--np-color-foreground, #0f172a);
  padding-bottom: 0.5rem;
  margin: 0 0 1.5rem;
}
.np-magazine-index-archive {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(18rem, 1fr));
  gap: 1.5rem;
}

/* ----------------------------------------------------------------
 * Magazine post cards
 * --------------------------------------------------------------- */
.np-magazine-card-link {
  display: block;
  text-decoration: none;
  color: inherit;
}
.np-magazine-card-feature .np-magazine-card-link {
  display: grid;
  grid-template-columns: minmax(0, 1.1fr) minmax(0, 1fr);
  gap: 2rem;
  align-items: center;
}
@media (max-width: 768px) {
  .np-magazine-card-feature .np-magazine-card-link {
    grid-template-columns: 1fr;
  }
}
.np-magazine-card-cover {
  margin: 0;
  aspect-ratio: 16 / 10;
  overflow: hidden;
  background: var(--np-color-muted, #f1f5f9);
}
.np-magazine-card-cover img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.np-magazine-card-feature .np-magazine-card-cover {
  aspect-ratio: 4 / 3;
}
.np-magazine-card-grid .np-magazine-card-cover,
.np-magazine-card-list .np-magazine-card-cover {
  aspect-ratio: 16 / 9;
}
.np-magazine-card-body {
  padding: 1rem 0;
}
.np-magazine-card-feature .np-magazine-card-body {
  padding: 0;
}
.np-magazine-card-kicker {
  margin: 0 0 0.4rem;
  font-size: 0.7rem;
  text-transform: uppercase;
  letter-spacing: 0.18em;
  font-weight: 600;
  color: var(--np-color-accent, #0f766e);
}
.np-magazine-card-title {
  font-family: var(--np-font-heading, "Fraunces", Georgia, serif);
  font-weight: 700;
  letter-spacing: -0.01em;
  line-height: 1.15;
  margin: 0 0 0.5rem;
  font-size: 1.4rem;
}
.np-magazine-card-feature .np-magazine-card-title {
  font-size: clamp(1.85rem, 3vw, 2.5rem);
  line-height: 1.05;
}
.np-magazine-card-list .np-magazine-card-title {
  font-size: 1.65rem;
}
.np-magazine-card-excerpt {
  margin: 0;
  font-size: 1rem;
  color: var(--np-color-muted-foreground, #64748b);
  line-height: 1.55;
  font-style: italic;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.np-magazine-card-meta {
  margin: 0.85rem 0 0;
  font-size: 0.75rem;
  text-transform: uppercase;
  letter-spacing: 0.16em;
  color: var(--np-color-muted-foreground, #64748b);
}

/* ----------------------------------------------------------------
 * Hero variants (F.9.2). Featured layout uses inline styles in
 * blocks.tsx (background-image-driven hero); carousel and grid
 * variants share a common header treatment defined here. The
 * \`data-hero-style\` attribute on the section element makes
 * variant-specific overrides possible without class explosion.
 * --------------------------------------------------------------- */
.np-magazine-hero-feature[data-hero-style="carousel"],
.np-magazine-hero-feature[data-hero-style="grid"] {
  margin: 2rem 0;
  padding: 1.5rem 0;
  border-top: 3px double var(--np-color-foreground, #0f172a);
  border-bottom: 1px solid var(--np-color-border, #e2e8f0);
}
.np-magazine-hero-header {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  padding: 0 0.5rem 1.25rem;
}
.np-magazine-hero-header h1 {
  font-family: var(--np-font-heading, "Fraunces", Georgia, serif);
  font-size: clamp(1.75rem, 4vw, 2.75rem);
  margin: 0;
  line-height: 1.1;
}
.np-magazine-hero-header p {
  margin: 0;
  font-size: 1.05rem;
  color: var(--np-color-muted-foreground, #64748b);
  max-width: 60ch;
}
.np-magazine-hero-cta {
  align-self: flex-start;
  margin-top: 0.5rem;
  padding: 0.4rem 1rem;
  border-radius: 0.25rem;
  background: var(--np-color-primary, #0f172a);
  color: var(--np-color-primary-foreground, #fff);
  text-decoration: none;
  font-weight: 500;
  font-size: 0.9rem;
}
.np-magazine-hero-empty {
  margin: 0;
  padding: 1.5rem 0.5rem;
  text-align: center;
  font-size: 0.9rem;
  color: var(--np-color-muted-foreground, #64748b);
  font-style: italic;
}
.np-magazine-hero-card-category {
  margin: 0 0 0.25rem;
  font-size: 0.7rem;
  text-transform: uppercase;
  letter-spacing: 0.12em;
  color: var(--np-color-primary, #0f172a);
  font-weight: 600;
}
.np-magazine-hero-carousel-track {
  display: flex;
  gap: 1rem;
  overflow-x: auto;
  scroll-snap-type: x mandatory;
  padding: 0 0.5rem 1rem;
  scrollbar-width: thin;
}
.np-magazine-hero-carousel-card {
  flex: 0 0 280px;
  scroll-snap-align: start;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  background: var(--np-color-card, #fff);
}
.np-magazine-hero-carousel-card img {
  width: 100%;
  aspect-ratio: 4 / 3;
  object-fit: cover;
  border-radius: 0.25rem;
}
.np-magazine-hero-carousel-card h2 {
  margin: 0;
  font-family: var(--np-font-heading, "Fraunces", Georgia, serif);
  font-size: 1.05rem;
  line-height: 1.3;
}
.np-magazine-hero-carousel-card a {
  color: inherit;
  text-decoration: none;
}
.np-magazine-hero-carousel-card a:hover {
  text-decoration: underline;
  text-decoration-color: var(--np-color-primary, #0f172a);
}
.np-magazine-hero-grid-tiles {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 1.25rem;
  padding: 0 0.5rem;
}
@media (min-width: 768px) {
  .np-magazine-hero-grid-tiles {
    grid-template-columns: repeat(3, 1fr);
  }
}
.np-magazine-hero-grid-tile {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}
.np-magazine-hero-grid-tile img {
  width: 100%;
  aspect-ratio: 16 / 10;
  object-fit: cover;
  border-radius: 0.25rem;
}
.np-magazine-hero-grid-tile h2 {
  margin: 0;
  font-family: var(--np-font-heading, "Fraunces", Georgia, serif);
  font-size: 1.1rem;
  line-height: 1.3;
}
.np-magazine-hero-grid-tile a {
  color: inherit;
  text-decoration: none;
}
.np-magazine-hero-grid-tile a:hover {
  text-decoration: underline;
  text-decoration-color: var(--np-color-primary, #0f172a);
}

/* ----------------------------------------------------------------
 * Phase M.ref — member surface (login / register / forgot-password
 * / reset-password / verify / me/notifications).
 *
 * Layout: masthead at top, narrow auth-form column centered, footer
 * at bottom. The (member)/layout.tsx invokes MagazineMembersShell
 * which renders np-magazine-members > np-magazine-members-column
 * around the page body.
 *
 * Token overrides (M.2): inputs go from indigo focus to terracotta,
 * radius 0.25rem (matches the rest of magazine's editorial squareness),
 * borders hairline. The form button picks up magazine's primary
 * (terracotta) automatically via the framework defaults — re-declared
 * here for explicitness.
 * --------------------------------------------------------------- */
.np-magazine .np-magazine-members {
  padding: 3rem 1.5rem 4rem;
  background: var(--np-color-background, #fafaf7);
  min-height: 60vh;
}
.np-magazine-members-column {
  max-width: 420px;
  margin: 0 auto;
}
.np-magazine-members-column h1 {
  font-family: var(--np-font-heading, "Fraunces", Georgia, serif);
  font-size: clamp(1.75rem, 4vw, 2.25rem);
  margin: 0 0 1.5rem;
  text-align: center;
  border-bottom: 1px solid var(--np-color-border, #e2e8f0);
  padding-bottom: 1rem;
}
.np-magazine-members-column .np-members-auth-alt {
  text-align: center;
  font-size: 0.9rem;
  color: var(--np-color-muted-foreground, #64748b);
}
/* Member form token overrides — magazine's editorial squareness
 * (smaller radius, hairline borders, terracotta accent). */
.np-magazine .np-members-form {
  --np-member-form-input-bg: var(--np-color-background, #fafaf7);
  --np-member-form-input-border: var(--np-color-border, #d6cfc4);
  --np-member-form-input-border-focus: var(--np-color-primary, #b75c3a);
  --np-member-form-input-radius: 0.25rem;
  --np-member-form-button-radius: 0.25rem;
}
.np-magazine .np-members-form .np-form-label {
  font-family: var(--np-font-body, "Source Serif 4", Georgia, serif);
  font-size: 0.8125rem;
  text-transform: uppercase;
  letter-spacing: 0.08em;
}
`.trim();
