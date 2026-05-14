import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { defaultCollections, defaultThemes } from "@nexpress/app/config-defaults";
import {
  mergeThemeRequirements,
  resetLogger,
  setLogger,
  type NpLogger,
} from "@nexpress/core";

/**
 * Bundled-themes "prebake" gate.
 *
 * Scaffolded projects ship `themes: [...defaultThemes]` and a copy
 * of `defaultCollections`, so `defineConfig` already runs
 * `mergeThemeRequirements(defaultCollections, defaultThemes)` at
 * boot. The union of every built-in theme's `requires` lands in
 * the operator's collections, and the next `db:generate &&
 * db:migrate` materialises every column. Once that's done, swapping
 * the active theme from `/admin/appearance` is just a
 * `np_settings.activeTheme` flip — no migration, no restart.
 *
 * The guarantee depends on the built-ins' `requires` being
 * conflict-free under the union: if two themes contribute the
 * same field name on the same slug with different shapes,
 * `mergeThemeRequirements` keeps the first and warns. That's
 * silently fine in dev but breaks the "swap is migration-free"
 * promise — the operator who picks the losing theme finds its
 * column shape doesn't match what the theme expects.
 *
 * This test asserts the union is conflict-free today and stays
 * that way as built-ins evolve. A future fifth built-in theme
 * that collides with an existing one will fail here and force
 * the contributor to rename/rescope the requirement before
 * merging.
 *
 * Why this lives under `apps/web/tests/` and not `packages/core/`:
 * the operator-facing arrays (`defaultCollections`, `defaultThemes`)
 * are in `@nexpress/app`, which `apps/web` depends on but
 * `@nexpress/core` does not. The bundle composition concern is
 * "what does the reference app + every scaffold ship", which
 * matches `apps/web`'s scope.
 */

const CONFLICT_MESSAGE = /Two themes contribute the same field/;

describe("built-in themes — requires union", () => {
  const warnings: Array<{ message: string; context?: Record<string, unknown> }> = [];

  beforeEach(() => {
    warnings.length = 0;
    const noopChild = (): NpLogger => ({
      debug: () => {},
      info: () => {},
      warn: (message, context) => {
        warnings.push({ message, context });
      },
      error: () => {},
      child: noopChild,
    });
    setLogger({
      debug: () => {},
      info: () => {},
      warn: (message, context) => {
        warnings.push({ message, context });
      },
      error: () => {},
      child: noopChild,
    });
  });

  afterEach(() => {
    resetLogger();
  });

  it("merges all built-in themes against default collections without theme-vs-theme conflicts", () => {
    // Real operator config the scaffold ships. Reflects exactly
    // what `defineConfig` sees at boot in a fresh project.
    mergeThemeRequirements(defaultCollections, defaultThemes);

    const conflicts = warnings.filter((w) => CONFLICT_MESSAGE.test(w.message));
    if (conflicts.length > 0) {
      // Surface the colliding fields in the failure message so a
      // future contributor diagnosing the gate doesn't need to
      // rerun with a debugger to see which theme + field tripped.
      const detail = conflicts
        .map(
          (c) =>
            `${String(c.context?.theme ?? "?")}:${String(c.context?.slug ?? "?")}.${String(c.context?.field ?? "?")}`,
        )
        .join(", ");
      throw new Error(
        `Built-in themes' requires union has theme-vs-theme conflicts: ${detail}. ` +
          `Two built-ins are contributing the same field on the same collection. ` +
          `Rename or rescope the requirement so swap-from-admin stays migration-free.`,
      );
    }
    expect(conflicts).toEqual([]);
  });

  it("union without operator collections also has no theme-vs-theme conflicts on createIfAbsent slugs", () => {
    // Worst case: empty operator config. Only `createIfAbsent`
    // requirements materialise, so this exercises theme-vs-theme
    // collisions on synthesised collections (e.g. `categories`,
    // `authors`) — a path the production-config test above might
    // skip because the operator already declared the slug.
    mergeThemeRequirements([], defaultThemes);

    const conflicts = warnings.filter((w) => CONFLICT_MESSAGE.test(w.message));
    expect(conflicts).toEqual([]);
  });
});
