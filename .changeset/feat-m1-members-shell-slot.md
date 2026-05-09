---
"@nexpress/theme": minor
"@nexpress/web": patch
---

feat(theme, web): M.1 — `impl.members.shell` slot + `(member)` route group restructure

First phase of the F-track member-surface skinning (`docs/design/member-surface-skinning.md`). Themes can now wrap the framework-owned `(member)/members/*` routes (login / register / forgot-password / reset-password / verify / me/notifications) in their own chrome — same masthead + footer the theme uses for the public site — without rewriting the form-submit / email-verification / OAuth flows.

**Theme contract addition** (`@nexpress/theme`, `NpThemeImpl`):

```ts
members?: {
  shell?: ComponentType<{ children: ReactNode }> | null;
  pageTitle?: {
    login?: string;
    register?: string;
    forgotPassword?: string;
    resetPassword?: string;
    verify?: string;
    notifications?: string;
  };
};
```

Fallback chain at the `(member)/layout.tsx` level:
1. `impl.members.shell` truthy → use it
2. `impl.members.shell === null` → opt out explicitly (member pages render bare, useful when the public-site shell would clash with narrow auth forms)
3. `impl.members.shell === undefined` → fall back to `impl.shell` (the public-site shell)
4. `impl.shell === undefined` → transparent fragment

**Route restructure** (locked decision E in the design doc § 2): six page files moved out of `(site)/members/*` into a new sibling `(member)/members/*` route group. URL surface unchanged (Next.js route groups don't add path segments — `/members/login` resolves to `(member)/members/login/page.tsx` post-restructure, same as `(site)/members/login/page.tsx` did pre-restructure). Header-based i18n (proxy sets `x-np-locale` without rewriting URL) is unaffected — static `/members/*` URLs are locale-agnostic in URL form.

The new `(member)/layout.tsx` duplicates the infrastructure pieces of `(site)/layout.tsx` — `ensureFor("read")`, `<NpThemeStyle theme={tokens}>`, the theme-owned CSS `<style>` tag, the `data-np-theme` attribute — because route groups are siblings (Next.js runs ONE root layout per request based on which group matches). Differences: wraps content in the member shell (or fallback chain) instead of `impl.shell`; skips the feed-discovery `<link rel="alternate" type="application/atom+xml">` line — member pages don't carry feed metadata.

Reference theme migration (magazine + portfolio + docs) lands in M.ref; this PR ships only the framework wiring + the empty contract slot. Existing themes with no `impl.members` declared inherit the public-site `impl.shell`, so behavior is unchanged for sites that haven't migrated.

Manifest changes: `NpThemeImpl` gains optional `members` field (additive — all existing themes continue to compile against the new type without changes).
