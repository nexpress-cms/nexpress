/**
 * `@nexpress/theme-magazine` — CSS layout.
 *
 * Editorial magazine identity: dateline strip at the top, double-
 * rule masthead with a Newsreader display-italic logo, section
 * nav, cover-story lead with a 5/6 hero image, three-up secondary
 * row, dispatches + archive split, subscribe band on a deep-ink
 * surface, three-column colophon footer. Warm cream surface
 * (#f6f1e7), terracotta accent (#b04a26), Newsreader for editorial
 * type and Hanken Grotesk for the chrome.
 *
 * All classes use the `np-magazine-*` prefix so theme swaps don't
 * leave residue. The framework injects this string as a
 * `<style data-np-theme="magazine">` tag at SSR time.
 */
export const magazineCss = `
.np-magazine {
  background: var(--np-color-background, #f6f1e7);
  color: var(--np-color-foreground, #1a1411);
  font-family: var(--np-font-body, "Newsreader", Georgia, "Times New Roman", serif);
  line-height: 1.5;
  -webkit-font-smoothing: antialiased;
}
.np-magazine a { color: inherit; }
.np-magazine img { max-width: 100%; display: block; }
.np-magazine-container {
  max-width: 1240px;
  margin: 0 auto;
  padding: 0 1.75rem;
}

/* ============================================================
 * Dateline strip — top band with date + issue number on the
 * left, secondary links on the right.
 * ============================================================ */
.np-magazine-dateline {
  font-family: var(--np-font-chrome, "Hanken Grotesk", -apple-system, BlinkMacSystemFont, sans-serif);
  font-size: 0.72rem;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: var(--np-color-muted-foreground, #6a5a48);
  border-bottom: 1px solid var(--np-color-border, #d8ccb4);
  padding: 0.6rem 0;
}
.np-magazine-dateline-inner {
  max-width: 1240px;
  margin: 0 auto;
  padding: 0 1.75rem;
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: 1rem;
}
.np-magazine-dateline-left { display: flex; gap: 1.5rem; }
.np-magazine-dateline-right {
  display: flex;
  gap: 1.25rem;
  align-items: center;
}
.np-magazine-dateline-right a {
  text-decoration: none;
  opacity: 0.85;
}
.np-magazine-dateline-right a:hover {
  opacity: 1;
  color: var(--np-color-primary, #b04a26);
}
.np-magazine-dateline-issue {
  color: var(--np-color-primary, #b04a26);
  font-weight: 600;
}

/* ============================================================
 * Masthead — display-italic logo over double-rule border.
 * Ornamental rules with a small caps middle label flank the
 * logo. Section nav sits beneath the logo on a single-line
 * border.
 * ============================================================ */
.np-magazine-header {
  padding: 2.5rem 0 1rem;
  text-align: center;
  border-bottom: 4px double var(--np-color-rule, #1a1411);
  position: relative;
}
.np-magazine-masthead-ornaments {
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 1.5rem;
  font-family: var(--np-font-chrome, "Hanken Grotesk", sans-serif);
  font-size: 0.7rem;
  letter-spacing: 0.22em;
  text-transform: uppercase;
  color: var(--np-color-muted-foreground, #6a5a48);
  margin: 0 0 1rem;
}
.np-magazine-masthead-rule {
  flex: 1;
  max-width: 4rem;
  height: 1px;
  background: var(--np-color-foreground, #1a1411);
  opacity: 0.4;
}
.np-magazine-logo {
  display: block;
  font-family: var(--np-font-heading, "Newsreader", "EB Garamond", Georgia, "Times New Roman", serif);
  font-weight: 800;
  font-style: italic;
  font-size: clamp(2.75rem, 7vw, 5.5rem);
  letter-spacing: -0.02em;
  line-height: 0.95;
  margin: 0 auto 0.4rem;
  text-decoration: none;
  color: inherit;
  max-width: 18ch;
  font-variation-settings: "opsz" 72;
}
.np-magazine-tagline {
  font-family: var(--np-font-body, "Newsreader", Georgia, serif);
  font-style: italic;
  font-size: 1.1rem;
  color: var(--np-color-muted-foreground, #6a5a48);
  margin: 0 0 1.5rem;
}
.np-magazine-sections {
  list-style: none;
  margin: 0;
  padding: 1rem 0 0.25rem;
  border-top: 1px solid var(--np-color-border, #d8ccb4);
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 2.25rem;
  font-family: var(--np-font-chrome, "Hanken Grotesk", sans-serif);
  font-size: 0.78rem;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  font-weight: 500;
}
.np-magazine-sections a {
  text-decoration: none;
  color: inherit;
  padding-bottom: 0.3rem;
  border-bottom: 2px solid transparent;
  transition: border-color 0.2s ease, color 0.2s ease;
}
.np-magazine-sections a:hover,
.np-magazine-sections a[aria-current="page"] {
  border-bottom-color: var(--np-color-primary, #b04a26);
  color: var(--np-color-primary, #b04a26);
}
.np-magazine-nav-item { position: relative; }
.np-magazine-subnav {
  position: absolute;
  top: 100%;
  left: 50%;
  transform: translateX(-50%);
  display: none;
  min-width: 12rem;
  padding: 0.5rem 0;
  margin: 0.25rem 0 0;
  list-style: none;
  background: var(--np-color-background, #f6f1e7);
  border: 1px solid var(--np-color-border, #d8ccb4);
  z-index: 10;
}
.np-magazine-nav-item:hover > .np-magazine-subnav,
.np-magazine-nav-item:focus-within > .np-magazine-subnav { display: block; }
.np-magazine-subnav li { padding: 0; }
.np-magazine-subnav a {
  display: block;
  padding: 0.4rem 1rem;
  border-bottom: 0;
  letter-spacing: 0.04em;
}

/* ============================================================
 * Index page — cover-story lead + 3-up secondary + dispatches /
 * archive split.
 * ============================================================ */
.np-magazine-index {
  padding: 3rem 0 0;
}

/* Lead (cover story) — left cover panel + right body block. */
.np-magazine-lead {
  display: grid;
  grid-template-columns: 1.05fr 1fr;
  gap: 3.5rem;
  align-items: center;
  padding-bottom: 3.5rem;
  border-bottom: 1px solid var(--np-color-border, #d8ccb4);
}
@media (max-width: 880px) {
  .np-magazine-lead {
    grid-template-columns: 1fr;
    gap: 1.5rem;
  }
}
.np-magazine-lead-cover {
  position: relative;
  aspect-ratio: 5/6;
  overflow: hidden;
  background: linear-gradient(160deg, #2a1810 0%, #5e2e1b 50%, #b04a26 100%);
}
.np-magazine-lead-cover::before {
  content: "";
  position: absolute;
  inset: 0;
  background:
    radial-gradient(ellipse 70% 50% at 30% 30%, rgba(252, 250, 243, 0.18), transparent 60%),
    radial-gradient(ellipse 50% 60% at 70% 80%, rgba(0, 0, 0, 0.4), transparent 60%);
}
.np-magazine-lead-cover-figure {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-family: var(--np-font-heading, "Newsreader", Georgia, serif);
  font-style: italic;
  font-weight: 800;
  font-size: clamp(8rem, 14vw, 14rem);
  letter-spacing: -0.05em;
  color: rgba(252, 250, 243, 0.12);
  line-height: 0.85;
  text-shadow: 0 4px 24px rgba(0, 0, 0, 0.25);
}
.np-magazine-lead-cover-caption {
  position: absolute;
  left: 1.25rem;
  bottom: 1.25rem;
  font-family: var(--np-font-chrome, "Hanken Grotesk", sans-serif);
  font-size: 0.7rem;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: rgba(252, 250, 243, 0.7);
}
.np-magazine-lead-body { max-width: 36rem; }
.np-magazine-lead-kicker {
  font-family: var(--np-font-chrome, "Hanken Grotesk", sans-serif);
  font-size: 0.72rem;
  letter-spacing: 0.22em;
  text-transform: uppercase;
  color: var(--np-color-primary, #b04a26);
  font-weight: 600;
  margin: 0 0 1rem;
  display: inline-flex;
  align-items: center;
  gap: 0.7rem;
}
.np-magazine-lead-kicker::after {
  content: "";
  width: 1.5rem;
  height: 1px;
  background: var(--np-color-primary, #b04a26);
}
.np-magazine-lead-title {
  font-family: var(--np-font-heading, "Newsreader", Georgia, serif);
  font-weight: 700;
  font-size: clamp(2.2rem, 4.4vw, 3.75rem);
  line-height: 1.04;
  letter-spacing: -0.018em;
  margin: 0 0 1rem;
  text-wrap: balance;
  font-variation-settings: "opsz" 60;
}
.np-magazine-lead-deck {
  font-style: italic;
  font-size: 1.2rem;
  line-height: 1.55;
  color: var(--np-color-muted-foreground, #6a5a48);
  margin: 0 0 1.75rem;
  max-width: 32rem;
  text-wrap: pretty;
}
.np-magazine-byline {
  display: flex;
  align-items: center;
  gap: 0.85rem;
  padding: 1rem 0;
  border-top: 1px solid var(--np-color-border, #d8ccb4);
  border-bottom: 1px solid var(--np-color-border, #d8ccb4);
  font-family: var(--np-font-chrome, "Hanken Grotesk", sans-serif);
  font-size: 0.78rem;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--np-color-muted-foreground, #6a5a48);
}
.np-magazine-byline-author {
  color: var(--np-color-foreground, #1a1411);
  font-weight: 600;
  letter-spacing: 0.04em;
}
.np-magazine-byline-sep { opacity: 0.35; }
.np-magazine-byline-link {
  margin-inline-start: auto;
  text-decoration: none;
  color: var(--np-color-primary, #b04a26);
  letter-spacing: 0.18em;
  font-weight: 600;
}
.np-magazine-byline-link:hover { color: var(--np-color-foreground, #1a1411); }

/* Section heading rule — eyebrow with rule on the left. */
.np-magazine-rule-head {
  display: flex;
  align-items: center;
  gap: 1.25rem;
  margin: 3.5rem 0 2rem;
  font-family: var(--np-font-chrome, "Hanken Grotesk", sans-serif);
  font-size: 0.78rem;
  letter-spacing: 0.22em;
  text-transform: uppercase;
  color: var(--np-color-muted-foreground, #6a5a48);
}
.np-magazine-rule-head::before,
.np-magazine-rule-head::after {
  content: "";
  height: 1px;
  flex: 1;
  background: var(--np-color-border, #d8ccb4);
}
.np-magazine-rule-head::before { max-width: 4rem; }

/* Three-up secondary stories. */
.np-magazine-row {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 2.75rem;
  padding-bottom: 3.5rem;
  border-bottom: 1px solid var(--np-color-border, #d8ccb4);
  list-style: none;
  margin: 0;
  padding-inline: 0;
  padding-top: 0;
}
@media (max-width: 880px) {
  .np-magazine-row { grid-template-columns: 1fr; gap: 2.25rem; }
}
.np-magazine-story {
  text-decoration: none;
  color: inherit;
  display: block;
}
.np-magazine-story-cover {
  aspect-ratio: 4 / 3;
  overflow: hidden;
  position: relative;
  margin: 0 0 1.1rem;
}
.np-magazine-story-cover-figure {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-family: var(--np-font-heading, "Newsreader", Georgia, serif);
  font-style: italic;
  font-weight: 800;
  font-size: 5rem;
  color: rgba(252, 250, 243, 0.18);
  letter-spacing: -0.04em;
}
.np-magazine-cover-2 { background: linear-gradient(150deg, #4a3a2a, #b8966a); }
.np-magazine-cover-3 { background: linear-gradient(150deg, #1f3a3a, #5a8c8c); }
.np-magazine-cover-4 { background: linear-gradient(150deg, #3a1f3a, #8c5a8c); }
.np-magazine-cover-5 { background: linear-gradient(150deg, #2a3a1f, #6a8c4a); }
.np-magazine-cover-6 { background: linear-gradient(150deg, #3a2a1f, #b07840); }
.np-magazine-cover-7 { background: linear-gradient(150deg, #1f1f3a, #4a4a8c); }

.np-magazine-story-kicker {
  font-family: var(--np-font-chrome, "Hanken Grotesk", sans-serif);
  font-size: 0.7rem;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: var(--np-color-primary, #b04a26);
  font-weight: 600;
  margin: 0 0 0.5rem;
}
.np-magazine-story-title {
  font-family: var(--np-font-heading, "Newsreader", Georgia, serif);
  font-weight: 700;
  font-size: 1.5rem;
  line-height: 1.18;
  letter-spacing: -0.012em;
  margin: 0 0 0.55rem;
  text-wrap: balance;
}
.np-magazine-story-excerpt {
  font-style: italic;
  font-size: 1rem;
  line-height: 1.55;
  color: var(--np-color-muted-foreground, #6a5a48);
  margin: 0 0 0.75rem;
}
.np-magazine-story-byline {
  font-family: var(--np-font-chrome, "Hanken Grotesk", sans-serif);
  font-size: 0.72rem;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--np-color-muted-foreground, #6a5a48);
}
.np-magazine-story-byline strong {
  color: var(--np-color-foreground, #1a1411);
  font-weight: 600;
}

/* ============================================================
 * Asymmetric editorial grid — dispatches column on the left,
 * archive grid on the right. Both lead with a small-caps
 * double-rule eyebrow.
 * ============================================================ */
.np-magazine-split {
  display: grid;
  grid-template-columns: 1fr 2fr;
  gap: 4rem;
  padding: 3.5rem 0;
}
@media (max-width: 880px) {
  .np-magazine-split { grid-template-columns: 1fr; gap: 2.5rem; }
}

.np-magazine-dispatches-head {
  font-family: var(--np-font-chrome, "Hanken Grotesk", sans-serif);
  font-size: 0.78rem;
  letter-spacing: 0.22em;
  text-transform: uppercase;
  color: var(--np-color-primary, #b04a26);
  padding-bottom: 0.75rem;
  border-bottom: 3px double var(--np-color-rule, #1a1411);
  margin: 0 0 1.5rem;
  font-weight: 600;
}
.np-magazine-dispatches {
  list-style: none;
  margin: 0;
  padding: 0;
}
.np-magazine-dispatch {
  padding: 1.25rem 0;
  border-bottom: 1px solid var(--np-color-border, #d8ccb4);
}
.np-magazine-dispatch:first-child { padding-top: 0; }
.np-magazine-dispatch:last-child { border-bottom: none; }
.np-magazine-dispatch-time {
  font-family: var(--np-font-chrome, "Hanken Grotesk", sans-serif);
  font-size: 0.68rem;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: var(--np-color-muted-foreground, #6a5a48);
  margin: 0 0 0.4rem;
}
.np-magazine-dispatch-title {
  font-family: var(--np-font-heading, "Newsreader", Georgia, serif);
  font-weight: 600;
  font-size: 1.1rem;
  line-height: 1.3;
  margin: 0 0 0.35rem;
  text-decoration: none;
  color: inherit;
  display: block;
}
.np-magazine-dispatch-title:hover { color: var(--np-color-primary, #b04a26); }
.np-magazine-dispatch-excerpt {
  font-size: 0.93rem;
  font-style: italic;
  color: var(--np-color-muted-foreground, #6a5a48);
  margin: 0;
  line-height: 1.5;
}

/* Archive grid — 2-col list with small thumbnail. */
.np-magazine-archive-head {
  font-family: var(--np-font-chrome, "Hanken Grotesk", sans-serif);
  font-size: 0.78rem;
  letter-spacing: 0.22em;
  text-transform: uppercase;
  color: var(--np-color-primary, #b04a26);
  padding-bottom: 0.75rem;
  border-bottom: 3px double var(--np-color-rule, #1a1411);
  margin: 0 0 1.5rem;
  font-weight: 600;
  display: flex;
  justify-content: space-between;
  align-items: baseline;
}
.np-magazine-archive-head a {
  text-decoration: none;
  font-size: 0.7rem;
  letter-spacing: 0.16em;
  color: var(--np-color-foreground, #1a1411);
}
.np-magazine-archive-head a:hover { color: var(--np-color-primary, #b04a26); }
.np-magazine-archive {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 2rem 2.5rem;
  list-style: none;
  padding: 0;
  margin: 0;
}
@media (max-width: 680px) { .np-magazine-archive { grid-template-columns: 1fr; } }
.np-magazine-archive-item {
  display: grid;
  grid-template-columns: 4.5rem 1fr;
  gap: 1rem;
  padding-bottom: 1.5rem;
  border-bottom: 1px solid var(--np-color-border, #d8ccb4);
  text-decoration: none;
  color: inherit;
}
.np-magazine-archive-item:hover .np-magazine-archive-item-title {
  color: var(--np-color-primary, #b04a26);
}
.np-magazine-archive-item-cover {
  aspect-ratio: 1;
  background: var(--np-color-muted, #ece4d3);
  overflow: hidden;
  position: relative;
}
.np-magazine-archive-item-cover-fig {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-family: var(--np-font-heading, "Newsreader", Georgia, serif);
  font-style: italic;
  font-size: 2rem;
  color: rgba(252, 250, 243, 0.35);
  font-weight: 700;
}
.np-magazine-archive-item-section {
  font-family: var(--np-font-chrome, "Hanken Grotesk", sans-serif);
  font-size: 0.65rem;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: var(--np-color-muted-foreground, #6a5a48);
  margin: 0 0 0.35rem;
}
.np-magazine-archive-item-title {
  font-family: var(--np-font-heading, "Newsreader", Georgia, serif);
  font-weight: 600;
  font-size: 1.05rem;
  line-height: 1.25;
  margin: 0 0 0.35rem;
  transition: color 0.2s ease;
}
.np-magazine-archive-item-byline {
  font-family: var(--np-font-chrome, "Hanken Grotesk", sans-serif);
  font-size: 0.7rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--np-color-muted-foreground, #6a5a48);
}

/* ============================================================
 * Subscribe band — deep-ink full-bleed strip with double-rule
 * top + bottom, italic display headline, terracotta eyebrow.
 * ============================================================ */
.np-magazine-subscribe {
  background: var(--np-color-foreground, #1a1411);
  color: var(--np-color-background, #f6f1e7);
  padding: 4rem 0;
  margin-top: 1rem;
  position: relative;
  overflow: hidden;
}
.np-magazine-subscribe::before,
.np-magazine-subscribe::after {
  content: "";
  position: absolute;
  left: 0;
  right: 0;
  height: 1px;
  background: color-mix(in oklab, var(--np-color-background, #f6f1e7) 22%, transparent);
}
.np-magazine-subscribe::before {
  top: 1rem;
  box-shadow: 0 4px 0 0
    color-mix(in oklab, var(--np-color-background, #f6f1e7) 22%, transparent);
}
.np-magazine-subscribe::after {
  bottom: 1rem;
  box-shadow: 0 -4px 0 0
    color-mix(in oklab, var(--np-color-background, #f6f1e7) 22%, transparent);
}
.np-magazine-subscribe-inner {
  max-width: 720px;
  margin: 0 auto;
  padding: 0 1.75rem;
  text-align: center;
}
.np-magazine-subscribe-eyebrow {
  font-family: var(--np-font-chrome, "Hanken Grotesk", sans-serif);
  font-size: 0.72rem;
  letter-spacing: 0.22em;
  text-transform: uppercase;
  color: var(--np-color-primary, #b04a26);
  margin: 0 0 0.85rem;
  font-weight: 600;
}
.np-magazine-subscribe h2 {
  font-family: var(--np-font-heading, "Newsreader", Georgia, serif);
  font-style: italic;
  font-weight: 600;
  font-size: clamp(1.85rem, 3.4vw, 2.5rem);
  letter-spacing: -0.01em;
  line-height: 1.15;
  margin: 0 0 0.85rem;
  text-wrap: balance;
}
.np-magazine-subscribe p {
  font-style: italic;
  color: color-mix(in oklab, var(--np-color-background, #f6f1e7) 75%, transparent);
  margin: 0 auto 2rem;
  max-width: 32rem;
  line-height: 1.55;
}
.np-magazine-subscribe-form {
  display: flex;
  max-width: 28rem;
  margin: 0 auto;
  gap: 0.5rem;
}
.np-magazine-subscribe-form input {
  flex: 1;
  padding: 0.85rem 1rem;
  font: inherit;
  font-family: var(--np-font-chrome, "Hanken Grotesk", sans-serif);
  font-size: 0.95rem;
  color: var(--np-color-background, #f6f1e7);
  background: transparent;
  border: 1px solid color-mix(in oklab, var(--np-color-background, #f6f1e7) 30%, transparent);
  outline: none;
}
.np-magazine-subscribe-form input::placeholder {
  color: color-mix(in oklab, var(--np-color-background, #f6f1e7) 45%, transparent);
}
.np-magazine-subscribe-form button {
  padding: 0.85rem 1.4rem;
  font-family: var(--np-font-chrome, "Hanken Grotesk", sans-serif);
  font-size: 0.72rem;
  font-weight: 700;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: var(--np-color-foreground, #1a1411);
  background: var(--np-color-background, #f6f1e7);
  border: 1px solid var(--np-color-background, #f6f1e7);
  cursor: pointer;
}
.np-magazine-subscribe-stats {
  margin-top: 1.5rem;
  font-family: var(--np-font-chrome, "Hanken Grotesk", sans-serif);
  font-size: 0.72rem;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: color-mix(in oklab, var(--np-color-background, #f6f1e7) 55%, transparent);
}
.np-magazine-subscribe-stats strong { color: var(--np-color-background, #f6f1e7); }

/* ============================================================
 * Footer — 3-col colophon: brand block / sections / colophon.
 * Display-italic mark + italic colophon text + chrome heading.
 * Double-rule top, hairline bottom for the meta row.
 * ============================================================ */
.np-magazine-footer {
  border-top: 4px double var(--np-color-rule, #1a1411);
  padding: 4rem 0 2rem;
  background: var(--np-color-background-elev, #fcfaf3);
}
.np-magazine-footer-grid {
  display: grid;
  grid-template-columns: 1.5fr 1fr 1fr;
  gap: 3.5rem;
  align-items: start;
  max-width: 1240px;
  margin: 0 auto;
  padding: 0 1.75rem;
}
@media (max-width: 760px) {
  .np-magazine-footer-grid { grid-template-columns: 1fr; gap: 2.5rem; }
}
.np-magazine-footer-mark {
  font-family: var(--np-font-heading, "Newsreader", Georgia, serif);
  font-style: italic;
  font-weight: 700;
  font-size: 2rem;
  line-height: 1.05;
  margin: 0 0 0.5rem;
  letter-spacing: -0.01em;
}
.np-magazine-footer-colophon {
  font-style: italic;
  font-size: 0.95rem;
  line-height: 1.6;
  color: var(--np-color-muted-foreground, #6a5a48);
  margin: 0 0 1.25rem;
}
.np-magazine-footer-meta {
  font-family: var(--np-font-chrome, "Hanken Grotesk", sans-serif);
  font-size: 0.7rem;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--np-color-muted-foreground, #6a5a48);
  margin: 0;
}
.np-magazine-footer-heading {
  font-family: var(--np-font-chrome, "Hanken Grotesk", sans-serif);
  font-size: 0.72rem;
  letter-spacing: 0.22em;
  text-transform: uppercase;
  color: var(--np-color-muted-foreground, #6a5a48);
  font-weight: 700;
  margin: 0 0 1rem;
}
.np-magazine-footer-nav {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
}
.np-magazine-footer-nav a {
  font-family: var(--np-font-heading, "Newsreader", Georgia, serif);
  font-size: 1.1rem;
  text-decoration: none;
  color: inherit;
  border-bottom: 1px solid transparent;
  align-self: start;
}
.np-magazine-footer-nav a:hover { border-bottom-color: currentColor; }
.np-magazine-footer-bottom {
  max-width: 1240px;
  margin: 3rem auto 0;
  padding: 1.5rem 1.75rem 0;
  border-top: 1px solid var(--np-color-border, #d8ccb4);
  display: flex;
  justify-content: space-between;
  gap: 1rem;
  flex-wrap: wrap;
  font-family: var(--np-font-chrome, "Hanken Grotesk", sans-serif);
  font-size: 0.72rem;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--np-color-muted-foreground, #6a5a48);
}
.np-magazine-footer-bottom a { text-decoration: none; }
.np-magazine-footer-bottom a:hover { color: var(--np-color-primary, #b04a26); }
.np-magazine-footer-bottom-right { display: flex; gap: 1.5rem; }

/* ============================================================
 * Single-post feature template — long-form article body with a
 * drop cap and centered byline rule. Used by templates/post-
 * feature.tsx.
 * ============================================================ */
.np-magazine-feature {
  max-width: 720px;
  margin: 0 auto;
  padding: 3rem 1.75rem 5rem;
}
.np-magazine-feature-kicker {
  font-family: var(--np-font-chrome, "Hanken Grotesk", sans-serif);
  font-size: 0.72rem;
  letter-spacing: 0.22em;
  text-transform: uppercase;
  color: var(--np-color-primary, #b04a26);
  font-weight: 600;
  margin: 0 0 1rem;
  text-align: center;
}
.np-magazine-feature-title {
  font-family: var(--np-font-heading, "Newsreader", Georgia, serif);
  font-weight: 700;
  font-size: clamp(2rem, 4.2vw, 3.25rem);
  line-height: 1.06;
  letter-spacing: -0.018em;
  text-align: center;
  margin: 0 0 1rem;
  text-wrap: balance;
}
.np-magazine-feature-deck {
  font-style: italic;
  font-size: 1.2rem;
  text-align: center;
  color: var(--np-color-muted-foreground, #6a5a48);
  line-height: 1.55;
  margin: 0 0 1.75rem;
  text-wrap: pretty;
}
.np-magazine-feature-byline {
  display: flex;
  justify-content: center;
  gap: 0.85rem;
  padding: 1rem 0;
  border-top: 1px solid var(--np-color-border, #d8ccb4);
  border-bottom: 1px solid var(--np-color-border, #d8ccb4);
  font-family: var(--np-font-chrome, "Hanken Grotesk", sans-serif);
  font-size: 0.78rem;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--np-color-muted-foreground, #6a5a48);
  margin-bottom: 2rem;
}
.np-magazine-feature-byline strong {
  color: var(--np-color-foreground, #1a1411);
  font-weight: 600;
  letter-spacing: 0.04em;
}
.np-magazine-feature-body {
  font-size: 1.125rem;
  line-height: 1.7;
}
.np-magazine-feature-body > p:first-of-type::first-letter {
  font-family: var(--np-font-heading, "Newsreader", Georgia, serif);
  font-style: italic;
  font-weight: 700;
  font-size: 4.25rem;
  line-height: 0.85;
  /* Use the logical-property form (inline-start) so RTL
     locales mirror the drop-cap to the leading edge instead of
     pinning it visually left. Repo gate at
     apps/web/tests/theme-magazine-portfolio.integration.test.ts
     enforces logical equivalents on every theme. */
  float: inline-start;
  margin-block-start: 0.25rem;
  margin-inline-end: 0.6rem;
  color: var(--np-color-primary, #b04a26);
}
.np-magazine-feature-body p { margin: 0 0 1rem; }
.np-magazine-feature-body h2 {
  font-family: var(--np-font-heading, "Newsreader", Georgia, serif);
  font-size: 1.625rem;
  letter-spacing: -0.012em;
  margin: 2.5rem 0 1rem;
}
.np-magazine-feature-body h3 {
  font-family: var(--np-font-heading, "Newsreader", Georgia, serif);
  font-size: 1.25rem;
  margin: 2rem 0 0.75rem;
}
.np-magazine-feature-body blockquote {
  border-left: 3px solid var(--np-color-primary, #b04a26);
  margin: 1.5rem 0;
  padding: 0 0 0 1.25rem;
  font-style: italic;
  color: var(--np-color-muted-foreground, #6a5a48);
}

/* ============================================================
 * Page templates — default centered column, cover hero.
 * ============================================================ */
.np-magazine-default {
  max-width: 720px;
  margin: 0 auto;
  padding: 3rem 1.75rem 5rem;
}
.np-magazine-default h1 {
  font-family: var(--np-font-heading, "Newsreader", Georgia, serif);
  font-size: clamp(2.25rem, 4.4vw, 3.25rem);
  letter-spacing: -0.018em;
  line-height: 1.05;
  margin: 0 0 1rem;
}

.np-magazine-cover {
  background: var(--np-color-foreground, #1a1411);
  color: var(--np-color-background, #f6f1e7);
}
.np-magazine-cover-hero {
  min-height: 60vh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 4rem 1.75rem;
  text-align: center;
  background: linear-gradient(160deg, #2a1810, #5e2e1b 60%, #b04a26);
}
.np-magazine-cover-title {
  font-family: var(--np-font-heading, "Newsreader", Georgia, serif);
  font-style: italic;
  font-weight: 800;
  font-size: clamp(2.5rem, 6vw, 4.5rem);
  letter-spacing: -0.02em;
  line-height: 1.02;
  max-width: 20ch;
  margin: 0 auto;
}
.np-magazine-cover-body {
  max-width: 720px;
  margin: 0 auto;
  padding: 3rem 1.75rem 5rem;
  background: var(--np-color-background, #f6f1e7);
  color: var(--np-color-foreground, #1a1411);
}

/* ============================================================
 * Mobile drawer — hidden on desktop, used by MagazineMobileNav.
 * ============================================================ */
.np-magazine-mobile-nav-toggle {
  display: none;
  font-family: var(--np-font-chrome, "Hanken Grotesk", sans-serif);
  font-size: 0.78rem;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  background: transparent;
  border: 1px solid var(--np-color-border, #d8ccb4);
  padding: 0.4rem 0.95rem;
  cursor: pointer;
}
@media (max-width: 760px) {
  .np-magazine-sections { display: none; }
  .np-magazine-mobile-nav-toggle { display: inline-flex; margin: 0.75rem auto 0; }
}
.np-magazine-mobile-nav-drawer {
  position: fixed;
  inset: 0;
  background: var(--np-color-background, #f6f1e7);
  z-index: 50;
  display: flex;
  flex-direction: column;
  padding: 1.5rem 1.75rem;
  gap: 1rem;
}
.np-magazine-mobile-nav-drawer ul {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 0.85rem;
}
.np-magazine-mobile-nav-drawer a {
  font-family: var(--np-font-heading, "Newsreader", Georgia, serif);
  font-size: 1.5rem;
  text-decoration: none;
  color: inherit;
}
.np-magazine-mobile-nav-close {
  align-self: flex-end;
  background: transparent;
  border: 0;
  font: inherit;
  font-family: var(--np-font-chrome, "Hanken Grotesk", sans-serif);
  font-size: 0.78rem;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  cursor: pointer;
}
`;
