---
"@nexpress/web": patch
---

feat(web): M.2 — `--np-member-form-*` tokens + framework default CSS

Second phase of the F-track member-surface skinning. Themes can now restyle the framework-shipped member auth forms (`/members/login` / `/register` / `/forgot-password` / `/reset-password` / `/verify`) by overriding CSS custom properties — no need to replace the form components.

**Token surface**

Form input styling, scoped to `.np-members-form`:

```
--np-member-form-input-bg
--np-member-form-input-border
--np-member-form-input-border-focus
--np-member-form-input-radius
--np-member-form-input-padding
--np-member-form-input-disabled-bg
--np-member-form-button-bg
--np-member-form-button-fg
--np-member-form-button-radius
--np-member-form-error-color
```

OAuth button styling (forward-compat — no OAuth button component renders today; OAuth flow goes through `/api/members/oauth/{provider}/start` directly. Tokens are declared so themes can pre-style for when buttons land):

```
--np-member-oauth-google-bg / -fg / -border / -radius
--np-member-oauth-github-bg / -fg / -border / -radius
```

**Selector scoping**

All tokens declared at `.np-members-form` (existing plural class name applied to every member auth `<form>`). Member-specific input rules (`.np-members-form .np-form-input`) read from the new tokens; the global `.np-form-input` selector (shared with `.np-discussion-form` and other `.np-form-input` consumers) keeps its existing `--np-color-*` reads. This means M.2 changes the look of member forms only — discussion forms, comment forms, and any other form using `.np-form-input` are untouched.

**Default values**

Every token falls back to an existing `--np-color-*` / `--np-radius-*` global so themes that don't override get the same look as today. Themes restyle by overriding tokens in their `impl.css` (e.g., `.np-magazine .np-members-form { --np-member-form-input-bg: var(--np-color-paper); }`).

**Design-doc selector correction**

§ 5.2 of the design doc earlier showed `.np-member-form` (singular) as the selector. The existing class is `.np-members-form` (plural — applied by member auth forms today). This PR reuses the existing class name to avoid churning the hand-coded forms, and the design doc § 5.2 is updated to match.

LOC: ~80 lines of CSS in `apps/web/src/app/globals.css` + design doc § 5.2 sync.

No code-component changes. No theme-side changes (themes opt in by overriding tokens, not by adopting new APIs). Reference theme migration (magazine adopting custom token values) lands in M.ref.
