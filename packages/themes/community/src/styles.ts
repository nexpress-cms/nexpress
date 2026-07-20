/**
 * Dense Korean community-portal visual language. Every rule is scoped under
 * `np-community-*`; the only cross-package selectors are the forum plugin's
 * documented `data-np-forum-*` hooks and inherited `--np-forum-*` variables.
 */
export const communityCss = `
.np-community-shell {
  --np-community-surface: var(--np-color-card, #ffffff);
  --np-community-soft: var(--np-color-muted, #f3f5f8);
  --np-community-ink: var(--np-color-foreground, #172033);
  --np-community-subtle: var(--np-color-muted-foreground, #697386);
  --np-community-line: var(--np-color-border, #dfe4ea);
  --np-community-accent: var(--np-color-primary, #246bfd);
  --np-community-accent-foreground: var(--np-color-primary-foreground, #ffffff);
  --np-forum-content-max: 80rem;
  --np-forum-detail-max: 54rem;
  --np-forum-composer-max: 48rem;
  --np-forum-page-gutter: clamp(1rem, 3vw, 1.5rem);
  --np-forum-page-space: 2rem auto 4rem;
  --np-forum-panel-background: var(--np-community-surface);
  --np-forum-panel-border: var(--np-community-line);
  --np-forum-panel-radius: 0.45rem;
  --np-forum-panel-shadow: 0 8px 24px rgba(28, 43, 68, 0.06);
  --np-forum-muted-background: var(--np-community-soft);
  --np-forum-muted-foreground: var(--np-community-subtle);
  --np-forum-accent: var(--np-community-accent);
  --np-forum-accent-foreground: var(--np-community-accent-foreground);
  --np-forum-row-min-height: 4.65rem;
  --np-forum-row-padding: 0.9rem 1rem;
  --np-forum-block-space: 1.25rem 0;
  --np-forum-block-gap: 0.85rem;
  --np-forum-block-board-min-height: 10rem;
  --np-forum-block-card-padding: 1.1rem;
  --np-forum-block-feed-card-min-height: 9rem;
  min-height: 100%;
  overflow-x: clip;
  background: var(--np-color-background, #f7f8fa);
  color: var(--np-community-ink);
  font-family: var(--np-font-body, Pretendard, "Noto Sans KR", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif);
  line-height: 1.55;
  -webkit-font-smoothing: antialiased;
}
.np-community-shell[data-np-community-density="comfortable"] {
  --np-forum-row-min-height: 5.4rem;
  --np-forum-row-padding: 1.15rem 1.2rem;
}
.np-community-shell *,
.np-community-shell *::before,
.np-community-shell *::after { box-sizing: border-box; }
.np-community-shell a { color: inherit; }
.np-community-shell img { display: block; max-width: 100%; }
.np-community-container {
  width: min(100%, 80rem);
  margin-inline: auto;
  padding-inline: clamp(1rem, 3vw, 1.5rem);
}

/* Header */
.np-community-header {
  position: relative;
  z-index: 30;
  background: var(--np-community-surface);
  border-bottom: 1px solid var(--np-community-line);
}
.np-community-utility {
  min-height: 2.1rem;
  background: #202b3c;
  color: #dbe4f3;
  font-size: 0.74rem;
}
.np-community-utility-inner {
  min-height: 2.1rem;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
}
.np-community-utility-inner nav { display: flex; align-items: center; gap: 1rem; }
.np-community-utility-inner a { text-decoration: none; color: #ffffff; }
.np-community-utility-inner a:hover { text-decoration: underline; text-underline-offset: 0.2rem; }
.np-community-brand-row { border-bottom: 1px solid var(--np-community-line); }
.np-community-brand-inner {
  min-height: 5.25rem;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
}
.np-community-brand {
  display: inline-flex;
  align-items: center;
  gap: 0.8rem;
  color: var(--np-community-ink);
  text-decoration: none;
}
.np-community-brand-mark {
  width: 2.55rem;
  height: 2.55rem;
  display: grid;
  place-items: center;
  border-radius: 0.7rem 0.7rem 0.7rem 0.2rem;
  background: var(--np-community-accent);
  color: var(--np-community-accent-foreground);
  font-family: var(--np-font-heading, inherit);
  font-size: 1.3rem;
  font-weight: 900;
  box-shadow: 0 5px 14px color-mix(in srgb, var(--np-community-accent) 28%, transparent);
}
.np-community-brand-copy { display: grid; gap: 0.08rem; }
.np-community-brand-copy strong {
  font-family: var(--np-font-heading, inherit);
  font-size: 1.35rem;
  letter-spacing: -0.04em;
}
.np-community-brand-copy small { color: var(--np-community-subtle); font-size: 0.76rem; }
.np-community-search-link {
  min-width: 5rem;
  min-height: 2.4rem;
  padding: 0 0.9rem;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.35rem;
  border: 1px solid var(--np-community-line);
  border-radius: 999px;
  color: var(--np-community-subtle);
  font-size: 0.82rem;
  text-decoration: none;
}
.np-community-search-link:hover { color: var(--np-community-accent); border-color: var(--np-community-accent); }
.np-community-nav-bar { background: var(--np-community-surface); }
.np-community-nav-inner {
  min-height: 3rem;
  display: flex;
  align-items: stretch;
  justify-content: space-between;
  gap: 1rem;
}
.np-community-desktop-nav { min-width: 0; }
.np-community-desktop-nav > ul {
  height: 100%;
  display: flex;
  align-items: stretch;
  gap: 0.15rem;
  margin: 0;
  padding: 0;
  list-style: none;
}
.np-community-desktop-nav > ul > li { position: relative; display: flex; align-items: stretch; }
.np-community-desktop-nav > ul > li > a {
  padding: 0 1.05rem;
  display: inline-flex;
  align-items: center;
  border-bottom: 3px solid transparent;
  font-size: 0.9rem;
  font-weight: 700;
  text-decoration: none;
}
.np-community-desktop-nav > ul > li > a:hover,
.np-community-desktop-nav > ul > li > a[aria-current="page"] {
  color: var(--np-community-accent);
  border-bottom-color: var(--np-community-accent);
}
.np-community-subnav {
  position: absolute;
  top: 100%;
  inset-inline-start: 0;
  min-width: 11rem;
  display: none;
  margin: 0;
  padding: 0.45rem;
  list-style: none;
  background: var(--np-community-surface);
  border: 1px solid var(--np-community-line);
  border-radius: 0 0 0.5rem 0.5rem;
  box-shadow: 0 16px 30px rgba(28, 43, 68, 0.12);
}
.np-community-desktop-nav li:hover > .np-community-subnav,
.np-community-desktop-nav li:focus-within > .np-community-subnav { display: block; }
.np-community-subnav a {
  display: block;
  padding: 0.55rem 0.7rem;
  border-radius: 0.3rem;
  font-size: 0.82rem;
  text-decoration: none;
}
.np-community-subnav a:hover,
.np-community-subnav a[aria-current="page"] { color: var(--np-community-accent); background: var(--np-community-soft); }
.np-community-write-link {
  align-self: center;
  padding: 0.5rem 0.95rem;
  border-radius: 0.35rem;
  background: var(--np-community-accent);
  color: var(--np-community-accent-foreground) !important;
  font-size: 0.82rem;
  font-weight: 800;
  text-decoration: none;
}
.np-community-mobile-nav { display: none; align-items: center; }
.np-community-mobile-toggle {
  display: inline-flex;
  align-items: center;
  gap: 0.45rem;
  padding: 0.45rem 0;
  border: 0;
  background: transparent;
  color: var(--np-community-ink);
  font: inherit;
  font-size: 0.86rem;
  font-weight: 800;
  cursor: pointer;
}
.np-community-mobile-backdrop {
  position: fixed;
  inset: 0;
  z-index: 60;
  border: 0;
  background: rgba(13, 22, 36, 0.52);
  cursor: pointer;
}
.np-community-mobile-drawer {
  position: fixed;
  inset-block: 0;
  inset-inline-start: auto;
  inset-inline-end: 0;
  z-index: 61;
  width: min(22rem, 88vw);
  padding: 1rem;
  overflow-y: auto;
  background: var(--np-community-surface);
  box-shadow: -16px 0 36px rgba(13, 22, 36, 0.2);
}
.np-community-mobile-drawer-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.25rem 0 1rem;
  border-bottom: 1px solid var(--np-community-line);
}
.np-community-mobile-drawer-head strong { font-size: 1.05rem; }
.np-community-mobile-drawer-head button {
  width: 2.25rem;
  height: 2.25rem;
  border: 0;
  background: var(--np-community-soft);
  border-radius: 50%;
  font-size: 1.4rem;
  cursor: pointer;
}
.np-community-mobile-list,
.np-community-mobile-subnav { margin: 0; padding: 0; list-style: none; }
.np-community-mobile-list > li { border-bottom: 1px solid var(--np-community-line); }
.np-community-mobile-list > li > a {
  display: block;
  padding: 0.95rem 0.35rem;
  font-weight: 800;
  text-decoration: none;
}
.np-community-mobile-subnav { padding: 0 0 0.7rem 0.75rem; }
.np-community-mobile-subnav a {
  display: block;
  padding: 0.4rem;
  color: var(--np-community-subtle);
  font-size: 0.84rem;
  text-decoration: none;
}
.np-community-mobile-actions { display: grid; grid-template-columns: 1fr 1fr; gap: 0.55rem; margin-top: 1rem; }
.np-community-mobile-actions a {
  padding: 0.7rem;
  border: 1px solid var(--np-community-line);
  border-radius: 0.4rem;
  text-align: center;
  font-size: 0.84rem;
  font-weight: 800;
  text-decoration: none;
}
.np-community-mobile-actions a:last-child { background: var(--np-community-accent); color: var(--np-community-accent-foreground); border-color: var(--np-community-accent); }

/* Home and article index */
.np-community-page { min-height: 50vh; }
.np-community-index-page { padding: 2rem 0 4rem; }
.np-community-home { padding-bottom: 4rem; }
.np-community-home-intro {
  background: linear-gradient(120deg, #1d2b42 0%, #263e65 62%, color-mix(in srgb, var(--np-community-accent) 72%, #263e65) 100%);
  color: #ffffff;
}
.np-community-home-intro-inner {
  min-height: 10.5rem;
  padding-block: 2rem;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 2rem;
}
.np-community-home-eyebrow {
  display: block;
  margin-bottom: 0.4rem;
  color: #b9c9e5;
  font-size: 0.7rem;
  font-weight: 800;
  letter-spacing: 0.16em;
}
.np-community-home-intro h1 {
  margin: 0;
  font-family: var(--np-font-heading, inherit);
  font-size: clamp(1.9rem, 4vw, 3rem);
  letter-spacing: -0.05em;
}
.np-community-home-intro p { margin: 0.45rem 0 0; color: #dce6f5; }
.np-community-home-stats { display: flex; gap: 0.7rem; margin: 0; }
.np-community-home-stats div {
  min-width: 7.25rem;
  padding: 0.85rem 1rem;
  border: 1px solid rgba(255,255,255,0.22);
  border-radius: 0.55rem;
  background: rgba(255,255,255,0.08);
}
.np-community-home-stats dt { color: #c6d4e9; font-size: 0.72rem; }
.np-community-home-stats dd { margin: 0.15rem 0 0; font-size: 1.35rem; font-weight: 900; }
.np-community-home-extensions { padding-top: 1.25rem; }
.np-community-home-extensions:has([data-np-forum-block]) { background: var(--np-community-soft); border-bottom: 1px solid var(--np-community-line); }
.np-community-content-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 18rem;
  gap: 1.25rem;
  align-items: start;
  padding-top: 1.5rem;
}
.np-community-feed { min-width: 0; display: grid; gap: 1.25rem; }
.np-community-feed-empty {
  padding: 1.5rem;
  background: var(--np-community-surface);
  border: 1px solid var(--np-community-line);
  border-radius: 0.55rem;
}
.np-community-feed-empty > p { color: var(--np-community-subtle); }
.np-community-highlights,
.np-community-latest {
  background: var(--np-community-surface);
  border: 1px solid var(--np-community-line);
  border-radius: 0.55rem;
  box-shadow: 0 8px 24px rgba(28, 43, 68, 0.04);
}
.np-community-panel-head {
  min-height: 4rem;
  padding: 0.8rem 1rem;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  border-bottom: 1px solid var(--np-community-line);
}
.np-community-panel-head > div > span,
.np-community-panel-head > span {
  display: block;
  margin-bottom: 0.08rem;
  color: var(--np-community-accent);
  font-size: 0.66rem;
  font-weight: 900;
  letter-spacing: 0.08em;
}
.np-community-panel-head h1,
.np-community-panel-head h2 { margin: 0; font-size: 1.03rem; letter-spacing: -0.025em; }
.np-community-panel-head > a { color: var(--np-community-subtle); font-size: 0.76rem; text-decoration: none; }
.np-community-panel-head > a:hover { color: var(--np-community-accent); }
.np-community-panel-head > p { max-width: 28rem; margin: 0; color: var(--np-community-subtle); font-size: 0.78rem; text-align: end; }
.np-community-highlight-grid { display: grid; grid-template-columns: minmax(0, 1.2fr) minmax(16rem, 0.8fr); }
.np-community-lead-card { padding: 1rem; display: grid; grid-template-columns: 11rem minmax(0, 1fr); gap: 1rem; border-inline-end: 1px solid var(--np-community-line); }
.np-community-lead-visual {
  min-height: 11rem;
  padding: 0.8rem;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  justify-content: space-between;
  overflow: hidden;
  border-radius: 0.45rem;
  background: linear-gradient(145deg, color-mix(in srgb, var(--np-community-accent) 82%, #0f1c31), #17243a);
  color: #ffffff !important;
  text-decoration: none;
}
.np-community-lead-visual > span { font-family: var(--np-font-heading, inherit); font-size: 4rem; font-weight: 900; opacity: 0.3; }
.np-community-lead-visual small { font-size: 0.58rem; font-weight: 800; letter-spacing: 0.11em; }
.np-community-lead-copy { min-width: 0; display: flex; flex-direction: column; align-items: flex-start; justify-content: center; }
.np-community-kicker { color: var(--np-community-accent); font-size: 0.7rem; font-weight: 900; }
.np-community-lead-copy h3 { margin: 0.3rem 0 0; font-size: clamp(1.2rem, 2.6vw, 1.65rem); line-height: 1.35; letter-spacing: -0.04em; }
.np-community-lead-copy h3 a { text-decoration: none; }
.np-community-lead-copy h3 a:hover { color: var(--np-community-accent); }
.np-community-lead-copy > p { margin: 0.65rem 0; color: var(--np-community-subtle); font-size: 0.83rem; line-height: 1.65; }
.np-community-post-meta { display: flex; flex-wrap: wrap; gap: 0.45rem; color: var(--np-community-subtle); font-size: 0.7rem; }
.np-community-post-meta > * + *::before { content: "·"; margin-inline-end: 0.45rem; color: var(--np-community-line); }
.np-community-highlight-list { margin: 0; padding: 0; list-style: none; }
.np-community-highlight-list li { min-height: 4.25rem; padding: 0.65rem 0.85rem; display: grid; grid-template-columns: 2rem minmax(0, 1fr); gap: 0.55rem; align-items: center; border-bottom: 1px solid var(--np-community-line); }
.np-community-highlight-list li:last-child { border-bottom: 0; }
.np-community-highlight-number { color: var(--np-community-accent); font-size: 0.78rem; font-weight: 900; font-variant-numeric: tabular-nums; }
.np-community-highlight-list a { min-width: 0; display: grid; text-decoration: none; }
.np-community-highlight-list a > span { color: var(--np-community-subtle); font-size: 0.64rem; }
.np-community-highlight-list strong { overflow: hidden; font-size: 0.84rem; text-overflow: ellipsis; white-space: nowrap; }
.np-community-highlight-list small { color: var(--np-community-subtle); font-size: 0.66rem; }
.np-community-latest-list { margin: 0; padding: 0; list-style: none; }
.np-community-latest-list > li {
  min-height: 5rem;
  padding: 0.8rem 1rem;
  display: grid;
  grid-template-columns: 2.4rem minmax(0, 1fr) 8rem;
  gap: 0.8rem;
  align-items: center;
  border-bottom: 1px solid var(--np-community-line);
}
.np-community-shell[data-np-community-density="comfortable"] .np-community-latest-list > li { padding-block: 1.1rem; }
.np-community-latest-list > li:last-child { border-bottom: 0; }
.np-community-latest-number { color: #a5adba; font-size: 0.72rem; font-weight: 800; font-variant-numeric: tabular-nums; }
.np-community-latest-copy { min-width: 0; }
.np-community-latest-copy > div { display: flex; align-items: center; gap: 0.55rem; }
.np-community-latest-copy h2 { min-width: 0; margin: 0; overflow: hidden; font-size: 0.92rem; letter-spacing: -0.02em; text-overflow: ellipsis; white-space: nowrap; }
.np-community-latest-copy h2 a { text-decoration: none; }
.np-community-latest-copy h2 a:hover { color: var(--np-community-accent); text-decoration: underline; text-underline-offset: 0.18rem; }
.np-community-latest-copy > p { margin: 0.25rem 0 0; overflow: hidden; color: var(--np-community-subtle); font-size: 0.74rem; text-overflow: ellipsis; white-space: nowrap; }
.np-community-latest-meta { display: grid; justify-items: end; color: var(--np-community-subtle); font-size: 0.69rem; }
.np-community-latest-meta time { font-variant-numeric: tabular-nums; }
.np-community-side-rail { position: sticky; top: 1rem; display: grid; gap: 0.8rem; }
.np-community-side-card { padding: 1rem; background: var(--np-community-surface); border: 1px solid var(--np-community-line); border-radius: 0.55rem; }
.np-community-side-card > span { color: var(--np-community-accent); font-size: 0.64rem; font-weight: 900; letter-spacing: 0.1em; }
.np-community-side-card h2 { margin: 0.25rem 0 0; font-size: 1rem; }
.np-community-side-card p { margin: 0.55rem 0; color: var(--np-community-subtle); font-size: 0.78rem; line-height: 1.65; }
.np-community-side-card > a { display: inline-flex; margin-top: 0.2rem; color: var(--np-community-accent); font-size: 0.78rem; font-weight: 800; text-decoration: none; }
.np-community-side-card-primary { border-top: 3px solid var(--np-community-accent); }
.np-community-side-card ul { margin: 0.55rem 0 0; padding: 0; list-style: none; }
.np-community-side-card li + li { border-top: 1px solid var(--np-community-line); }
.np-community-side-card li a { display: block; padding: 0.55rem 0; font-size: 0.78rem; text-decoration: none; }
.np-community-side-card li a::after { content: "›"; float: inline-end; color: #a5adba; }
.np-community-side-card-note { background: #f0f5ff; border-color: #d7e4ff; }
.np-community-side-card-note strong { color: #2853a5; font-size: 0.78rem; }

/* Page and post templates */
.np-community-page-default { padding: 2.5rem 0 4rem; }
.np-community-page-header { padding: 1.5rem 0 1.25rem; border-bottom: 2px solid var(--np-community-ink); }
.np-community-page-header span { color: var(--np-community-accent); font-size: 0.66rem; font-weight: 900; letter-spacing: 0.12em; }
.np-community-page-header h1 { margin: 0.3rem 0 0; font-size: clamp(1.8rem, 4vw, 2.8rem); letter-spacing: -0.05em; }
.np-community-page-body { max-width: 52rem; margin: 1.5rem auto 0; padding: 1.25rem; background: var(--np-community-surface); border: 1px solid var(--np-community-line); border-radius: 0.55rem; }
.np-community-page-body h2,
.np-community-page-body h3,
.np-community-page-body h4 { margin: 1.75rem 0 0.65rem; line-height: 1.4; letter-spacing: -0.03em; }
.np-community-page-body p { margin: 0 0 1rem; line-height: 1.8; }
.np-community-page-body ul,
.np-community-page-body ol { margin: 0 0 1rem; padding-inline-start: 1.4rem; }
.np-community-page-body blockquote { margin: 1.25rem 0; padding: 0.9rem 1rem; border-inline-start: 4px solid var(--np-community-accent); background: var(--np-community-soft); color: var(--np-community-subtle); }
.np-community-post-page { padding: 2rem 1rem 4rem; }
.np-community-article { width: min(100%, 54rem); margin: 0 auto; background: var(--np-community-surface); border: 1px solid var(--np-community-line); border-radius: 0.6rem; box-shadow: 0 10px 30px rgba(28,43,68,0.05); }
.np-community-breadcrumbs { padding: 0.75rem 1.25rem; display: flex; gap: 0.45rem; color: var(--np-community-subtle); border-bottom: 1px solid var(--np-community-line); font-size: 0.74rem; }
.np-community-breadcrumbs a { text-decoration: none; }
.np-community-breadcrumbs a:hover { color: var(--np-community-accent); }
.np-community-article-header { padding: clamp(1.5rem, 5vw, 3rem); border-bottom: 1px solid var(--np-community-line); }
.np-community-article-header h1 { margin: 0.45rem 0 0; font-size: clamp(1.8rem, 4.5vw, 3.15rem); line-height: 1.25; letter-spacing: -0.055em; }
.np-community-article-header > p { max-width: 42rem; margin: 1rem 0 0; color: var(--np-community-subtle); font-size: 1rem; line-height: 1.7; }
.np-community-article-meta { margin-top: 1.2rem; display: flex; flex-wrap: wrap; gap: 0.6rem; color: var(--np-community-subtle); font-size: 0.76rem; }
.np-community-article-meta strong { color: var(--np-community-ink); }
.np-community-article-meta > * + *::before { content: "·"; margin-inline-end: 0.6rem; color: #b1b8c4; }
.np-community-article-body { padding: clamp(1.5rem, 5vw, 3rem); font-size: 1rem; line-height: 1.85; }
.np-community-article-body h2,
.np-community-article-body h3,
.np-community-article-body h4 { margin: 2rem 0 0.7rem; line-height: 1.4; letter-spacing: -0.035em; }
.np-community-article-body p { margin: 0 0 1.2rem; }
.np-community-article-body ul,
.np-community-article-body ol { margin: 0 0 1.2rem; padding-inline-start: 1.45rem; }
.np-community-article-body blockquote { margin: 1.5rem 0; padding: 1rem 1.2rem; border-inline-start: 4px solid var(--np-community-accent); background: var(--np-community-soft); color: var(--np-community-subtle); }
.np-community-article-body a { color: var(--np-community-accent); text-underline-offset: 0.18rem; }
.np-community-article-footer { padding: 1rem 1.5rem; display: flex; justify-content: space-between; gap: 1rem; align-items: center; border-top: 1px solid var(--np-community-line); }
.np-community-article-footer ul { display: flex; flex-wrap: wrap; gap: 0.4rem; margin: 0; padding: 0; list-style: none; }
.np-community-article-footer li { padding: 0.3rem 0.55rem; border-radius: 999px; background: var(--np-community-soft); color: var(--np-community-subtle); font-size: 0.7rem; }
.np-community-article-footer > a { color: var(--np-community-accent); font-size: 0.76rem; font-weight: 800; text-decoration: none; white-space: nowrap; }

/* Framework-owned comments remain a standalone contract even when the forum
   plugin is absent. The theme consumes only stable np-comment classes and
   state hooks; no forum collection, route, or React import is required. */
.np-community-shell .np-comments {
  width: min(calc(100% - 2rem), 54rem);
  margin: 2rem auto 3rem;
  padding: 1.25rem;
  background: var(--np-community-surface);
  border: 1px solid var(--np-community-line);
  border-radius: 0.6rem;
  box-shadow: 0 10px 30px rgba(28,43,68,0.05);
}
.np-community-shell .np-comments h2 { color: var(--np-community-ink); letter-spacing: -0.025em; }
.np-community-shell .np-comments-sort { border-color: var(--np-community-line); background: var(--np-community-soft); }
.np-community-shell .np-comments-sort button[data-active="true"] { background: var(--np-community-ink); color: var(--np-community-surface); }
.np-community-shell .np-comment-card { border-color: var(--np-community-line); border-radius: 0.45rem; background: var(--np-community-surface); }
.np-community-shell .np-comment-children { border-color: color-mix(in srgb, var(--np-community-accent) 35%, var(--np-community-line)); }
.np-community-shell .np-comment-author { color: var(--np-community-ink); font-weight: 800; }
.np-community-shell .np-comment-author small,
.np-community-shell .np-comment-date,
.np-community-shell .np-comment-replying-to,
.np-community-shell .np-comments-empty,
.np-community-shell .np-comments-locked,
.np-community-shell .np-comments-login { color: var(--np-community-subtle); }
.np-community-shell .np-comments-login a { color: var(--np-community-accent); font-weight: 800; text-underline-offset: 0.18rem; }
.np-community-shell .np-comment-actions button:hover:not(:disabled) { background: var(--np-community-soft); color: var(--np-community-ink); }
.np-community-shell .np-comment-reaction button[data-active="true"] { border-color: var(--np-community-accent); background: color-mix(in srgb, var(--np-community-accent) 12%, transparent); color: var(--np-community-accent); }
.np-community-shell .np-comments textarea,
.np-community-shell .np-comment-dialog textarea { border-color: var(--np-community-line); background: var(--np-community-surface); color: var(--np-community-ink); }
.np-community-shell .np-comments textarea:focus-visible { outline: 2px solid var(--np-community-accent); outline-offset: 2px; }
.np-community-shell .np-comments .np-comment-primary-action,
.np-community-shell .np-comment-dialog .np-comment-primary-action { background: var(--np-community-accent); color: var(--np-community-accent-foreground); }
.np-community-shell .np-comments-pagination button { border-color: var(--np-community-line); background: var(--np-community-surface); }
.np-community-shell .np-comment-dialog { background: var(--np-community-surface); color: var(--np-community-ink); }
.np-community-shell .np-comment-body { line-height: 1.75; }
.np-community-shell .np-comment-body p { color: var(--np-community-ink); }
.np-community-shell .np-comment-body ul,
.np-community-shell .np-comment-body ol { padding-inline-start: 1.25rem; }

/* Public member profile */
.np-community-member-profile { width: min(calc(100% - 2rem), 80rem); margin: 2rem auto 4rem; color: var(--np-community-ink); }
.np-community-member-profile-hero { min-height: 11rem; padding: clamp(1.25rem, 4vw, 2rem); display: flex; align-items: center; justify-content: space-between; gap: 1.5rem; background: #202b3c; background: linear-gradient(120deg, #202b3c 0%, #2f4260 72%, color-mix(in srgb, var(--np-community-accent) 60%, #2f4260) 100%); color: #ffffff; border-radius: 0.7rem 0.7rem 0 0; }
.np-community-member-profile-identity { min-width: 0; display: flex; align-items: center; gap: 1.2rem; }
.np-community-member-profile-identity img,
.np-community-member-profile-avatar { width: 6rem; height: 6rem; flex: 0 0 6rem; border: 3px solid rgba(255,255,255,0.75); border-radius: 50%; object-fit: cover; box-shadow: 0 8px 24px rgba(0,0,0,0.2); }
.np-community-member-profile-avatar { display: grid; place-items: center; background: var(--np-community-surface); color: var(--np-community-ink); font-size: 2rem; font-weight: 900; }
.np-community-member-profile-eyebrow { margin: 0 0 0.3rem; color: #b9c7dc; font-size: 0.7rem; font-weight: 900; letter-spacing: 0.13em; text-transform: uppercase; }
.np-community-member-profile-copy h1 { margin: 0; font-size: clamp(1.7rem, 4vw, 2.45rem); letter-spacing: -0.045em; line-height: 1.1; }
.np-community-member-profile-handle { margin: 0.45rem 0 0; color: #dbe4f3; font-size: 0.88rem; }
.np-community-member-profile-follow .np-member-follow-action { min-height: 2.65rem; padding: 0.55rem 1.05rem; border-color: rgba(255,255,255,0.45); background: rgba(255,255,255,0.1); color: #ffffff; backdrop-filter: blur(10px); }
.np-community-member-profile-follow .np-member-follow-action[data-np-member-follow="following"] { border-color: #ffffff; background: #ffffff; color: #202b3c; }
.np-community-member-profile-follow .np-member-follow-error { color: #ffe0e0; }
.np-community-member-profile-grid { display: grid; grid-template-columns: minmax(13rem, 18rem) minmax(0, 1fr); align-items: start; background: var(--np-community-surface); border: 1px solid var(--np-community-line); border-top: 0; border-radius: 0 0 0.7rem 0.7rem; box-shadow: 0 16px 36px rgba(28,43,68,0.08); }
.np-community-member-profile-summary { padding: 1.4rem; border-right: 1px solid var(--np-community-line); }
.np-community-member-profile-summary > p { margin: 0; white-space: pre-wrap; line-height: 1.75; }
.np-community-member-profile-summary > p.is-empty { color: var(--np-community-subtle); }
.np-community-member-profile-summary dl { margin: 1.4rem 0 0; display: grid; gap: 0.65rem; }
.np-community-member-profile-summary dl > div { display: flex; align-items: baseline; justify-content: space-between; gap: 1rem; padding-top: 0.65rem; border-top: 1px solid var(--np-community-line); }
.np-community-member-profile-summary dt { color: var(--np-community-subtle); font-size: 0.73rem; }
.np-community-member-profile-summary dd { margin: 0; font-size: 0.83rem; font-weight: 900; }
.np-community-member-profile-activity { min-width: 0; }
.np-community-member-profile-tabs { min-height: 3.4rem; padding: 0 1rem; display: flex; align-items: end; gap: 1.2rem; border-bottom: 1px solid var(--np-community-line); }
.np-community-member-profile-tabs a { min-height: 3.4rem; padding: 1rem 0 0.8rem; display: inline-flex; align-items: center; border-bottom: 3px solid transparent; color: var(--np-community-subtle); font-size: 0.83rem; font-weight: 900; text-decoration: none; }
.np-community-member-profile-tabs a[aria-current="page"] { border-color: var(--np-community-accent); color: var(--np-community-ink); }
.np-community-member-profile-list { margin: 0; padding: 0; list-style: none; }
.np-community-member-profile-list li + li { border-top: 1px solid var(--np-community-line); }
.np-community-member-profile-list li > a,
.np-community-member-profile-list li > div { min-height: 5.5rem; padding: 1rem 1.15rem; display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 0.25rem 1rem; align-content: center; color: inherit; text-decoration: none; }
.np-community-member-profile-list li > a:hover { background: var(--np-community-soft); }
.np-community-member-profile-list strong,
.np-community-member-profile-list p { min-width: 0; margin: 0; grid-column: 1; overflow-wrap: anywhere; }
.np-community-member-profile-list p { color: var(--np-community-subtle); font-size: 0.8rem; }
.np-community-member-profile-list time { grid-column: 2; grid-row: 1 / span 3; align-self: center; color: var(--np-community-subtle); font-size: 0.73rem; white-space: nowrap; }
.np-community-member-profile-kind { color: var(--np-community-accent); font-size: 0.68rem; font-weight: 900; letter-spacing: 0.06em; text-transform: uppercase; }
.np-community-member-profile-empty { min-height: 16rem; margin: 0; display: grid; place-items: center; color: var(--np-community-subtle); }
.np-community-member-profile-pagination { min-height: 3.5rem; padding: 0.65rem 1rem; display: grid; grid-template-columns: 1fr auto 1fr; align-items: center; gap: 0.75rem; border-top: 1px solid var(--np-community-line); color: var(--np-community-subtle); font-size: 0.76rem; text-align: center; }
.np-community-member-profile-pagination a { min-height: 2.25rem; padding: 0.4rem 0.7rem; display: inline-flex; align-items: center; justify-content: center; border: 1px solid var(--np-community-line); border-radius: 0.35rem; background: var(--np-community-surface); color: var(--np-community-ink); font-weight: 800; text-decoration: none; }
.np-community-member-profile-pagination a:first-child { justify-self: start; }
.np-community-member-profile-pagination a:last-child { justify-self: end; }

/* Members, messages and footer */
.np-community-members { min-height: 62vh; padding: 3rem 1rem; display: grid; place-items: start center; background: linear-gradient(180deg, var(--np-community-soft), var(--np-color-background, #f7f8fa)); }
.np-community-members-card { width: min(100%, 30rem); padding: 1.5rem; background: var(--np-community-surface); border: 1px solid var(--np-community-line); border-radius: 0.65rem; box-shadow: 0 16px 36px rgba(28,43,68,0.08); }
.np-community-message { width: min(calc(100% - 2rem), 34rem); min-height: 24rem; margin: 3rem auto; padding: 2rem; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; background: var(--np-community-surface, #ffffff); border: 1px solid var(--np-community-line, #dfe4ea); border-top: 4px solid var(--np-community-accent, #246bfd); border-radius: 0.65rem; color: var(--np-community-ink, #172033); }
.np-community-not-found,
.np-community-members-not-found,
.np-community-error,
.np-community-members-error { box-shadow: 0 16px 36px rgba(28,43,68,0.08); }
.np-community-message-code { color: var(--np-community-accent, #246bfd); font-size: 0.68rem; font-weight: 900; letter-spacing: 0.16em; }
.np-community-message h1 { margin: 0.65rem 0 0; font-size: clamp(1.55rem, 4vw, 2.2rem); letter-spacing: -0.045em; }
.np-community-message > p { max-width: 28rem; margin: 0.9rem 0 0; color: var(--np-community-subtle, #697386); line-height: 1.7; }
.np-community-message-actions { margin-top: 1.5rem; display: flex; flex-wrap: wrap; justify-content: center; gap: 0.55rem; }
.np-community-message-actions a,
.np-community-message-actions button { min-height: 2.5rem; padding: 0.55rem 1rem; display: inline-flex; align-items: center; justify-content: center; border: 1px solid var(--np-community-line, #dfe4ea); border-radius: 0.4rem; background: var(--np-community-surface, #ffffff); color: var(--np-community-ink, #172033); font: inherit; font-size: 0.8rem; font-weight: 800; text-decoration: none; cursor: pointer; }
.np-community-message-actions > :first-child { background: var(--np-community-accent, #246bfd); border-color: var(--np-community-accent, #246bfd); color: var(--np-community-accent-foreground, #ffffff); }
.np-community-footer { background: #202b3c; color: #dbe4f3; }
.np-community-footer-grid { min-height: 9rem; padding-block: 1.6rem; display: grid; grid-template-columns: minmax(15rem, 1.2fr) minmax(12rem, 1fr) auto; gap: 2rem; align-items: start; }
.np-community-footer-brand strong { color: #ffffff; font-size: 1.05rem; }
.np-community-footer-brand p { max-width: 28rem; margin: 0.45rem 0 0; color: #aebbd0; font-size: 0.78rem; }
.np-community-footer-nav { display: flex; flex-wrap: wrap; gap: 0.7rem 1rem; }
.np-community-footer-nav a { font-size: 0.78rem; text-decoration: none; }
.np-community-footer-nav a:hover { color: #ffffff; text-decoration: underline; text-underline-offset: 0.2rem; }
.np-community-footer-meta { display: grid; justify-items: end; gap: 0.45rem; color: #aebbd0; font-size: 0.72rem; }
.np-community-footer-meta a { color: #ffffff; text-decoration: none; }

/* Optional forum integration: documented public hooks only. */
.np-community-shell [data-np-forum-surface] { font-family: inherit; }
.np-community-shell [data-np-forum-surface="board-index"],
.np-community-shell [data-np-forum-surface="post-list"] { letter-spacing: -0.012em; }
.np-community-shell [data-np-forum-block] { width: 100%; }
.np-community-shell [data-np-forum-block="board-directory"] + [data-np-forum-block="post-feed"] { margin-top: 0.85rem; }
.np-community-shell [data-np-forum-engagement] { font-variant-numeric: tabular-nums; }
.np-community-shell [data-np-forum-engagement="post"] button { border-radius: 0.4rem; }
.np-community-shell [data-np-forum-feed-mode="popular"] { --np-forum-panel-shadow: 0 10px 28px rgba(28,43,68,0.08); }

@media (max-width: 1020px) {
  .np-community-content-grid { grid-template-columns: minmax(0, 1fr); }
  .np-community-side-rail { position: static; grid-template-columns: repeat(3, minmax(0, 1fr)); }
  .np-community-highlight-grid { grid-template-columns: 1fr; }
  .np-community-lead-card { border-inline-end: 0; border-bottom: 1px solid var(--np-community-line); }
  .np-community-highlight-list { display: grid; grid-template-columns: 1fr 1fr; }
  .np-community-highlight-list li:nth-last-child(-n + 2) { border-bottom: 0; }
}

@media (max-width: 760px) {
  .np-community-utility-inner > span { display: none; }
  .np-community-utility-inner { justify-content: flex-end; }
  .np-community-brand-inner { min-height: 4.5rem; }
  .np-community-brand-copy small { display: none; }
  .np-community-search-link span:last-child { display: none; }
  .np-community-search-link { min-width: 2.4rem; width: 2.4rem; padding: 0; }
  .np-community-desktop-nav { display: none; }
  .np-community-mobile-nav { display: flex; }
  .np-community-member-profile { width: min(calc(100% - 1.25rem), 80rem); margin-top: 0.75rem; }
  .np-community-member-profile-hero { min-height: 0; align-items: flex-start; flex-direction: column; border-radius: 0.5rem 0.5rem 0 0; }
  .np-community-member-profile-identity img,
  .np-community-member-profile-avatar { width: 4.5rem; height: 4.5rem; flex-basis: 4.5rem; }
  .np-community-member-profile-follow,
  .np-community-member-profile-follow > *,
  .np-community-member-profile-follow .np-member-follow-action { width: 100%; }
  .np-community-member-profile-grid { grid-template-columns: minmax(0, 1fr); }
  .np-community-member-profile-summary { border-right: 0; border-bottom: 1px solid var(--np-community-line); }
  .np-community-member-profile-list li > a,
  .np-community-member-profile-list li > div { grid-template-columns: minmax(0, 1fr); }
  .np-community-member-profile-list time { grid-column: 1; grid-row: auto; }
  .np-community-nav-inner { align-items: center; min-height: 3rem; }
  .np-community-home-intro-inner { min-height: 9rem; align-items: flex-start; flex-direction: column; gap: 1.2rem; }
  .np-community-home-stats { width: 100%; }
  .np-community-home-stats div { min-width: 0; flex: 1; }
  .np-community-lead-card { grid-template-columns: 7rem minmax(0, 1fr); }
  .np-community-lead-visual { min-height: 9rem; }
  .np-community-lead-visual > span { font-size: 3rem; }
  .np-community-highlight-list { grid-template-columns: 1fr; }
  .np-community-highlight-list li:nth-last-child(2) { border-bottom: 1px solid var(--np-community-line); }
  .np-community-latest-list > li { grid-template-columns: 1.75rem minmax(0, 1fr); }
  .np-community-latest-meta { grid-column: 2; grid-row: 2; display: flex; justify-content: flex-start; gap: 0.5rem; }
  .np-community-latest-copy > p { display: none; }
  .np-community-latest-copy > div { display: block; }
  .np-community-latest-copy .np-community-kicker { display: block; margin-bottom: 0.08rem; }
  .np-community-side-rail { grid-template-columns: 1fr; }
  .np-community-panel-head > p { display: none; }
  .np-community-footer-grid { grid-template-columns: 1fr; gap: 1rem; }
  .np-community-footer-meta { justify-items: start; }
  .np-community-article-footer { align-items: flex-start; flex-direction: column; }
}

@media (max-width: 480px) {
  .np-community-utility-inner nav { width: 100%; justify-content: space-between; }
  .np-community-brand-mark { width: 2.25rem; height: 2.25rem; }
  .np-community-brand-copy strong { font-size: 1.15rem; }
  .np-community-write-link { padding-inline: 0.75rem; }
  .np-community-lead-card { grid-template-columns: 1fr; }
  .np-community-lead-visual { min-height: 7rem; }
  .np-community-post-page { padding-inline: 0.5rem; }
  .np-community-message { margin-block: 1.5rem; padding: 1.5rem 1rem; }
}
`;
