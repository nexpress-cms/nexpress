/**
 * `@nexpress/theme-docs` — CSS layout.
 *
 * Three-column reference-docs layout: sticky search-first header,
 * hierarchical sidebar (groups with bullet eyebrows + nested
 * links + status badges), centered article column, on-this-page
 * TOC on the right. Sidebar + TOC collapse out below the
 * tablet / phone breakpoints respectively.
 *
 * Scoped under `.np-docs-*` so a theme swap to another v0.2
 * theme doesn't leave residue. All colors resolve through the
 * `--np-color-*` tokens so admin overrides on top still apply.
 *
 * The terminal-style shell command snippet uses `.np-docs-cmdline`
 * (not `.np-docs-shell`) because `.np-docs-shell` is already
 * claimed by the route shell's root container.
 */
export const docsCss = `
.np-docs-shell {
  display: flex;
  flex-direction: column;
  min-height: 100vh;
  background: var(--np-color-background);
  color: var(--np-color-foreground);
  font-family: var(--np-font-body, "Geist", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif);
  line-height: 1.6;
  -webkit-font-smoothing: antialiased;
}
.np-docs-shell a { color: inherit; }
.np-docs-shell code,
.np-docs-shell pre,
.np-docs-shell kbd {
  font-family: var(--np-font-mono, "Geist Mono", ui-monospace, SFMono-Regular, Menlo, monospace);
}

.np-docs-api,
.np-docs-changelog-page {
  max-width: 980px;
  margin: 0 auto;
  padding: 3rem 1rem 5rem;
}
.np-docs-api-hero,
.np-docs-changelog-hero {
  padding: 3rem 0 2rem;
}
.np-docs-api-eyebrow,
.np-docs-changelog-hero p {
  margin: 0 0 0.8rem;
  font-family: var(--np-font-mono);
  color: var(--np-color-primary);
  font-size: 0.78rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}
.np-docs-api-hero h1,
.np-docs-changelog-hero h1 {
  margin: 0;
  font-size: clamp(2.4rem, 5vw, 4.4rem);
  line-height: 1;
  letter-spacing: -0.04em;
}
.np-docs-api-hero p,
.np-docs-changelog-hero span {
  display: block;
  max-width: 44rem;
  margin-top: 1rem;
  color: var(--np-color-muted-foreground);
  font-size: 1.05rem;
}
.np-docs-api-signature {
  overflow: hidden;
  border: 1px solid var(--np-color-border);
  border-radius: 14px;
  background: #0b1220;
  color: #e6edf6;
}
.np-docs-api-signature-head {
  display: flex;
  justify-content: space-between;
  gap: 1rem;
  padding: 0.8rem 1rem;
  color: #93c5fd;
  border-bottom: 1px solid rgba(255,255,255,0.12);
  font-family: var(--np-font-mono);
  font-size: 0.78rem;
}
.np-docs-api-signature pre {
  margin: 0;
  padding: 1.2rem;
  overflow-x: auto;
  font-size: 0.85rem;
  line-height: 1.65;
}
.np-docs-api-section { padding-top: 2.5rem; }
.np-docs-api-section h2 {
  margin: 0 0 1rem;
  font-size: 1.35rem;
}
.np-docs-api-table {
  border: 1px solid var(--np-color-border);
  border-radius: 14px;
  overflow: hidden;
  background: var(--np-color-card);
}
.np-docs-api-row {
  display: grid;
  grid-template-columns: 10rem 7rem minmax(0, 1fr);
  gap: 1rem;
  padding: 1rem;
  border-bottom: 1px solid var(--np-color-border);
}
.np-docs-api-row:last-child { border-bottom: 0; }
.np-docs-api-row span {
  color: var(--np-color-primary);
  font-family: var(--np-font-mono);
  font-size: 0.76rem;
}
.np-docs-api-row p { margin: 0; color: var(--np-color-muted-foreground); }
.np-docs-changelog-timeline {
  list-style: none;
  margin: 2rem 0 0;
  padding: 0;
  border-top: 1px solid var(--np-color-border);
}
.np-docs-changelog-release {
  display: grid;
  grid-template-columns: 13rem minmax(0, 1fr);
  gap: 2rem;
  padding: 1.6rem 0;
  border-bottom: 1px solid var(--np-color-border);
}
.np-docs-changelog-release aside {
  display: grid;
  gap: 0.3rem;
  align-content: start;
}
.np-docs-changelog-release aside strong {
  font-size: 1.25rem;
  letter-spacing: -0.02em;
}
.np-docs-changelog-release aside span,
.np-docs-changelog-release aside i {
  color: var(--np-color-muted-foreground);
  font-style: normal;
  font-size: 0.82rem;
}
.np-docs-changelog-release p {
  display: grid;
  grid-template-columns: 6.5rem minmax(0, 1fr);
  gap: 1rem;
  margin: 0 0 0.85rem;
}
.np-docs-changelog-release p span {
  justify-self: start;
  padding: 0.12rem 0.45rem;
  border-radius: 999px;
  border: 1px solid var(--np-color-border);
  font-family: var(--np-font-mono);
  font-size: 0.7rem;
  color: var(--np-color-primary);
}
@media (max-width: 760px) {
  .np-docs-api-row,
  .np-docs-changelog-release,
  .np-docs-changelog-release p {
    grid-template-columns: 1fr;
  }
}

/* ============================================================
 * Header — sticky bar with brand + version pill, ⌘K search in
 * the center, primary nav + GitHub link on the right. Grid
 * keeps everything anchored regardless of viewport width.
 * ============================================================ */
.np-docs-header {
  position: sticky;
  top: 0;
  z-index: 30;
  background: color-mix(in oklab, var(--np-color-background) 80%, transparent);
  backdrop-filter: saturate(140%) blur(14px);
  -webkit-backdrop-filter: saturate(140%) blur(14px);
  border-bottom: 1px solid var(--np-color-border);
}
.np-docs-header-inner {
  max-width: 1380px;
  margin: 0 auto;
  padding: 0.7rem 1.5rem;
  display: grid;
  grid-template-columns: auto 1fr auto;
  gap: 1.5rem;
  align-items: center;
}
.np-docs-brand {
  display: inline-flex;
  align-items: center;
  gap: 0.55rem;
  font-weight: 700;
  font-size: 1.0625rem;
  letter-spacing: -0.02em;
  text-decoration: none;
}
.np-docs-brand-mark {
  width: 1.55rem;
  height: 1.55rem;
  border-radius: 6px;
  background: linear-gradient(135deg, var(--np-color-primary, #2563eb), #0ea5e9);
  position: relative;
  flex: none;
}
.np-docs-brand-mark::after {
  content: "";
  position: absolute;
  inset: 5px;
  border-radius: 2px;
  background: var(--np-color-background, #fff);
  opacity: 0.95;
  clip-path: polygon(0 0, 100% 0, 100% 100%, 60% 100%, 0 35%);
}
.np-docs-brand-version {
  font-family: var(--np-font-mono);
  font-size: 0.72rem;
  font-weight: 500;
  color: var(--np-color-primary);
  background: color-mix(in oklab, var(--np-color-primary) 14%, var(--np-color-card));
  padding: 0.15rem 0.45rem;
  border-radius: 5px;
}

.np-docs-search-form {
  max-width: 520px;
  width: 100%;
  position: relative;
  justify-self: center;
}
.np-docs-search-form svg {
  position: absolute;
  top: 50%;
  left: 0.85rem;
  transform: translateY(-50%);
  color: var(--np-color-muted-foreground);
}
.np-docs-search-input {
  width: 100%;
  padding: 0.55rem 0.85rem 0.55rem 2.4rem;
  font: inherit;
  font-size: 0.875rem;
  color: var(--np-color-foreground);
  background: var(--np-color-card);
  border: 1px solid var(--np-color-border);
  border-radius: 9px;
}
.np-docs-search-input::placeholder {
  color: var(--np-color-muted-foreground);
}
.np-docs-search-input:focus {
  outline: none;
  border-color: var(--np-color-primary);
  box-shadow: 0 0 0 3px color-mix(in oklab, var(--np-color-primary) 22%, transparent);
}
.np-docs-search-kbd {
  position: absolute;
  right: 0.6rem;
  top: 50%;
  transform: translateY(-50%);
  font-size: 0.7rem;
  padding: 0.1rem 0.4rem;
  color: var(--np-color-muted-foreground);
  border: 1px solid var(--np-color-border);
  border-radius: 4px;
}

.np-docs-nav {
  display: flex;
  align-items: center;
  gap: 1.25rem;
}
.np-docs-primary-nav {
  display: flex;
  list-style: none;
  gap: 1.25rem;
  margin: 0;
  padding: 0;
}
.np-docs-primary-nav a {
  color: var(--np-color-muted-foreground);
  font-size: 0.875rem;
  font-weight: 500;
  text-decoration: none;
}
.np-docs-primary-nav a:hover,
.np-docs-primary-nav a[aria-current="page"] {
  color: var(--np-color-foreground);
}
@media (max-width: 800px) {
  .np-docs-header-inner {
    grid-template-columns: auto 1fr auto;
    gap: 0.75rem;
  }
  .np-docs-search-form { display: none; }
  .np-docs-primary-nav { display: none; }
}

/* ============================================================
 * 3-column layout: sidebar + article + on-page TOC.
 * ============================================================ */
.np-docs-grid,
.np-docs-body {
  max-width: 1380px;
  margin: 0 auto;
  width: 100%;
  display: grid;
  grid-template-columns: 260px minmax(0, 1fr) 220px;
  gap: 3rem;
  padding: 2.25rem 1.5rem 4rem;
}
@media (max-width: 1100px) {
  .np-docs-grid,
  .np-docs-body {
    grid-template-columns: 240px minmax(0, 1fr);
  }
  .np-docs-toc { display: none; }
}
@media (max-width: 800px) {
  .np-docs-grid,
  .np-docs-body {
    grid-template-columns: 1fr;
  }
  .np-docs-sidebar { display: none; }
}

/* Non-docs routes (home / about / pricing / contact / member pages):
 * collapse the 3-col grid to a single wide column and hide the
 * doc-only chrome (sidebar + TOC) so a generic pages doc has full
 * canvas width instead of being squeezed into the 800-ish px
 * article column reserved for the /docs reading lane. */
.np-docs-shell[data-layout="page"] .np-docs-grid {
  grid-template-columns: minmax(0, 1fr);
}
.np-docs-shell[data-layout="page"] .np-docs-sidebar,
.np-docs-shell[data-layout="page"] .np-docs-toc {
  display: none;
}
/* Framework's globals.css caps .np-page at 48rem (~768px) so a
 * regular pages doc rendered through the catch-all's fallback
 * wrapper stays squeezed even after the grid collapse above.
 * Lift the cap inside the page-layout so block-level content
 * (hero, features, stats) can stretch to the docs container. */
.np-docs-shell[data-layout="page"] .np-page {
  max-width: none;
  margin: 0;
  padding: 0;
}

/* ============================================================
 * Sidebar — grouped link list with bullet eyebrow + badges.
 * ============================================================ */
.np-docs-sidebar {
  position: sticky;
  top: 4.25rem;
  align-self: start;
  max-height: calc(100vh - 5rem);
  overflow-y: auto;
  padding-right: 0.5rem;
}
.np-docs-sidebar-group { margin-bottom: 1.5rem; }
.np-docs-sidebar-eyebrow {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  font-family: var(--np-font-mono);
  font-size: 0.7rem;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--np-color-muted-foreground);
  margin: 0 0 0.65rem;
  font-weight: 600;
}
.np-docs-sidebar-eyebrow-dot {
  width: 0.4rem;
  height: 0.4rem;
  border-radius: 50%;
  background: var(--np-color-primary);
}
/* Leaf top-level doc rendered as a clickable eyebrow — inherits
 * the eyebrow typography (mono / uppercase / 0.7rem) so it sits
 * in the same visual row as sibling group eyebrows; primary
 * accent on current, foreground on hover. */
.np-docs-sidebar-eyebrow-link {
  color: inherit;
  text-decoration: none;
  font: inherit;
  letter-spacing: inherit;
  text-transform: inherit;
}
.np-docs-sidebar-eyebrow-link:hover {
  color: var(--np-color-foreground);
}
.np-docs-sidebar-eyebrow-link[data-current="true"],
.np-docs-sidebar-eyebrow-link[aria-current="page"] {
  color: var(--np-color-primary);
}
.np-docs-sidebar ul {
  list-style: none;
  padding: 0;
  margin: 0;
}
.np-docs-sidebar li { margin: 0.05rem 0; }
.np-docs-sidebar a {
  display: block;
  padding: 0.34rem 0.6rem;
  font-size: 0.875rem;
  color: var(--np-color-muted-foreground);
  text-decoration: none;
  border-radius: 6px;
  line-height: 1.35;
}
.np-docs-sidebar a:hover {
  background: var(--np-color-muted);
  color: var(--np-color-foreground);
}
.np-docs-sidebar a[data-current="true"],
.np-docs-sidebar a[aria-current="page"] {
  color: var(--np-color-primary);
  background: color-mix(in oklab, var(--np-color-primary) 14%, var(--np-color-card));
  font-weight: 500;
}
.np-docs-sidebar ul ul {
  margin-left: 0.5rem;
  padding-left: 0.85rem;
  border-left: 1px solid var(--np-color-border);
}
.np-docs-sidebar-badge {
  display: inline-block;
  font-family: var(--np-font-mono);
  font-size: 0.62rem;
  padding: 0.02rem 0.34rem;
  margin-left: 0.4rem;
  vertical-align: 1px;
  border-radius: 4px;
  background: var(--np-color-muted);
  color: var(--np-color-muted-foreground);
  font-weight: 500;
}
.np-docs-sidebar-badge.new { background: #dcfce7; color: #166534; }
.np-docs-sidebar-badge.beta { background: #fef3c7; color: #92400e; }
.np-docs-sidebar-badge.api {
  background: color-mix(in oklab, var(--np-color-primary) 16%, var(--np-color-card));
  color: var(--np-color-primary);
}

/* ============================================================
 * Doc page — article column. h1 + lede + meta row + sections
 * with hovered anchor link icon.
 * ============================================================ */
.np-docs-page {
  max-width: 760px;
  min-width: 0;
}
.np-docs-breadcrumbs {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  font-size: 0.8125rem;
  color: var(--np-color-muted-foreground);
  margin-bottom: 1rem;
}
.np-docs-breadcrumbs a {
  color: inherit;
  text-decoration: none;
}
.np-docs-breadcrumbs a:hover { color: var(--np-color-foreground); }
.np-docs-breadcrumbs-sep { opacity: 0.5; }

.np-docs-page h1 {
  font-size: clamp(2rem, 3.6vw, 2.5rem);
  font-weight: 700;
  letter-spacing: -0.03em;
  line-height: 1.1;
  margin: 0 0 0.5rem;
  text-wrap: balance;
}
.np-docs-page-lede {
  font-size: 1.125rem;
  color: var(--np-color-muted-foreground);
  line-height: 1.55;
  margin: 0 0 2rem;
  max-width: 38rem;
  text-wrap: pretty;
}
.np-docs-page-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  align-items: center;
  font-size: 0.8125rem;
  color: var(--np-color-muted-foreground);
  padding: 0.85rem 0;
  margin-bottom: 2rem;
  border-top: 1px solid var(--np-color-border);
  border-bottom: 1px solid var(--np-color-border);
}
.np-docs-page-meta-pill {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  padding: 0.15rem 0.55rem;
  font-family: var(--np-font-mono);
  font-size: 0.72rem;
  border: 1px solid var(--np-color-border);
  border-radius: 999px;
  background: var(--np-color-card);
}
.np-docs-page-meta-pill.status {
  color: var(--np-color-success, #047857);
  border-color: #bbf7d0;
  background: var(--np-color-success-soft, #f0fdf4);
}
.np-docs-page-meta-pill.status::before {
  content: "";
  width: 0.4rem;
  height: 0.4rem;
  border-radius: 50%;
  background: var(--np-color-success, #047857);
}
.np-docs-page-meta-sep { opacity: 0.4; }
.np-docs-page-meta a {
  color: var(--np-color-primary);
  text-decoration: none;
  margin-left: auto;
}
.np-docs-page-meta a:hover { text-decoration: underline; }

.np-docs-page h2 {
  font-size: 1.5rem;
  font-weight: 600;
  letter-spacing: -0.02em;
  line-height: 1.25;
  margin: 3rem 0 0.85rem;
  scroll-margin-top: 5rem;
  position: relative;
}
.np-docs-page h2:first-of-type { margin-top: 2.5rem; }
.np-docs-page h3 {
  font-size: 1.1rem;
  font-weight: 600;
  letter-spacing: -0.01em;
  margin: 2.25rem 0 0.7rem;
  scroll-margin-top: 5rem;
  position: relative;
}
.np-docs-page p { margin: 0 0 1rem; }
.np-docs-page p code,
.np-docs-page li code {
  font-size: 0.875em;
  padding: 0.1em 0.35em;
  background: var(--np-color-muted);
  border: 1px solid var(--np-color-border);
  border-radius: 4px;
}
.np-docs-page strong { font-weight: 600; }
.np-docs-page ul,
.np-docs-page ol {
  margin: 0 0 1rem;
  padding-left: 1.4rem;
}
.np-docs-page li { margin: 0.35rem 0; }
.np-docs-page a:not(.np-docs-prev-next a):not(.np-docs-anchor) {
  color: var(--np-color-primary);
  text-decoration: underline;
  text-underline-offset: 3px;
  text-decoration-thickness: 1px;
  text-decoration-color: color-mix(in oklab, var(--np-color-primary) 45%, transparent);
}
.np-docs-page a:not(.np-docs-prev-next a):not(.np-docs-anchor):hover {
  text-decoration-color: currentColor;
}

/* Anchor icon — visible only on heading hover. */
.np-docs-anchor {
  position: absolute;
  left: -1.3rem;
  top: 50%;
  transform: translateY(-50%);
  color: var(--np-color-muted-foreground);
  opacity: 0;
  text-decoration: none !important;
  font-weight: 400;
}
.np-docs-page h2:hover .np-docs-anchor,
.np-docs-page h3:hover .np-docs-anchor { opacity: 1; }

/* ============================================================
 * Callouts — info (default) / note (indigo) / warn (amber) /
 * danger (red). 3px left rule carries the variant color.
 * ============================================================ */
.np-docs-callout {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 0.85rem;
  padding: 1rem 1.15rem;
  border: 1px solid var(--np-color-border);
  border-left: 3px solid var(--np-color-primary);
  border-radius: 8px;
  background: var(--np-color-card);
  margin: 1.25rem 0;
  font-size: 0.95rem;
  line-height: 1.55;
}
.np-docs-callout > svg,
.np-docs-callout-icon {
  width: 1.25rem;
  height: 1.25rem;
  flex-shrink: 0;
  color: var(--np-color-primary);
  margin-top: 0.1rem;
}
.np-docs-callout p { margin: 0; }
.np-docs-callout-title {
  font-weight: 600;
  margin-bottom: 0.15rem;
  color: var(--np-color-foreground);
}
.np-docs-callout--warn {
  border-left-color: var(--np-color-warning, #b45309);
  background: var(--np-color-warning-soft, #fffbeb);
  border-color: #fde68a;
}
.np-docs-callout--warn .np-docs-callout-icon,
.np-docs-callout--warn > svg { color: var(--np-color-warning, #b45309); }
.np-docs-callout--note {
  border-left-color: #6366f1;
  background: #eef2ff;
  border-color: #c7d2fe;
}
.np-docs-callout--note .np-docs-callout-icon,
.np-docs-callout--note > svg { color: #4338ca; }
.np-docs-callout--danger {
  border-left-color: var(--np-color-danger, #b91c1c);
  background: var(--np-color-danger-soft, #fef2f2);
  border-color: #fecaca;
}
.np-docs-callout--danger .np-docs-callout-icon,
.np-docs-callout--danger > svg { color: var(--np-color-danger, #b91c1c); }

/* ============================================================
 * Code blocks — dark surface with a file-named header and a
 * copy button. Syntax tokens (.tk-*) cover the common slots
 * (keyword / string / function / number / type / punctuation /
 * comment) using a muted neutral-paired palette so the block
 * reads at the same contrast as the page chrome.
 * ============================================================ */
.np-docs-code {
  margin: 1.25rem 0;
  border-radius: 10px;
  background: var(--np-color-code-bg, #0b1220);
  color: var(--np-color-code-fg, #e6edf6);
  overflow: hidden;
  border: 1px solid var(--np-color-code-head, #1e2939);
}
.np-docs-code-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.55rem 0.85rem;
  background: var(--np-color-code-border, #0f1a2b);
  border-bottom: 1px solid #1e293b;
}
.np-docs-code-file {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  font-family: var(--np-font-mono);
  font-size: 0.78rem;
  color: #94a3b8;
}
.np-docs-code-file svg { color: #64748b; }
.np-docs-code-copy {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  padding: 0.25rem 0.55rem;
  font-size: 0.72rem;
  font-family: var(--np-font-mono);
  color: #94a3b8;
  background: transparent;
  border: 1px solid #1e293b;
  border-radius: 5px;
  cursor: pointer;
}
.np-docs-code-copy:hover {
  color: #e2e8f0;
  border-color: #334155;
}
.np-docs-code pre {
  margin: 0;
  padding: 1rem 1.1rem;
  font-size: 0.825rem;
  line-height: 1.65;
  overflow-x: auto;
}
.np-docs-code pre code {
  display: block;
  font-family: inherit;
  background: transparent;
  border: 0;
  padding: 0;
  color: inherit;
}
.tk-c { color: #64748b; font-style: italic; }
.tk-k { color: #c084fc; }
.tk-s { color: #86efac; }
.tk-f { color: #93c5fd; }
.tk-t { color: #fcd34d; }
.tk-n { color: #f9a8d4; }
.tk-p { color: #e2e8f0; }

/* Inline shell snippet — for terse \`pnpm dev\` style commands.
 * Named \`cmdline\` (not \`shell\`) so it doesn't collide with the
 * route shell container at \`.np-docs-shell\`. */
.np-docs-cmdline {
  display: grid;
  grid-template-columns: auto 1fr auto;
  gap: 0.7rem;
  align-items: center;
  padding: 0.75rem 1rem;
  margin: 1.25rem 0;
  background: var(--np-color-code-bg, #0b1220);
  color: var(--np-color-code-fg, #e6edf6);
  border-radius: 9px;
  font-family: var(--np-font-mono);
  font-size: 0.875rem;
}
.np-docs-cmdline-prompt { color: #34d399; }
.np-docs-cmdline-cmd { color: #e2e8f0; }
.np-docs-cmdline-copy {
  padding: 0.2rem 0.55rem;
  font-size: 0.7rem;
  color: #94a3b8;
  background: transparent;
  border: 1px solid #1e293b;
  border-radius: 5px;
  cursor: pointer;
}
.np-docs-cmdline-copy:hover { color: #e2e8f0; border-color: #334155; }

/* ============================================================
 * Numbered steps — counter on a soft pill before each step.
 * ============================================================ */
.np-docs-steps {
  counter-reset: step;
  list-style: none;
  padding: 0;
  margin: 1.5rem 0;
  display: grid;
  gap: 1rem;
}
.np-docs-steps > li {
  counter-increment: step;
  display: grid;
  grid-template-columns: 2.1rem 1fr;
  gap: 0.85rem;
  align-items: start;
}
.np-docs-steps > li::before {
  content: counter(step);
  width: 1.85rem;
  height: 1.85rem;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-family: var(--np-font-mono);
  font-size: 0.85rem;
  font-weight: 600;
  color: var(--np-color-primary);
  background: color-mix(in oklab, var(--np-color-primary) 14%, var(--np-color-card));
  border-radius: 50%;
}
.np-docs-step-title {
  font-weight: 600;
  margin: 0.25rem 0 0.25rem;
}
.np-docs-step-body {
  margin: 0;
  color: var(--np-color-muted-foreground);
}

/* ============================================================
 * API / reference tables — uppercase mono headers.
 * ============================================================ */
.np-docs-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.875rem;
  margin: 1.25rem 0;
}
.np-docs-table thead { background: var(--np-color-muted); }
.np-docs-table th,
.np-docs-table td {
  text-align: left;
  padding: 0.7rem 0.85rem;
  border-bottom: 1px solid var(--np-color-border);
  vertical-align: top;
}
.np-docs-table th {
  font-family: var(--np-font-mono);
  font-size: 0.72rem;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--np-color-muted-foreground);
  font-weight: 600;
}
.np-docs-table td:first-child code {
  color: var(--np-color-foreground);
  font-weight: 500;
}
.np-docs-table-required {
  display: inline-block;
  font-family: var(--np-font-mono);
  font-size: 0.65rem;
  padding: 0.05rem 0.35rem;
  margin-left: 0.4rem;
  background: #fef3c7;
  color: #92400e;
  border-radius: 4px;
  vertical-align: 1px;
}

/* ============================================================
 * Prev / next — symmetric pair at the foot of every doc page.
 * Hover lifts the bordered card and tints the border primary.
 * ============================================================ */
.np-docs-prev-next {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 1rem;
  margin: 3.5rem 0 1rem;
  padding-top: 2rem;
  border-top: 1px solid var(--np-color-border);
}
.np-docs-prev-next a {
  display: block;
  padding: 1rem 1.15rem;
  background: var(--np-color-card);
  border: 1px solid var(--np-color-border);
  border-radius: 10px;
  text-decoration: none;
  transition: border-color 0.15s ease, transform 0.2s ease;
}
.np-docs-prev-next a:hover {
  border-color: var(--np-color-primary);
  transform: translateY(-1px);
}
.np-docs-prev-next-dir,
.np-docs-prev-next-label {
  font-family: var(--np-font-mono);
  font-size: 0.72rem;
  color: var(--np-color-muted-foreground);
  letter-spacing: 0.05em;
  margin-bottom: 0.25rem;
}
.np-docs-prev-next-title {
  font-weight: 600;
  font-size: 0.95rem;
}
.np-docs-prev-next a.np-docs-prev-next-next,
.np-docs-prev-next a:last-child { text-align: right; }
.np-docs-prev-next[data-single="prev"],
.np-docs-prev-next[data-single="next"] { grid-template-columns: 1fr; }
.np-docs-prev-next[data-single="prev"] a.np-docs-prev-next-prev,
.np-docs-prev-next[data-single="next"] a.np-docs-prev-next-next { width: 100%; }
.np-docs-prev-next[data-single="prev"] a.np-docs-prev-next-prev { text-align: left; }

/* ============================================================
 * Feedback row — Yes / Could be better buttons under each page.
 * ============================================================ */
.np-docs-feedback {
  margin-top: 3rem;
  padding: 1.25rem;
  background: var(--np-color-muted);
  border: 1px solid var(--np-color-border);
  border-radius: 10px;
  display: flex;
  gap: 1rem;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
}
.np-docs-feedback-title { font-weight: 600; font-size: 0.95rem; }
.np-docs-feedback-helper {
  font-size: 0.825rem;
  color: var(--np-color-muted-foreground);
  margin-top: 0.15rem;
}
.np-docs-feedback-buttons {
  display: flex;
  gap: 0.5rem;
}
.np-docs-feedback-buttons button {
  padding: 0.4rem 0.85rem;
  font: inherit;
  font-size: 0.825rem;
  background: var(--np-color-card);
  border: 1px solid var(--np-color-border);
  border-radius: 7px;
  cursor: pointer;
}
.np-docs-feedback-buttons button:hover {
  border-color: var(--np-color-primary);
  color: var(--np-color-primary);
}

/* ============================================================
 * On-page TOC — right rail, sticky, current section gets a
 * primary border + soft gradient.
 * ============================================================ */
.np-docs-toc {
  position: sticky;
  top: 4.25rem;
  align-self: start;
  max-height: calc(100vh - 5rem);
  overflow-y: auto;
  font-size: 0.825rem;
}
.np-docs-toc-eyebrow {
  font-family: var(--np-font-mono);
  font-size: 0.7rem;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--np-color-muted-foreground);
  margin: 0 0 0.75rem;
  font-weight: 600;
}
.np-docs-toc ul {
  list-style: none;
  padding: 0;
  margin: 0;
}
.np-docs-toc li { margin: 0.05rem 0; }
.np-docs-toc a {
  display: block;
  padding: 0.3rem 0.5rem;
  color: var(--np-color-muted-foreground);
  text-decoration: none;
  border-left: 2px solid transparent;
  margin-left: -2px;
  line-height: 1.4;
}
.np-docs-toc a:hover { color: var(--np-color-foreground); }
.np-docs-toc a[data-current="true"],
.np-docs-toc a[aria-current="location"],
.np-docs-toc a[aria-current="true"] {
  color: var(--np-color-primary);
  border-left-color: var(--np-color-primary);
  background: linear-gradient(
    to right,
    color-mix(in oklab, var(--np-color-primary) 14%, var(--np-color-card)),
    transparent 80%
  );
}
.np-docs-toc ul ul { margin-left: 0.85rem; }
.np-docs-toc-l3 { margin-left: 0.85rem; }
.np-docs-toc-secondary {
  margin-top: 1.5rem;
  padding-top: 1rem;
  border-top: 1px solid var(--np-color-border);
}
.np-docs-toc-secondary a {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  padding: 0.2rem 0;
  border-left: 0;
  margin: 0;
}
.np-docs-toc-secondary a:hover { background: transparent; }

/* Empty / not-found surfaces — used by routes/not-found and
 * the docs collection's empty state. */
.np-docs-empty {
  padding: 4rem 1.5rem;
  text-align: center;
  color: var(--np-color-muted-foreground);
}
.np-docs-empty h1 {
  font-size: 1.5rem;
  margin: 0 0 0.5rem;
  color: var(--np-color-foreground);
}

/* ============================================================
 * Search route — wraps DocsSearch's output. Eyebrow + result
 * cards reuse the docs chrome (mono small caps, hairline rules,
 * bordered card with hover lift).
 * ============================================================ */
.np-docs-search {
  max-width: 800px;
  margin: 0 auto;
  padding-top: 2.25rem;
}
.np-docs-search-heading {
  font-family: var(--np-font-mono);
  font-size: 0.72rem;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--np-color-muted-foreground);
  font-weight: 600;
  margin: 0 0 0.5rem;
}
.np-docs-search h1 {
  font-size: 1.75rem;
  font-weight: 700;
  letter-spacing: -0.02em;
  margin: 0 0 1.5rem;
  text-wrap: balance;
}
.np-docs-search-empty {
  color: var(--np-color-muted-foreground);
  padding: 1.5rem 0;
  font-size: 0.95rem;
}
.np-docs-search-results {
  list-style: none;
  padding: 0;
  margin: 1.5rem 0 0;
  display: grid;
  gap: 1rem;
}
.np-docs-search-result {
  padding: 1rem 1.15rem;
  border: 1px solid var(--np-color-border);
  border-radius: 10px;
  background: var(--np-color-card);
  transition: border-color 0.15s ease, transform 0.2s ease;
}
.np-docs-search-result:hover {
  border-color: var(--np-color-primary);
  transform: translateY(-1px);
}
.np-docs-search-result-eyebrow {
  font-family: var(--np-font-mono);
  font-size: 0.68rem;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--np-color-muted-foreground);
  margin: 0 0 0.35rem;
}
.np-docs-search-result h2 {
  font-size: 1.05rem;
  font-weight: 600;
  margin: 0 0 0.4rem;
}
.np-docs-search-result h2 a {
  color: var(--np-color-foreground);
  text-decoration: none;
}
.np-docs-search-result h2 a:hover { color: var(--np-color-primary); }
.np-docs-search-result-excerpt {
  margin: 0;
  font-size: 0.875rem;
  color: var(--np-color-muted-foreground);
  line-height: 1.55;
}

/* ============================================================
 * Front-page landing — eyebrow + display heading + lede +
 * primary CTA + 2x2 group cards + recently-updated row.
 * Renders inside the single-column page layout
 * (data-layout="page" on the shell collapses the 3-col grid).
 * ============================================================ */
.np-docs-front {
  max-width: 880px;
  margin: 0 auto;
  padding: 2.5rem 0 4rem;
  display: grid;
  gap: 3rem;
}
.np-docs-front-hero {
  display: grid;
  gap: 1rem;
}
.np-docs-front-eyebrow {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  font-family: var(--np-font-mono, ui-monospace, monospace);
  font-size: 0.72rem;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: var(--np-color-primary);
  background: var(--np-color-primary-soft, color-mix(in oklab, var(--np-color-primary) 10%, transparent));
  padding: 0.32rem 0.6rem;
  border-radius: 999px;
  align-self: start;
  justify-self: start;
}
.np-docs-front-eyebrow-dot {
  width: 6px;
  height: 6px;
  border-radius: 999px;
  background: var(--np-color-success, currentColor);
  display: inline-block;
}
.np-docs-front h1 {
  font-size: clamp(2.4rem, 4.2vw, 3rem);
  font-weight: 700;
  letter-spacing: -0.03em;
  line-height: 1.05;
  margin: 0;
  text-wrap: balance;
}
.np-docs-front-lede {
  font-size: 1.125rem;
  line-height: 1.55;
  color: var(--np-color-muted-foreground);
  max-width: 60ch;
  margin: 0;
}
.np-docs-front-cta {
  display: flex;
  flex-wrap: wrap;
  gap: 0.65rem;
  margin-top: 0.5rem;
}
.np-docs-front-cta-primary {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  font-size: 0.92rem;
  font-weight: 500;
  padding: 0.55rem 1.05rem;
  border-radius: 999px;
  background: var(--np-color-foreground);
  color: var(--np-color-background);
  text-decoration: none;
}
.np-docs-front-cta-primary:hover {
  background: color-mix(in oklab, var(--np-color-foreground) 85%, transparent);
}
.np-docs-front-cta-secondary {
  display: inline-flex;
  align-items: center;
  font-size: 0.92rem;
  padding: 0.55rem 1.05rem;
  border-radius: 999px;
  color: var(--np-color-foreground);
  text-decoration: none;
  border: 1px solid var(--np-color-border);
}
.np-docs-front-cta-secondary:hover {
  background: var(--np-color-muted);
}

.np-docs-front-groups {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 1rem;
}
@media (max-width: 720px) {
  .np-docs-front-groups { grid-template-columns: 1fr; }
}
.np-docs-front-group {
  display: grid;
  gap: 0.5rem;
  padding: 1.4rem 1.4rem 1.6rem;
  border-radius: var(--np-radius-lg, 10px);
  border: 1px solid var(--np-color-border);
  background: var(--np-color-card);
  text-decoration: none;
  color: inherit;
  transition: border-color 120ms ease, transform 120ms ease;
}
.np-docs-front-group:hover {
  border-color: var(--np-color-primary);
  transform: translateY(-1px);
}
.np-docs-front-group-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 1.05rem;
  font-weight: 600;
  margin: 0;
}
.np-docs-front-group-count {
  font-family: var(--np-font-mono, ui-monospace, monospace);
  font-size: 0.7rem;
  letter-spacing: 0.04em;
  color: var(--np-color-muted-foreground);
  font-weight: 400;
}
.np-docs-front-group-lede {
  margin: 0;
  font-size: 0.9rem;
  line-height: 1.5;
  color: var(--np-color-muted-foreground);
}
.np-docs-front-group-children {
  list-style: none;
  margin: 0.4rem 0 0;
  padding: 0;
  display: grid;
  gap: 0.25rem;
}
.np-docs-front-group-children li {
  font-size: 0.86rem;
  color: var(--np-color-muted-foreground);
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
}

.np-docs-front-recent {
  display: grid;
  gap: 0.75rem;
}
.np-docs-front-recent-eyebrow {
  font-family: var(--np-font-mono, ui-monospace, monospace);
  font-size: 0.7rem;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: var(--np-color-muted-foreground);
  margin: 0;
}
.np-docs-front-recent-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 0.5rem;
}
.np-docs-front-recent-list a {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 1rem;
  padding: 0.5rem 0;
  border-bottom: 1px solid var(--np-color-border);
  text-decoration: none;
  color: inherit;
}
.np-docs-front-recent-list li:last-child a {
  border-bottom: 0;
}
.np-docs-front-recent-list a:hover {
  color: var(--np-color-primary);
}
.np-docs-front-recent-title {
  font-size: 0.95rem;
}
.np-docs-front-recent-time {
  font-family: var(--np-font-mono, ui-monospace, monospace);
  font-size: 0.75rem;
  color: var(--np-color-muted-foreground);
  flex-shrink: 0;
}

/* ────────────────────────────────────────────────────────────
 * Members shell (DocsMembersShell — /members/* routes)
 *
 * Drops the docs sidebar — hierarchical navigation is useless
 * on auth forms. Reuses DocsHeader directly. Body becomes a
 * narrow centered column for the form / status content.
 * ──────────────────────────────────────────────────────────── */
.np-docs-members {
  padding: 4rem 1.5rem;
  min-height: 60vh;
}
.np-docs-members-column {
  max-width: 32rem;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
}
`;
