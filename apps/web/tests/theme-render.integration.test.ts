import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createElement, type ReactNode } from "react";
import { renderToReadableStream } from "react-dom/server";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime.js";

import {
  buildRequest,
  closeTestDb,
  ensureMigrated,
  readJson,
  registerTestCollections,
  seedUser,
  skipIfNoTestDb,
  truncateAll,
} from "./harness.js";

// Model an anonymous public request; navigation/settings still use PostgreSQL.
vi.mock("next/headers", () => ({
  headers: () =>
    Promise.resolve(new Headers({ "x-np-locale": "en", "x-np-pathname": "/features" })),
  cookies: () => Promise.resolve({ get: () => undefined }),
}));

// Same async server-render boundary as builtin-theme-route-smoke. Waiting for
// allReady includes nested async slot reads without a live Next.js listener.
async function renderHtml(element: ReactNode): Promise<string> {
  const stream = await renderToReadableStream(element);
  await stream.allReady;
  return new Response(stream).text();
}

describe.skipIf(skipIfNoTestDb())("built-in theme shell and slot rendering", () => {
  let restoreThemes: () => void;
  beforeAll(async () => {
    await ensureMigrated();
    registerTestCollections();
    const { ensureFor } = await import("@/lib/init-core");
    await ensureFor("read");
    const { getRegisteredThemes, registerThemes } = await import("@nexpress/core");
    const previous = getRegisteredThemes();
    restoreThemes = () => registerThemes(previous);
  });
  beforeEach(async () => {
    await truncateAll();
    const { registerThemes } = await import("@nexpress/core");
    const { defaultTheme } = await import("@nexpress/theme-default");
    const { magazineTheme } = await import("@nexpress/theme-magazine");
    registerThemes([defaultTheme, magazineTheme]);
  });
  afterAll(async () => {
    restoreThemes?.();
    await closeTestDb();
  });

  async function saveNavigation(location: string, label: string, url: string) {
    const admin = await seedUser({ role: "admin" });
    const { PUT } = await import("@/app/api/navigation/route");
    const response = await PUT(
      buildRequest("/api/navigation", {
        session: admin,
        method: "PUT",
        body: { location, items: [{ id: "render-fixture", type: "link", label, url }] },
      }),
    );
    expect((await readJson(response)).status).toBe(200);
  }

  it("magazine shell preserves escaped children inside its scoped wrapper and emits its font/token bootstrap", async () => {
    const { magazineTheme, MagazineShell } = await import("@nexpress/theme-magazine");
    expect(magazineTheme.impl.shell).toBe(MagazineShell);
    const html = await renderHtml(
      createElement(MagazineShell, { children: "<probe>hello</probe>" }),
    );
    expect(html).toContain('<div class="np-magazine">&lt;probe&gt;hello&lt;/probe&gt;</div>');
    expect(html).not.toContain("<probe>");
    expect(html).toContain('rel="preconnect" href="https://fonts.googleapis.com"');
    expect(html).toContain("Newsreader");
    expect(html).toContain("--np-color-rule:");
  });

  it("magazine header renders its masthead and current persisted section navigation", async () => {
    const { magazineTheme, MagazineHeader } = await import("@nexpress/theme-magazine");
    expect(magazineTheme.impl.slots?.header).toBe(MagazineHeader);
    await saveNavigation("header", "Rendered section", "/features");
    const html = await renderHtml(createElement(MagazineHeader));
    expect(html).toContain('class="np-magazine-header"');
    expect(html).toContain('class="np-magazine-logo"');
    expect(html).toContain("The Northbound Review");
    expect(html).toContain('aria-label="Sections"');
    expect(html).toContain('href="/features"');
    expect(html).toContain("Rendered section");
    expect(html).toContain('aria-current="page"');
    expect(html).not.toContain("np-site-search-input");
  });

  it("magazine footer renders its fallback colophon and then replaces sections with persisted navigation", async () => {
    const { magazineTheme, MagazineFooter } = await import("@nexpress/theme-magazine");
    expect(magazineTheme.impl.slots?.footer).toBe(MagazineFooter);
    const fallback = await renderHtml(createElement(MagazineFooter));
    expect(fallback).toContain('class="np-magazine-footer"');
    expect(fallback).toContain('class="np-magazine-footer-colophon"');
    expect(fallback).toContain('href="/features"');
    expect(fallback).toContain('href="/masthead"');
    await saveNavigation("footer", "Persisted footer section", "/render-footer");
    const html = await renderHtml(createElement(MagazineFooter));
    expect(html).toContain('href="/render-footer"');
    expect(html).toContain("Persisted footer section");
    expect(html).not.toContain('href="/features"');
    expect(html).toContain('href="/masthead"');
    expect(html).toContain('href="/feed.xml"');
  });

  it("default and magazine headers render distinct chrome over the same persisted navigation", async () => {
    const { DefaultHeader } = await import("@nexpress/theme-default");
    const { MagazineHeader } = await import("@nexpress/theme-magazine");
    await saveNavigation("header", "Shared navigation", "/features");
    const unexpectedNavigation = () => {
      throw new Error("Server rendering must not navigate");
    };
    const defaultHtml = await renderHtml(
      createElement(AppRouterContext.Provider, {
        value: {
          back: unexpectedNavigation,
          forward: unexpectedNavigation,
          refresh: unexpectedNavigation,
          push: unexpectedNavigation,
          replace: unexpectedNavigation,
          prefetch: unexpectedNavigation,
          bfcacheId: "theme-render-fixture",
        },
        children: createElement(DefaultHeader),
      }),
    );
    const magazineHtml = await renderHtml(createElement(MagazineHeader));
    expect(defaultHtml).not.toBe(magazineHtml);
    expect(defaultHtml).toContain('class="np-site-header"');
    expect(defaultHtml).toContain('class="np-site-search-input"');
    expect(defaultHtml).not.toContain('class="np-magazine-header"');
    expect(magazineHtml).toContain('class="np-magazine-header"');
    expect(magazineHtml).not.toContain('class="np-site-search-input"');
    expect(defaultHtml).toContain("Shared navigation");
    expect(magazineHtml).toContain("Shared navigation");
  });

  it("theme CSS contains the matching shell/chrome rules and distinct layout signatures", async () => {
    const { defaultTheme } = await import("@nexpress/theme-default");
    const { magazineTheme } = await import("@nexpress/theme-magazine");
    const defaultCss = defaultTheme.impl.css ?? "";
    const magazineCss = magazineTheme.impl.css ?? "";
    expect(defaultCss.length).toBeGreaterThan(100);
    expect(magazineCss.length).toBeGreaterThan(100);
    expect(defaultCss).toContain(".np-site-header-inner");
    expect(magazineCss).toContain(".np-magazine-header");
    expect(magazineCss).toContain(".np-magazine-footer");
    expect(defaultCss).not.toContain(".np-magazine-header");
    expect(magazineCss).not.toContain(".np-site-header-inner");
    expect(defaultCss).not.toBe(magazineCss);
  });
});
