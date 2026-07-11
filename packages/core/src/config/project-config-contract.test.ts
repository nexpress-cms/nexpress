import { describe, expect, it } from "vitest";

import type { NpConfig } from "./types.js";
import { npAnalyzeProjectConfig, npValidateProjectConfig } from "./project-config-contract.js";

function validConfig(): NpConfig {
  return {
    site: { name: "Test", url: "https://example.com" },
    db: { connectionString: "postgres://localhost/test" },
    storage: {
      adapter: "local",
      local: { directory: "./public/media", baseUrl: "/media" },
    },
    collections: [
      {
        slug: "posts",
        labels: { singular: "Post", plural: "Posts" },
        fields: [{ name: "title", type: "text" }],
      },
    ],
    i18n: { locales: ["en", "ko-KR"], defaultLocale: "en" },
    auth: { secret: "x".repeat(32) },
    jobs: { stuckThreshold: { failed: 0, expired: 20 } },
  };
}

function resolvedPlugin(id: string, requires: string[] = []): Record<string, unknown> {
  return {
    manifest: { id, name: id, capabilities: [], requires },
  };
}

describe("project config contract", () => {
  it("accepts the complete active project config surface", () => {
    expect(npValidateProjectConfig(validConfig())).toEqual({ ok: true });
  });

  it("rejects unknown and retired top-level or nested properties", () => {
    const retired = { ...validConfig(), images: { format: "webp" } };
    expect(npAnalyzeProjectConfig(retired)[0]).toEqual(
      expect.objectContaining({ code: "shape", message: expect.stringMatching(/images/) }),
    );

    const nested = validConfig() as NpConfig & { jobs: { typo: boolean } };
    nested.jobs = { typo: true };
    expect(npAnalyzeProjectConfig(nested)[0]).toEqual(
      expect.objectContaining({ code: "shape", message: expect.stringMatching(/typo/) }),
    );
  });

  it("requires an HTTP origin and usable storage URLs", () => {
    const config = validConfig();
    config.site.url = "https://user@example.com/path?preview=1";
    if (config.storage?.adapter !== "local") throw new Error("fixture drift");
    config.storage.local.baseUrl = "media";

    expect(npAnalyzeProjectConfig(config)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ location: "site.url", message: expect.stringMatching(/origin/) }),
        expect.objectContaining({
          location: "storage.local.baseUrl",
          message: expect.stringMatching(/absolute path/),
        }),
      ]),
    );
  });

  it("requires a PostgreSQL connection URL and a strong configured secret", () => {
    const invalidDatabase = validConfig();
    invalidDatabase.db.connectionString = "https://example.com/database";
    expect(npAnalyzeProjectConfig(invalidDatabase)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          location: "db.connectionString",
          message: expect.stringMatching(/PostgreSQL connection URL/),
        }),
      ]),
    );

    const weakSecret = validConfig();
    weakSecret.auth = { secret: "too-short" };
    expect(npAnalyzeProjectConfig(weakSecret)[0]).toEqual(
      expect.objectContaining({ code: "shape", location: "auth.secret" }),
    );
  });

  it("requires canonical unique BCP 47 locales", () => {
    const config = validConfig();
    config.i18n = { locales: ["en-us", "en-us"], defaultLocale: "en-us" };

    expect(npAnalyzeProjectConfig(config)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ message: expect.stringMatching(/canonical BCP 47/) }),
        expect.objectContaining({ message: expect.stringMatching(/duplicate locale/) }),
      ]),
    );
  });

  it("validates the legacy plugin entry shape", () => {
    const config = validConfig();
    config.plugins = [{ id: "legacy", name: "Legacy", init: () => undefined, typo: true } as never];

    expect(npAnalyzeProjectConfig(config)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ message: 'unsupported legacy plugin field "typo".' }),
      ]),
    );
  });

  it("rejects duplicate and missing plugin dependencies", () => {
    const config = validConfig();
    config.plugins = [
      resolvedPlugin("alpha", ["missing", "missing"]),
      resolvedPlugin("alpha"),
    ] as never;

    expect(npAnalyzeProjectConfig(config)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ message: expect.stringMatching(/duplicate plugin id "alpha"/) }),
        expect.objectContaining({ message: expect.stringMatching(/duplicate plugin dependency/) }),
        expect.objectContaining({
          message: expect.stringMatching(/not declared in config.plugins/),
        }),
      ]),
    );
  });

  it("rejects plugin dependency cycles", () => {
    const config = validConfig();
    config.plugins = [
      resolvedPlugin("alpha", ["beta"]),
      resolvedPlugin("beta", ["alpha"]),
    ] as never;

    expect(npAnalyzeProjectConfig(config)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          message: "plugin dependency cycle detected: alpha -> beta -> alpha.",
        }),
      ]),
    );
  });

  it("accepts an acyclic resolved plugin inventory", () => {
    const config = validConfig();
    config.plugins = [resolvedPlugin("base"), resolvedPlugin("consumer", ["base"])] as never;

    expect(npValidateProjectConfig(config)).toEqual({ ok: true });
  });
});
