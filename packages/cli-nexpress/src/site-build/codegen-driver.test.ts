import { describe, expect, it } from "vitest";
import { createSiteBuildCodegenDriverV1 } from "./codegen-driver.js";
import {
  createSiteBuildGenerationPreloadV1,
  type NpSiteBuildGenerationContextV1,
} from "./generation-context.js";
const context: NpSiteBuildGenerationContextV1 = {
  schemaVersion: "np.site-build-generation-context.v1",
  implementation: "np.site-build-generation.v1",
  selectedDirectionHash: `nb1:sha256:${"A".repeat(43)}`,
  comparisonInputsDigest: `nb1:sha256:${"A".repeat(43)}`,
  selectedRenderEnvironmentFingerprint: `nb1:sha256:${"A".repeat(43)}`,
  clock: { now: "2026-10-23T00:00:00.000Z", randomSeed: "a".repeat(64) },
};
const base = {
  context,
  configPath: "src/nexpress.config.ts" as const,
  loaderPath: "/np/project/node_modules/@nexpress/cli/dist/site-build-loader.js",
  preloadPath:
    "/np/project/.nexpress/site/tmp/codegen-source-00000000-0000-4000-8000-000000000001/generation-0.mjs",
};
describe("shared fixed codegen source", () => {
  it.each(["src/nexpress.config.ts", "nexpress.config.ts"] as const)(
    "keeps the ordinary schema owner for %s",
    (configPath) => {
      const command = { id: "schema", template: "schema-generate" as const, name: null };
      const result = createSiteBuildCodegenDriverV1({ ...base, configPath, command });
      expect(result.preload).toEqual(createSiteBuildGenerationPreloadV1(context, command));
      expect(result.driver).toBe(
        `import config from "file:///np/project/${configPath}";\nimport {generateSchema} from "@nexpress/app/scripts/generate-schema";\ngenerateSchema({config,projectRoot:"/np/project"});\n`,
      );
    },
  );
  it("preserves named Drizzle, framework lifecycle migrations and journal assertion in order", () => {
    const command = {
      id: "migration",
      template: "migration-generate" as const,
      name: "editorial-reviewer-note",
    };
    const result = createSiteBuildCodegenDriverV1({ ...base, command });
    expect(result.preload).toEqual(createSiteBuildGenerationPreloadV1(context, command));
    expect(result.driver).toContain(
      '"generate","--config","drizzle.config.ts","--name","editorial-reviewer-note"',
    );
    expect(result.driver.indexOf("const child=spawn")).toBeLessThan(
      result.driver.indexOf("await generateMigrations()"),
    );
    expect(result.driver.indexOf("await generateMigrations()")).toBeLessThan(
      result.driver.lastIndexOf("assertSiteBuildGenerationJournalV1()"),
    );
    expect(result.driver).toContain("shell:false");
    expect(result.driver).not.toContain("migrate");
  });
  it.each([
    "/tmp/preload.mjs",
    "/np/project/.nexpress/site/tmp/codegen-source-00000000-0000-4000-8000-000000000001/../escape.mjs",
    "file:///np/project/preload.mjs",
  ])("rejects a foreign preload path %s", (preloadPath) => {
    expect(() =>
      createSiteBuildCodegenDriverV1({
        ...base,
        preloadPath,
        command: { id: "schema", template: "schema-generate", name: null },
      }),
    ).toThrow();
  });
  it("accepts the existing executor control profile without a source substitution", () => {
    const result = createSiteBuildCodegenDriverV1({
      ...base,
      preloadPath: base.preloadPath.replace("codegen-source-", "command-executor-"),
      command: { id: "schema", template: "schema-generate", name: null },
    });
    expect(result.driver).toContain('generateSchema({config,projectRoot:"/np/project"})');
  });
  it("rejects alternate loaders and command injection through the existing owner", () => {
    expect(() =>
      createSiteBuildCodegenDriverV1({
        ...base,
        loaderPath: "/tmp/custom-loader.mjs",
        command: { id: "schema", template: "schema-generate", name: null },
      }),
    ).toThrow();
    expect(() =>
      createSiteBuildCodegenDriverV1({
        ...base,
        command: { id: "migration", template: "migration-generate", name: "x; curl example" },
      }),
    ).toThrow();
    expect(() =>
      createSiteBuildCodegenDriverV1({
        ...base,
        command: { id: "schema", template: "schema-generate", name: "unexpected" },
      }),
    ).toThrow();
  });
});
