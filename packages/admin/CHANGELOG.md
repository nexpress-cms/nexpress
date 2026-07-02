# @nexpress/admin

## 0.3.26

### Patch Changes

- 64c6c7e: Add background WordPress import runs with admin progress polling, run history, and worker execution for Apply.
- b7284a9: Add an admin WordPress import screen with WXR preview/apply controls and a shared app API route.
- 192270e: Add admin WordPress import custom type mappings with preview diagnostics and background-run persistence.
- ffee334: Harden admin WordPress import background runs with worker status guidance, stale-run cleanup, and real pg-boss pickup coverage.
- Updated dependencies [64c6c7e]
- Updated dependencies [11e3007]
- Updated dependencies [192270e]
  - @nexpress/core@0.3.26
  - @nexpress/editor@0.3.26
  - @nexpress/blocks@0.3.26

## 0.3.25

### Patch Changes

- 1d11718: Harden admin authoring recovery with browser-history unsaved-change prompts and session-scoped autosave recovery dismissal.
- 8fe1905: Add an admin autosave recovery banner with review/apply controls and more readable revision snapshots.
- 11d6514: Improve the Document view authoring experience with a visible empty canvas state and stronger publish-to-public-render coverage.
- d48a1c8: Preserve scheduled document status when Save & Preview saves dirty edits, restore framework-managed `publishedAt` codegen for draft-enabled collections, accept ISO `publishedAt` strings in the save pipeline, and complete the Magazine theme's tag and monthly date archives with seeded tag content.
- df736ab: Improve collection authoring reliability with visible save-failure states, unsaved-change navigation guards, autosave retry, and revision difference summaries.
- 590e12d: Align admin Preview links with each collection's configured public URL path and cover draft-mode preview for pages and posts.
- 2b72360: Tighten scheduled publishing end to end: add an admin status filter for scheduled rows, include draft-enabled framework `publishedAt` columns in the scheduled sweep, return the sweep timestamp from the internal trigger, and document the public API scheduling contract.
- 44b754d: Improve admin preview authoring so new and dirty documents save first, then open the server-resolved public preview route.
- Updated dependencies [d48a1c8]
- Updated dependencies [2b72360]
- Updated dependencies [a96907c]
- Updated dependencies [2c95312]
  - @nexpress/core@0.3.25
  - @nexpress/blocks@0.3.25
  - @nexpress/editor@0.3.25

## 0.3.24

### Patch Changes

- @nexpress/blocks@0.3.24
- @nexpress/core@0.3.24
- @nexpress/editor@0.3.24

## 0.3.23

### Patch Changes

- 4fd3bf8: Add an admin Ops overview that combines Health, Readiness, Jobs, Storage, and
  Plugins into one operator queue, upgrade the Health page with copyable
  remediation commands and JSON evidence, and scaffold the matching route
  wrappers in new projects.
- b7cf702: Add an admin Readiness surface that gathers deploy, migration, backup, storage,
  jobs, and plugin ops evidence from the existing CLI core checks, and scaffold the
  matching route wrappers in new projects.
  - @nexpress/blocks@0.3.23
  - @nexpress/core@0.3.23
  - @nexpress/editor@0.3.23

## 0.3.22

### Patch Changes

- 2c85715: Add an admin recovery action for stale active themes after removal and surface the same repair path in theme removal guidance.
- 7a28472: Harden Document view quick insert and preview cleanup while extending persistence coverage.
  Emit typed generated-schema foreign-key callbacks so self-referential collections typecheck under
  project-service lint.
- 31f1868: Keep schema-backed plugin config forms consistent between the plugin list Configure dialog and the plugin detail page. Also harden theme/plugin settings schema introspection for wrapped array elements and add tested helpers for one-item-per-line string-array inputs.
- 84ae7c9: Expose configSchema-only plugin admin pages from the Plugins list and render empty config schemas as settings pages.
- 7d461d7: Align plugin discovery and install guidance with `nexpress plugin add`, including manual fallback commands and ops doctor verification.
- e00a036: Improve plugin lifecycle guidance by adding restart and doctor verification steps after plugin
  removal, clearer manual removal recovery output, and a copyable plugin doctor command in Admin.
- 5852e1b: Align admin theme APIs and UI with public fallback behavior when the persisted active theme is no longer registered.
- Updated dependencies [7a28472]
- Updated dependencies [31f1868]
  - @nexpress/core@0.3.22
  - @nexpress/blocks@0.3.22
  - @nexpress/editor@0.3.22

## 0.3.21

### Patch Changes

- b5b9074: Restore legacy plugin settings saves through the dedicated plugin config route while keeping schema-backed plugin config validation intact.
- Updated dependencies [edfc9ae]
- Updated dependencies [b5b9074]
  - @nexpress/core@0.3.21
  - @nexpress/blocks@0.3.21
  - @nexpress/editor@0.3.21

## 0.3.20

### Patch Changes

- 769473f: Improve plugin authoring/install UX in the admin registry. The discover API now returns install,
  registration, and verification hints for each npm result, and the admin Browse registry dialog can
  copy both the install command and the matching `nexpress.config.ts` registration snippet. Plugin
  author docs now reflect the current auto-form `.refine()` support and plugin object registration
  shape.
  - @nexpress/blocks@0.3.20
  - @nexpress/core@0.3.20
  - @nexpress/editor@0.3.20

## 0.3.19

### Patch Changes

- @nexpress/blocks@0.3.19
- @nexpress/core@0.3.19
- @nexpress/editor@0.3.19

## 0.3.18

### Patch Changes

- @nexpress/blocks@0.3.18
- @nexpress/core@0.3.18
- @nexpress/editor@0.3.18

## 0.3.17

### Patch Changes

- 9342083: Reduce admin React compiler warnings in settings, plugin, navigation, and async loader surfaces by deferring load-triggered state updates outside synchronous effects.
- e0fffb6: Improve collection editor field affordances with text length counters, native length limits, and clearer condition-hidden field guidance.
- 456cfbd: Keep the admin package lintable with content-based ESLint caching and remove remaining lint errors in the document editor helpers.
- 44520a5: Reduce React compiler warnings in the admin block editor by moving open-time resets and DOM projection updates out of synchronous effects.
- e6eb968: Reduce admin React compiler warnings across dialog reset, media loading, navigation shell, data table pagination, and collection list surfaces.
- 6d55e54: Keep nested array block props editable in the block editor so docs API table rows can edit their cells without JSON fallback.
- fef3414: Polish Document-mode quick insert accessibility and keep hover controls inside the viewport on narrow canvases.
- f257223: Count rich-text content in the Document-mode status bar and align the in-page editor docs with the implemented quick insert and top-level drag controls.
- Updated dependencies [6d55e54]
  - @nexpress/blocks@0.3.17
  - @nexpress/core@0.3.17
  - @nexpress/editor@0.3.17

## 0.3.16

### Patch Changes

