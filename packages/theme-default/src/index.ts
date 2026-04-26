import { defineTheme } from "@nexpress/theme";

import { DefaultFooter } from "./footer.js";
import { DefaultHeader } from "./header.js";
import { DefaultShell } from "./shell.js";
import { defaultThemeCss } from "./styles.js";

/**
 * `@nexpress/theme-default` — the built-in baseline theme.
 *
 * Phase 11.1 stubbed the manifest; 11.2 backfilled the real
 * shell, header, footer, and CSS so swapping themes is a
 * genuine UX change rather than a registry lookup that
 * points at empty components.
 *
 * The header is a server component that loads the `header`
 * navigation menu and renders logo / nav / search / member
 * status widget. The footer reads the `footer` menu. CSS for
 * the layout-level classes (`.nx-site-header`, `.nx-site-footer`,
 * `.nx-site-search`, etc.) ships with the package — the
 * framework injects it as `<style data-nx-theme="default">` in
 * the layout head when this theme is active.
 *
 * Sites that want a different layout author a competing theme
 * package (see `@nexpress/theme-minimal` for the canonical
 * sparse alternative) and register both in
 * `nexpress.config.ts`'s `themes` array. Admins switch via the
 * Theme settings tab without redeploying — that's the UX 11.4
 * lands.
 */
export const defaultTheme = defineTheme({
  manifest: {
    id: "default",
    name: "NexPress Default",
    version: "0.1.0",
    description:
      "Built-in baseline theme. Provides the standard NexPress shell, header, footer, and search bar styled with the design tokens. Sites brand by overriding tokens; ship a custom theme to change the structure.",
    author: { name: "NexPress" },
    nexpress: { minVersion: "0.1.0" },
  },
  impl: {
    shell: DefaultShell,
    slots: {
      header: DefaultHeader,
      footer: DefaultFooter,
    },
    css: defaultThemeCss,
    // Templates land in 11.3; tokens in 11.4. The fields are
    // declared on the type so themes can future-proof — leaving
    // them undefined here is intentional.
  },
});

export { DefaultShell } from "./shell.js";
export { DefaultHeader } from "./header.js";
export { DefaultFooter } from "./footer.js";
export { MemberStatusWidget } from "./components/member-status-widget.js";
export { defaultThemeCss } from "./styles.js";
