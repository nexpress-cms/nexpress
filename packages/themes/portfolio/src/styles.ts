/**
 * `@nexpress/theme-portfolio` — CSS layout.
 *
 * Image-led dark canvas, color-scheme: dark by default. Sticky
 * blurred header with logo + nav + local-time pill + "Start a
 * project" CTA; large hero with eyebrow + display-italic
 * headline + three meta blocks; controls strip (filters tablist +
 * grid/list view toggle); 12-column asymmetric project grid
 * driven by `.span-N` modifiers on each card; studio strip
 * (2-col text + 2x2 stats); contact strip with a large mailto;
 * thin footer with local-clock indicator.
 *
 * Scoped under `.np-portfolio-*` so theme swaps don't leave
 * residue. Color tokens are consumed via `var(--np-color-*)`
 * with sensible dark fallbacks, so admin token overrides
 * cascade through the whole shell.
 */
export const portfolioCss = `
.np-portfolio {
  background: var(--np-color-background, #0a0a0a);
  color: var(--np-color-foreground, #f5f1ea);
  font-family: var(--np-font-chrome, "Hanken Grotesk", -apple-system, BlinkMacSystemFont, sans-serif);
  line-height: 1.55;
  -webkit-font-smoothing: antialiased;
  color-scheme: dark;
}
.np-portfolio a { color: inherit; }
.np-portfolio img { max-width: 100%; display: block; }
.np-portfolio-container {
  max-width: 1440px;
  margin: 0 auto;
  padding: 0 2rem;
}
.np-portfolio-studio-page,
.np-portfolio-journal-page,
.np-portfolio-press-page {
  min-height: 80vh;
}
.np-portfolio-subpage-hero {
  padding-block: 6rem 3rem;
  display: grid;
  grid-template-columns: minmax(0, 1.35fr) minmax(18rem, 0.65fr);
  gap: 4rem;
  border-bottom: 1px solid var(--np-color-border, #232323);
}
.np-portfolio-subpage-hero > p {
  grid-column: 1 / -1;
  margin: 0;
  color: var(--np-color-accent, #d97a4f);
  font-size: 0.75rem;
  letter-spacing: 0.18em;
  text-transform: uppercase;
}
.np-portfolio-subpage-hero h1 {
  margin: 0;
  font-family: var(--np-font-display, "Instrument Serif", "Times New Roman", serif);
  font-size: clamp(3rem, 7vw, 6.75rem);
  font-weight: 400;
  line-height: 0.98;
  letter-spacing: -0.015em;
  max-width: 12ch;
}
.np-portfolio-subpage-hero div {
  display: grid;
  gap: 1rem;
  align-content: end;
}
.np-portfolio-subpage-hero div p {
  margin: 0;
  color: var(--np-color-muted-foreground, #8a857d);
  font-size: 1rem;
  line-height: 1.75;
}
.np-portfolio-studio-services {
  padding-block: 4rem;
  display: grid;
  grid-template-columns: 12rem 1fr;
  gap: 3rem;
  border-bottom: 1px solid var(--np-color-border, #232323);
}
.np-portfolio-studio-services p {
  margin: 0;
  color: var(--np-color-muted-foreground, #8a857d);
  font-size: 0.75rem;
  letter-spacing: 0.16em;
  text-transform: uppercase;
}
.np-portfolio-studio-services ul {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 0.8rem;
}
.np-portfolio-studio-services li {
  padding: 1rem;
  border: 1px solid var(--np-color-border, #232323);
  background: var(--np-color-card, #141414);
  color: var(--np-color-foreground, #f5f1ea);
}
.np-portfolio-studio-people {
  list-style: none;
  margin: 0;
  padding: 4rem 0 7rem;
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  border-bottom: 1px solid var(--np-color-border, #232323);
}
.np-portfolio-studio-person {
  min-height: 24rem;
  display: flex;
  flex-direction: column;
  justify-content: end;
  padding: 1.5rem;
  border: 1px solid var(--np-color-border, #232323);
  border-inline-end: 0;
  background:
    radial-gradient(circle at 50% 20%, color-mix(in oklab, var(--np-color-accent, #d97a4f) 18%, transparent), transparent 34%),
    var(--np-color-card, #141414);
}
.np-portfolio-studio-person:last-child {
  border-inline-end: 1px solid var(--np-color-border, #232323);
}
.np-portfolio-studio-person p,
.np-portfolio-press-list p {
  margin: 0;
  color: var(--np-color-accent, #d97a4f);
  font-size: 0.72rem;
  letter-spacing: 0.14em;
  text-transform: uppercase;
}
.np-portfolio-studio-person h2,
.np-portfolio-journal-list h2,
.np-portfolio-press-list h2 {
  margin: 0.5rem 0 0;
  font-family: var(--np-font-display, "Instrument Serif", serif);
  font-size: clamp(1.9rem, 3vw, 3rem);
  font-weight: 400;
  line-height: 1;
}
.np-portfolio-studio-person span {
  margin-top: 1rem;
  color: var(--np-color-muted-foreground, #8a857d);
  line-height: 1.65;
}
.np-portfolio-journal-list,
.np-portfolio-press-list {
  list-style: none;
  margin: 0;
  padding: 3rem 0 7rem;
  display: grid;
  border-bottom: 1px solid var(--np-color-border, #232323);
}
.np-portfolio-journal-list li,
.np-portfolio-press-list li {
  border-top: 1px solid var(--np-color-border, #232323);
}
.np-portfolio-journal-list li:last-child,
.np-portfolio-press-list li:last-child {
  border-bottom: 1px solid var(--np-color-border, #232323);
}
.np-portfolio-journal-list a,
.np-portfolio-press-list li {
  display: grid;
  grid-template-columns: 11rem minmax(0, 1fr);
  gap: 2rem;
  padding-block: 1.6rem;
  text-decoration: none;
}
.np-portfolio-journal-list time,
.np-portfolio-press-list span {
  color: var(--np-color-muted-foreground, #8a857d);
  font-size: 0.8rem;
  font-feature-settings: "tnum";
}
.np-portfolio-journal-list p {
  max-width: 42rem;
  margin: 0.75rem 0 0;
  color: var(--np-color-muted-foreground, #8a857d);
  line-height: 1.7;
}
.np-portfolio-journal-list a:hover h2 {
  color: var(--np-color-accent, #d97a4f);
}
@media (max-width: 920px) {
  .np-portfolio-subpage-hero,
  .np-portfolio-studio-services,
  .np-portfolio-journal-list a,
  .np-portfolio-press-list li {
    grid-template-columns: 1fr;
  }
  .np-portfolio-studio-services ul,
  .np-portfolio-studio-people {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .np-portfolio-studio-person:nth-child(2n) {
    border-inline-end: 1px solid var(--np-color-border, #232323);
  }
}
@media (max-width: 640px) {
  .np-portfolio-container {
    padding: 0 1rem;
  }
  .np-portfolio-subpage-hero {
    padding-block: 4rem 2rem;
    gap: 2rem;
  }
  .np-portfolio-studio-services ul,
  .np-portfolio-studio-people {
    grid-template-columns: 1fr;
  }
  .np-portfolio-studio-person {
    min-height: 18rem;
    border-inline-end: 1px solid var(--np-color-border, #232323);
  }
}

/* ============================================================
 * Header — sticky, blurred, logo on the left, nav centered,
 * tools (local time + Start-a-project CTA) on the right.
 * ============================================================ */
.np-portfolio-header {
  position: sticky;
  top: 0;
  z-index: 30;
  padding: 1.4rem 0;
  background: color-mix(in oklab, var(--np-color-background, #0a0a0a) 78%, transparent);
  backdrop-filter: saturate(140%) blur(20px);
  -webkit-backdrop-filter: saturate(140%) blur(20px);
}
.np-portfolio-header-inner {
  max-width: 1440px;
  margin: 0 auto;
  padding: 0 2rem;
  display: grid;
  grid-template-columns: auto 1fr auto;
  align-items: center;
  gap: 3rem;
}
.np-portfolio-logo {
  font-family: var(--np-font-display, "Instrument Serif", "Times New Roman", serif);
  font-style: italic;
  font-size: 1.65rem;
  letter-spacing: -0.01em;
  text-decoration: none;
  line-height: 1;
  color: inherit;
  white-space: nowrap;
}
.np-portfolio-logo-amp {
  color: var(--np-color-accent, #d97a4f);
}
.np-portfolio-nav {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  gap: 2.5rem;
  justify-self: center;
  font-size: 0.825rem;
  letter-spacing: 0.04em;
}
.np-portfolio-nav a {
  text-decoration: none;
  color: var(--np-color-muted-foreground, #8a857d);
  position: relative;
  padding: 0.2rem 0;
}
.np-portfolio-nav a:hover,
.np-portfolio-nav a[aria-current="page"] {
  color: var(--np-color-foreground, #f5f1ea);
}
.np-portfolio-nav a[aria-current="page"]::after {
  content: "";
  position: absolute;
  left: 0;
  right: 0;
  bottom: -3px;
  height: 1px;
  background: var(--np-color-foreground, #f5f1ea);
}
.np-portfolio-header-tools {
  display: flex;
  gap: 1rem;
  align-items: center;
  font-size: 0.825rem;
}
.np-portfolio-header-meta {
  color: var(--np-color-muted-foreground, #8a857d);
  font-feature-settings: "tnum";
}
.np-portfolio-cta {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.5rem 1rem 0.5rem 1.15rem;
  font-size: 0.825rem;
  font-weight: 500;
  color: var(--np-color-background, #0a0a0a);
  background: var(--np-color-foreground, #f5f1ea);
  border-radius: 999px;
  text-decoration: none;
  transition: opacity 0.15s ease;
}
.np-portfolio-cta::after {
  content: "→";
  font-family: var(--np-font-display, "Instrument Serif", serif);
  font-style: italic;
  font-size: 1rem;
}
.np-portfolio-cta:hover { opacity: 0.85; }
@media (max-width: 880px) {
  .np-portfolio-header-inner {
    grid-template-columns: auto auto;
    gap: 1rem;
  }
  .np-portfolio-nav { display: none; }
}
@media (max-width: 720px) {
  .np-portfolio-header-meta { display: none; }
}

/* ============================================================
 * Hero — eyebrow with dot + display headline + 3 meta blocks.
 * ============================================================ */
.np-portfolio-hero {
  padding: 6rem 0 3rem;
}
.np-portfolio-hero-eyebrow {
  display: inline-flex;
  align-items: center;
  gap: 0.7rem;
  font-size: 0.75rem;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: var(--np-color-muted-foreground, #8a857d);
  margin: 0 0 2rem;
}
.np-portfolio-hero-eyebrow::before {
  content: "";
  width: 1.75rem;
  height: 1px;
  background: var(--np-color-muted-foreground, #8a857d);
}
.np-portfolio-hero-eyebrow-dot {
  width: 0.45rem;
  height: 0.45rem;
  border-radius: 50%;
  background: var(--np-color-accent, #d97a4f);
  box-shadow: 0 0 0 3px color-mix(in oklab, var(--np-color-accent, #d97a4f) 25%, transparent);
}
.np-portfolio-hero h1 {
  font-family: var(--np-font-display, "Instrument Serif", "Times New Roman", serif);
  font-weight: 400;
  font-size: clamp(3.2rem, 9vw, 8.5rem);
  letter-spacing: -0.025em;
  line-height: 0.96;
  margin: 0 0 2rem;
  max-width: 18ch;
  text-wrap: balance;
}
.np-portfolio-hero h1 em {
  font-style: italic;
  color: var(--np-color-accent, #d97a4f);
  font-weight: 400;
}
.np-portfolio-hero-meta {
  display: grid;
  grid-template-columns: 1.2fr 1fr 1fr;
  gap: 2.5rem;
  padding-top: 2.5rem;
  margin-top: 1.5rem;
  border-top: 1px solid var(--np-color-border, #232323);
  max-width: 1100px;
}
@media (max-width: 760px) {
  .np-portfolio-hero-meta {
    grid-template-columns: 1fr;
    gap: 1.25rem;
  }
}
.np-portfolio-hero-meta-block-label {
  font-size: 0.72rem;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: var(--np-color-muted-foreground, #8a857d);
  margin: 0 0 0.6rem;
}
.np-portfolio-hero-meta-block-value {
  font-family: var(--np-font-display, "Instrument Serif", serif);
  font-style: italic;
  font-size: 1.35rem;
  line-height: 1.35;
  color: var(--np-color-foreground, #f5f1ea);
  margin: 0;
  text-wrap: pretty;
}

/* ============================================================
 * Index controls — filter tablist + grid/list view toggle.
 * ============================================================ */
.np-portfolio-controls {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 2.5rem 0 1.5rem;
  gap: 1rem;
  flex-wrap: wrap;
}
.np-portfolio-filters {
  display: flex;
  gap: 0.4rem;
  list-style: none;
  padding: 0;
  margin: 0;
  flex-wrap: wrap;
}
.np-portfolio-filters a {
  display: inline-flex;
  align-items: baseline;
  gap: 0.35rem;
  padding: 0.45rem 0.95rem;
  font-size: 0.825rem;
  color: var(--np-color-muted-foreground, #8a857d);
  border: 1px solid var(--np-color-border, #232323);
  border-radius: 999px;
  text-decoration: none;
  transition: color 0.15s ease, border-color 0.15s ease, background 0.15s ease;
}
.np-portfolio-filters a:hover {
  color: var(--np-color-foreground, #f5f1ea);
  border-color: var(--np-color-muted-foreground, #8a857d);
}
.np-portfolio-filters a[data-active="true"] {
  background: var(--np-color-foreground, #f5f1ea);
  color: var(--np-color-background, #0a0a0a);
  border-color: var(--np-color-foreground, #f5f1ea);
}
.np-portfolio-filters a sup {
  font-size: 0.65rem;
  opacity: 0.7;
  top: 0;
}
.np-portfolio-view {
  display: inline-flex;
  align-items: center;
  gap: 0.7rem;
  font-size: 0.78rem;
  color: var(--np-color-muted-foreground, #8a857d);
  letter-spacing: 0.04em;
}
.np-portfolio-view-toggle {
  display: inline-flex;
  border: 1px solid var(--np-color-border, #232323);
  border-radius: 7px;
}
.np-portfolio-view-toggle button {
  padding: 0.4rem 0.6rem;
  background: transparent;
  border: 0;
  color: var(--np-color-muted-foreground, #8a857d);
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.np-portfolio-view-toggle button[aria-pressed="true"] {
  background: var(--np-color-muted, #1a1a1a);
  color: var(--np-color-foreground, #f5f1ea);
}

/* ============================================================
 * Project grid — 12-col asymmetric layout with span-N cards.
 * Cards scale their cover image inner block on hover.
 * ============================================================ */
.np-portfolio-grid {
  display: grid;
  grid-template-columns: repeat(12, 1fr);
  gap: 1.5rem 1.5rem;
  padding-bottom: 4rem;
  list-style: none;
  margin: 0;
}
.np-portfolio-card {
  text-decoration: none;
  color: inherit;
  display: block;
  position: relative;
}
.np-portfolio-card-cover {
  position: relative;
  overflow: hidden;
  aspect-ratio: 4 / 3;
  background: var(--np-color-muted, #1a1a1a);
}
.np-portfolio-card-cover-inner {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: transform 0.6s cubic-bezier(0.2, 0.8, 0.2, 1);
}
.np-portfolio-card:hover .np-portfolio-card-cover-inner {
  transform: scale(1.04);
}
.np-portfolio-card-fig {
  font-family: var(--np-font-display, "Instrument Serif", serif);
  font-style: italic;
  font-size: clamp(3rem, 6vw, 6rem);
  font-weight: 400;
  color: rgba(245, 241, 234, 0.18);
  letter-spacing: -0.03em;
  line-height: 1;
  max-width: 90%;
  text-align: center;
  overflow-wrap: anywhere;
}
.np-portfolio-card-meta {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  padding: 1rem 0 0;
  gap: 1rem;
}
.np-portfolio-card-title {
  font-family: var(--np-font-display, "Instrument Serif", serif);
  font-weight: 400;
  font-size: 1.5rem;
  line-height: 1.15;
  letter-spacing: -0.01em;
  margin: 0;
  color: inherit;
}
.np-portfolio-card-title em { font-style: italic; }
.np-portfolio-card-year {
  font-size: 0.78rem;
  color: var(--np-color-muted-foreground, #8a857d);
  font-feature-settings: "tnum";
  flex-shrink: 0;
}
.np-portfolio-card-discipline {
  font-size: 0.78rem;
  color: var(--np-color-muted-foreground, #8a857d);
  margin: 0.3rem 0 0;
  letter-spacing: 0.02em;
}
.np-portfolio-card-discipline span {
  color: color-mix(in oklab, var(--np-color-muted-foreground, #8a857d) 60%, transparent);
  margin: 0 0.5rem;
}

/* Cover gradient variants — drop-in for cards without an image. */
.np-portfolio-cover-a,
.np-cover-a { background: linear-gradient(140deg, #2a2018 0%, #d97a4f 100%); }
.np-portfolio-cover-b,
.np-cover-b { background: linear-gradient(140deg, #1a2230 0%, #4f6e8a 100%); }
.np-portfolio-cover-c,
.np-cover-c { background: linear-gradient(140deg, #2a2a1a 0%, #8a7f4f 100%); }
.np-portfolio-cover-d,
.np-cover-d { background: linear-gradient(140deg, #1f2a1f 0%, #4f8a5f 100%); }
.np-portfolio-cover-e,
.np-cover-e { background: linear-gradient(140deg, #2a1a2a 0%, #8a4f7a 100%); }
.np-portfolio-cover-f,
.np-cover-f { background: linear-gradient(140deg, #1a1a1a 0%, #3a3a3a 100%); }
.np-portfolio-cover-g,
.np-cover-g { background: linear-gradient(140deg, #2a1f1a 0%, #b06a3a 100%); }
.np-portfolio-cover-h,
.np-cover-h { background: linear-gradient(140deg, #1a2a2a 0%, #4f8a8a 100%); }

.np-portfolio-cover-a::after,
.np-portfolio-cover-b::after,
.np-portfolio-cover-c::after,
.np-portfolio-cover-d::after,
.np-portfolio-cover-e::after,
.np-portfolio-cover-f::after,
.np-portfolio-cover-g::after,
.np-portfolio-cover-h::after,
.np-cover-a::after,
.np-cover-b::after,
.np-cover-c::after,
.np-cover-d::after,
.np-cover-e::after,
.np-cover-f::after,
.np-cover-g::after,
.np-cover-h::after {
  content: "";
  position: absolute;
  inset: 0;
  background:
    radial-gradient(ellipse 70% 50% at 30% 30%, rgba(255, 255, 255, 0.12), transparent 60%),
    radial-gradient(ellipse 50% 60% at 70% 80%, rgba(0, 0, 0, 0.35), transparent 60%);
  pointer-events: none;
}
.np-portfolio-card-cover[data-has-image="true"]::after { content: none; }

/* Asymmetric grid spans. Cards default to span-6; templates
 * promote selected cards to span-7 / 8 / 12 for the editorial
 * mosaic feel. */
.np-portfolio-grid > li,
.np-portfolio-grid > .np-portfolio-card { grid-column: span 6; }
.span-12, .np-portfolio-span-12 { grid-column: span 12; }
.span-8, .np-portfolio-span-8 { grid-column: span 8; }
.span-7, .np-portfolio-span-7 { grid-column: span 7; }
.span-6, .np-portfolio-span-6 { grid-column: span 6; }
.span-5, .np-portfolio-span-5 { grid-column: span 5; }
.span-4, .np-portfolio-span-4 { grid-column: span 4; }

.span-7 .np-portfolio-card-cover { aspect-ratio: 16/10; }
.span-8 .np-portfolio-card-cover { aspect-ratio: 16/9; }
.span-12 .np-portfolio-card-cover { aspect-ratio: 21/9; }
.span-5 .np-portfolio-card-cover,
.span-6 .np-portfolio-card-cover { aspect-ratio: 4/3; }
.span-4 .np-portfolio-card-cover { aspect-ratio: 3/4; }

@media (max-width: 980px) {
  .np-portfolio-grid { gap: 2rem 1rem; }
  .span-4, .span-5, .span-6, .span-7, .span-8 {
    grid-column: span 12;
  }
  .span-7 .np-portfolio-card-cover,
  .span-8 .np-portfolio-card-cover { aspect-ratio: 16/10; }
  .span-12 .np-portfolio-card-cover { aspect-ratio: 16/10; }
}

/* Featured-corner badge — top-left chip on the cover. */
.np-portfolio-card-badge {
  position: absolute;
  top: 1rem;
  left: 1rem;
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  padding: 0.3rem 0.65rem;
  font-size: 0.7rem;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: var(--np-color-background, #0a0a0a);
  background: var(--np-color-foreground, #f5f1ea);
  border-radius: 999px;
  z-index: 2;
}
.np-portfolio-card-badge.accent {
  background: var(--np-color-accent, #d97a4f);
  color: var(--np-color-background, #0a0a0a);
}

/* ============================================================
 * Studio strip — 2-col text + 2x2 stats grid.
 * ============================================================ */
.np-portfolio-studio {
  padding: 7rem 0 6rem;
  border-top: 1px solid var(--np-color-border, #232323);
}
.np-portfolio-studio-grid {
  display: grid;
  grid-template-columns: 1.4fr 1fr;
  gap: 4rem;
  align-items: start;
}
@media (max-width: 880px) {
  .np-portfolio-studio-grid {
    grid-template-columns: 1fr;
    gap: 2.5rem;
  }
}
.np-portfolio-studio-eyebrow {
  font-size: 0.75rem;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: var(--np-color-accent, #d97a4f);
  margin: 0 0 2rem;
}
.np-portfolio-studio h2 {
  font-family: var(--np-font-display, "Instrument Serif", serif);
  font-weight: 400;
  font-size: clamp(2.2rem, 4.5vw, 3.4rem);
  letter-spacing: -0.02em;
  line-height: 1.1;
  margin: 0 0 1.5rem;
  max-width: 22ch;
  text-wrap: balance;
}
.np-portfolio-studio h2 em {
  font-style: italic;
  color: var(--np-color-accent, #d97a4f);
}
.np-portfolio-studio p {
  font-size: 1rem;
  line-height: 1.65;
  color: var(--np-color-muted-foreground, #8a857d);
  margin: 0 0 1rem;
  max-width: 36rem;
}
.np-portfolio-studio-stats {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 2rem 1.5rem;
}
.np-portfolio-studio-stat {
  padding-top: 1rem;
  border-top: 1px solid var(--np-color-border, #232323);
}
.np-portfolio-studio-stat-value {
  font-family: var(--np-font-display, "Instrument Serif", serif);
  font-style: italic;
  font-size: 2.5rem;
  line-height: 1;
  margin: 0 0 0.5rem;
  color: var(--np-color-foreground, #f5f1ea);
}
.np-portfolio-studio-stat-label {
  font-size: 0.78rem;
  letter-spacing: 0.05em;
  color: var(--np-color-muted-foreground, #8a857d);
  margin: 0;
}

/* ============================================================
 * Contact strip — large mailto link + meta links below.
 * ============================================================ */
.np-portfolio-contact {
  padding: 7rem 0;
  border-top: 1px solid var(--np-color-border, #232323);
  text-align: center;
}
.np-portfolio-contact-eyebrow {
  font-size: 0.75rem;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: var(--np-color-muted-foreground, #8a857d);
  margin: 0 0 1.5rem;
}
.np-portfolio-contact-mail {
  display: inline-block;
  font-family: var(--np-font-display, "Instrument Serif", serif);
  font-style: italic;
  font-size: clamp(2.4rem, 6vw, 5rem);
  letter-spacing: -0.02em;
  line-height: 1.05;
  color: var(--np-color-foreground, #f5f1ea);
  text-decoration: none;
  border-bottom: 1px solid var(--np-color-border, #232323);
  padding-bottom: 0.15em;
  transition: color 0.2s ease, border-color 0.2s ease;
}
.np-portfolio-contact-mail:hover {
  color: var(--np-color-accent, #d97a4f);
  border-bottom-color: var(--np-color-accent, #d97a4f);
}
.np-portfolio-contact-meta {
  margin-top: 2rem;
  font-size: 0.85rem;
  color: var(--np-color-muted-foreground, #8a857d);
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 1.25rem;
}
.np-portfolio-contact-meta a { text-decoration: none; }
.np-portfolio-contact-meta a:hover {
  color: var(--np-color-foreground, #f5f1ea);
}

/* ============================================================
 * Footer — thin meta row with a live-pulse "open" indicator
 * (decorative; sites that want a real on/off signal wire it
 * via settings or a plugin).
 * ============================================================ */
.np-portfolio-footer {
  padding: 2.5rem 0 2rem;
  border-top: 1px solid var(--np-color-border, #232323);
  font-size: 0.78rem;
  color: var(--np-color-muted-foreground, #8a857d);
}
.np-portfolio-footer-inner {
  max-width: 1440px;
  margin: 0 auto;
  padding: 0 2rem;
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 1rem;
  flex-wrap: wrap;
}
.np-portfolio-footer-left {
  display: flex;
  gap: 1.5rem;
  align-items: center;
}
.np-portfolio-footer-clock {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
}
.np-portfolio-footer-clock-dot {
  width: 0.4rem;
  height: 0.4rem;
  border-radius: 50%;
  background: #10b981;
  box-shadow: 0 0 0 2px color-mix(in oklab, #10b981 30%, transparent);
}
.np-portfolio-footer-right {
  display: flex;
  gap: 1.5rem;
}
.np-portfolio-footer-right a { text-decoration: none; }
.np-portfolio-footer-right a:hover {
  color: var(--np-color-foreground, #f5f1ea);
}

/* ============================================================
 * Mobile drawer — hidden on desktop, used by the mobile nav.
 * ============================================================ */
.np-portfolio-nav-drawer {
  position: fixed;
  inset: 0;
  background: var(--np-color-background, #0a0a0a);
  color: var(--np-color-foreground, #f5f1ea);
  padding: 1.5rem 2rem;
  display: flex;
  flex-direction: column;
  gap: 1rem;
  z-index: 50;
}
.np-portfolio-nav-drawer-list {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 1rem;
}
.np-portfolio-nav-drawer a {
  font-family: var(--np-font-display, "Instrument Serif", serif);
  font-size: 2rem;
  text-decoration: none;
  color: inherit;
}

/* ============================================================
 * Project detail / page templates — narrower columns, generous
 * vertical rhythm matching the index hero's display ramp.
 * ============================================================ */
.np-portfolio-detail {
  padding: 4rem 0 6rem;
}
.np-portfolio-detail h1 {
  font-family: var(--np-font-display, "Instrument Serif", serif);
  font-weight: 400;
  font-size: clamp(2.6rem, 6vw, 5rem);
  letter-spacing: -0.02em;
  line-height: 0.98;
  margin: 0 0 1.5rem;
  max-width: 22ch;
}
.np-portfolio-detail h1 em {
  font-style: italic;
  color: var(--np-color-accent, #d97a4f);
}
.np-portfolio-detail-body {
  max-width: 720px;
  margin: 0 auto;
  font-size: 1.0625rem;
  line-height: 1.7;
}
.np-portfolio-detail-body p { margin: 0 0 1rem; }

.np-portfolio-page-default {
  max-width: 760px;
  margin: 0 auto;
  padding: 4rem 2rem 6rem;
}
.np-portfolio-page-default h1 {
  font-family: var(--np-font-display, "Instrument Serif", serif);
  font-weight: 400;
  font-size: clamp(2.4rem, 5vw, 4rem);
  letter-spacing: -0.02em;
  line-height: 1;
  margin: 0 0 1.5rem;
}

.np-portfolio-gallery {
  padding: 2rem 0 6rem;
}
.np-portfolio-gallery-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(100%, 18rem), 1fr));
  gap: 1.25rem;
}

/* Empty state for the index when no projects exist yet. */
.np-portfolio-empty {
  padding: 6rem 0;
  text-align: center;
  color: var(--np-color-muted-foreground, #8a857d);
}
.np-portfolio-empty h1 {
  font-family: var(--np-font-display, "Instrument Serif", serif);
  font-style: italic;
  font-size: clamp(2rem, 4vw, 3rem);
  color: var(--np-color-foreground, #f5f1ea);
  margin: 0 0 0.75rem;
}

/* ────────────────────────────────────────────────────────────
 * Project detail template (/work/:slug)
 *
 * Big hero image full-bleed at the top, generous display-serif
 * title + excerpt + meta dl, then renderBlocks() body inside a
 * max-width column. The body wrapper opts back out of the max-
 * width for direct-descendant figures so image blocks render
 * edge-to-edge — matches the docstring intent on
 * ProjectDetailTemplate.
 * ──────────────────────────────────────────────────────────── */
.np-portfolio-project-detail {
  display: flex;
  flex-direction: column;
  gap: 3rem;
  padding-bottom: 6rem;
}
.np-portfolio-project-hero {
  margin: 0;
  width: 100%;
  aspect-ratio: 16 / 9;
  background: var(--np-color-muted, #1a1a1a);
  overflow: hidden;
}
.np-portfolio-project-hero img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.np-portfolio-project-header {
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
  max-width: 56rem;
  margin: 0 auto;
  padding: 0 1.5rem;
  width: 100%;
}
.np-portfolio-project-header h1 {
  font-family: var(--np-font-display, "Instrument Serif", serif);
  font-weight: 400;
  font-size: clamp(2.4rem, 6vw, 5rem);
  line-height: 1;
  letter-spacing: -0.02em;
  color: var(--np-color-foreground, #f5f1ea);
  margin: 0;
  text-wrap: balance;
}
.np-portfolio-project-excerpt {
  font-family: var(--np-font-body, "Hanken Grotesk", sans-serif);
  font-size: clamp(1.125rem, 1.6vw, 1.35rem);
  line-height: 1.5;
  color: var(--np-color-muted-foreground, #8a857d);
  margin: 0;
  max-width: 44rem;
}
.np-portfolio-project-meta {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(8rem, 1fr));
  gap: 1.5rem 2.5rem;
  margin: 1rem 0 0;
  padding: 1.5rem 0 0;
  border-top: 1px solid var(--np-color-border, #232323);
}
.np-portfolio-project-meta dt {
  font-family: var(--np-font-body, "Hanken Grotesk", sans-serif);
  font-size: 0.72rem;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: var(--np-color-muted-foreground, #8a857d);
  margin: 0 0 0.4rem;
}
.np-portfolio-project-meta dd {
  font-family: var(--np-font-display, "Instrument Serif", serif);
  font-size: 1.35rem;
  line-height: 1.2;
  color: var(--np-color-foreground, #f5f1ea);
  margin: 0;
}
.np-portfolio-project-body {
  max-width: 56rem;
  margin: 0 auto;
  padding: 0 1.5rem;
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
}
.np-portfolio-project-body > figure,
.np-portfolio-project-body > .np-block-image {
  width: 100vw;
  max-width: 100vw;
  /* margin-inline keeps the full-bleed trick RTL-safe — the
   * integration test theme-magazine-portfolio.integration rejects
   * physical margin-left/right for directional layout. */
  margin-inline: calc(50% - 50vw);
}

/* ────────────────────────────────────────────────────────────
 * Members shell (PortfolioMembersShell — /members/* routes)
 *
 * Public site uses a wide image-led layout that dwarfs auth
 * forms. The members shell drops the magazine canvas for a
 * narrower centered column. Header + footer chrome stay (re-
 * used directly from the site shell so a masthead change
 * reaches every member page too).
 * ──────────────────────────────────────────────────────────── */
.np-portfolio-members {
  padding: 4rem 1.5rem;
  min-height: 60vh;
}
.np-portfolio-members-column {
  max-width: 30rem;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
}
`;
