/**
 * Phase F.9-B — docs theme CSS.
 *
 * Scoped under `.np-docs-*` so theme swaps don't leave
 * residue. Uses `var(--np-color-*)` tokens so admin
 * settings → tokens still apply on top.
 */
export const docsCss = `
.np-docs-shell {
  display: flex;
  flex-direction: column;
  min-height: 100vh;
  background: var(--np-color-background);
  color: var(--np-color-foreground);
  font-family: var(--np-font-body, system-ui, sans-serif);
}

.np-docs-header {
  position: sticky;
  top: 0;
  z-index: 50;
  background: var(--np-color-background);
  border-bottom: 1px solid var(--np-color-border);
  backdrop-filter: blur(8px);
}

.np-docs-header-inner {
  max-width: 1200px;
  margin: 0 auto;
  padding: 0.75rem 1.5rem;
  display: grid;
  grid-template-columns: auto 1fr auto;
  gap: 1.5rem;
  align-items: center;
}

.np-docs-brand {
  display: flex;
  align-items: baseline;
  gap: 0.5rem;
  font-weight: 600;
  text-decoration: none;
  color: var(--np-color-foreground);
}

.np-docs-brand-version {
  font-size: 0.75rem;
  font-family: ui-monospace, "SF Mono", Menlo, monospace;
  color: var(--np-color-muted-foreground);
  background: var(--np-color-muted);
  padding: 0.125rem 0.375rem;
  border-radius: 0.25rem;
}

.np-docs-search-form {
  flex: 1;
}

.np-docs-search-input {
  width: 100%;
  padding: 0.4rem 0.75rem;
  border: 1px solid var(--np-color-border);
  border-radius: 0.375rem;
  background: var(--np-color-card);
  color: var(--np-color-foreground);
  font-size: 0.875rem;
}

.np-docs-search-input:focus {
  outline: 2px solid var(--np-color-primary);
  outline-offset: -2px;
  border-color: transparent;
}

.np-docs-nav {
  display: flex;
  align-items: center;
  gap: 1rem;
}

.np-docs-primary-nav {
  display: flex;
  list-style: none;
  margin: 0;
  padding: 0;
  gap: 1rem;
}

.np-docs-primary-nav a {
  color: var(--np-color-muted-foreground);
  text-decoration: none;
  font-size: 0.875rem;
}

.np-docs-primary-nav a:hover {
  color: var(--np-color-foreground);
}

.np-docs-github-link {
  font-size: 0.875rem;
  color: var(--np-color-muted-foreground);
  text-decoration: none;
}

.np-docs-grid {
  flex: 1;
  display: grid;
  grid-template-columns: 240px minmax(0, 1fr);
  max-width: 1200px;
  margin: 0 auto;
  width: 100%;
  gap: 2.5rem;
  padding: 2rem 1.5rem;
}

@media (max-width: 768px) {
  .np-docs-grid {
    grid-template-columns: 1fr;
  }
  .np-docs-sidebar {
    display: none;
  }
}

.np-docs-sidebar {
  position: sticky;
  top: 4rem;
  align-self: start;
  max-height: calc(100vh - 5rem);
  overflow-y: auto;
}

.np-docs-sidebar h2 {
  font-size: 0.75rem;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--np-color-muted-foreground);
  margin: 0 0 0.75rem;
}

.np-docs-sidebar ul {
  list-style: none;
  padding: 0;
  margin: 0;
}

.np-docs-sidebar li {
  margin: 0.125rem 0;
}

.np-docs-sidebar a {
  display: block;
  padding: 0.25rem 0.5rem;
  border-radius: 0.25rem;
  color: var(--np-color-muted-foreground);
  text-decoration: none;
  font-size: 0.875rem;
}

.np-docs-sidebar a:hover {
  background: var(--np-color-muted);
  color: var(--np-color-foreground);
}

.np-docs-sidebar a[data-current="true"] {
  background: color-mix(in oklch, var(--np-color-primary) 12%, transparent);
  color: var(--np-color-primary);
  font-weight: 500;
}

.np-docs-sidebar ul ul {
  margin-left: 0.75rem;
  border-left: 1px solid var(--np-color-border);
  padding-left: 0.5rem;
}

.np-docs-page {
  max-width: 720px;
}

.np-docs-page h1 {
  font-size: 2rem;
  margin: 0 0 0.5rem;
}

.np-docs-prev-next {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 1rem;
  margin-top: 3rem;
  padding-top: 1.5rem;
  border-top: 1px solid var(--np-color-border);
}

.np-docs-prev-next a {
  display: block;
  padding: 0.75rem 1rem;
  border: 1px solid var(--np-color-border);
  border-radius: 0.5rem;
  color: var(--np-color-foreground);
  text-decoration: none;
}

.np-docs-prev-next a:hover {
  border-color: var(--np-color-primary);
}

.np-docs-prev-next-label {
  display: block;
  font-size: 0.75rem;
  color: var(--np-color-muted-foreground);
  margin-bottom: 0.25rem;
}

/* M.* member surface — narrow auth-form column under the
   masthead, no sidebar (the docs sidebar is hierarchical
   doc nav, useless on auth forms). */
.np-docs-members {
  display: flex;
  justify-content: center;
  min-height: 60vh;
  padding: 3rem 1.5rem;
}
.np-docs-members-column {
  width: 100%;
  max-width: 440px;
}

/* Member form token overrides — docs aesthetic: slightly
   rounded corners, neutral palette, monospace label accent. */
.np-docs .np-members-form {
  --np-member-form-input-bg: var(--np-color-background);
  --np-member-form-input-border: var(--np-color-border);
  --np-member-form-input-border-focus: var(--np-color-primary);
  --np-member-form-input-radius: 0.375rem;
  --np-member-form-button-radius: 0.375rem;
}
.np-docs .np-members-form .np-form-label {
  font-family: var(--np-font-mono, ui-monospace, monospace);
  font-size: 0.8125rem;
}
`;
