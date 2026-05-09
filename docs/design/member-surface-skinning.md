# Member/Community Surface Skinning — Design Plan

> Version: 0.1 (Draft — design phase)
> Date: 2026-05-09
> Status: Design — pending review and decision-locking
> Prerequisites:
>   - `docs/design/theme-v0.2-extension.md` (theme contract v0.2,
>     deferred this surface to a separate track per §3 / §10)
>   - `docs/community.md` (existing member/community model)
>   - AGENTS.md theme section (v0.1 contract baseline)

---

## 0. Position statement

The v0.2 theme contract explicitly deferred member/community
surface skinning. From `theme-v0.2-extension.md` §3:

> Non-goals: Member/community surface skinning (deferred to a
> separate track).

And the rationale (§1 locked decisions, B):

> `(site)/members/*` carries strong behavior; needs its own
> track. Theme contract stays presentational for v0.2.

This doc opens that separate track. The realistic ceiling is
**making members feel like part of the active theme's site**
without dragging the form-submission / API-call behavior into
the theme contract.

Two requirements drive the design:

- **Theme developer**: skin the member chrome (header/footer
  wrapping, page title typography, form field styling) without
  rewriting auth flow or notification scheduling.
- **Site operator**: a member opening `/members/login` on the
  Magazine theme sees the masthead-styled chrome wrapping a
  login form — never a default-themed page surrounded by
  Magazine's everything-else.

These pull mildly against each other — full theme freedom
breaks if every theme has to reimplement form validation,
while operator-no-code requires the contract to be lightweight
enough that themes opt in painlessly.

## 1. Inventory of the surface

Routes the framework owns under `apps/web/src/app/(site)/members/`:

| Route | Behavior weight | Surfaces |
|---|---|---|
| `/members/login` | Heavy (auth flow) | Email + password form, OAuth buttons (when configured), link to register / forgot-password |
| `/members/register` | Heavy (auth flow) | Registration form, terms-of-service hint, post-submit "check email" state |
| `/members/forgot-password` | Heavy | Email submit, "we sent you a link" state |
| `/members/reset-password` | Heavy | Token-from-URL parse, new password form |
| `/members/verify` | Medium | Token-from-URL parse, success / failure state, resend link |
| `/members/me/notifications` | Medium | Per-user inbox, mark-read, preference toggles |

Plus surface-adjacent components (defined in `(site)/layout.tsx`
or imported by site pages):

- `<MemberMenu>` (top-bar avatar / login link) — already lives
  in theme `slots.header` per the v0.1 contract; today themes
  render their own login link or omit the menu.
- `<CommentList>` / `<ReactionBar>` — community render below
  posts; already pluggable per `docs/community.md`'s ssr render
  hooks.

## 2. Locked decisions (proposed)

To be confirmed before implementation.

| # | Decision | Choice | Rationale |
|---|----------|--------|-----------|
| A | Member routes stay app-owned (URLs, behavior, API contracts) | **Yes** | Auth + token + email flows belong to the framework. Theme owns presentation only. |
| B | Theme contract gains slot for member chrome | **Yes** | Without this, login pages look default-themed even on Magazine sites. |
| C | Theme can replace member page bodies wholesale | **No** | Body replacement requires the theme to reimplement form submission, validation messages, and OAuth provider buttons. Slots-only keeps the migration story small. |
| D | Existing themes work unchanged | **Yes** | All v0.3+ fields are additive optional. |

## 3. Goals

- A magazine site's `/members/login` feels like part of the
  magazine — masthead, footer, typography, color palette.
- Existing v0.2 themes (`magazine` / `portfolio` / `docs`)
  opt in by adding ~20 lines.
- Theme authors don't have to reimplement form validation,
  password complexity rules, OAuth callback handling, or
  email verification token parsing.
- The member-form component contract is stable enough that a
  framework upgrade adding a new field (e.g. captcha) doesn't
  force every theme to update.

## 4. Non-goals

- Replacing the member-routes' URL structure or API contracts.
- Theme-shipped server actions or DB schema changes for
  member-side data (those remain plugin territory).
- Letting themes change the auth flow shape (e.g. email + code
  instead of email + password) — that's `@nexpress/plugin-auth-*`
  territory.
