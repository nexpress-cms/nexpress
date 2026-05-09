/**
 * Theme-owned CSS for `@nexpress/theme-portfolio`. Reads from the
 * theme token system (background / foreground / primary / card /
 * muted) so admin token overrides reflow the whole shell. The
 * dark surface ships via `impl.tokens` in `index.ts`; that's the
 * single point of truth, this CSS just consumes it. Scoped under
 * `.np-portfolio-*` so swapping themes never leaves residue.
 *
 * Decorative dividers stay as `rgba(255, 255, 255, …)` since they're
 * tied to the dark assumption — flipping to a light palette is an
 * intentional fork that needs a fresh divider color anyway.
 */
export const portfolioCss = `
.np-portfolio {
  background: var(--np-color-background);
  color: var(--np-color-foreground);
  min-height: 100vh;
  font-family: var(--np-font-body, "Inter", system-ui, sans-serif);
}
.np-portfolio a { color: inherit; }
.np-portfolio ::selection {
  background: var(--np-color-primary);
  color: var(--np-color-primary-foreground);
}

/* ----------------------------------------------------------------
 * Header
 * --------------------------------------------------------------- */
.np-portfolio-header {
  background: color-mix(in oklab, var(--np-color-background) 85%, transparent);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  border-bottom: 1px solid color-mix(in oklab, var(--np-color-foreground) 8%, transparent);
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 1rem 2rem;
  position: sticky;
  top: 0;
  z-index: 30;
  gap: 1rem;
}
.np-portfolio-logo {
  font-weight: 600;
  letter-spacing: 0.02em;
  text-decoration: none;
  font-size: 0.95rem;
}
.np-portfolio-nav {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  gap: 1.5rem;
  font-size: 0.875rem;
}
.np-portfolio-nav a {
  text-decoration: none;
  opacity: 0.75;
  transition: opacity 0.15s ease;
}
.np-portfolio-nav a:hover { opacity: 1; }
.np-portfolio-nav-item {
  position: relative;
}
.np-portfolio-subnav {
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
.np-portfolio-nav-item:hover > .np-portfolio-subnav,
.np-portfolio-nav-item:focus-within > .np-portfolio-subnav {
  display: block;
}
.np-portfolio-subnav a {
  display: block;
  padding: 0.4rem 1rem;
  font-size: 0.875rem;
}
.np-portfolio-mobile-subnav {
  list-style: none;
  margin: 0;
  padding-left: 1.25rem;
}

/* Mobile drawer */
.np-portfolio-nav-toggle {
  display: none;
  align-items: center;
  justify-content: center;
  padding: 0.4rem 0.85rem;
  border: 1px solid color-mix(in oklab, var(--np-color-foreground) 20%, transparent);
  border-radius: 999px;
  background: transparent;
  color: inherit;
  font: inherit;
  font-size: 0.75rem;
  letter-spacing: 0.06em;
  cursor: pointer;
}
.np-portfolio-nav-toggle:hover {
  border-color: color-mix(in oklab, var(--np-color-foreground) 50%, transparent);
}
.np-portfolio-nav-drawer {
  position: fixed;
  inset: 0;
  background: color-mix(in oklab, var(--np-color-background) 95%, transparent);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  z-index: 50;
  display: flex;
  align-items: center;
  justify-content: center;
  opacity: 0;
  visibility: hidden;
  transition: opacity 0.25s ease, visibility 0.25s ease;
}
.np-portfolio-nav-drawer[data-open="true"] {
  opacity: 1;
  visibility: visible;
}
.np-portfolio-nav-drawer-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
  text-align: center;
  font-size: clamp(1.4rem, 3vw, 2rem);
  font-weight: 500;
  letter-spacing: -0.01em;
}
.np-portfolio-nav-drawer-list a {
  color: inherit;
  text-decoration: none;
  opacity: 0.85;
  transition: opacity 0.15s ease;
}
.np-portfolio-nav-drawer-list a:hover { opacity: 1; }

@media (max-width: 720px) {
  .np-portfolio-nav-desktop { display: none; }
  .np-portfolio-nav-toggle { display: inline-flex; }
}
@media (min-width: 721px) {
  .np-portfolio-nav-drawer { display: none; }
}

/* ----------------------------------------------------------------
 * Footer
 * --------------------------------------------------------------- */
.np-portfolio-footer {
  border-top: 1px solid color-mix(in oklab, var(--np-color-foreground) 8%, transparent);
  margin-top: 6rem;
  background: transparent;
  text-align: center;
}
.np-portfolio-footer-inner {
  max-width: 960px;
  margin: 0 auto;
  padding: 2.5rem 1.5rem;
  display: flex;
  flex-direction: column;
  gap: 1rem;
  align-items: center;
}
.np-portfolio-footer-contact { font-size: 1.05rem; }
.np-portfolio-footer-email {
  text-decoration: none;
  letter-spacing: 0.02em;
  border-bottom: 1px solid color-mix(in oklab, var(--np-color-foreground) 40%, transparent);
  padding-bottom: 0.15rem;
}
.np-portfolio-footer-email:hover {
  border-bottom-color: color-mix(in oklab, var(--np-color-foreground) 85%, transparent);
}
.np-portfolio-footer-social {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 1.5rem;
  font-size: 0.85rem;
  text-transform: uppercase;
  letter-spacing: 0.16em;
}
.np-portfolio-footer-social a {
  text-decoration: none;
  opacity: 0.65;
  transition: opacity 0.15s ease;
}
.np-portfolio-footer-social a:hover { opacity: 1; }
.np-portfolio-footer-mark {
  margin: 0;
  font-size: 0.78rem;
  opacity: 0.5;
  letter-spacing: 0.06em;
}

/* ----------------------------------------------------------------
 * Page templates
 * --------------------------------------------------------------- */
.np-portfolio-page {
  max-width: 720px;
  margin: 0 auto;
  padding: 4rem 1.5rem;
  line-height: 1.7;
}
.np-portfolio-page h1,
.np-portfolio-page h2,
.np-portfolio-page h3 { letter-spacing: -0.01em; }

.np-portfolio-gallery {
  max-width: 1280px;
  margin: 0 auto;
  padding: 3rem 1.5rem 4rem;
}
.np-portfolio-gallery > h1 {
  text-align: center;
  font-size: clamp(2rem, 4vw, 3.5rem);
  margin: 0 0 2.5rem;
  letter-spacing: -0.02em;
}
.np-portfolio-gallery-grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: 1.5rem;
}
@media (min-width: 720px) {
  .np-portfolio-gallery-grid { grid-template-columns: 1fr 1fr; }
}
.np-portfolio-gallery-grid img {
  width: 100%;
  height: auto;
  display: block;
  border-radius: 8px;
}

/* ----------------------------------------------------------------
 * Project index (grid of cards)
 * --------------------------------------------------------------- */
.np-portfolio-index {
  max-width: 1320px;
  margin: 0 auto;
  padding: 3.5rem 1.5rem 4rem;
}
.np-portfolio-index-header {
  text-align: center;
  margin-bottom: 3rem;
}
.np-portfolio-index-header h1 {
  font-size: clamp(2.25rem, 4vw, 3rem);
  letter-spacing: -0.02em;
  margin: 0 0 0.65rem;
  font-weight: 600;
}
.np-portfolio-index-header p {
  margin: 0 auto;
  max-width: 38rem;
  opacity: 0.75;
  line-height: 1.6;
}
.np-portfolio-index-empty {
  text-align: center;
  padding: 4rem 1.5rem;
  opacity: 0.6;
}
.np-portfolio-index-grid {
  /* Phase F.9.1-A — operator's settings.gridColumns
   * sets --np-portfolio-grid-cols on this element via the
   * project-index template. Mobile clamps to 1 column
   * regardless; tablet caps at min(2, --np-portfolio-grid-cols);
   * desktop honors the operator's choice up to 6. Operator
   * stays in control without breaking responsive design.
   */
  --np-portfolio-grid-cols: 3;
  --np-portfolio-grid-gutter: 1.5rem;
  display: grid;
  grid-template-columns: 1fr;
  gap: var(--np-portfolio-grid-gutter);
}
@media (min-width: 640px) {
  .np-portfolio-index-grid {
    grid-template-columns: repeat(min(2, var(--np-portfolio-grid-cols, 3)), 1fr);
  }
}
@media (min-width: 1024px) {
  .np-portfolio-index-grid {
    grid-template-columns: repeat(var(--np-portfolio-grid-cols, 3), 1fr);
  }
}

/* ----------------------------------------------------------------
 * Project card
 * --------------------------------------------------------------- */
.np-portfolio-project-card {
  display: block;
  text-decoration: none;
  color: inherit;
  position: relative;
  overflow: hidden;
  border-radius: 4px;
  background: var(--np-color-card);
}
.np-portfolio-project-cover {
  margin: 0;
  position: relative;
  /* Phase F.9.1-B — operator-tunable aspect via shell-set
   * --np-portfolio-card-aspect (square / portrait / landscape /
   * golden). Falls back to 4/3 when the variable isn't set. */
  aspect-ratio: var(--np-portfolio-card-aspect, 4 / 3);
  overflow: hidden;
}
.np-portfolio-project-cover img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
  transition: transform 0.5s ease, filter 0.4s ease;
}
/* Phase F.9.1-B — hoverStyle variants. Selected via the shell's
 * data-hover-style attribute. Default ("fade") = caption fades in
 * + image scale; the others swap the image effect.
 *  - scale: only the image zooms (caption stays subtle)
 *  - slide: image stays put; caption slides up from below
 *  - lift: card lifts with shadow; image static
 */
.np-portfolio[data-hover-style="fade"] .np-portfolio-project-card:hover .np-portfolio-project-cover img,
.np-portfolio[data-hover-style="scale"] .np-portfolio-project-card:hover .np-portfolio-project-cover img {
  transform: scale(1.04);
}
.np-portfolio[data-hover-style="lift"] .np-portfolio-project-card {
  transition: transform 0.3s ease, box-shadow 0.3s ease;
}
.np-portfolio[data-hover-style="lift"] .np-portfolio-project-card:hover {
  transform: translateY(-4px);
  box-shadow: 0 12px 28px rgba(0, 0, 0, 0.35);
}
.np-portfolio[data-hover-style="slide"] .np-portfolio-project-caption {
  /* Slide-up reveal — caption starts further below + opacity 0 */
  transform: translateY(24px);
}
.np-portfolio-project-placeholder {
  display: block;
  width: 100%;
  height: 100%;
  background: linear-gradient(
    135deg,
    var(--np-color-muted) 0%,
    var(--np-color-accent) 100%
  );
}
.np-portfolio-project-caption {
  position: absolute;
  inset: auto 0 0 0;
  padding: 1rem 1.25rem;
  background: linear-gradient(to top, rgba(0, 0, 0, 0.85) 0%, transparent 100%);
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  opacity: 0;
  transform: translateY(8px);
  transition: opacity 0.25s ease, transform 0.25s ease;
}
.np-portfolio-project-card:hover .np-portfolio-project-caption {
  opacity: 1;
  transform: translateY(0);
}
.np-portfolio-project-title {
  font-weight: 600;
  letter-spacing: 0.01em;
  font-size: 1rem;
}
.np-portfolio-project-category {
  font-size: 0.72rem;
  text-transform: uppercase;
  letter-spacing: 0.16em;
  opacity: 0.8;
}

/* ----------------------------------------------------------------
 * Project detail
 * --------------------------------------------------------------- */
.np-portfolio-project-detail {
  margin: 0;
  padding: 0 0 4rem;
}
.np-portfolio-project-hero {
  margin: 0;
  width: 100%;
  aspect-ratio: 21 / 9;
  overflow: hidden;
  background: var(--np-color-card);
}
.np-portfolio-project-hero img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.np-portfolio-project-header {
  max-width: 760px;
  margin: 0 auto;
  padding: 3rem 1.5rem 2rem;
  text-align: center;
}
.np-portfolio-project-header h1 {
  font-size: clamp(2rem, 4vw, 3rem);
  letter-spacing: -0.02em;
  margin: 0 0 0.85rem;
  font-weight: 600;
}
.np-portfolio-project-excerpt {
  margin: 0 auto;
  max-width: 38rem;
  opacity: 0.75;
  font-size: 1.075rem;
  line-height: 1.55;
}
.np-portfolio-project-meta {
  margin: 2rem auto 0;
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(8rem, max-content));
  justify-content: center;
  gap: 0 2rem;
  font-size: 0.85rem;
  text-align: start;
}
.np-portfolio-project-meta dt {
  text-transform: uppercase;
  letter-spacing: 0.16em;
  font-size: 0.7rem;
  opacity: 0.55;
  margin-bottom: 0.2rem;
}
.np-portfolio-project-meta dd {
  margin: 0 0 0.75rem;
  font-weight: 500;
}
.np-portfolio-project-body {
  max-width: 720px;
  margin: 0 auto;
  padding: 0 1.5rem;
  font-size: 1.05rem;
  line-height: 1.7;
  opacity: 0.92;
}
.np-portfolio-project-body img {
  max-width: 100%;
  height: auto;
  border-radius: 6px;
  margin: 1.5rem 0;
}

/* Re-cast the .np-page baseline so links pick up the theme's
   primary token. Dark theme: primary is light-on-dark, so the
   link reads correctly. */
.np-portfolio .np-page a {
  color: var(--np-color-primary);
}
`.trim();
