import { describe, expect, expectTypeOf, it } from "vitest";
import { npPluginHookNames } from "@nexpress/core";

import { definePlugin } from "./define-plugin.js";
import {
  npHookNames,
  type NpAuthAfterRegisterHookData,
  type NpContentAfterCreateHookData,
  type NpContentBeforeCreateHookData,
  type NpHookData,
  type NpHookName,
  type NpHookResult,
  type NpMediaAfterUploadHookData,
  type NpPluginDocument,
  type NpReadonlyPluginDocument,
} from "./types.js";

const manifest = {
  id: "typed-hooks",
  name: "Typed hooks",
  version: "0.1.0",
  description: "Exercises typed lifecycle hooks.",
  author: { name: "Test" },
  license: "MIT",
  nexpress: { minVersion: "0.1.0" },
} as const;

describe("typed lifecycle hook contract", () => {
  it("maps every lifecycle hook to exact data and void results", () => {
    expect(npHookNames).toEqual(npPluginHookNames);
    expectTypeOf<(typeof npHookNames)[number]>().toEqualTypeOf<NpHookName>();
    expectTypeOf<NpHookData<"content:afterCreate">>().toEqualTypeOf<NpContentAfterCreateHookData>();
    expectTypeOf<
      NpHookData<"content:beforeCreate">
    >().toEqualTypeOf<NpContentBeforeCreateHookData>();
    expectTypeOf<NpHookData<"auth:afterRegister">>().toEqualTypeOf<NpAuthAfterRegisterHookData>();
    expectTypeOf<NpHookData<"media:afterUpload">>().toEqualTypeOf<NpMediaAfterUploadHookData>();
    expectTypeOf<NpHookResult<"content:afterCreate">>().toEqualTypeOf<void | Promise<void>>();
    expectTypeOf<Extract<NpHookName, `content:${string}`>>().not.toEqualTypeOf<string>();
  });

  it("contextually types content, auth, and media handler payloads", () => {
    const plugin = definePlugin({
      manifest,
      hooks: {
        "content:afterCreate": (context) => {
          const { hook, data, ctx } = context;
          expectTypeOf(hook).toEqualTypeOf<"content:afterCreate">();
          expectTypeOf<
            Extract<keyof typeof context, "collection" | "user" | "principal">
          >().toEqualTypeOf<never>();
          expectTypeOf(data.documentId).toEqualTypeOf<string>();
          expectTypeOf(data.document).toEqualTypeOf<NpReadonlyPluginDocument>();
          expectTypeOf(data.operation).toEqualTypeOf<"create">();
          expectTypeOf(data.originalDocument).toEqualTypeOf<null>();
          ctx.log.info("created", { collection: data.collection });
        },
        "content:beforeCreate": ({ data }) => {
          expectTypeOf(data.document).toEqualTypeOf<NpPluginDocument>();
          data.document.normalizedByPlugin = true;
        },
        "auth:afterRegister": ({ hook, data }) => {
          expectTypeOf(hook).toEqualTypeOf<"auth:afterRegister">();
          expectTypeOf(data.origin).toEqualTypeOf<"admin" | "invite">();
        },
        "media:afterUpload": ({ hook, data }) => {
          expectTypeOf(hook).toEqualTypeOf<"media:afterUpload">();
          expectTypeOf(data.media.folderId).toEqualTypeOf<string | null>();
          if (data.principal.kind === "member") {
            expectTypeOf(data.member).not.toEqualTypeOf<null>();
          }
        },
      },
    });

    expect(plugin.manifest.provides.hooks).toEqual([
      "content:afterCreate",
      "content:beforeCreate",
      "auth:afterRegister",
      "media:afterUpload",
    ]);
  });
});