- Supporting completely-headless members (a theme that wants
  to skin the entire form layout, not just chrome) — covered
  in §10 deferred items.

## 5. Contract additions

Three phases, each adding optional fields. Theme authors opt
into as many or few as they want.

### 5.1 Phase M.1 — `impl.members.shell`

Adds an optional component to `NpThemeImpl`:

```ts
interface NpThemeImpl {
  // ... existing v0.2 fields ...

  members?: {
    /**
     * Optional shell wrapping every (site)/members/* route.
     * Receives a single `children` prop (the framework's
     * member page body). Use it to wrap the body in the theme's
     * masthead + footer.
     *
     * Falls back to the theme's top-level `shell` when omitted.
     * Set to `null` (not `undefined`) to explicitly opt out and
     * render members pages bare (no shell).
     */
    shell?: ComponentType<{ children: ReactNode }> | null;

    /**
     * Optional theme-provided variants of the framework's
     * default member chrome strings. Operators with the i18n
     * package layer per-locale overrides on top.
     */
    pageTitle?: {
      login?: string;
      register?: string;
      forgotPassword?: string;
      resetPassword?: string;
      verify?: string;
      notifications?: string;
    };
  };
}
```

**Why slot-shaped not page-shaped**: a `shell` slot is the
narrow contract — `children` is opaque, themes don't depend
on the framework's body internals. If the framework redesigns
`/members/login` to add a captcha row, themes don't have to
ship a new version.

### 5.2 Phase M.2 — Member form surface tokens

Member forms today ship with hand-styled inputs. Phase M.2
maps their CSS via `--np-` custom properties so themes
restyle inputs by overriding tokens, not by replacing
components:

```css
/* Framework defaults — themes override per their `impl.tokens` */
.np-member-form {
  --np-member-form-input-bg:     var(--np-color-background);
  --np-member-form-input-border: var(--np-color-border);
  --np-member-form-input-radius: var(--np-radius-md);
  --np-member-form-input-padding: 0.625rem 0.875rem;
  --np-member-form-button-bg:    var(--np-color-primary);
  --np-member-form-button-fg:    var(--np-color-primary-foreground);
  --np-member-form-error-color:  var(--np-color-destructive);
}
```

Existing v0.2 reference themes already declare base colors via
`tokens.colors`; Phase M.2 maps the existing tokens through
to forms. No new theme code required for "looks consistent
with the rest of the site" — just for "looks specifically
custom on member pages".

### 5.3 Phase M.3 — `impl.members.notFound` / `impl.members.error`

Mirrors the v0.2 contract's `notFound` / `error` slots
(`theme-v0.2-extension.md` §F.7 / F.7.1) for the
`(site)/members/*` subtree. Reuse the v0.2 design wholesale:

- `members.notFound`: server-rendered 404 component for
  `members/[...slug]`-shaped misses
- `members.error`: client error boundary, follows the F.7.1
  delegation pattern (subpath export + lazy import) so
  hydration constraints don't bind us to defaults

Falls back to the theme's top-level `notFound` / `error` when
omitted, which already falls back to framework defaults.

## 6. Reference implementation plan

Migrate `magazine` first (already pilots the F.7.1 error
delegation). Sequence:

1. `theme-magazine/src/members/shell.tsx` — wraps `children`
   in `MagazineHeader` + `<main className="np-magazine-members">`
   + `MagazineFooter` (re-uses existing slot components).
2. `magazine/src/styles.ts` — add `.np-member-form` overrides
   under `.np-magazine` scope: serif label fonts, hairline
   input borders matching the masthead aesthetic.
3. Manifest exposes the new `members.shell`; existing
   `magazine` install path unchanged (no schema migration).

Portfolio + Docs migrate as second/third PRs once the magazine
seam is proven.

## 7. Cache + invalidation

Member chrome reads from the active theme via
`getCachedActiveTheme()` (already wrapped by `nx:theme:<siteId>`
tag). No new tags needed — the existing theme switch / settings
save invalidations already cover the member chrome by extension.

Member-form data (form state, error messages) lives in client
component state; no server-cache invalidation concern.

## 8. Risk register

