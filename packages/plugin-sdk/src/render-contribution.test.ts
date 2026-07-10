import { describe, expect, expectTypeOf, it } from "vitest";

import { npValidateRenderContribution } from "./render-contribution.js";
import {
  npHookNames,
  type NpHookData,
  type NpHookName,
  type NpHookResult,
  type NpRenderHookData,
  type NpRenderHookResult,
} from "./types.js";

describe("render contribution contract", () => {
  it("exposes one typed render hook", () => {
    expect(npHookNames.filter((name) => name.startsWith("render:"))).toEqual(["render:beforePage"]);
    expectTypeOf<Extract<NpHookName, `render:${string}`>>().toEqualTypeOf<"render:beforePage">();
    expectTypeOf<NpHookData<"render:beforePage">>().toEqualTypeOf<NpRenderHookData>();
    expectTypeOf<NpHookResult<"render:beforePage">>().toEqualTypeOf<NpRenderHookResult>();
  });

  it("accepts the complete head and body-end vocabulary", () => {
    const contribution = {
      head: [
        { tag: "meta", attrs: { name: "description", content: "Example" } },
        { tag: "link", attrs: { rel: "canonical", href: "/example" } },
        { tag: "script", attrs: { src: "/head.js", async: "" } },
        { tag: "style", attrs: { nonce: "abc" }, children: "body { color: red; }" },
      ],
      bodyEnd: [
        { tag: "script", children: "window.example = true;" },
        { tag: "noscript", children: "JavaScript is disabled." },
      ],
    };

    expect(npValidateRenderContribution(contribution)).toEqual({ ok: true });
  });

  it.each([
    [null, /plain object/],
    [{ footer: [] }, /only head and bodyEnd/],
    [{ head: "meta" }, /head must be an array/],
    [{ head: [{ tag: "meta", attrs: { content: 42 } }] }, /require string attrs/],
    [{ head: [{ tag: "iframe", attrs: {} }] }, /iframe.*not supported/],
    [{ bodyEnd: [{ tag: "noscript" }] }, /require string children/],
    [{ bodyEnd: [{ tag: "script", children: false }] }, /children must be a string/],
  ])("rejects malformed contributions: %j", (value, message) => {
    const result = npValidateRenderContribution(value);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(message);
  });
});
