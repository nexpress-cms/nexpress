/**
 * Layout-level CSS for `@nexpress/theme-default`. Phase 11.2
 * extracted these rules from `apps/web/src/app/globals.css`
 * into the theme package so swapping themes actually changes
 * the rendered shell. Cross-theme primitives (form inputs,
 * member auth pages, etc.) stayed in globals.css because they
 * aren't theme-specific.
 *
 * The layout reads `activeTheme.impl.css` and emits this string
 * inside a `<style data-nx-theme="default">` tag at SSR time —
 * no separate stylesheet round-trip, just inline bytes that
 * race with the document.
 */
export const defaultThemeCss = `
.nx-site-header {
  border-bottom: 1px solid var(--nx-color-border, #e5e7eb);
  background: var(--nx-color-background, #fff);
}
.nx-site-header > nav {
  display: flex;
  align-items: center;
  gap: 1.5rem;
  max-width: 1200px;
  margin: 0 auto;
  padding: 1rem 1.5rem;
}
.nx-site-logo {
  font-weight: 700;
  font-size: 1.125rem;
  text-decoration: none;
  color: inherit;
  letter-spacing: -0.01em;
}
.nx-site-nav {
  display: flex;
  align-items: center;
  gap: 1.25rem;
  list-style: none;
  padding: 0;
  margin: 0 auto 0 0;
}
.nx-site-nav a {
  color: var(--nx-color-muted-foreground, #64748b);
  text-decoration: none;
  font-size: 0.9375rem;
  transition: color 0.15s ease;
}
.nx-site-nav a:hover {
  color: var(--nx-color-foreground, #0f172a);
}
/*
 * .nx-site-main baseline (min-height) lives in the consuming
 * app's globals.css as a cross-theme primitive — every theme
 * renders the same <main className="nx-site-main"> container,
 * so the box-model rule belongs to the framework, not the
 * theme. Themes that want to restyle the main area layer
 * their own rules on top.
 */
.nx-site-footer {
  border-top: 1px solid var(--nx-color-border, #e5e7eb);
  background: var(--nx-color-muted, #f8fafc);
  margin-top: 4rem;
}
.nx-site-footer > nav {
  max-width: 1200px;
  margin: 0 auto;
  padding: 1.5rem;
}
.nx-site-footer ul {
  display: flex;
  gap: 1.5rem;
  list-style: none;
  padding: 0;
  margin: 0;
  font-size: 0.875rem;
}
.nx-site-footer a {
  color: var(--nx-color-muted-foreground, #64748b);
  text-decoration: none;
}
.nx-site-footer a:hover {
  color: var(--nx-color-foreground, #0f172a);
}
.nx-site-search {
  margin-left: 0.75rem;
}
.nx-site-search-input {
  padding: 0.375rem 0.75rem;
  font: inherit;
  font-size: 0.875rem;
  color: inherit;
  background: var(--nx-color-muted, #f8fafc);
  border: 1px solid var(--nx-color-border, #e5e7eb);
  border-radius: var(--nx-radius-md, 0.5rem);
  width: 12rem;
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
}
.nx-site-search-input:focus {
  outline: none;
  border-color: var(--nx-color-ring, #4f46e5);
  box-shadow: 0 0 0 3px color-mix(in oklch, var(--nx-color-ring, #4f46e5) 20%, transparent);
}

/*
 * Page templates (11.3). The base .nx-page rule lives in
 * apps/web's globals.css alongside the other content-wrapper
 * primitives (.nx-blog, .nx-discussions, etc.). The wide
 * variant is theme-owned because how a theme expresses
 * "edge-to-edge" is opinionated.
 */
.nx-page-wide {
  max-width: none;
  margin: 0;
  padding: 0;
}
`.trim();
