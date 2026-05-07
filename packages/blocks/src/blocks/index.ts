export { heroBlock } from "./hero.js";
export { featureGridBlock } from "./feature-grid.js";
export { faqBlock } from "./faq.js";
export { pricingBlock } from "./pricing.js";
export { ctaBlock } from "./cta.js";
export { richTextBlock } from "./rich-text.js";
export { contactFormBlock } from "./contact-form.js";
export { imageGalleryBlock } from "./image-gallery.js";
export { gridBlock, readGridChildLayout } from "./grid.js";
export { sectionHeaderBlock } from "./section-header.js";
export { testimonialsBlock } from "./testimonials.js";
export { statsGridBlock } from "./stats-grid.js";
export { logosCloudBlock } from "./logos-cloud.js";
export { tabsBlock } from "./tabs.js";

// Atom blocks (paragraph / heading / quote / list / code / callout
// / image / divider) lived here briefly during the in-page editor's
// initial design. The rich-text block covers all of these via
// Lexical (paragraphs, headings, lists, code, image, HR + inline
// marks — all in one editor surface), so shipping separate atom
// blocks duplicated the same content types under a different wire
// format. Removed before #511 merged; rich-text is the canonical
// content surface for prose / structured text.
