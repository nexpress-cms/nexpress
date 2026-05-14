---
"@nexpress/theme-magazine": minor
---

Theme-magazine redesign — editorial magazine identity (The Northbound
Review).

Visual surface overhauled to a print-magazine register: full-width
dateline strip at the top with date + volume / issue label and
secondary chrome links; double-rule masthead with a Newsreader
display-italic title, small-caps ornamental rules flanking an "Est."
ornament, and an italic tagline; primary section nav under a single
hairline rule; cover-story 2-col lead (5/6 hero cover with a Roman-
numeral figure overlay and caption, body block with kicker rule +
italic display title + italic deck + byline rule with a "Read →"
link); "In this issue" 3-up secondary row with story-cover gradients;
dispatches + archive split (1-col timed dispatch list + 2-col archive
grid with square thumbnails); deep-ink full-bleed subscribe band with
double-rule top/bottom; three-column colophon footer (brand mark +
italic colophon paragraph / sections / colophon links) above a
hairline meta row.

`impl.tokens` overlay updates the identity — cream `#f6f1e7` surface,
deep ink `#1a1411` foreground, terracotta `#b04a26` primary; Newsreader
display-italic + body, Hanken Grotesk for chrome (mono slot points
at it so kicker / byline / nav letter-spacing works at all sizes).

`impl.seedContent` ships fourteen demo posts laid out for the index
template's zones — 1 lead (`featured: true`) + 3 secondary + 4
timed dispatches + 6 archive items — plus six categories (Features /
Dispatches / Profiles / Essays / Reporting / Photography) and primary
+ footer navigation. Posts attach to the seeding admin user;
diversifying authors across the seed set needs the seedContent
contract to grow per-author wiring (queued as a follow-up).

`i18n.{en,ko}` adds three new keys the masthead reads via `t()`:
`magazine.title`, `magazine.ornament`, `magazine.tagline`. Operators
that rename the publication override these in their site-level UI
string bundle (last-writer-wins on key collision).

Component-level changes:

- `header.tsx`: now emits the dateline strip + masthead with
  ornaments + display-italic logo + section nav, all in one slot
  output (returns a Fragment of `<div className="np-magazine-
  dateline">` + `<header>`). Volume / issue derived from the year
  so the masthead stays editorially accurate without an admin step.
- `footer.tsx`: restructured to a 3-col colophon (brand block /
  sections / colophon) above a hairline meta row. Reads from
  `footer` + `footerColophon` nav locations; falls back to a short
  stub when neither is wired.
- `post-list.tsx`: full rewrite — renders the lead / 3-up /
  dispatches+archive / subscribe zones inline rather than via
  `MagazinePostCard`. `MagazinePostCard` is kept for sites that
  embed it elsewhere.
- `post-feature.tsx`: adds `deck` field support + centered byline
  with reading time. Drop cap on the first paragraph remains
  CSS-driven.
- `MagazinePostCardDoc` gains `readingTime`, `featured`, and
  `categories` as optional fields the new template reads.

`np-magazine-*` class prefix preserved across all surfaces so theme
swaps don't leave residue.
