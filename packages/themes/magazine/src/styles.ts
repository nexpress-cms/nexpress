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
.np-magazine-section-head {
  display: flex;
  justify-content: space-between;
  gap: 1rem;
  align-items: end;
  border-top: 1px solid var(--np-color-border, #d8ccb4);
  padding-top: 1rem;
  margin-bottom: 1.5rem;
}
.np-magazine-section-head h2 {
  font-size: clamp(1.8rem, 4vw, 3rem);
  line-height: 1;
  letter-spacing: -0.025em;
  margin: 0;
}
.np-magazine-section-head span {
  font-family: var(--np-font-mono, "Hanken Grotesk", sans-serif);
  color: var(--np-color-muted-foreground, #6a5a48);
  font-size: 0.78rem;
}
.np-magazine-masthead,
.np-magazine-section-page {
  padding: 3rem 0 5rem;
}
.np-magazine-masthead {
  max-width: 1120px;
  margin: 0 auto;
  padding-inline: 1.5rem;
}
.np-magazine-masthead-hero,
.np-magazine-section-hero {
  max-width: 780px;
  padding: 3rem 0;
}
.np-magazine-masthead-hero p,
.np-magazine-section-hero p {
  margin: 0 0 0.8rem;
  font-family: var(--np-font-mono, "Hanken Grotesk", sans-serif);
  color: var(--np-color-primary, #b04a26);
  text-transform: uppercase;
  letter-spacing: 0.16em;
  font-size: 0.75rem;
}
.np-magazine-masthead-hero h1,
.np-magazine-section-hero h1 {
  margin: 0;
  font-style: italic;
  font-size: clamp(3rem, 7vw, 6.5rem);
  line-height: 0.92;
  letter-spacing: -0.035em;
}
.np-magazine-masthead-hero span,
.np-magazine-section-hero span {
  display: block;
  margin-top: 1.25rem;
  color: var(--np-color-muted-foreground, #6a5a48);
  font-size: 1.15rem;
  line-height: 1.65;
}
.np-magazine-masthead-manifesto {
  max-width: 760px;
  margin: 1rem auto 4rem;
  padding-block: 2rem;
  border-block: 3px double var(--np-color-foreground, #1a1411);
}
.np-magazine-masthead-manifesto p {
  font-size: 1.28rem;
  line-height: 1.75;
  margin: 0 0 1rem;
}
.np-magazine-masthead-editors {
  display: grid;
  gap: 1.5rem;
}
.np-magazine-masthead-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 1rem;
}
.np-magazine-masthead-editor {
  border-top: 1px solid var(--np-color-border, #d8ccb4);
  padding-top: 1rem;
}
.np-magazine-masthead-editor div {
  width: 100%;
  aspect-ratio: 4 / 5;
  background: linear-gradient(145deg, #2a1810, #b04a26);
  margin-bottom: 1rem;
  position: relative;
}
.np-magazine-masthead-editor div::after {
  content: attr(data-initials);
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  color: rgba(252, 250, 243, 0.28);
  font-size: 2.4rem;
  font-style: italic;
}
.np-magazine-masthead-editor span,
.np-magazine-masthead-editor small {
  display: block;
  font-family: var(--np-font-mono, "Hanken Grotesk", sans-serif);
  color: var(--np-color-muted-foreground, #6a5a48);
  font-size: 0.72rem;
  text-transform: uppercase;
  letter-spacing: 0.12em;
}
.np-magazine-masthead-editor h3 {
  margin: 0.35rem 0;
  font-style: italic;
  font-size: 1.4rem;
}
.np-magazine-masthead-editor p {
  margin: 0 0 0.8rem;
  color: var(--np-color-muted-foreground, #6a5a48);
}
.np-magazine-section-layout {
  display: grid;
  grid-template-columns: 220px minmax(0, 1fr);
  gap: 3rem;
}
.np-magazine-section-layout aside {
  position: sticky;
  top: 7rem;
  align-self: start;
  border-top: 3px double var(--np-color-foreground, #1a1411);
  padding-top: 1rem;
}
.np-magazine-section-layout aside strong {
  display: block;
  font-style: italic;
  font-size: 4rem;
  line-height: 0.9;
}
.np-magazine-section-layout aside span {
  font-family: var(--np-font-mono, "Hanken Grotesk", sans-serif);
  color: var(--np-color-muted-foreground, #6a5a48);
  text-transform: uppercase;
  letter-spacing: 0.12em;
  font-size: 0.75rem;
}
.np-magazine-section-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 1.2rem;
}
@media (max-width: 900px) {
  .np-magazine-masthead-grid,
  .np-magazine-section-layout {
    grid-template-columns: 1fr;
  }
}
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
  z-index: 1;
  pointer-events: none;
}
.np-magazine-lead-cover[data-has-image="true"]::before {
  background: linear-gradient(180deg, transparent 40%, rgba(0, 0, 0, 0.45) 100%);
}
.np-magazine-cover-image {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  object-position: center;
  z-index: 0;
}
.np-magazine-lead-cover-figure,
.np-magazine-lead-cover-caption,
.np-magazine-story-cover-figure,
.np-magazine-archive-item-cover-fig { z-index: 2; }
.np-magazine-story-cover,
.np-magazine-archive-item-cover { isolation: isolate; }
.np-magazine-story-cover[data-has-image="true"] .np-magazine-story-cover-figure,
.np-magazine-archive-item-cover[data-has-image="true"] .np-magazine-archive-item-cover-fig {
  display: none;
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
@media (max-width: 420px) {
  .np-magazine-subscribe-form {
    display: grid;
    grid-template-columns: 1fr;
  }
  .np-magazine-subscribe-form button {
    width: 100%;
    justify-content: center;
  }
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

.np-magazine-footer-social {
  list-style: none;
  padding: 0;
  margin: 1.25rem 0 0;
  display: flex;
  flex-wrap: wrap;
  gap: 0.85rem;
  font-family: var(--np-font-chrome, "Hanken Grotesk", sans-serif);
  font-size: 0.72rem;
  letter-spacing: 0.14em;
  text-transform: uppercase;
}
.np-magazine-footer-social a { text-decoration: none; }
.np-magazine-footer-social a:hover { color: var(--np-color-primary, #b04a26); }

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
  max-width: 1240px;
  margin: 0 auto;
  padding: 3rem 1.75rem 5rem;
}
.np-magazine-default > h1 {
  font-family: var(--np-font-heading, "Newsreader", Georgia, serif);
  font-size: clamp(2.25rem, 4.4vw, 3.25rem);
  letter-spacing: -0.018em;
  line-height: 1.05;
  margin: 0 auto 2rem;
  max-width: 32ch;
  text-align: center;
}
.np-magazine-default > h1 + * {
  margin-top: 0;
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
  display: none;
  flex-direction: column;
  padding: 1.5rem 1.75rem;
  gap: 1rem;
}
.np-magazine-mobile-nav-drawer[data-open="true"] {
  display: flex;
}
.np-magazine-mobile-nav-overlay {
  position: fixed;
  inset: 0;
  background: color-mix(
    in oklab,
    var(--np-color-foreground, #1a1411) 40%,
    transparent
  );
  z-index: 49;
}
@media (min-width: 761px) {
  .np-magazine-mobile-nav-drawer,
  .np-magazine-mobile-nav-drawer[data-open="true"],
  .np-magazine-mobile-nav-overlay {
    display: none;
  }
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

/* ============================================================
 * Member + 404 surfaces — centered column, Newsreader display
 * heading, small-caps eyebrow, terracotta CTA pill. Shared
 * between the public 404, member 404, and error boundaries so
 * any chrome change lands in one place.
 * ============================================================ */
.np-magazine-message {
  max-width: 36rem;
  margin: 5rem auto;
  padding: 0 1.75rem;
  text-align: center;
}
.np-magazine-message-eyebrow {
  font-family: var(--np-font-chrome, "Hanken Grotesk", sans-serif);
  font-size: 0.72rem;
  letter-spacing: 0.22em;
  text-transform: uppercase;
  color: var(--np-color-primary, #b04a26);
  font-weight: 600;
  margin: 0;
}
.np-magazine-message-title {
  font-family: var(--np-font-heading, "Newsreader", Georgia, serif);
  font-weight: 700;
  font-size: clamp(2rem, 5vw, 3rem);
  line-height: 1.06;
  letter-spacing: -0.018em;
  margin: 1.25rem 0 0;
  text-wrap: balance;
  border-top: 3px double var(--np-color-foreground, #1a1411);
  border-bottom: 1px solid var(--np-color-border, #d8ccb4);
  padding: 1.5rem 0;
}
.np-magazine-message-body {
  font-style: italic;
  font-size: 1.0625rem;
  line-height: 1.6;
  color: var(--np-color-muted-foreground, #6a5a48);
  margin: 1.5rem auto 0;
  max-width: 32rem;
  text-wrap: pretty;
}
.np-magazine-message-actions {
  margin-top: 2rem;
  display: flex;
  gap: 0.75rem;
  justify-content: center;
  flex-wrap: wrap;
}
.np-magazine-cta {
  display: inline-flex;
  align-items: center;
  padding: 0.7rem 1.5rem;
  font-family: var(--np-font-chrome, "Hanken Grotesk", sans-serif);
  font-size: 0.78rem;
  font-weight: 600;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  background: var(--np-color-primary, #b04a26);
  color: var(--np-color-primary-foreground, #fcfaf3);
  border: 1px solid var(--np-color-primary, #b04a26);
  border-radius: 0.25rem;
  text-decoration: none;
  cursor: pointer;
}
.np-magazine-cta:hover { opacity: 0.92; }
.np-magazine-cta-ghost {
  background: transparent;
  color: var(--np-color-foreground, #1a1411);
  border-color: var(--np-color-border, #d8ccb4);
}
.np-magazine-cta-ghost:hover {
  color: var(--np-color-primary, #b04a26);
  border-color: var(--np-color-primary, #b04a26);
}

.np-magazine-members {
  padding: 3rem 1.75rem 4rem;
}
.np-magazine-members-column {
  max-width: 32rem;
  margin: 0 auto;
}

/* ============================================================
 * Archive index masthead — used by /category/:slug and
 * /author/:id pages above the .np-magazine-archive grid.
 * ============================================================ */
.np-magazine-archive-masthead {
  margin: 3rem 0 2rem;
  padding-bottom: 1.5rem;
  border-bottom: 3px double var(--np-color-foreground, #1a1411);
}
.np-magazine-archive-eyebrow {
  font-family: var(--np-font-chrome, "Hanken Grotesk", sans-serif);
  font-size: 0.72rem;
  letter-spacing: 0.22em;
  text-transform: uppercase;
  color: var(--np-color-primary, #b04a26);
  font-weight: 600;
  margin: 0;
}
.np-magazine-archive-title {
  font-family: var(--np-font-heading, "Newsreader", Georgia, serif);
  font-weight: 700;
  font-size: clamp(2rem, 4.2vw, 3rem);
  letter-spacing: -0.018em;
  margin: 0.75rem 0 0;
  text-wrap: balance;
}
.np-magazine-archive-subtitle {
  font-style: italic;
  font-size: 1.125rem;
  color: var(--np-color-muted-foreground, #6a5a48);
  margin: 0.75rem 0 0;
  max-width: 36rem;
}
.np-magazine-archive-count {
  font-family: var(--np-font-chrome, "Hanken Grotesk", sans-serif);
  font-size: 0.72rem;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: var(--np-color-muted-foreground, #6a5a48);
  margin: 0.85rem 0 0;
}
.np-magazine-archive-empty {
  font-style: italic;
  color: var(--np-color-muted-foreground, #6a5a48);
  padding: 2rem 0;
}

/* ────────────────────────────────────────────────────────────
 * Hero feature block (magazine.hero-feature)
 *
 * Adaptive page-builder block with three layouts that share the
 * np-magazine-hero-feature root. \`featured\` is inline-styled
 * for full-bleed background images; \`carousel\` and \`grid\` use
 * the class rules below. The shared header + card subcomponents
 * style identically across carousel and grid; the data-hero-style
 * attribute toggles the layout container.
 * ──────────────────────────────────────────────────────────── */
.np-magazine-hero-feature {
  margin: 2rem 0;
  padding: 2.5rem 0 3rem;
  border-top: 3px double var(--np-color-foreground, #1a1411);
  border-bottom: 1px solid var(--np-color-border, #d8ccb4);
}
.np-magazine-hero-header {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 0.5rem;
  margin: 0 0 2rem;
  max-width: 60ch;
}
.np-magazine-hero-header h1 {
  font-family: var(--np-font-heading, "Newsreader", Georgia, serif);
  font-weight: 600;
  font-size: clamp(1.75rem, 4vw, 2.75rem);
  line-height: 1.05;
  letter-spacing: -0.015em;
  margin: 0;
  text-wrap: balance;
}
.np-magazine-hero-header p {
  font-family: var(--np-font-heading, "Newsreader", Georgia, serif);
  font-style: italic;
  font-size: 1.125rem;
  color: var(--np-color-muted-foreground, #6a5a48);
  margin: 0;
}
.np-magazine-hero-cta {
  display: inline-block;
  margin-top: 0.5rem;
  padding: 0.5rem 1.25rem;
  border-radius: 0.25rem;
  background: var(--np-color-primary, #b04a26);
  color: var(--np-color-primary-foreground, #fcfaf3);
  text-decoration: none;
  font-family: var(--np-font-chrome, "Hanken Grotesk", sans-serif);
  font-weight: 500;
  font-size: 0.85rem;
  letter-spacing: 0.02em;
}
.np-magazine-hero-empty {
  font-style: italic;
  color: var(--np-color-muted-foreground, #6a5a48);
  padding: 2rem 0;
  margin: 0;
}
.np-magazine-hero-card-category {
  font-family: var(--np-font-chrome, "Hanken Grotesk", sans-serif);
  font-size: 0.68rem;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: var(--np-color-muted-foreground, #6a5a48);
  margin: 0 0 0.4rem;
}

/* Carousel variant — horizontally scrolling track with snap.
 * The modifier on the section is a semantic hook; layout lives
 * on the .np-magazine-hero-carousel-track child below. */
.np-magazine-hero-carousel {
  position: relative;
}
.np-magazine-hero-carousel-track {
  display: flex;
  gap: 1.5rem;
  overflow-x: auto;
  scroll-snap-type: x mandatory;
  scroll-padding: 0;
  padding-bottom: 0.5rem;
}
.np-magazine-hero-carousel-card {
  flex: 0 0 min(20rem, 80%);
  scroll-snap-align: start;
  display: flex;
  flex-direction: column;
  gap: 0.85rem;
}
.np-magazine-hero-carousel-card img {
  width: 100%;
  aspect-ratio: 4 / 3;
  object-fit: cover;
  background: var(--np-color-muted, #ece4d3);
}
.np-magazine-hero-carousel-card h2 {
  font-family: var(--np-font-heading, "Newsreader", Georgia, serif);
  font-weight: 600;
  font-size: 1.125rem;
  line-height: 1.3;
  margin: 0;
}
.np-magazine-hero-carousel-card a {
  color: inherit;
  text-decoration: none;
}
.np-magazine-hero-carousel-card a:hover {
  text-decoration: underline;
  text-underline-offset: 0.2em;
}

/* Grid variant — responsive auto-fit grid. Same modifier-on-
 * section hook pattern as the carousel; layout is on the
 * .np-magazine-hero-grid-tiles child. */
.np-magazine-hero-grid {
  position: relative;
}
.np-magazine-hero-grid-tiles {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 16rem), 1fr));
  gap: 1.75rem 1.5rem;
}
.np-magazine-hero-grid-tile {
  display: flex;
  flex-direction: column;
  gap: 0.85rem;
}
.np-magazine-hero-grid-tile img {
  width: 100%;
  aspect-ratio: 4 / 3;
  object-fit: cover;
  background: var(--np-color-muted, #ece4d3);
}
.np-magazine-hero-grid-tile h2 {
  font-family: var(--np-font-heading, "Newsreader", Georgia, serif);
  font-weight: 600;
  font-size: 1.125rem;
  line-height: 1.3;
  margin: 0;
}
.np-magazine-hero-grid-tile a {
  color: inherit;
  text-decoration: none;
}
.np-magazine-hero-grid-tile a:hover {
  text-decoration: underline;
  text-underline-offset: 0.2em;
}
`;
