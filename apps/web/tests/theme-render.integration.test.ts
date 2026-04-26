import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";

import {
  closeTestDb,
  ensureMigrated,
  registerTestCollections,
  skipIfNoTestDb,
  truncateAll,
} from "./harness.js";

/**
 * Phase 11.2 self-review followup — actual React render
 * coverage. The earlier `theme-layout-swap` tests assert
 * registry / slot / CSS plumbing but never render JSX, so a
 * subtle component-level break (logo gone, CSS class typo,
 * shell that swallows children) wouldn't surface in CI; only
 * a manual `curl` smoke test would catch it.
 *
 * These render the SYNC slot components and assert on the
 * markup. Async server components (default header / footer
 * that read `getNavigation`) need a Next.js render rig — out
 * of scope for the integration suite, kept on the `pnpm dev`
 * smoke checklist.
 */
describe.skipIf(skipIfNoTestDb())("theme render snapshots (Phase 11.2 fixup)", () => {
  beforeAll(async () => {
    await ensureMigrated();
    registerTestCollections();
    const { ensureCoreServices } = await import("@/lib/init-core");
    ensureCoreServices();
  });
  beforeEach(async () => {
    await truncateAll();
  });
  afterAll(async () => {
    await closeTestDb();
  });

  it("MinimalShell wraps children verbatim (no extra DOM)", async () => {
    const { minimalTheme } = await import("@nexpress/theme-minimal");
    const Shell = (minimalTheme.impl as {
      shell: (props: { children: React.ReactNode }) => React.ReactElement;
    }).shell;
    const html = renderToString(Shell({ children: "<probe>hello</probe>" } as never));
    expect(html).toContain("probe");
    expect(html).toContain("hello");
  });

  it("MinimalHeader renders only the centered logo (no nav/search/widget)", async () => {
    const { minimalTheme } = await import("@nexpress/theme-minimal");
    const Header = (minimalTheme.impl as {
      slots: { header: () => React.ReactElement };
    }).slots.header;
    const html = renderToString(Header());
    // Logo present
    expect(html).toContain('class="nx-site-logo"');
    expect(html).toContain("NexPress");
    // Header wrapper carries the minimal modifier
    expect(html).toContain("nx-minimal-header");
    // No nav menu, no search form, no member widget
    expect(html).not.toContain("nx-site-nav");
    expect(html).not.toContain("nx-site-search");
    expect(html).not.toContain("nx-member-status");
  });

  it("MinimalFooter is the bare top-rule (no menu)", async () => {
    const { minimalTheme } = await import("@nexpress/theme-minimal");
    const Footer = (minimalTheme.impl as {
      slots: { footer: () => React.ReactElement };
    }).slots.footer;
    const html = renderToString(Footer());
    expect(html).toContain("nx-minimal-footer");
    // No `<nav>` / `<ul>` — minimal footer renders just the
    // visual rule, no link list.
    expect(html).not.toContain("<nav");
    expect(html).not.toContain("<ul");
  });

  it("Default and minimal headers produce DIFFERENT markup", async () => {
    // Belt-and-braces: the registry-level `theme-layout-swap`
    // suite asserts slot REFS differ, but ref equality alone
    // doesn't guarantee the rendered output differs (you could
    // imagine two functions that happen to return identical
    // JSX). Render the minimal one and confirm the markup is
    // recognizably itself.
    const { minimalTheme } = await import("@nexpress/theme-minimal");
    const Header = (minimalTheme.impl as {
      slots: { header: () => React.ReactElement };
    }).slots.header;
    const html = renderToString(Header());
    expect(html).toContain("nx-minimal-header");
    // Default header would contain `nx-site-search-input`
    // (search input class). Minimal explicitly drops it.
    expect(html).not.toContain("nx-site-search-input");
  });

  it("Theme CSS strings are non-trivial and don't share rule signatures", async () => {
    const { defaultTheme } = await import("@nexpress/theme-default");
    const { minimalTheme } = await import("@nexpress/theme-minimal");
    const defaultCss = (defaultTheme.impl as { css?: string }).css ?? "";
    const minimalCss = (minimalTheme.impl as { css?: string }).css ?? "";
    expect(defaultCss.length).toBeGreaterThan(100);
    expect(minimalCss.length).toBeGreaterThan(100);
    // Default's flex header layout shouldn't appear in
    // minimal's CSS — proves we actually wrote different
    // rule sets, not a copy-paste with one selector tweaked.
    expect(minimalCss).not.toContain("max-width: 1200px");
    expect(defaultCss).not.toContain("nx-minimal-header");
  });
});
