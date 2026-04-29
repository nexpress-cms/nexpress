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
.nx-magazine-header {
  background: transparent;
  border-bottom: 4px double var(--nx-color-foreground, #0f172a);
  padding: 2.5rem 1.5rem 1.25rem;
  text-align: center;
}
.nx-magazine-masthead {
  max-width: 960px;
  margin: 0 auto 1rem;
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
  margin: 0.25rem 0 0;
  font-style: italic;
  color: var(--nx-color-muted-foreground, #64748b);
  font-size: 0.95rem;
}
.nx-magazine-sections > ul {
  list-style: none;
  margin: 0;
  padding: 0.75rem 0 0;
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
.nx-magazine-footer {
  margin-top: 5rem;
  padding: 3rem 1.5rem;
  border-top: 4px double var(--nx-color-foreground, #0f172a);
  text-align: center;
}
.nx-magazine-footer-mark {
  font-family: var(--nx-font-heading, "Fraunces", Georgia, serif);
  font-size: 1.25rem;
  font-weight: 700;
  letter-spacing: 0.02em;
  margin: 0 0 1rem;
}
.nx-magazine-footer-nav {
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
.nx-magazine-footer-nav a {
  color: var(--nx-color-muted-foreground, #64748b);
  text-decoration: none;
}
.nx-magazine-footer-nav a:hover {
  color: var(--nx-color-foreground, #0f172a);
}

/* Page templates (magazine variants) */
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
  float: left;
  font-size: 4rem;
  line-height: 0.85;
  margin: 0.4rem 0.6rem 0 0;
  font-weight: 700;
  color: var(--nx-color-accent, #0f766e);
}
`.trim();
