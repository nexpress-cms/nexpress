/**
 * Theme-owned CSS for `@nexpress/theme-portfolio`. Sets a dark
 * surface across the whole shell and styles the slim header /
 * gallery grid. All selectors scoped under `.nx-portfolio` so
 * the theme can be swapped in/out without leaking.
 */
export const portfolioCss = `
.nx-portfolio {
  background: #0b0b0c;
  color: #e7e7e7;
  min-height: 100vh;
  font-family: var(--nx-font-body, "Inter", system-ui, sans-serif);
}
.nx-portfolio a {
  color: inherit;
}
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
}
.nx-portfolio-logo {
  font-weight: 600;
  letter-spacing: 0.02em;
  text-decoration: none;
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
.nx-portfolio-nav a:hover {
  opacity: 1;
}
.nx-portfolio-footer {
  border-top: 1px solid rgba(255, 255, 255, 0.08);
  padding: 2.5rem;
  text-align: center;
  margin-top: 4rem;
}
.nx-portfolio-footer-mark {
  margin: 0;
  font-size: 0.8rem;
  opacity: 0.6;
  letter-spacing: 0.04em;
}

.nx-portfolio-page {
  max-width: 720px;
  margin: 0 auto;
  padding: 4rem 1.5rem;
  line-height: 1.7;
}
.nx-portfolio-page h1,
.nx-portfolio-page h2,
.nx-portfolio-page h3 {
  letter-spacing: -0.01em;
}
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
  .nx-portfolio-gallery-grid {
    grid-template-columns: 1fr 1fr;
  }
}
.nx-portfolio-gallery-grid img {
  width: 100%;
  height: auto;
  display: block;
  border-radius: 8px;
}

/* Re-cast the .nx-page baseline so its dark variant carries
   the right link / muted colors without having to touch
   admin-edited tokens. */
.nx-portfolio .nx-page a {
  color: #93c5fd;
}
`.trim();