- 06417de: Improve mobile dashboard shortcuts and media dialog resilience.
- 6014f93: Improve mobile touch targets in the admin collection editor and page builder controls.
- 4a9d9fb: Keep draft, schedule, and publish actions reachable from a sticky mobile editor action bar.
- 6d2c31a: Improve mobile resilience for collection editor side panels and plugin tab cards.
- dfa4a0b: Polish mobile sizing for block editor rows, starter buttons, and image picker controls.
- bcb4509: Finish mobile touch-target polish for editor dialogs, picker dialogs, and switch controls.
- f6a770d: Improve mobile collection list card actions, selection targets, and bulk delete dialog controls.
- b6c8834: Tighten mobile sizing for user-management actions and report queue cards.
- 96c59d2: Improve mobile list filtering controls for admin members, audit logs, and jobs.
- 401d23d: Render the settings locales progress table as mobile-friendly collection cards on narrow screens.
  Keep the default theme mobile drawer from widening long article pages while open.
- 9c95e89: Improve mobile media library controls, card selection targets, and bulk delete confirmation.
- 03080b8: Finish admin mobile hardening across plugin, jobs, community, and theme cleanup operational controls.
- 7996b9a: Improve mobile controls for deep admin settings tabs and navigation/user dialogs.
- 30083fe: Improve mobile tap targets for admin plugin controls and config dialogs.
- a400d9d: Improve mobile resilience for user, site, and membership management dialogs.
- b1c8643: Improve admin mobile ergonomics by tightening narrow-screen shell spacing, simplifying topbar breadcrumbs on phones, and stacking editor actions on very small viewports. Also remove the default theme's member-status loading chrome so auth links do not flash on first render.
  - @nexpress/blocks@0.3.16
  - @nexpress/core@0.3.16
  - @nexpress/editor@0.3.16

## 0.3.15

### Patch Changes

- da32271: Fix bundled theme mobile overflow regressions, including the default header's auth-driven
  tablet overflow, and allow seeded posts to declare clean URL slugs.
  - @nexpress/blocks@0.3.15
  - @nexpress/core@0.3.15
  - @nexpress/editor@0.3.15

## 0.3.14

### Patch Changes

- Updated dependencies [bf8ca4d]
  - @nexpress/core@0.3.14
  - @nexpress/blocks@0.3.14
  - @nexpress/editor@0.3.14

## 0.3.13

### Patch Changes

- @nexpress/blocks@0.3.13
- @nexpress/core@0.3.13
- @nexpress/editor@0.3.13

## 0.3.12

### Patch Changes

- 29c64b5: Improve mobile overflow handling for auth, settings, users, and linked identity admin surfaces.
- 2d960fb: Improve mobile overflow handling for the admin page builder and editor support panels.
- 6f82c9f: Improve mobile overflow handling for collection list and edit admin views.
- 1645ed4: Improve mobile wrapping and overflow handling across the community moderation admin views.
- 226f3f1: Improve mobile overflow handling for the admin dashboard.
- 03118a1: Improve mobile layouts for admin media lists, site membership panels, linked identity panels, and site cards.
- f4c483c: Improve mobile ergonomics across admin edit screens, block-editor controls, and rich-text image insertion dialogs.
- fb4ba86: Clamp collection editor columns and rich-text surfaces to the mobile viewport so toolbar content wraps instead of being clipped.
- 1f9ac01: Improve mobile layout resilience for page-builder dialogs, including JSON editors, pattern browsing, block palette, block settings, media picker, and delete confirmations.
- 7afa936: Improve mobile overflow handling for shared admin form controls and picker dialogs.
- 86b2d4f: Improve mobile overflow handling for the jobs admin view.
- 11ab920: Add mobile card layouts for admin members, moderation queues, audit logs, and user management lists.
- a3e9f50: Improve mobile wrapping and action layouts on member detail moderation panels.
- ae79d5a: Improve mobile overflow handling for members and media admin views.
- 9da5e4d: Improve mobile layout resilience for the navigation editor and plugin manager, keeping nested rows, long plugin ids, registry dialogs, and action groups within narrow admin viewports.
- 2937c1c: Improve plugin admin extension panels on mobile with card-style table rows, full-width action controls, and safer wrapping for long plugin output.
- 83417cb: Constrain admin dialog, popover, dropdown, and select primitives on narrow mobile viewports.
- abdb9d4: Improve mobile overflow handling across admin settings, plugins, themes, and health surfaces.
- fcdb349: Tighten mobile layout for generated settings forms and theme controls so long labels, values, and action bars wrap inside narrow admin viewports.
- 8e6e29a: Improve mobile layout resilience for admin settings, jobs, dashboard, plugin management, navigation, and media upload surfaces.
- f3349a8: Improve admin mobile layout with an overlay navigation drawer, tighter topbar controls, mobile collection-list cards, safer dialog sizing, responsive admin tables, and a Next-safe admin theme bootstrap.
- 70bc0ee: Improve mobile layout resilience for multi-site admin surfaces, including site cards, delete/create dialogs, membership grants, and the topbar site picker.
- ad979b3: Treat the first-boot admin and E2E admin fixture as super-admins, and hide the Sites
  admin entry for non-super admins so the multi-site screen matches the API gate.
- 3290e04: Harden mobile layouts for theme switching, reseeding, and cleanup flows so long theme names, block types, requirement messages, and action groups stay inside narrow admin viewports.
- Updated dependencies [f4c483c]
- Updated dependencies [fb4ba86]
  - @nexpress/editor@0.3.12
  - @nexpress/blocks@0.3.12
  - @nexpress/core@0.3.12

## 0.3.11

### Patch Changes

- @nexpress/blocks@0.3.11
- @nexpress/core@0.3.11
- @nexpress/editor@0.3.11

## 0.3.10

### Patch Changes

- Updated dependencies [45bca0d]
  - @nexpress/core@0.3.10
  - @nexpress/blocks@0.3.10
  - @nexpress/editor@0.3.10

## 0.3.9

### Patch Changes

- @nexpress/blocks@0.3.9
- @nexpress/core@0.3.9
- @nexpress/editor@0.3.9

## 0.3.8

### Patch Changes

- Updated dependencies [b331118]
  - @nexpress/core@0.3.8
  - @nexpress/blocks@0.3.8
  - @nexpress/editor@0.3.8

## 0.3.7

### Patch Changes

- @nexpress/blocks@0.3.7
- @nexpress/core@0.3.7
- @nexpress/editor@0.3.7

## 0.3.6

### Patch Changes

- @nexpress/blocks@0.3.6
- @nexpress/core@0.3.6
- @nexpress/editor@0.3.6

## 0.3.5

### Patch Changes

- @nexpress/blocks@0.3.5
- @nexpress/core@0.3.5
- @nexpress/editor@0.3.5

## 0.3.4

### Patch Changes

- Updated dependencies [4d997b8]
  - @nexpress/core@0.3.4
  - @nexpress/blocks@0.3.4
  - @nexpress/editor@0.3.4

## 0.3.3

### Patch Changes

- Updated dependencies [3072b40]
  - @nexpress/core@0.3.3
  - @nexpress/blocks@0.3.3
  - @nexpress/editor@0.3.3

## 0.3.2

### Patch Changes

- Updated dependencies [131d969]
- Updated dependencies [1fe61de]
- Updated dependencies [4e75c7a]
- Updated dependencies [0c5b8d9]
  - @nexpress/core@0.3.2
  - @nexpress/blocks@0.3.2
  - @nexpress/editor@0.3.2

## 0.3.1

### Patch Changes

