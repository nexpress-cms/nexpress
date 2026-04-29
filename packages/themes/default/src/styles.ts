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
  /* Phase 12.8 — logical property keeps the auto-margin on
     the trailing edge in both LTR and RTL, so the search /
     toggles always sit at the far end of the nav row. */
  margin-block: 0;
  margin-inline-start: 0;
  margin-inline-end: auto;
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
  /* Phase 12.8 — logical property mirrors automatically under
     RTL, putting the gap on the leading side. */
  margin-inline-start: 0.75rem;
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

/* Phase 11.5 — dark/light mode toggle in the header. The
   placeholder span keeps the header from reflowing during the
   single-frame gap before the client component mounts. */
.nx-color-scheme-toggle {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 2rem;
  height: 2rem;
  padding: 0;
  border: 1px solid var(--nx-color-border, #e5e7eb);
  border-radius: var(--nx-radius-md, 0.5rem);
  background: transparent;
  color: inherit;
  cursor: pointer;
  transition: background 0.15s ease, border-color 0.15s ease;
}
.nx-color-scheme-toggle:hover {
  background: var(--nx-color-muted, #f8fafc);
  border-color: var(--nx-color-mutedForeground, #94a3b8);
}
.nx-color-scheme-toggle:focus-visible {
  outline: 2px solid var(--nx-color-ring, #4f46e5);
  outline-offset: 2px;
}
.nx-color-scheme-toggle-placeholder {
  width: 2rem;
  height: 2rem;
  border: 1px solid transparent;
}

/* Phase 12.6 — visitor-facing language picker. Renders as a
   horizontal row of locale chips; the active locale is bolder
   and underlined. Only mounted by the header when the i18n
   config declares more than one locale. */
.nx-language-picker {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  font-size: 0.75rem;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}
.nx-language-picker-link {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 2rem;
  height: 1.75rem;
  padding: 0 0.5rem;
  border-radius: var(--nx-radius-md, 0.5rem);
  text-decoration: none;
  color: inherit;
  opacity: 0.6;
  transition: opacity 0.15s ease, background 0.15s ease;
}
.nx-language-picker-link:hover {
  opacity: 1;
  background: var(--nx-color-muted, #f8fafc);
}
.nx-language-picker-link[data-active="true"] {
  opacity: 1;
  font-weight: 600;
  background: var(--nx-color-muted, #f8fafc);
}

/* Dark mode — owned by this theme. The shell mounts
   <NxColorSchemeScript /> which sets <html data-theme="dark">
   based on the saved cookie / prefers-color-scheme, and these
   rules flip the design tokens. Themes that want a different
   color-mode policy (or none) simply omit this block. */
[data-theme="dark"] {
  --nx-color-background: oklch(0.145 0.004 285.823);
  --nx-color-foreground: oklch(0.985 0.001 106.423);
  --nx-color-muted: oklch(0.269 0.006 286.033);
  --nx-color-muted-foreground: oklch(0.711 0.008 285.879);
  --nx-color-border: oklch(0.269 0.006 286.033);
  --nx-color-card: oklch(0.145 0.004 285.823);
  --nx-color-card-foreground: oklch(0.985 0.001 106.423);
  --nx-color-accent: oklch(0.269 0.006 286.033);
  --nx-color-accent-foreground: oklch(0.985 0.001 106.423);
}
`.trim();
