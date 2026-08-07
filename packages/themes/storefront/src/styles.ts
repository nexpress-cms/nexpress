export const storefrontCss = `
.np-storefront-shell {
  --np-storefront-surface: var(--np-color-card, #fffdf8);
  --np-storefront-soft: var(--np-color-muted, #f3efe5);
  --np-storefront-ink: var(--np-color-foreground, #23251f);
  --np-storefront-subtle: var(--np-color-muted-foreground, #6f7168);
  --np-storefront-line: var(--np-color-border, #ded8cb);
  --np-storefront-accent: var(--np-color-primary, #315f46);
  --np-storefront-accent-foreground: var(--np-color-primary-foreground, #ffffff);
  --np-shop-content-max: 86rem;
  --np-shop-surface: var(--np-storefront-surface);
  --np-shop-soft: var(--np-storefront-soft);
  --np-shop-ink: var(--np-storefront-ink);
  --np-shop-subtle: var(--np-storefront-subtle);
  --np-shop-line: var(--np-storefront-line);
  --np-shop-accent: var(--np-storefront-accent);
  --np-shop-accent-foreground: var(--np-storefront-accent-foreground);
  min-height: 100%;
  overflow-x: clip;
  background: var(--np-color-background, #fbf9f3);
  color: var(--np-storefront-ink);
  font-family: var(--np-font-body, "Pretendard", system-ui, sans-serif);
  line-height: 1.55;
}
.np-storefront-shell *,
.np-storefront-shell *::before,
.np-storefront-shell *::after { box-sizing: border-box; }
.np-storefront-shell a { color: inherit; }
.np-storefront-container {
  width: min(100%, 86rem);
  margin-inline: auto;
  padding-inline: clamp(1rem, 4vw, 2rem);
}
.np-storefront-announcement {
  min-height: 2.25rem;
  display: grid;
  place-items: center;
  padding: 0.35rem 1rem;
  background: #25382d;
  color: #f6f4ed;
  font-size: 0.72rem;
  letter-spacing: 0.04em;
  text-align: center;
}
.np-storefront-header {
  position: relative;
  z-index: 20;
  border-bottom: 1px solid var(--np-storefront-line);
  background: color-mix(in srgb, var(--np-storefront-surface) 94%, transparent);
}
.np-storefront-header-main {
  min-height: 5.25rem;
  display: grid;
  grid-template-columns: minmax(11rem, 0.7fr) minmax(0, 1fr) minmax(9rem, 0.7fr);
  align-items: center;
  gap: 1rem;
}
.np-storefront-brand {
  display: inline-flex;
  align-items: center;
  gap: 0.7rem;
  text-decoration: none;
}
.np-storefront-brand > span {
  width: 2.35rem;
  height: 2.35rem;
  display: grid;
  place-items: center;
  border: 1px solid var(--np-storefront-ink);
  border-radius: 50%;
  font-family: var(--np-font-heading, Georgia, serif);
  font-size: 1.25rem;
  font-style: italic;
}
.np-storefront-brand strong {
  font-family: var(--np-font-heading, Georgia, serif);
  font-size: 1.2rem;
  letter-spacing: -0.02em;
}
.np-storefront-header nav {
  display: flex;
  justify-content: center;
  gap: clamp(0.8rem, 2.5vw, 2rem);
}
.np-storefront-header nav a,
.np-storefront-tools a {
  font-size: 0.78rem;
  font-weight: 700;
  text-decoration: none;
}
.np-storefront-header nav a:hover,
.np-storefront-tools a:hover { color: var(--np-storefront-accent); }
.np-storefront-tools { display: flex; justify-content: flex-end; gap: 1rem; }
.np-storefront-hero {
  min-height: min(43rem, 76vh);
  display: flex;
  align-items: flex-end;
  padding-block: clamp(4rem, 10vw, 8rem);
  background:
    radial-gradient(circle at 78% 24%, rgba(255,255,255,.72), transparent 22%),
    linear-gradient(135deg, #d8d0bb 0%, #f0eadc 46%, #bccbbd 100%);
}
.np-storefront-hero p,
.np-storefront-story-section header > p,
.np-storefront-journal > header > p {
  margin: 0 0 0.7rem;
  color: var(--np-storefront-accent);
  font-size: 0.74rem;
  font-weight: 800;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}
.np-storefront-hero h1 {
  max-width: 10ch;
  margin: 0;
  font-family: var(--np-font-heading, Georgia, serif);
  font-size: clamp(3rem, 9vw, 7.5rem);
  font-weight: 500;
  letter-spacing: -0.065em;
  line-height: .88;
}
.np-storefront-hero .np-storefront-container > span {
  max-width: 34rem;
  display: block;
  margin-top: 1.5rem;
  color: #4e554c;
  font-size: clamp(.95rem, 1.8vw, 1.15rem);
}
.np-storefront-hero .np-storefront-container > div {
  display: flex;
  gap: .75rem;
  margin-top: 1.5rem;
}
.np-storefront-hero .np-storefront-container > div a {
  min-height: 2.65rem;
  display: inline-flex;
  align-items: center;
  padding: 0 1rem;
  border: 1px solid var(--np-storefront-accent);
  background: var(--np-storefront-accent);
  color: var(--np-storefront-accent-foreground);
  font-size: .78rem;
  font-weight: 800;
  text-decoration: none;
}
.np-storefront-hero .np-storefront-container > div a + a {
  background: transparent;
  color: var(--np-storefront-accent);
}
.np-storefront-extension-blocks { padding-block: clamp(2rem, 6vw, 5rem); }
.np-storefront-story-section { padding-block: clamp(3rem, 8vw, 7rem); }
.np-storefront-story-section > header {
  display: grid;
  grid-template-columns: 1fr auto;
  align-items: end;
  gap: .5rem 1rem;
  margin-bottom: 2rem;
  border-bottom: 1px solid var(--np-storefront-line);
  padding-bottom: 1rem;
}
.np-storefront-story-section > header p { grid-column: 1 / -1; }
.np-storefront-story-section h2,
.np-storefront-journal h1,
.np-storefront-page h1,
.np-storefront-post h1 {
  margin: 0;
  font-family: var(--np-font-heading, Georgia, serif);
  font-weight: 500;
  letter-spacing: -.045em;
}
.np-storefront-story-section h2 { font-size: clamp(2rem, 5vw, 4rem); }
.np-storefront-story-section > header a { color: var(--np-storefront-accent); font-size: .8rem; font-weight: 800; }
.np-storefront-story-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 1rem; }
.np-storefront-story-grid article {
  min-height: 19rem;
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  padding: 1.25rem;
  border: 1px solid var(--np-storefront-line);
  background: var(--np-storefront-surface);
}
.np-storefront-story-grid article > span {
  width: 3rem;
  height: 3rem;
  display: grid;
  place-items: center;
  margin-bottom: auto;
  border-radius: 50%;
  background: var(--np-storefront-soft);
  color: var(--np-storefront-accent);
  font-family: var(--np-font-heading, Georgia, serif);
  font-size: 1.3rem;
}
.np-storefront-story-grid h3 { margin: 0; font-family: var(--np-font-heading, Georgia, serif); font-size: 1.35rem; }
.np-storefront-story-grid h3 a { text-decoration: none; }
.np-storefront-story-grid p { margin: .7rem 0 0; color: var(--np-storefront-subtle); font-size: .85rem; }
.np-storefront-page,
.np-storefront-journal,
.np-storefront-post { padding-block: clamp(2.5rem, 7vw, 6rem); }
.np-storefront-page > h1,
.np-storefront-journal h1,
.np-storefront-post h1 { font-size: clamp(2.5rem, 7vw, 5.5rem); }
.np-storefront-journal > header,
.np-storefront-post > header { max-width: 58rem; margin-bottom: 3rem; }
.np-storefront-journal > header > span,
.np-storefront-post header p { display: block; margin-top: 1rem; color: var(--np-storefront-subtle); font-size: 1rem; }
.np-storefront-journal-grid { border-top: 1px solid var(--np-storefront-line); }
.np-storefront-journal-grid article {
  display: grid;
  grid-template-columns: 5rem 1fr;
  gap: 1.5rem;
  padding: 1.5rem 0;
  border-bottom: 1px solid var(--np-storefront-line);
}
.np-storefront-journal-grid article > span { color: var(--np-storefront-subtle); font-family: var(--np-font-mono, monospace); }
.np-storefront-journal-grid h2 { margin: 0; font-family: var(--np-font-heading, Georgia, serif); font-size: clamp(1.3rem, 3vw, 2rem); }
.np-storefront-journal-grid h2 a { text-decoration: none; }
.np-storefront-journal-grid p { max-width: 60ch; margin: .5rem 0; color: var(--np-storefront-subtle); }
.np-storefront-journal-grid time { font-size: .74rem; color: var(--np-storefront-subtle); }
.np-storefront-post > a { color: var(--np-storefront-accent); font-size: .8rem; font-weight: 800; }
.np-storefront-post-cover {
  width: 100%;
  max-height: 44rem;
  display: block;
  margin-bottom: 3rem;
  object-fit: cover;
}
.np-storefront-prose {
  max-width: 46rem;
  font-size: 1rem;
  line-height: 1.8;
}
.np-storefront-prose h2,
.np-storefront-prose h3,
.np-storefront-prose h4 { margin: 1.7em 0 .55em; font-family: var(--np-font-heading, Georgia, serif); line-height: 1.2; }
.np-storefront-prose p,
.np-storefront-prose ul,
.np-storefront-prose ol,
.np-storefront-prose blockquote { margin: 1em 0; }
.np-storefront-prose ul,
.np-storefront-prose ol { padding-left: 1.4rem; }
.np-storefront-prose blockquote { padding-left: 1rem; border-left: 3px solid var(--np-storefront-accent); color: var(--np-storefront-subtle); }
.np-storefront-footer {
  padding: 4rem 0 1.5rem;
  background: #25302a;
  color: #f1efe8;
}
.np-storefront-footer-grid {
  display: grid;
  grid-template-columns: 1.3fr .7fr 1fr;
  gap: clamp(2rem, 6vw, 6rem);
}
.np-storefront-footer-grid section > strong { font-family: var(--np-font-heading, Georgia, serif); font-size: 1.25rem; }
.np-storefront-footer-grid p { color: #bdc4bd; font-size: .84rem; line-height: 1.65; }
.np-storefront-footer-grid nav { display: grid; align-content: start; gap: .65rem; }
.np-storefront-footer-grid a { font-size: .8rem; text-underline-offset: .2rem; }
.np-storefront-footer-meta {
  display: flex;
  justify-content: space-between;
  gap: 1rem;
  margin-top: 3rem;
  padding-top: 1rem;
  border-top: 1px solid #4b574f;
  color: #99a39b;
  font-size: .7rem;
}
.np-storefront-shell[data-np-storefront-density="compact"] .np-shop-product-grid { gap: .75rem; }
.np-storefront-shell .np-shop[data-np-shop-skin],
.np-storefront-shell [data-np-shop-block] { font-family: inherit; }
.np-storefront-shell .np-shop[data-np-shop-skin="classic"] .np-shop-product-card {
  border-radius: 0;
  box-shadow: none;
}
.np-storefront-shell .np-shop-product-image,
.np-storefront-shell .np-shop-category-grid > a { border-radius: 0; }
.np-storefront-shell [data-np-shop-surface="cart"] .np-shop-cart-lines > li,
.np-storefront-shell [data-np-shop-surface="cart"] .np-shop-cart-summary,
.np-storefront-shell [data-np-shop-surface="checkout"] .np-shop-checkout-intent,
.np-storefront-shell [data-np-shop-surface="checkout"] .np-shop-checkout-summary,
.np-storefront-shell [data-np-shop-surface="order-draft"] fieldset,
.np-storefront-shell [data-np-shop-surface="order-draft"] .np-shop-order-draft-summary,
.np-storefront-shell [data-np-shop-surface="orders"] .np-shop-order-list article,
.np-storefront-shell [data-np-shop-surface="order"] .np-shop-order-layout > section,
.np-storefront-shell [data-np-shop-surface="order"] .np-shop-order-layout > aside {
  border-radius: 0;
}
.np-storefront-shell [data-np-shop-reviews] { margin-top: 4rem; }
.np-storefront-shell .np-shop-review-summary,
.np-storefront-shell [data-np-shop-review-form] { border-radius: 0; box-shadow: none; }
.np-storefront-shell [data-np-shop-review] > header strong { color: var(--np-storefront-accent); }
@media (max-width: 52rem) {
  .np-storefront-header-main { grid-template-columns: 1fr auto; min-height: 4.5rem; }
  .np-storefront-header nav { grid-column: 1 / -1; justify-content: flex-start; padding-bottom: 1rem; overflow-x: auto; }
  .np-storefront-story-grid,
  .np-storefront-footer-grid { grid-template-columns: 1fr; }
  .np-storefront-hero { min-height: 34rem; }
}
@media (max-width: 32rem) {
  .np-storefront-tools { display: none; }
  .np-storefront-journal-grid article { grid-template-columns: 2.5rem 1fr; gap: .75rem; }
  .np-storefront-footer-meta { flex-direction: column; }
}
`;
