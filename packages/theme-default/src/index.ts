import { defineTheme } from "@nexpress/theme";

import { DefaultFooter } from "./footer.js";
import { DefaultHeader } from "./header.js";
import { DefaultShell } from "./shell.js";

/**
 * `@nexpress/theme-default` — the built-in baseline theme.
 *
 * Phase 11.1 establishes the registry + manifest contract;
 * the current `apps/web/(site)/layout.tsx` is extracted into
 * this package so the reference app has a "real" theme to
 * register and test against. The actual shell / header /
 * footer components stay minimal — they wrap the existing
 * `nx-*` CSS classes already styled by `globals.css`. 11.2
 * wires the apps/web layout to render these via the active
 * theme rather than calling them directly.
 *
 * Sites that want to brand their own NexPress install ship
 * a competing theme package that exports its own
 * `defineTheme(...)` and register both in
 * `nexpress.config.ts`'s `themes` array. Admins switch via
 * the Theme settings tab without redeploying — that's the
 * UX 11.4 lands.
 */
export const defaultTheme = defineTheme({
  manifest: {
    id: "default",
    name: "NexPress Default",
    version: "0.0.1",
    description:
      "Built-in baseline theme. Provides the standard NexPress shell, header, and footer with no opinionated styling — sites brand by overriding tokens.",
    author: { name: "NexPress" },
    nexpress: { minVersion: "0.1.0" },
  },
  impl: {
    shell: DefaultShell,
    slots: {
      header: DefaultHeader,
      footer: DefaultFooter,
    },
    // Templates land in 11.3; tokens in 11.4. The fields are
    // declared on the type so themes can future-proof — leaving
    // them undefined here is intentional.
  },
});

export { DefaultShell } from "./shell.js";
export { DefaultHeader } from "./header.js";
export { DefaultFooter } from "./footer.js";