- 07c763b: feat(theme-docs, core, app, admin): universal-content-model Phase U.2+U.3+U.4 — docs collapse into posts.kind

  Docs are now posts with `kind: "doc"`. Bundles U.2 (theme query
  rewrite + admin sidebar per-kind), U.3 (drop docs table — no
  data to migrate since pre-1.0 has no users), and U.4 cleanup
  (remove docs slug from registry) into one PR. Pages stay
  separate (the page-builder body is a different writing
  experience from prose).

  ## Theme contract (@nexpress/core)
  - `NpThemeCollectionRequirement.kinds` — keyed by discriminator
    value, each entry carries `label`, `labelPlural`, `icon`
    (lucide), optional `urlPattern`, optional `hierarchical`. The
    merge-requirements step unions across registered themes and
    stamps the result onto `admin.kinds` on the collection.
  - `NpThemeCollectionKind` exported from both
    `@nexpress/core` root and via the requirement type.
  - Merge logic now handles the `kinds` block (last-write-wins on
    per-kind props), in addition to the field-options union from
    U.1.

  ## Docs theme (@nexpress/theme-docs)
  - `requires.collections.docs` removed. The collection is gone.
  - `requires.collections.posts` now contributes `kind: "doc"`
    options, `lede` + `stableSince` fields, and
    `kinds.doc: { label, labelPlural: "Documentation",
icon: "BookOpen", urlPattern: "/docs/:slug", hierarchical: true }`.
  - `templates.docs.default` moves to `templates.posts.doc` —
    template id matches the kind value.
  - Sidebar / doc-detail route / doc-page template queries all
    switch from `findDocuments("docs", ...)` →
    `findDocuments("posts", { where: { kind: "doc", ... } })`.

  ## Built-in posts (@nexpress/app)
  - `seo.urlPath` reads `doc.kind` and returns `/docs/<slug>`
    when kind=doc, `/blog/<slug>` otherwise. Operators with
    custom kinds register their own override.

  ## Admin (@nexpress/admin)
  - `AdminShellCollection.admin.kinds` — per-kind nav metadata.
    Sidebar walks the merged map and renders one entry per kind
    under the collection's group, linking to
    `/admin/collections/<slug>?kind=<value>`.
  - Reference app's protected layout projects `c.admin.kinds`
    into the shell props.
  - Collection list view (`/admin/collections/<slug>`) reads
    `?kind=` from searchParams and adds it to the `findDocuments`
    where clause. Unknown kinds yield empty results rather than
    errors.

  ## Schema
  - `apps/web/drizzle/0003_tiresome_harry_osborn.sql`:
    `DROP TABLE np_c_docs CASCADE` + ADD COLUMN lede + ADD COLUMN
    stable_since on np_c_posts.
  - Pre-1.0 + no users → destructive drop is OK. Operators with
    doc data run U.1 first to add `kind` to posts, then export
    np_c_docs rows to `kind="doc"` posts manually before
    upgrading to this release.

  ## Remaining follow-up

  Create-form kind pre-fill and the generic kind URL resolver were
  completed later in the universal-content-model follow-up batch.
  - **Kind-aware capabilities** — `content.publish.<kind>`
    capability strings designed-in but not implemented. Add when
    an operator asks for the split.

- 1c07056: feat(admin, app): editor a11y + motion polish (5/7)

  PR 5 of the editor progressive-disclosure sequence. Cleans up
  the smaller a11y / interaction loose ends queued from PRs 1-4.

  ## Sidebar group collapse animation

  PR 2 wired the collapse interaction but Radix Collapsible
  needs CSS keyframes to animate; without them the content
  snaps open / closed. Added `np-collapsible-slide-down` /
  `np-collapsible-slide-up` keyframes in
  `@nexpress/app/styles/globals.css` interpolating
  `--radix-collapsible-content-height` over 180ms. Targeted via
  the `np-sidebar-group-content` marker class so other Radix
  Collapsibles in the admin aren't accidentally restyled.

  ## Focus ring on the group header

  The header was clickable (`role="button"`, `tabIndex=0`) but
  had no `:focus-visible` style — keyboard users couldn't see
  which group was about to toggle. Added
  `focus-visible:ring-2 focus-visible:ring-[var(--np-color-brand)]`
  matching the rest of the admin's focus treatment.

  ## `aria-controls` id sanitization

  The id contained dots from `storageKey`. HTML allows dots in
  ids but CSS attribute / id selectors break, and dev-tools
  navigation is friendlier with hyphens. Replaced with
  `.replace(/\./g, "-")` so the id is `np-sidebar-group-posts-Publish`
  rather than `np-sidebar-group-np-admin.sidebar-group.posts.Publish`.

  ## Show-all toggle label association

  The toggle's text was a `<span>` with no `<label htmlFor>`
  wiring to the Switch — screen readers had to rely on the
  Switch's `aria-label` alone. Added an explicit `<label>`
  pointing at the Switch's id; the existing `aria-label` stays
  for SRs that prefer it.

  ## What does NOT change
  - Default open/closed state — same as PR 2.
  - Toggle visibility logic — same as PR 1.
  - localStorage key shape — same.

  ## Test plan
  - [x] `@nexpress/admin` build + typecheck clean
  - [ ] Browser: click sidebar group header → smooth 180ms slide
        animation.
  - [ ] Keyboard: tab to group header → visible focus ring;
        Enter / Space toggles.
  - [ ] Screen reader: clicking the toggle's text label moves
        focus to the Switch.

- 95cbc46: feat(admin): auto-expand sidebar group containing a validation error (7/7)

  Closing PR of the editor progressive-disclosure sequence. PR 6
  shipped toast + auto-focus on Save failure, but if the failing
  field sat inside a collapsed `SidebarGroupCard` the focus +
  scrollIntoView fired against a hidden element. This PR
  force-opens any group whose field has a current validation
  error.

  ## Mechanism

  `SidebarGroupCard` gains an optional `forceOpen?: boolean` prop.
  When true, the Collapsible renders as open regardless of the
  user's localStorage-persisted preference. Local state still
  tracks the operator's intent — once errors clear (operator
  fixes the field, submit succeeds), the force lifts and the
  card reverts to whatever the user had set.

  The parent `CollectionEditView` walks each `sidebarGroups`
  entry, checks `form.formState.errors` for any field in that
  group, and passes `forceOpen={hasError}` to the matching card.
  Reactive: as the operator fixes the field, the error clears
  and the force-open lifts; if they collapse the card during the
  force, the local state captures that and applies once force
  lifts.

  ## Edge handling
  - **User clicks the trigger while force-open**: the click still
    updates local state via `setOpen`. UX-wise the card stays
    open (forceOpen wins for `effectiveOpen`), but the
    preference is captured. Once force lifts, the card honors
    the captured preference.
  - **ARIA wiring**: `aria-expanded={effectiveOpen}` reflects the
    actually-visible state, not the user's preference. Screen
    readers announce the real state.
  - **Chevron rotation**: tied to `effectiveOpen` for the same
    reason.

  ## What's left as polish (not blocking)
  - **Nested-group errors** still don't aggregate (see PR 6
    flag). If a `group` field's nested required fails, RHF
    surfaces the leaf path (`seo.metaTitle`) but my
    `group.fields.some((f) => errors[f.name])` checks only
    top-level names. Pre-existing gap. Trivial recursive check
    to fix when a real consumer needs it.

  ## Test plan
  - [x] `@nexpress/admin` build + typecheck clean
  - [ ] Browser: collapse the SEO group → click Save with required SEO field empty → group auto-expands, focus lands in the failing input, toast names it
  - [ ] Fix the field → submit succeeds → next reload the group stays in whatever state the operator left it

