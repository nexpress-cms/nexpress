import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createElement, Fragment } from "react";
import { renderToStaticMarkup } from "react-dom/server";

const { runHookAndCollect } = vi.hoisted(() => ({ runHookAndCollect: vi.fn() }));

vi.stubGlobal("React", { createElement, Fragment });
afterAll(() => vi.unstubAllGlobals());

vi.mock("@nexpress/core/bootstrap", () => ({ runHookAndCollect }));

import { npValidateRenderContribution } from "@nexpress/plugin-sdk";

import { collectRenderContributions, RenderBodyEnd } from "./render-contributions.js";

describe("collectRenderContributions", () => {
  beforeEach(() => {
    runHookAndCollect.mockReset();
  });

  it("dispatches the single render hook with runtime result validation", async () => {
    runHookAndCollect.mockResolvedValue([
      { head: [{ tag: "meta", attrs: { name: "one", content: "1" } }] },
      { bodyEnd: [{ tag: "script", children: "window.two = true;" }] },
    ]);

    const document = { id: "page-1" };
    await expect(
      collectRenderContributions({ collection: "pages", slug: "hello", document }),
    ).resolves.toEqual({
      head: [{ tag: "meta", attrs: { name: "one", content: "1" } }],
      bodyEnd: [{ tag: "script", children: "window.two = true;" }],
    });

    expect(runHookAndCollect).toHaveBeenCalledOnce();
    expect(runHookAndCollect).toHaveBeenCalledWith(
      "render:beforePage",
      { collection: "pages", slug: "hello", document },
      { validateResult: npValidateRenderContribution },
    );
  });

  it("renders body-end script and noscript entries in place", () => {
    const markup = renderToStaticMarkup(
      createElement(RenderBodyEnd, {
        entries: [
          { tag: "script", children: "window.analytics = true;" },
          { tag: "noscript", children: "Analytics requires JavaScript." },
        ],
      }),
    );

    expect(markup).toContain("<script>window.analytics = true;</script>");
    expect(markup).toContain("<noscript>Analytics requires JavaScript.</noscript>");
  });
});