| Risk | Severity | Mitigation |
|---|---|---|
| Theme's shell makes assumptions about page width that break narrow login forms | 🟡 Medium | Reference impl for magazine ships max-width: 480px wrapper inside the shell; doc the convention in theme-authoring.md |
| OAuth provider buttons styled by themes look inconsistent with the framework's tokens | 🟡 Medium | Phase M.2 tokens; doc that OAuth buttons consume `--np-member-oauth-*` |
| i18n drift between theme-provided pageTitle and framework strings | 🟢 Low | Theme strings layered under operator i18n overrides per existing pattern |
| Auth flow form changes (e.g. captcha row) break theme assumptions | 🟢 Low | Slot contract is opaque `children`; theme doesn't see internals. The risk is purely visual (new row in unfamiliar style); rare enough to fix per release |

## 9. Phasing

| Phase | Scope | PR-size estimate |
|---|---|---|
| **M.1** | `impl.members.shell` slot + framework wiring | 1 PR, ~250 LOC |
| **M.2** | `--np-member-form-*` tokens + framework default CSS | 1 PR, ~150 LOC |
| **M.3** | `impl.members.notFound` / `error` (mirror F.7 / F.7.1) | 1 PR, ~200 LOC |
| **M.ref** | Magazine reference impl (shell + form tokens + error) | 1 PR, ~300 LOC |
| **M.docs** | Theme-authoring cookbook updates | 1 PR, ~150 LOC |

Total: 5 PRs, ~1050 LOC. Each phase ships independently.

## 10. Deferred to a later track

- **Body replacement** — themes wholesale-replacing member page
  bodies (e.g. a theme shipping its own login form layout).
  Would require exposing the framework's form state hook to
  the theme; pre-mature for the v0.3 baseline.
- **Per-route shell variants** — different chrome for
  `/login` vs `/notifications`. Today: one shell wraps all.
  Add when reference themes show the need.
- **Theme-shipped member dashboard widgets** — themes
  contributing tiles to `/members/me` (e.g. "Your reading
  list" via member-saved-articles plugin). Plugin territory
  for now.
- **Member-side i18n string ownership** — today framework
  ships English defaults; operators override per locale. A
  theme shipping translated strings overlapping with the
  operator's i18n bundles would need a precedence rule.

## 11. Open questions

These need answers before phasing locks.

1. **Where does the `MemberShell` hook into the route tree**?
   - Option A: `(site)/members/layout.tsx` — single tree
     wrap, but conflicts with i18n locale-prefix routing.
   - Option B: per-page `<MemberShell>` import — verbose but
     no layout-level coupling. Decide before M.1.
2. **Can `members.shell` access form state**? Today: no —
   `children` is opaque. If a theme wants a "Login" header
   that changes to "Welcome back" post-submit, it can't tell.
   Decide whether to expose a `<MemberShellContext>` hook
   that surfaces page identity at minimum.
3. **OAuth button styling** — framework owns buttons today
   (Continue with Google / GitHub markup). Theme override
   path: tokens (`--np-member-oauth-google-bg`) or full
   button replacement? Decide at M.2.
4. **`/members/me/notifications` complexity** — this is closer
   to a member dashboard than a form. Stay slot-only, or
   expose a richer `members.notificationsItem` slot for the
   per-row rendering? Decide at M.1 with a punt to deferred
   if simplicity wins.

## 12. NOT in scope (record so it doesn't creep)

- Plugin-contributed member surface routes (e.g. a forum plugin
  adding `/members/me/discussions`). Plugin contracts already
  cover this via routes; the theme contract just makes the
  shell consistent.
- Admin-side member management (`/admin/members/*`). Admin UI
  uses its own shell (`AdminShell`), not theme-driven. Don't
  spread the surface skinning into admin.
- Backwards-compatible "theme without `members.shell` falls back
  to v0.1 default" — this is automatic since the field is
  optional. Just record so reviewers don't ask.

## 13. Success criteria

- A `magazine` site's `/members/login` is visually
  indistinguishable from any other magazine page (same
  masthead, footer, type ramp).
- Adding `members.shell` to a v0.2 theme requires <30 lines of
  code in the theme package (excluding existing
  `MagazineHeader` / `MagazineFooter` reuse).
- Removing a theme's `members.shell` falls back to the
  framework default without 500ing.
- Operator opening admin → switching themes → reloading
  `/members/login` shows the new theme's chrome.
