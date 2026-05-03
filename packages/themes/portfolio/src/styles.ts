/**
 * Theme-owned CSS for `@nexpress/theme-portfolio`. Dark surface,
 * visual-first layouts, scoped under `.nx-portfolio-*` so swapping
 * themes never leaves residue. The framework injects this string
 * as a `<style data-nx-theme="portfolio">` tag at SSR time.
 */
export const portfolioCss = `
.nx-portfolio {
  background: #0b0b0c;
  color: #e7e7e7;
  min-height: 100vh;
  font-family: var(--nx-font-body, "Inter", system-ui, sans-serif);
}
.nx-portfolio a { color: inherit; }
.nx-portfolio ::selection {
  background: #fff;
  color: #0b0b0c;
}

/* ----------------------------------------------------------------
 * Header
 * --------------------------------------------------------------- */
.nx-portfolio-header {
  background: rgba(11, 11, 12, 0.85);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 1rem 2rem;
  position: sticky;
  top: 0;
  z-index: 30;
  gap: 1rem;
}
.nx-portfolio-logo {
  font-weight: 600;
  letter-spacing: 0.02em;
  text-decoration: none;
  font-size: 0.95rem;
}
.nx-portfolio-nav {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  gap: 1.5rem;
  font-size: 0.875rem;
}
.nx-portfolio-nav a {
  text-decoration: none;
  opacity: 0.75;
  transition: opacity 0.15s ease;
}
.nx-portfolio-nav a:hover { opacity: 1; }

/* Mobile drawer */
.nx-portfolio-nav-toggle {
  display: none;
  align-items: center;
  justify-content: center;
  padding: 0.4rem 0.85rem;
  border: 1px solid rgba(255, 255, 255, 0.2);
  border-radius: 999px;
  background: transparent;
  color: inherit;
  font: inherit;
  font-size: 0.75rem;
  letter-spacing: 0.06em;
  cursor: pointer;
}
.nx-portfolio-nav-toggle:hover {
  border-color: rgba(255, 255, 255, 0.5);
}
.nx-portfolio-nav-drawer {
  position: fixed;
  inset: 0;
  background: rgba(11, 11, 12, 0.95);
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
.nx-portfolio-nav-drawer[data-open="true"] {
  opacity: 1;
  visibility: visible;
}
.nx-portfolio-nav-drawer-list {
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
.nx-portfolio-nav-drawer-list a {
  color: inherit;
  text-decoration: none;
  opacity: 0.85;
  transition: opacity 0.15s ease;
}
.nx-portfolio-nav-drawer-list a:hover { opacity: 1; }

@media (max-width: 720px) {
  .nx-portfolio-nav-desktop { display: none; }
  .nx-portfolio-nav-toggle { display: inline-flex; }
}
@media (min-width: 721px) {
  .nx-portfolio-nav-drawer { display: none; }
}

/* ----------------------------------------------------------------
 * Footer
 * --------------------------------------------------------------- */
.nx-portfolio-footer {
  border-top: 1px solid rgba(255, 255, 255, 0.08);
  margin-top: 6rem;
  background: transparent;
  text-align: center;
}
.nx-portfolio-footer-inner {
  max-width: 960px;
  margin: 0 auto;
  padding: 2.5rem 1.5rem;
  display: flex;
  flex-direction: column;
  gap: 1rem;
  align-items: center;
}
.nx-portfolio-footer-contact { font-size: 1.05rem; }
.nx-portfolio-footer-email {
  text-decoration: none;
  letter-spacing: 0.02em;
  border-bottom: 1px solid rgba(255, 255, 255, 0.4);
  padding-bottom: 0.15rem;
}
.nx-portfolio-footer-email:hover {
  border-bottom-color: rgba(255, 255, 255, 0.85);
}
.nx-portfolio-footer-social {
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
.nx-portfolio-footer-social a {
  text-decoration: none;
  opacity: 0.65;
  transition: opacity 0.15s ease;
}
.nx-portfolio-footer-social a:hover { opacity: 1; }
.nx-portfolio-footer-mark {
  margin: 0;
  font-size: 0.78rem;
  opacity: 0.5;
  letter-spacing: 0.06em;
}

/* ----------------------------------------------------------------
 * Page templates
 * --------------------------------------------------------------- */
.nx-portfolio-page {
  max-width: 720px;
  margin: 0 auto;
  padding: 4rem 1.5rem;
  line-height: 1.7;
}
.nx-portfolio-page h1,
.nx-portfolio-page h2,
.nx-portfolio-page h3 { letter-spacing: -0.01em; }

.nx-portfolio-gallery {
  max-width: 1280px;
  margin: 0 auto;
  padding: 3rem 1.5rem 4rem;
}
.nx-portfolio-gallery > h1 {
  text-align: center;
  font-size: clamp(2rem, 4vw, 3.5rem);
  margin: 0 0 2.5rem;
  letter-spacing: -0.02em;
}
.nx-portfolio-gallery-grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: 1.5rem;
}
@media (min-width: 720px) {
  .nx-portfolio-gallery-grid { grid-template-columns: 1fr 1fr; }
}
.nx-portfolio-gallery-grid img {
  width: 100%;
  height: auto;
  display: block;
  border-radius: 8px;
}

/* ----------------------------------------------------------------
 * Project index (grid of cards)
 * --------------------------------------------------------------- */
.nx-portfolio-index {
  max-width: 1320px;
  margin: 0 auto;
  padding: 3.5rem 1.5rem 4rem;
}
.nx-portfolio-index-header {
  text-align: center;
  margin-bottom: 3rem;
}
.nx-portfolio-index-header h1 {
  font-size: clamp(2.25rem, 4vw, 3rem);
  letter-spacing: -0.02em;
  margin: 0 0 0.65rem;
  font-weight: 600;
}
.nx-portfolio-index-header p {
  margin: 0 auto;
  max-width: 38rem;
  opacity: 0.75;
  line-height: 1.6;
}
.nx-portfolio-index-empty {
  text-align: center;
  padding: 4rem 1.5rem;
  opacity: 0.6;
}
.nx-portfolio-index-grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: 1.5rem;
}
@media (min-width: 640px) {
  .nx-portfolio-index-grid { grid-template-columns: repeat(2, 1fr); }
}
@media (min-width: 1024px) {
  .nx-portfolio-index-grid { grid-template-columns: repeat(3, 1fr); }
}

/* ----------------------------------------------------------------
 * Project card
 * --------------------------------------------------------------- */
.nx-portfolio-project-card {
  display: block;
  text-decoration: none;
  color: inherit;
  position: relative;
  overflow: hidden;
  border-radius: 4px;
  background: #181818;
}
.nx-portfolio-project-cover {
  margin: 0;
  position: relative;
  aspect-ratio: 4 / 3;
  overflow: hidden;
}
.nx-portfolio-project-cover img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
  transition: transform 0.5s ease;
}
.nx-portfolio-project-card:hover .nx-portfolio-project-cover img {
  transform: scale(1.04);
}
.nx-portfolio-project-placeholder {
  display: block;
  width: 100%;
  height: 100%;
  background: linear-gradient(135deg, #1f1f22 0%, #2a2a2d 100%);
}
.nx-portfolio-project-caption {
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
.nx-portfolio-project-card:hover .nx-portfolio-project-caption {
  opacity: 1;
  transform: translateY(0);
}
.nx-portfolio-project-title {
  font-weight: 600;
  letter-spacing: 0.01em;
  font-size: 1rem;
}
.nx-portfolio-project-category {
  font-size: 0.72rem;
  text-transform: uppercase;
  letter-spacing: 0.16em;
  opacity: 0.8;
}

/* ----------------------------------------------------------------
 * Project detail
 * --------------------------------------------------------------- */
.nx-portfolio-project-detail {
  margin: 0;
  padding: 0 0 4rem;
}
.nx-portfolio-project-hero {
  margin: 0;
  width: 100%;
  aspect-ratio: 21 / 9;
  overflow: hidden;
  background: #1a1a1c;
}
.nx-portfolio-project-hero img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.nx-portfolio-project-header {
  max-width: 760px;
  margin: 0 auto;
  padding: 3rem 1.5rem 2rem;
  text-align: center;
}
.nx-portfolio-project-header h1 {
  font-size: clamp(2rem, 4vw, 3rem);
  letter-spacing: -0.02em;
  margin: 0 0 0.85rem;
  font-weight: 600;
}
.nx-portfolio-project-excerpt {
  margin: 0 auto;
  max-width: 38rem;
  opacity: 0.75;
  font-size: 1.075rem;
  line-height: 1.55;
}
.nx-portfolio-project-meta {
  margin: 2rem auto 0;
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(8rem, max-content));
  justify-content: center;
  gap: 0 2rem;
  font-size: 0.85rem;
  text-align: start;
}
.nx-portfolio-project-meta dt {
  text-transform: uppercase;
  letter-spacing: 0.16em;
  font-size: 0.7rem;
  opacity: 0.55;
  margin-bottom: 0.2rem;
}
.nx-portfolio-project-meta dd {
  margin: 0 0 0.75rem;
  font-weight: 500;
}
.nx-portfolio-project-body {
  max-width: 720px;
  margin: 0 auto;
  padding: 0 1.5rem;
  font-size: 1.05rem;
  line-height: 1.7;
  opacity: 0.92;
}
.nx-portfolio-project-body img {
  max-width: 100%;
  height: auto;
  border-radius: 6px;
  margin: 1.5rem 0;
}

/* Re-cast the .nx-page baseline so its dark variant carries
   the right link / muted colors without having to touch
   admin-edited tokens. */
.nx-portfolio .nx-page a {
  color: #93c5fd;
}
`.trim();