- 218906d: feat(admin): collapsible sidebar group cards in the document editor (2/7)

  Builds on #756 — the foundation PR introduced sidebar groups
  but rendered each as an always-expanded Card. This PR makes
  each group Card collapsible: clicking the header toggles, the
  chevron rotates, the content slides via Radix Collapsible's
  built-in animation.

  ## Why this instead of tabs

  The original 7-PR plan had tabs as #2 (Content / SEO / Settings
  / Advanced). Reconsidered post-foundation: WordPress, Sanity,
  Ghost, Notion all use scrollable grouped sidebars for post
  editors — not tabs. Tabs split content into distinct
  workspaces; post editing is one workspace centered on the body,
  with the sidebar as a glance-target. Collapsibles give 80% of
  tabs' visual decluttering without the context-switch cost.

  If after PRs 3–6 the editor still feels crowded with SEO +
  media + theme-specific groups, layering tabs on top stays
  available as a future addition.

  ## Behavior
  - Each sidebar group Card has a chevron in its header.
  - Clicking the header toggles open/closed; keyboard support via
    Enter / Space on the focused header (role="button",
    tabIndex=0).
  - Default: all groups expanded. Pre-collapsing essential groups
    (Publish, Lead) would hide common editing targets behind a
    click; trading visual decluttering for an extra interaction
    per session isn't the right trade for content authoring.
    Operators collapse what they personally don't use.
  - State persists per-collection per-group via localStorage
    (`np-admin.sidebar-group.<slug>.<groupName>` → `"open"` /
    `"closed"`). Same scoping rule as the existing show-all
    toggle.
  - `aria-expanded` + `aria-controls` wire the trigger to the
    content for screen readers.

  ## What does NOT change
  - Field grouping logic (foundation in #756) — unchanged.
  - Default sidebar layout for fresh operator — all groups
    expanded. The collapse-by-default question lands in a
    separate UX decision PR if operators ask.
  - Main column rendering — unchanged.

  ## Test plan
  - [x] `@nexpress/admin` build + typecheck clean
  - [x] Lint count unchanged
  - [ ] Browser: click sidebar group header → collapses with
        animation, chevron rotates. Reload page → group stays
        collapsed. Toggle other groups independently.
  - [ ] Keyboard: tab to group header → Enter / Space toggles.

- a8b732f: feat(admin): honor `admin.condition` for fields nested inside row / collapsible containers (13/14)

  PR 13 of the editor progressive-disclosure sequence. Closes a
  gap flagged in PR 4 (#759) and PR 7 (#762) self-reviews: the
  filter pipeline operated on top-level fields only, so a
  conditional field inside a `row` or `collapsible` container
  always rendered regardless of its condition.

  Server-side `collectHiddenFieldNames` (PR 4) already recursed
  into containers, so `required` was correctly dropped at the
  schema level. The CLIENT side just didn't hide the input.

  ## Two helpers
  - `filterContainerChildren(field, formValues, showAll)` —
    recursively strips condition-failing children from `row` /
    `collapsible` containers. Returns the field unchanged when
    not a container. Threaded through every `FieldRenderer`
    call in the main + sidebar render walks.
  - `fieldTreeHasError(fields, errors)` — recursively scans
    field trees for current validation errors. Replaces the
    shallow `group.fields.some` check that decided force-open;
    a required-but-empty field nested in a container now
    triggers its parent group to force open on save failure.

  ## Edge handling
  - Nested containers (row inside collapsible, etc.) recurse all
    the way down.
  - Empty container after filter: still rendered (container
    styling around 0 fields is fine; alternative would be to
    prune the container itself, but that changes the layout
    shape based on transient form values which feels jumpy).

  ## Test plan
  - [x] admin build + typecheck clean
  - [ ] Browser: put a kind=doc-conditional field inside a row
        container → field hides on article posts; row container
        renders empty
  - [ ] Required field nested in collapsible fails validation →
        parent group force-opens

- ee20a2d: feat(admin): empty-state Card when every sidebar group is hidden by kind (10/14)

  PR 10 of the editor progressive-disclosure sequence. Closes the
  edge where every sidebar group's fields are hidden by their
  `admin.condition` — sidebar would otherwise show just the
  "Show all fields" toggle with no Card below, which looks broken.

  The empty-state Card explains why the sidebar is empty (kind
  filter) and offers an inline action that flips `showAllFields`
  to `true`, surfacing every field. Operators hit this when:
  - They switch a post's kind in the editor and every field of
    the previous kind disappears
  - A theme contributes fields all gated to a kind they're not
    using
  - A custom collection has fields all condition-hidden by some
    edge state

  ## Behavior
  - Renders only when `sidebarGroups.length === 0` AND
    `hasHiddenFields === true` (existing "no fields configured"
    fallback stays for collections without sidebar fields at all)
  - Inline "Show all fields" button toggles `showAllFields` to
    `true`, which immediately repopulates the sidebar
  - Brand-colored underline-on-hover for the action — matches the
    rest of the admin's link styling

  ## Test plan
  - [x] admin build + typecheck clean
  - [ ] Browser: switch a post's kind so every sidebar field
        hides → empty Card appears with the action
  - [ ] Click "Show all fields" inside the Card → sidebar
        repopulates with all groups including the hidden-by-kind ones

- 4067401: feat(admin, core, themes): editor sidebar group icons + descriptions (8/14)

  Adds visual hierarchy to sidebar group cards introduced in
  #757. Operators currently see plain text titles ("Publish",
  "Author", "Taxonomy") — scanning ~6 groups visually is
  slower than necessary. Each group now renders with a Lucide
  icon next to the title and an optional one-line description
  beneath when open.

  ## Type contract
  - `NpAdminGroupMeta` — `{ icon?: string, description?: string }`.
  - `NpCollectionConfig.admin.groupMeta?: Record<string, NpAdminGroupMeta>`.
  - `NpThemeCollectionRequirement.groupMeta?: Record<string, NpAdminGroupMeta>`
    — themes contribute icons for their own groups; merge unions
    across themes (last-write-wins per key).

  ## Built-in posts groups
  - Publish → Calendar
  - Lead → Layout
  - Author → User
  - Taxonomy → Tag
  - SEO → Search
  - Hierarchy → FolderTree

  ## Theme contributions
  - **theme-magazine** Magazine → Newspaper
  - **theme-portfolio** Portfolio → Briefcase
  - **theme-docs** Docs → BookOpen

  ## Admin client

  `SidebarGroupCard` gains `icon` + `description` props. The
  header layout reflows: icon → title + description (truncated
  when long) → chevron. `GROUP_ICONS` registry mirrors the
  existing `COLLECTION_ICONS` pattern in `admin-shell`. Unknown
  names fall back to no icon (silent — no warning).

  ## What's queued for the next 6 PRs
  - **PR 9 (CRITICAL)**: `admin.condition` is currently stripped
    in `toClientCollectionConfig` so the editor never sees it
    on the client. Kind-based field hiding (the entire PR 1
    promise) doesn't work in the browser today — server-side
    validation works because the pipeline has the original
    config. Needs a serializable condition predicate language
    (e.g. `{ when: "kind", equals: "doc" }`) so both server +
    client can evaluate.
  - PR 10: Empty state when every sidebar group is hidden
  - PR 11: Main column field grouping (symmetry)
  - PR 12: SEO field `maxLength` hints
  - PR 13: Container-nested field condition evaluation
  - PR 14: Nested-group error aggregation in toast + auto-expand

  ## Test plan
  - [x] core 452/452
  - [x] All themes build + typecheck clean
  - [x] admin build + typecheck clean
  - [ ] Browser: sidebar groups render with icons + descriptions

- 3de8716: feat(core, admin): hidden field validation safety (4/7)

  PR 4 of the editor progressive-disclosure sequence. Closes the
  gap where a `required` field gated by `admin.condition` would
  block save with an invisible validation error: operator sees
  no failing input but the form refuses to submit.

  ## The gap

  PR 1 wired `admin.condition` to hide fields from the editor. A
  field marked `required: true` + `condition: (data) => data.kind
=== "doc"` would:
  - Hide for kind=article posts (correct)
  - Still fail Zod's `required` check on submit (wrong)

  Operator sees nothing to fix; the only signal is the form
  refusing to advance. Same gap on the server-side pipeline —
  even if the client let the submit through, `pipeline.ts` rebuilt
  the schema unconditionally and rejected too.

  ## Fix

  `@nexpress/core/collections/validation` gains a
  `hiddenByCondition: ReadonlySet<string>` parameter on
  `buildZodSchema` + `getCollectionZodSchema(config, forData?)`.
  When set, `required` is dropped for the named fields — they
  slip through as if `required: false`. `collectHiddenFieldNames`
  is the public helper that walks fields + evaluates conditions
  against current data.

  ### Admin client

  `useForm`'s `zodResolver` is replaced with a custom resolver
  that computes hidden names per submit, rebuilds a dynamic
  schema, then delegates to `zodResolver`. Resolver fires only
  on submit (`mode: "onSubmit"` default), so the rebuild cost is
  trivial.

  ### Server pipeline

  `saveDocument`'s validation call passes the incoming `data` to
  `getCollectionZodSchema(config, data)`. The schema mirrors the
  client's drop set — a hidden field can't sneak through the
  admin's required check and then trip a server-side one.

  ### Deduplication

  Both surfaces share `collectHiddenFieldNames` from
  `@nexpress/core/collections/validation`. The admin had a local
  copy from PR 1; that's gone now in favor of the core export.
  Single source of truth, single condition-evaluation behavior.

  ## Edge handling
  - **`row` / `collapsible` containers**: walked transparently
    (their nested fields are checked individually).
  - **`group` fields**: when the group itself has a condition
    that hides it, the group name + every nested name are all
    marked hidden. Required on a hidden group OR any nested
    required is dropped.
  - **Buggy conditions** (throws): treated as "not hidden" —
    surfacing a required error is more recoverable than silently
    dropping the check.

  ## What does NOT change
  - Public surface of `getCollectionZodSchema(config)` (no
    `forData`) — back-compat. Callers that don't have current
    data continue getting the unconditional schema (matches
    pre-#759 behavior).
  - Required-without-condition fields: unchanged.
  - Default Zod error messages on visible required fields:
    unchanged.

  ## Test plan
  - [x] `core` 442/442 (existing tests cover the unchanged
        unconditional path)
  - [x] `admin` build + typecheck clean
  - [ ] Browser: edit a doc-kind post → leave `parent` blank →
        save fails with visible error
  - [ ] Edit an article post → `parent` hidden → save succeeds
        (previously would have failed with no visible error)

- 6d5deef: feat(admin): main column grouping symmetry (11/14)

  PR 11 of the editor progressive-disclosure sequence. Mirrors
  the sidebar's `admin.group` semantics in the main column so
  custom collections with multiple main-position fields can
  cluster them into purpose-titled Cards.

  ## Behavior

  Main column walks `mainFields` in order:

  | Field                                      | Renders                                               |
  | ------------------------------------------ | ----------------------------------------------------- |
  | Unwrapped (title / richText / blocks)      | naked (no Card) — keeps the focused editor flow       |
  | No group, wrapped                          | Own Card (existing behavior)                          |
  | Has `admin.group`, consecutive same group  | Single Card titled with group name, icon, description |
  | Has `admin.group`, different from previous | Flushes the previous group, starts a new Card         |

  Group metadata (icon + description) comes from the same
  `admin.groupMeta` map the sidebar uses — `Layout`, `Calendar`,
  etc. resolve via the shared `GROUP_ICONS` registry.

  ## In-tree consumer

  Built-in `posts` has no main-column fields with `admin.group`
  (title + content are unwrapped). The framework infrastructure
  exists for custom collections (e.g. a `products` collection
  with `name` / `sku` / `dimensions` / `weight` in main) to opt
  in. Theme authors can also contribute main-position grouped
  fields via `requires.collections.<slug>.fields.<name>.admin.group`.

  ## Test plan
  - [x] admin build + typecheck clean
  - [x] Built-in posts: title + content still render unwrapped,
        no other main fields affected
  - [ ] Add a test collection with two main fields sharing
        `admin.group: "Specs"` → both render in one Card titled
        "Specs"

- 63c4997: feat(admin): nested-group error aggregation in toast (14/14) — closes the editor sequence

  PR 14 of the editor progressive-disclosure sequence. Closes
  the last flag from PR 6 (#761): nested-group errors weren't
  aggregated.

  ## The gap

  `Object.keys(form.formState.errors)` is shallow. When a field
  nested in a `group` field fails, RHF surfaces the error at the
  nested path (`errors.seo.metaTitle = { type, message }`). The
  shallow walk saw `seo` as a key, fed it to `fieldLabelByName`
  which returned the group's label — the toast said "Please
  complete the 'SEO' field." but the actual failing input was
  `metaTitle` inside it.

  ## Fix

  `flattenErrorPaths(errors)` recursively walks the nested error
  object. Leaves (objects with a `type` string property) become
  dot-paths; containers (objects without `type`) recurse. Skips
  RHF's `root` key which holds form-level errors.

  `{ title: { type, message }, seo: { metaTitle: { type } } }` →
  `["title", "seo.metaTitle"]`

  `fieldLabelByName` switches from single-name lookup to a path
  walk. Splits on dots, finds each segment in the current field
  list, recurses into `group` fields when the path has more
  segments. Falls back to the last segment when no label is
  found (`seo.metaTitle` → `metaTitle`) — better than echoing
  internal path structure.

  `findNamed` (new helper) walks through `row` / `collapsible`
  containers (which don't have names) to find a named field at
  the current level — used by the segment-walk above.

  `setFocus` accepts dot-paths through RHF's path-aware
  registry, so the focus call on `setFocus("seo.metaTitle")`
  just works without manual handling.

  ## Closes out

  This is the final PR of the 14-PR sequence. Together with
  #756–#768 the editor is now:
  - Fields grouped by purpose, with icons + descriptions
  - Kind-based hiding works end-to-end (client + server, expr form)
  - Empty-state Card when every group is hidden
  - Main column grouping (symmetric with sidebar)
  - SEO meta fields with length hints
  - Required-but-hidden never blocks save
  - Container-nested fields honor conditions
  - Save errors surface as toast + focus + auto-expand to the
    failing field, including nested ones
  - a11y + motion polish

  ## Test plan
  - [x] admin build + typecheck clean
  - [ ] Browser: failing nested group field surfaces in toast
        with the leaf field's label (or last path segment as
        fallback)
  - [ ] `setFocus` with dot-path lands on the right input

- 1eb6255: feat(admin, core, themes): progressive disclosure in the document editor

  The bundled-themes prebake stacks every theme's contributed
  fields on `posts` — magazine, portfolio, docs all add columns
  the operator may never need on a given post. The previous edit
  view dumped them all into one "Publishing" sidebar Card,
  forcing the operator to scroll through ~20 controls per post.

  This redesign shapes the sidebar around what the operator is
  actually authoring:

  ## Field grouping
  - New `admin.group?: string` on `NpFieldBase` — sidebar fields
    with the same `group` label render together in their own
    collapsible-style Card. Default group = `"Publish"`.
  - Group order in the rendered sidebar follows the first-seen
    order of fields in the collection's `fields` array, so
    operators control layout by ordering.

  ## Kind-aware conditional visibility
  - `admin.condition` was already typed but unread; the edit view
    now honors it. The renderer subscribes to live form values
    via `form.watch()` and re-evaluates conditions on change.
  - Built-in `posts` fields tagged:
    - `parent` / `order`: only when `kind === "doc"` (hierarchy)
    - `wpOriginalAuthor`: only when populated (no value → hidden)
  - Theme-contributed fields tagged:
    - **theme-magazine** `featured`: hidden for `kind === "doc"`
    - **theme-portfolio** `heroImage`, `client`, `year`, `role`,
      `discipline`, `span`, `coverVariant`, `coverFigure`,
      `badge`: hidden for `kind === "doc"`, grouped under
      "Portfolio"
    - **theme-docs** `lede`, `stableSince`: only when
      `kind === "doc"`, grouped under "Docs"

  ## "Show all fields" escape hatch
  - Sidebar header shows a toggle when at least one field is
    hidden by an active condition. Flipping it reveals every
    field including ones the kind filter is suppressing.
  - Toggle state persists per-collection via `localStorage`.

  ## Theme requirement contract change

  `NpThemeFieldRequirement` gains an optional `admin` block
  forwarded onto the synthesised field's `admin` slot:

  ```ts
  admin?: {
    group?: string;
    condition?: (data, siblingData) => boolean;
    position?: "main" | "sidebar";
  }
  ```

  Themes use these to bucket their contributed fields into
  sidebar groups and gate visibility by kind.

  ## Schema drift cleanup

  `apps/web/drizzle/0004_smart_valkyrie.sql` drops the orphan
  `np_c_authors` table. The magazine theme stopped declaring
  `requires.collections.authors` in #747 but the migration to
  drop the leftover table was never generated. This PR's
  schema:gen pass surfaced the drift; the auto-generated
  migration cleans it up. No data loss (table never populated).

  ## What does NOT change
  - Main column rendering is unchanged — title + body flow as
    before.
  - 2-column layout preserved.
  - No field-level data loss: hidden fields keep their stored
    values; `condition` is view-only.
  - Theme swap behavior unchanged: switching themes doesn't
    remove fields from the schema, only hides irrelevant ones
    from the editor.

  ## Tests
  - `core` 442/442
  - `web` 85/85 (builtin-themes-union gate covers field-merge)
  - All themes + admin + app build + typecheck clean

- 712c11c: fix(core, admin, themes): serializable condition predicates — fixes broken client-side field hiding (9/14)

  ## The bug

  PR 1 (#756) wired `admin.condition` in the admin editor's
  `passesCondition` helper, but `packages/next/src/client-safe.ts`
  already stripped `admin.condition` from the collection config
  before it reached the client component (Next.js can't serialize
  functions across the RSC boundary). The browser never saw the
  condition function, so the kind-based field hiding **never
  worked client-side** — every operator editing any post saw
  every field regardless of kind.

  Server-side validation (PR 4 #759) was unaffected because the
  pipeline uses the original (un-stripped) config.

  ## Fix

  New `NpFieldConditionExpr` discriminated-union type — a
  serializable JSON predicate that survives RSC serialization:

  ```ts
  condition: { when: "kind", equals: "doc" }
  condition: { when: "kind", notEquals: "doc" }
  condition: { when: "kind", in: ["doc", "page"] }
  condition: { when: "kind", notIn: ["doc"] }
  condition: { when: "wpOriginalAuthor", exists: true }
  condition: { all: [...] }                              // AND
  condition: { any: [...] }                              // OR
  ```

  `evaluateFieldCondition(condition, data)` (exported from
  `@nexpress/core`) handles both the function form (server-only)
  and the expression form (works both env), so the admin client +
  server pipeline run the same evaluator against the same data.

  `admin.condition` type widens to
  `NpFieldCondition | NpFieldConditionExpr` — both accepted, but
  **the expression form is required for client-side hiding to
  work**. Function-form conditions still run server-side (pipeline
  validation drops `required` for hidden fields, sitemap walks
  honor them) but are silently stripped client-side.

  `toClientCollectionConfig` now strips only function-form
  conditions; expression-form passes through verbatim.

  ## Migration of in-tree conditions

  All built-in / theme conditions migrate from function form:
  - `posts.parent` / `posts.order`: `{ when: "kind", equals: "doc" }`
  - `posts.wpOriginalAuthor`: `{ when: "wpOriginalAuthor", exists: true }`
  - `theme-magazine.featured`: `{ when: "kind", notEquals: "doc" }`
  - `theme-portfolio.*` (9 fields): `{ when: "kind", notEquals: "doc" }`
  - `theme-docs.lede` / `stableSince`: `{ when: "kind", equals: "doc" }`

  ## Edge handling
  - **Function condition that throws** → fails open (field visible).
  - **Malformed expression** (unknown shape) → fails open.
  - **`exists: true`** → false for `undefined`, `null`, `""`, `[]`.
  - **`all` / `any`** compose nested expressions for AND / OR logic.

  ## Tests

  `validation.test.ts` adds 9 cases covering function form, every
  expression operator, malformed shape, and `collectHiddenFieldNames`
  recursing through expression conditions. Core 452 → 461.

  ## What this unlocks

  The kind-based hiding the entire editor sequence (#756-#762) was
  designed around now actually works in the browser. Operators
  editing `kind="article"` posts won't see docs / portfolio
  fields; operators editing `kind="doc"` won't see magazine /
  portfolio fields.

- b3f70ff: feat(admin): surface validation errors on Save with toast + auto-focus (6/7)

  PR 6 of the editor progressive-disclosure sequence.

  ## The gap

  Before this PR, clicking Save with a required field empty
  silently failed: `react-hook-form` set `formState.errors` but
  no aggregated UI appeared, and the offending field might be
  inside a collapsed sidebar group — invisible to the operator.
  The only visible signal was "Save doesn't seem to do anything."

  ## Fix

  `form.handleSubmit(success, onValidationErrors)` now wires the
  second callback. On validation failure:
  - A toast surfaces the affected field labels — single field
    gets named directly; ≥2 get a comma-separated list capped at
    three with a `+N more` overflow.
  - `form.setFocus(firstName)` moves keyboard focus to the first
    invalid input, which also scrolls it into view.
  - For fields whose renderer wraps the input atypically (block
    editors, upload tiles), the focus call's error falls back to
    a DOM query for `[name=...]` / `[data-field-name=...]` and
    manual `scrollIntoView` + `focus`.

  `fieldLabelByName` walks `effectiveFields` (recursing through
  `row` / `collapsible` / `group`) to resolve the field-name →
  visible label so the toast reads "Please complete the
  \"Lede\" field." rather than "Please complete lede."

  ## What this PR does NOT do (queued)
  - **Auto-expand a collapsed group containing the failing
    field.** Today: the toast names it, focus moves to it,
    scrollIntoView fires — but if the field sits inside a
    closed group, it's still hidden. Lifting the group's
    open-state out of `SidebarGroupCard` so the parent can
    force-open on validation error is the next step. PR 7 / a
    follow-up.

  ## Test plan
  - [x] `@nexpress/admin` build + typecheck clean
  - [ ] Browser: leave a required field blank → click Save →
        toast appears naming the field; focus jumps to the input.
  - [ ] Toast lists ≥2 field labels when multiple fail.

- d76a0c9: fix(core, admin): admin client bundle no longer drags argon2 / pg

  `@nexpress/admin`'s `collection-edit-view` (a `"use client"`
  component) imported `collectHiddenFieldNames` and
  `evaluateFieldCondition` from the `@nexpress/core` root. The
  root re-exports `@nexpress/core/auth`, which transitively pulls
  `@node-rs/argon2` and `pg` into the bundle — Next's client
  bundler tried to resolve `argon2/browser.js`'s `verify` export
  and failed, killing every CI build since #756 landed:

  ```
  The export verify was not found in module @node-rs/argon2/browser.js
  ```

  Adds a new client-safe subpath `@nexpress/core/fields` that
  re-exports only the pure helpers (`evaluateFieldCondition`,
  `collectHiddenFieldNames`, `buildZodSchema`,
  `getCollectionZodSchema`). No transitive auth / db / sharp /
  argon2 imports — verified by grepping the produced
  `dist/chunk-*.js` files that the new entry pulls in.

  The admin's runtime import switches to `@nexpress/core/fields`;
  the type-only `import type { NpCollectionConfig, NpFieldConfig }`
  stays on the root (type imports are erased and don't drag
  runtime code).

  Bump kind: patch. Adding a new export is arguably minor by
  strict semver, but pre-1.0 we default to patch unless the user
  explicitly approves otherwise.

- 4cae8cf: fix(admin, app): editor track audit follow-ups — reduced-motion, container-nested hidden detection, main-column empty state

  Three small follow-ups from a post-track audit of the editor
  progressive-disclosure work (#756–#773):
  - **`prefers-reduced-motion: reduce`** on the sidebar group
    collapse animation. PR #760 added the 180ms slide on
    `.np-sidebar-group-content` but didn't include the
    reduced-motion override — vestibular-sensitive users with
    the OS preference set still saw the animation. Adds an
    `@media` block that disables the keyframes when the
    preference is set.
  - **`hasHiddenFields` recurses into containers**. The check
    that decides whether the "Show all fields" toggle is even
    rendered skipped `row` / `collapsible` containers, so a
    conditional field nested inside one wouldn't trip the
    toggle even though PR #772 (container-nested condition)
    would gate it out of the form. Replaced with a call to
    `collectHiddenFieldNames` (single source of truth — same
    helper the server pipeline + zod resolver use).
  - **Main-column empty state**. PR #765 added the "every
    sidebar field hidden" Card; PR #766 added main-column
    group symmetry. The pair left a hole: if every main field
    gets hidden by the active kind, the left column went
    blank with no reason or escape hatch. Mirrors the sidebar's
    empty-state Card with a "Show all fields" link.

- 73c919b: feat(admin, app): universal-content-model follow-ups — create-form kind pre-fill, generic URL resolver, kind-aware template lookup

  Three trivial follow-ups carved out during the U track
  self-reviews. None are blocking; each removes a small wart
  exposed when the framework grew per-kind awareness.

  ## 1. Create-form `?kind=` pre-fill

  `CollectionListView` now threads `?kind=<value>` onto the
  Create CTA when the list view is kind-scoped. The matching
  create page reads `?kind=` from `searchParams` and passes
  `{ kind }` as the initial doc, so the new-doc form opens with
  the kind field already set to what the operator was filtering.
  Empty / absent kind → bare `/create` URL (field's
  `defaultValue` applies, same as before).

  ## 2. Generic kind URL resolver in built-in posts

  `seo.urlPath` previously hardcoded `kind === "doc"` →
  `/docs/<slug>`. Replaced with a registry read:
  `getCollectionConfig("posts").admin.kinds.<kind>.urlPattern`
  substitutes `:slug` and returns the result. Unknown kinds (or
  kinds without a `urlPattern` declared) fall back to the
  framework default `/blog/<slug>`.

  This means a theme that contributes a third kind (e.g.
  portfolio's hypothetical `kind: "project"` with `urlPattern:
"/work/:slug"`) gets correct sitemap / canonical / slug-history
  URLs without needing to override the built-in collection.

  `try / catch` around the registry read covers the
  not-yet-loaded boot path (seed scripts that run urlPath
  resolution before `loadCollections` completes).

  ## 3. Kind-aware template lookup in `/blog/<slug>`

  `resolvePostDetailTemplate` previously walked
  `explicitTemplateId / "detail" / "default" / "feature"`. The
  new walk prepends `post.kind` between the explicit id and the
  legacy triple — so a theme that registers
  `templates.posts.<kind>` gets picked up automatically by the
  framework's blog route.

  Today the `/blog/<slug>` guard 404s any `post.kind !==
"article"` (the doc-kind canonical URL is `/docs/<slug>` via
  the theme route), so the new candidate is only exercised when
  a theme registers `templates.posts.article` for non-default
  article rendering. A future theme that contributes a kind AND
  wants to ride `/blog/<slug>` (e.g. seasonal post types) can
  register `templates.posts.<kind>` without needing its own
  theme route.

  ## Tests
  - `@nexpress/core` 441/441, `apps/web` 85/85 (no test additions
    — these are wire-up changes that flow through existing test
    coverage)
  - All themes + admin + app typecheck clean

- Updated dependencies [07c763b]
- Updated dependencies [4067401]
- Updated dependencies [3de8716]
- Updated dependencies [1eb6255]
- Updated dependencies [712c11c]
- Updated dependencies [d76a0c9]
- Updated dependencies [d76a0c9]
- Updated dependencies [4d38283]
- Updated dependencies [88bd29b]
- Updated dependencies [48ce0d1]
- Updated dependencies [6f46b5a]
- Updated dependencies [17c90d6]
  - @nexpress/core@0.3.1
  - @nexpress/blocks@0.3.1
  - @nexpress/editor@0.3.1

## 0.3.0

### Patch Changes

- Updated dependencies [ab3afa7]
- Updated dependencies [f36c0f2]
  - @nexpress/core@0.3.0
  - @nexpress/editor@0.3.0
  - @nexpress/blocks@0.3.0

## 0.2.2

### Patch Changes

- e733d47: Replace `pnpm nexpress theme:install <pkg>` with a friendlier two-piece flow: framework-side auto-merge of theme requirements at config-resolution time, plus a single `pnpm nexpress theme add <pkg>` command for installation + registration.

  **`@nexpress/core`** — `defineConfig` now walks every theme on `config.themes` and unions each theme's `manifest.requires.collections` into the resolved `collections` array. For each existing collection slug, the theme's declared fields are appended to that collection's `fields` (operator-authored fields with the same name always win, so the merge is non-destructive). For slugs that don't yet exist AND the theme set `createIfAbsent: true`, a minimal collection is synthesised. The merge is exposed as `mergeThemeRequirements(collections, themes)` for tooling that wants to introspect the resolved shape without going through `defineConfig`.

  **`@nexpress/cli` (`@nexpress/cli-nexpress`)** — new `nexpress theme add <pkg>` command: runs `pnpm/yarn/npm add`, AST-patches `nexpress.config.ts` via two new marker pairs (`@nexpress:themes-imports-start/-end` + `@nexpress:themes-list-start/-end`), and probes the installed package's export shape to confirm it ships a `<name>Theme` named export. `--apply` chains `db:generate` + `db:migrate`; `--dry-run` prints the plan; `--yes` skips the prompt. The legacy `theme:install` command and its AST-patcher (`extract-collection`, `patch-collection`, `generate-collection`) are removed — the auto-merge replaces every reason to touch operator collection files. `theme:uninstall` keeps working unchanged.

  **`@nexpress/admin`** — Themes page guidance no longer suggests `theme:install`. When `checkThemeRequirements` still flags missing fields after the auto-merge (only possible when an operator-declared field has a conflicting TYPE), the hint surfaces the conflicting types and points at `src/collections/*.ts`. Otherwise the hint is the plain `pnpm db:generate && pnpm db:migrate` reminder.

  **`create-nexpress`** — scaffolded `nexpress.config.ts` ships with the new `@nexpress:themes-imports-*` and `@nexpress:themes-list-*` markers so future `theme add` invocations have anchors out of the box.

  **`@nexpress/theme-magazine` / `@nexpress/theme-portfolio`** — their `requires.collections.posts.*Image` upload fields now declare `relationTo: "media"` explicitly. Without it `mergeThemeRequirements` silently skipped the field (no scalar relation target), so the column never landed in the generated schema and the theme's hero/cover slot rendered against an empty value. The merge layer keeps the warning for any other upload requirement missing `relationTo` to surface the same gap in third-party themes.

  Operator-visible migration:

  ```bash
  # Before
  pnpm nexpress theme:install @nexpress/theme-magazine     # ran AST patches on src/collections/*.ts
  pnpm db:migrate

  # After
  pnpm nexpress theme add @nexpress/theme-magazine         # only edits nexpress.config.ts
  pnpm db:generate && pnpm db:migrate                       # (or `theme add --apply` to chain)
  ```

- Updated dependencies [e733d47]
  - @nexpress/core@0.2.2
  - @nexpress/blocks@0.2.2
  - @nexpress/editor@0.2.2

## 0.2.1

### Patch Changes

- @nexpress/blocks@0.2.1
- @nexpress/core@0.2.1
- @nexpress/editor@0.2.1

## 0.2.0

### Patch Changes

- @nexpress/blocks@0.2.0
- @nexpress/core@0.2.0
- @nexpress/editor@0.2.0

## 0.1.6

### Patch Changes

- @nexpress/blocks@0.1.6
- @nexpress/core@0.1.6
- @nexpress/editor@0.1.6

## 0.1.5

### Patch Changes

- @nexpress/blocks@0.1.5
- @nexpress/core@0.1.5
- @nexpress/editor@0.1.5

## 0.1.3

### Patch Changes

- Updated dependencies [bb6f71c]
  - @nexpress/core@0.1.3
  - @nexpress/blocks@0.1.3
  - @nexpress/editor@0.1.3

## 0.1.2

### Patch Changes

- @nexpress/core@0.1.2
- @nexpress/blocks@0.1.2
- @nexpress/editor@0.1.2

## 0.1.1

### Patch Changes

- e062ed7: **0.1.1 — post-launch cleanup + first-time UX.**

  Bundles every change since the v0.1.0 first publish into one patch
  release. The npm registry stays on the 0.1.x track; 0.2.0 was
  attempted (and the version-PR landed locally) but the CI publish
  failed end-to-end due to npm 10 not supporting Trusted Publishing
  (npm 11.5.1+ required) — fixed in the release workflow, but the
  0.2.0 bump itself was premature for the size of changes shipped.

  ### `@nexpress/core`
  - `getPluginConfig` read/write asymmetry fixed (#664). `setPlugin`
    writes to `np_settings` for any pluginId; `getPluginConfig` now
    reads it back regardless of whether the plugin is registered.

  ### `@nexpress/admin`
  - Empty-state CTA on `/admin/collections/<slug>` (#666). Truly-empty
    collections render a "Create your first \<singular>" card instead
    of the generic "No documents found" line.
  - Dashboard welcome card → 5-step setup checklist (#666). Tracks
    site name set / first post published / theme chosen / production
    domain set.
  - Topbar user-menu trigger now has `aria-label="Open user menu"`
    (#664) so the e2e selector matches a stable accessible name.

  ### `@nexpress/theme-magazine`, `@nexpress/theme-portfolio`
  - `padding-inline-start` instead of `padding-left` on mobile sub-nav
    lists (#664). Makes RTL locales render with the correct leading
    edge.

  ### Internal (no operator-facing change)
  - Drizzle migration history squashed to a single `0000_init.sql`
    (#646). New installs run one migration to reach the v0.1 schema.
  - Repository transferred from `hahabsw/nexpress` to
    `nexpress-cms/nexpress` (#647). `repository.url` metadata updated
    across every published package.
  - Release workflow: `publish: pnpm run release` restored + npm 11+
    installed before publish so Trusted Publishing actually
    authenticates (#670). The v0.2.0 attempt's E404 was npm 10 not
    supporting the OIDC TP token, not a TP-config mistake.
  - CI noise reduction: docs / changesets / community-file paths
    no longer trigger main-push CI; E2E gated to PRs only.

- Updated dependencies [e062ed7]
  - @nexpress/core@0.1.1
  - @nexpress/blocks@0.1.1
  - @nexpress/editor@0.1.1

## 0.1.0

### Minor Changes

- de22826: Publish-readiness sweep — package metadata, license, and publishability.

  Every `@nexpress/*` library and `create-nexpress` becomes publishable
  to npm: `"private": true` removed, full metadata added (description,
  license, repository with `directory`, author, bugs, homepage, keywords,
  engines.node), and a `prepublishOnly: "pnpm build"` safety net so a
  one-off `pnpm publish` from inside a package directory still rebuilds
  before tarball.

  A repo-root `LICENSE` (MIT) is added and copied into every published
  package's directory so each tarball ships its own license file (npm
  auto-includes LICENSE at the package root, but only if the file
  actually lives there — repo-root licenses don't propagate).

  `apps/web` (the reference app) stays `"private": true` — it's not a
  distributable package.

  No code change; this is publish-bookkeeping only. Versions move from
  `0.0.0` (or `0.1.0` for the existing plugin packages) to a coherent
  `0.1.0` floor when `pnpm changeset version` runs against all currently
  queued changesets.

### Patch Changes

- Updated dependencies [952483c]
- Updated dependencies [4c01668]
- Updated dependencies [75f65a2]
- Updated dependencies [de22826]
  - @nexpress/core@0.1.0
  - @nexpress/blocks@0.1.0
  - @nexpress/editor@0.1.0
