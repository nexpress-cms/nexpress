import * as React from "react";
import type { NpThemeShellProps } from "@nexpress/theme";

/**
 * `NpThemeColors` (from `@nexpress/core`) is a strict interface
 * — success / warning / danger / code-surface colors aren't
 * legal `tokens.colors` keys. The docs CSS still depends on
 * them, so the shell injects them as `--np-color-*` vars inline
 * once per render. Anything the operator overrides via the
 * settings cascade still wins (cascade order — later rule
 * applied to the same custom property — keeps admin overrides
 * effective even with this baseline injected).
 */
const TOKEN_CSS = `:root{--np-color-success:#047857;--np-color-warning:#b45309;--np-color-danger:#b91c1c;--np-color-success-soft:#ecfdf5;--np-color-warning-soft:#fffbeb;--np-color-danger-soft:#fef2f2;--np-color-code-bg:#0b1220;--np-color-code-fg:#e6edf6;--np-color-code-head:#1e2939;--np-color-code-border:#0f1a2b;}`;

export async function DocsShell({
  children,
}: NpThemeShellProps): Promise<React.ReactElement> {
  let layout: "docs" | "page" = "docs";
  try {
    const { headers } = await import("next/headers");
    const pathname = (await headers()).get("x-np-pathname") ?? "";
    if (!pathname.startsWith("/docs")) layout = "page";
  } catch {
    // Outside a request scope — keep the docs grid as the default.
  }
  return (
    <div className="np-docs-shell" data-layout={layout}>
      <style dangerouslySetInnerHTML={{ __html: TOKEN_CSS }} />
      <div className="np-docs-grid">{children}</div>
    </div>
  );
}
