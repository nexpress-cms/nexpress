import { z } from "zod";
import type { NpBlockContent } from "../fields/block-content.js";
import { npValidateBlockContent } from "../fields/block-content.js";
import { npAnalyzeNavigationItems, npAnalyzeNavigationLocation } from "../navigation/contract.js";
import type { NpNavigationItems } from "../navigation/types.js";
import { npAnalyzeThemeTokensOverlay } from "../theme/contract.js";
import type { NpThemeTokensOverlay } from "../theme/types.js";
import { npAuthUuidPattern } from "../auth-contract/contract.js";
import type {
  NpAgentSiteBriefV1,
  NpAgentSiteBlueprintV1,
  NpAgentGeneratedMediaPromptV1,
  NpAgentBuildSourceTreeV1,
  NpAgentBuildCommandOutputV1,
  NpAgentBlueprintCommand,
} from "./types.js";
import {
  compareUtf8,
  digest,
  environmentName,
  fileDigest,
  fingerprint,
  httpsUrl,
  id,
  jsonObject,
  label,
  locale,
  prose,
  relativePath,
  route,
  slug,
  sortedIds,
  sourcePath,
  strings,
  text,
  under,
  unique,
  npIsBuildSourcePathExcludedV1,
} from "./primitives.js";

const target = z.enum(["local", "vercel", "railway", "render", "fly", "docker"]);
const count = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).nullable();
const uuid = z.string().regex(new RegExp(npAuthUuidPattern, "u"));
const nullableId = id.nullable();
const tokens = z.custom<NpThemeTokensOverlay>(
  (v) => npAnalyzeThemeTokensOverlay(v).length === 0,
  "invalid theme token overlay",
);
// Preserve the existing block wire rather than introducing a second block schema.
const blockContent = z.custom<NpBlockContent>(
  (v) => npValidateBlockContent(v).ok,
  "invalid block content",
);
const navigationItems = z.custom<NpNavigationItems>(
  (v) => npAnalyzeNavigationItems(v).length === 0,
  "invalid navigation items",
);
const navigationLocation = text(63).refine(
  (v) => npAnalyzeNavigationLocation(v).length === 0,
  "invalid navigation location",
);
const shellFree = text(512).refine(
  (v) => /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9*][a-z0-9._*-]*$/u.test(v),
  "must be a typed argument, not shell syntax",
);
const previewRoot = ".nexpress/site/review/final";
const viewport = z.strictObject({
  width: z.number().int().min(240).max(7680),
  height: z.number().int().min(240).max(4320),
  deviceScaleFactor: z.union([z.literal(1), z.literal(2)]),
});
const viewports = z.strictObject({ desktop: viewport, mobile: viewport });
const previewChecks = z.tuple([
  z.literal("interaction-smoke"),
  z.literal("links"),
  z.literal("metadata"),
  z.literal("accessibility"),
  z.literal("overflow"),
]);
const previewRoute = z.strictObject({
  pageId: id,
  route,
  locale: locale.nullable(),
  audience: z.enum(["public", "member"]),
  fixtureIds: unique(id, 1000),
});
const issue = (ctx: z.RefinementCtx, path: (string | number)[], message: string) =>
  ctx.addIssue({ code: "custom", path, message });

export const briefSchema: z.ZodType<NpAgentSiteBriefV1> = z.strictObject({
  schemaVersion: z.literal("np.agent-site-brief.v1"),
  project: z.strictObject({
    name: label,
    summary: text(2000),
    primaryGoal: text(500),
    successSignals: strings(20),
  }),
  audience: unique(
    z.strictObject({ name: label, needs: strings(20), priority: z.enum(["primary", "secondary"]) }),
    20,
    (v) => v.name,
  ),
  content: unique(
    z.strictObject({
      name: label,
      purpose: text(500),
      author: z.enum(["staff", "member", "both"]),
      lifecycle: z.enum(["static", "editorial", "community"]),
      expectedVolume: z.enum(["small", "medium", "large"]),
    }),
    64,
    (v) => v.name,
  ),
  pages: unique(
    z.strictObject({
      name: label,
      purpose: text(500),
      priority: z.enum(["required", "recommended"]),
    }),
    200,
    (v) => v.name,
  ),
  features: strings(100),
  locales: unique(locale, 20),
  design: z.strictObject({
    adjectives: strings(20),
    avoid: strings(20),
    references: unique(z.strictObject({ label, url: httpsUrl.nullable() }), 20, (v) => v.label),
    accessibility: z.literal("AA"),
  }),
  operations: z.strictObject({
    target,
    expectedEditors: count,
    expectedMembers: count,
    agentOperation: z.boolean(),
  }),
  constraints: strings(100),
  assumptions: strings(100),
  unresolved: strings(100),
});
export const promptSchema: z.ZodType<NpAgentGeneratedMediaPromptV1> = z.strictObject({
  schemaVersion: z.literal("np.agent-generated-media-prompt.v1"),
  prompt: prose,
  avoid: strings(20, 200),
  aspectRatio: z.enum(["1:1", "4:3", "3:4", "16:9", "9:16"]),
  textPolicy: z.discriminatedUnion("kind", [
    z.strictObject({ kind: z.literal("none"), exactText: z.tuple([]) }),
    z.strictObject({ kind: z.literal("exact"), exactText: strings(20, 200).min(1) }),
  ]),
  referenceArtifactIds: sortedIds(20),
});
const mediaCommon = { mediaId: uuid, provenanceNote: prose, alt: text(500) };
const stagedCommon = {
  materialization: z.literal("staged"),
  stagedArtifactPath: under(".nexpress/site/media"),
  contentHash: fileDigest,
  mimeType: z.enum(["image/png", "image/webp", "image/jpeg", "image/gif", "image/avif"]),
  byteSize: z
    .number()
    .int()
    .min(1)
    .max(25 * 1024 * 1024),
};
const media = z.discriminatedUnion("kind", [
  z.strictObject({
    ...mediaCommon,
    ...stagedCommon,
    kind: z.literal("operator-supplied"),
    sourceArtifactId: id,
    rightsConfirmedBy: id,
  }),
  z.strictObject({
    ...mediaCommon,
    ...stagedCommon,
    kind: z.literal("generated"),
    generatorId: id,
    generationPrompt: promptSchema,
    promptDigest: digest,
    rightsNote: prose,
  }),
  z.strictObject({
    ...mediaCommon,
    kind: z.literal("licensed-reference"),
    materialization: z.literal("reference-only"),
    sourceUrl: httpsUrl,
    license: z.strictObject({ name: label, spdxId: id.nullable(), url: httpsUrl }),
    creator: label,
    attribution: prose,
    fetch: z.literal(false),
  }),
  z.strictObject({
    ...mediaCommon,
    kind: z.literal("placeholder"),
    materialization: z.literal("reference-only"),
    placeholderId: id,
  }),
]);
const collection = z
  .strictObject({
    id,
    action: z.enum(["reuse", "create", "update"]),
    slug,
    sourcePath,
    expectedSourceHash: fileDigest.nullable(),
    definition: jsonObject,
    definitionHash: digest,
    migrationClass: z.enum(["none", "additive", "rename", "destructive-review"]),
  })
  .superRefine((v, ctx) => {
    if ((v.action === "create") !== (v.expectedSourceHash === null))
      issue(
        ctx,
        ["expectedSourceHash"],
        "create requires absence; reuse/update require a source hash",
      );
    if (v.action === "reuse" && v.migrationClass !== "none")
      issue(ctx, ["migrationClass"], "reuse cannot introduce a migration");
  });
const pageCommon = {
  id,
  route,
  locale: locale.nullable(),
  audience: z.enum(["public", "member"]),
  blocks: blockContent,
};
const page = z.discriminatedUnion("source", [
  z.strictObject({
    ...pageCommon,
    source: z.literal("pattern"),
    patternId: id,
    patternOverrides: jsonObject,
    templateId: z.null(),
  }),
  z.strictObject({
    ...pageCommon,
    source: z.literal("custom"),
    patternId: z.null(),
    patternOverrides: z.null(),
    templateId: id,
  }),
]);
const fileCommon = {
  path: sourcePath,
  action: z.enum(["create", "update"]),
  owner: z.enum([
    "config",
    "collection",
    "theme",
    "page",
    "navigation",
    "plugin-config",
    "dependency",
    "seed",
    "generated-schema",
    "migration",
    "test",
    "docs",
  ]),
  expectedHash: fileDigest.nullable(),
  contentHash: fileDigest,
  rationale: prose,
};
const fileChange = z
  .discriminatedUnion("source", [
    z.strictObject({
      ...fileCommon,
      source: z.literal("staged"),
      stagedArtifactPath: under(".nexpress/site/files"),
      generatedByCommandId: z.null(),
    }),
    z.strictObject({
      ...fileCommon,
      source: z.literal("command"),
      stagedArtifactPath: z.null(),
      generatedByCommandId: id,
    }),
  ])
  .superRefine((v, ctx) => {
    if ((v.action === "create") !== (v.expectedHash === null))
      issue(ctx, ["expectedHash"], "create requires absence; update requires a source hash");
    if (v.source === "command" && v.owner !== "generated-schema" && v.owner !== "migration")
      issue(ctx, ["owner"], "command output must be schema or migration owned");
    if (v.source === "staged" && (v.owner === "generated-schema" || v.owner === "migration"))
      issue(ctx, ["source"], "generated schema and migrations must be command owned");
  });
const commandCommon = {
  id,
  cwd: z.literal("project"),
  prerequisites: sortedIds(32),
  timeoutSeconds: z.number().int().min(1).max(3600),
};
const filter = { workspaceFilter: shellFree.nullable() };
const command: z.ZodType<NpAgentBlueprintCommand> = z.discriminatedUnion("template", [
  z.strictObject({
    ...commandCommon,
    template: z.literal("format"),
    files: unique(sourcePath, 500).min(1),
  }),
  z.strictObject({ ...commandCommon, template: z.literal("schema-generate") }),
  z.strictObject({
    ...commandCommon,
    template: z.literal("migration-generate"),
    name: text(512).regex(/^[a-z][a-z0-9_-]*$/u),
  }),
  z.strictObject({ ...commandCommon, template: z.enum(["typecheck", "lint", "build"]), ...filter }),
  z.strictObject({
    ...commandCommon,
    template: z.literal("test"),
    ...filter,
    integration: z.boolean(),
  }),
  z.strictObject({
    ...commandCommon,
    template: z.literal("doctor"),
    production: z.boolean(),
    target: z.enum(["vercel", "railway", "render", "fly", "docker"]).nullable(),
  }),
  z.strictObject({ ...commandCommon, template: z.literal("verify") }),
  z.strictObject({
    ...commandCommon,
    template: z.literal("preview-render"),
    comparisonInputsDigest: digest,
    renderEnvironmentFingerprint: digest,
    routes: unique(previewRoute, 200, (v) => v.pageId).min(1),
    viewports,
    checks: previewChecks,
    artifacts: unique(
      z.discriminatedUnion("kind", [
        z.strictObject({
          kind: z.literal("screenshot"),
          pageId: id,
          viewport: z.enum(["desktop", "mobile"]),
          path: under(previewRoot),
        }),
        z.strictObject({ kind: z.literal("report"), path: under(previewRoot) }),
      ]),
      401,
      (v) => v.path,
    ),
    verificationResultPath: under(previewRoot),
  }),
]);
const checkCommon = { id, commandId: id, required: z.boolean() };
const check = z.discriminatedUnion("expected", [
  z.strictObject({
    ...checkCommon,
    expected: z.enum(["exit-zero", "no-diff"]),
    artifactPath: z.null(),
  }),
  z.strictObject({
    ...checkCommon,
    expected: z.literal("review-artifact"),
    artifactPath: under(".nexpress/site/review"),
  }),
]);
const document = z.strictObject({
  documentId: uuid,
  collection: slug,
  locale: locale.nullable(),
  translationGroupId: uuid.nullable(),
  dependsOnDocumentIds: unique(uuid, 1000).refine(
    (v) => v.every((s, i) => i === 0 || compareUtf8(v[i - 1], s) < 0),
    "dependencies must be sorted",
  ),
  data: jsonObject.refine((value) => {
    const hasRef = (node: unknown): boolean =>
      node !== null &&
      typeof node === "object" &&
      (Object.hasOwn(node, "$ref") || Object.values(node).some(hasRef));
    return !hasRef(value);
  }, "seed data must use allocated ids, never $ref substitutions"),
  provenance: z.literal("demo"),
});

function canonicalOrder<T>(
  items: T[],
  key: (v: T) => string,
  dependencies: (v: T) => string[],
  tie: (a: T, b: T) => number,
): boolean {
  const byId = new Map(items.map((v) => [key(v), v]));
  const pending = new Map<string, number>();
  const followers = new Map<string, string[]>();
  for (const item of items) {
    const itemId = key(item),
      edges = dependencies(item);
    pending.set(itemId, edges.length);
    for (const dependency of edges) {
      if (dependency === itemId || !byId.has(dependency)) return false;
      const targets = followers.get(dependency) ?? [];
      targets.push(itemId);
      followers.set(dependency, targets);
    }
  }
  const ready = items.filter((v) => pending.get(key(v)) === 0).sort(tie);
  for (const actual of items) {
    const next = ready.shift();
    if (!next || key(next) !== key(actual)) return false;
    for (const child of followers.get(key(next)) ?? []) {
      const remaining = pending.get(child)! - 1;
      pending.set(child, remaining);
      if (remaining === 0) ready.push(byId.get(child)!);
    }
    ready.sort(tie);
  }
  return true;
}
const collisionFree = (paths: string[]): boolean => {
  // Conservatively detect portable Unicode case aliases, including sharp-s/final sigma.
  const folded = paths.map((path) =>
    path.normalize("NFC").toUpperCase().toLowerCase().normalize("NFC"),
  );
  const all = new Set(folded);
  if (all.size !== paths.length) return false;
  for (const path of folded)
    for (let slash = path.indexOf("/"); slash >= 0; slash = path.indexOf("/", slash + 1))
      if (all.has(path.slice(0, slash))) return false;
  return true;
};

export const blueprintSchema: z.ZodType<NpAgentSiteBlueprintV1> = z
  .strictObject({
    schemaVersion: z.literal("np.agent-site-blueprint.v1"),
    briefHash: digest,
    directionSetHash: digest,
    selectedDirectionId: id,
    selectedDirectionHash: digest,
    selectedDirectionProjectionDigest: digest,
    discoveryFingerprint: fingerprint,
    framework: z.strictObject({
      nexpressVersion: text(128),
      nodeRange: text(128),
      pnpmVersion: text(128),
    }),
    theme: z.strictObject({ package: text(128), tokens }),
    collections: unique(collection, 64, (v) => v.id).refine(
      (v) => new Set(v.map((c) => c.slug)).size === v.length,
      "duplicate collection slug",
    ),
    pages: unique(page, 200, (v) => v.id).refine(
      (v) => new Set(v.map((p) => p.route)).size === v.length,
      "duplicate route",
    ),
    navigation: unique(
      z.strictObject({ location: navigationLocation, items: navigationItems }),
      32,
      (v) => v.location,
    ),
    plugins: unique(
      z.strictObject({
        source: z.literal("installed"),
        package: text(128),
        version: text(128),
        discoveryFingerprint: fingerprint,
        reason: prose,
        requiredCapabilities: unique(text(128), 128),
        configPlaceholders: unique(environmentName, 100),
      }),
      64,
      (v) => v.package,
    ),
    seed: z.strictObject({
      mode: z.enum(["none", "demo-fixtures"]),
      documents: unique(document, 1000, (v) => v.documentId),
      media: unique(media, 200, (v) => v.mediaId),
    }),
    deployment: z.strictObject({
      target,
      database: z.literal("postgres"),
      storage: z.enum(["local", "s3", "custom"]),
      workerRequired: z.boolean(),
      requiredEnvironment: unique(
        z.strictObject({
          name: environmentName,
          owner: z.enum(["nexpress", "platform", "adapter", "plugin"]),
          sourceId: nullableId,
        }),
        100,
        (v) => v.name,
      ),
      notes: strings(100, 4000),
    }),
    filePlan: unique(fileChange, 500, (v) => v.path),
    commandRegistryFingerprint: digest,
    commands: unique(command, 32, (v) => v.id),
    verification: unique(check, 64, (v) => v.id),
    risks: unique(
      z.strictObject({
        id,
        category: z.enum(["data", "auth", "content", "design", "operations", "dependency"]),
        severity: z.enum(["low", "medium", "high", "critical"]),
        summary: prose,
        mitigation: prose,
        blocking: z.boolean(),
      }),
      100,
      (v) => v.id,
    ),
  })
  .superRefine((v, ctx) => {
    if (
      !collisionFree(v.filePlan.map((f) => f.path)) ||
      !collisionFree(v.collections.map((c) => c.sourcePath))
    )
      issue(ctx, ["filePlan"], "paths must not alias or collide with parent files");
    if (v.seed.mode === "none" && (v.seed.documents.length || v.seed.media.length))
      issue(ctx, ["seed"], "none requires empty documents and media");
    if (
      !canonicalOrder(
        v.commands,
        (c) => c.id,
        (c) => c.prerequisites,
        (a, b) => compareUtf8(a.id, b.id),
      )
    )
      issue(
        ctx,
        ["commands"],
        "commands must resolve an acyclic graph in canonical topological order",
      );
    if (
      !canonicalOrder(
        v.seed.documents,
        (d) => d.documentId,
        (d) => d.dependsOnDocumentIds,
        (a, b) =>
          compareUtf8(a.collection, b.collection) || compareUtf8(a.documentId, b.documentId),
      )
    )
      issue(
        ctx,
        ["seed", "documents"],
        "documents must resolve an acyclic graph in canonical topological order",
      );
    const commandMap = new Map(v.commands.map((c) => [c.id, c]));
    for (const [i, c] of v.verification.entries())
      if (!commandMap.has(c.commandId))
        issue(ctx, ["verification", i], "unknown command reference");
    for (const [i, c] of v.commands.entries()) {
      const checks = v.verification.filter((check) => check.commandId === c.id && check.required);
      if (!checks.some((check) => check.expected === "exit-zero"))
        issue(ctx, ["commands", i], "every command requires an exit-zero check");
      if (
        ["format", "schema-generate", "migration-generate"].includes(c.template) &&
        !checks.some((check) => check.expected === "no-diff")
      )
        issue(ctx, ["commands", i], "source mutation requires a no-diff check");
      if (
        c.template === "format" &&
        c.files.some((p) => !v.filePlan.some((f) => f.path === p && f.source === "staged"))
      )
        issue(ctx, ["commands", i, "files"], "format paths must be staged file-plan members");
      if (
        c.template === "doctor" &&
        ((c.production && c.target !== v.deployment.target) || (!c.production && c.target !== null))
      )
        issue(ctx, ["commands", i, "target"], "doctor target must match the deployment mode");
      if (c.template === "preview-render") {
        const paths = [...c.artifacts.map((a) => a.path), c.verificationResultPath];
        const screenshots = c.artifacts.filter((a) => a.kind === "screenshot");
        if (
          !collisionFree(paths) ||
          c.artifacts.filter((a) => a.kind === "report").length !== 1 ||
          c.artifacts.length !== 2 * c.routes.length + 1 ||
          c.routes.some((r) =>
            ["desktop", "mobile"].some(
              (viewport) =>
                screenshots.filter((a) => a.pageId === r.pageId && a.viewport === viewport)
                  .length !== 1,
            ),
          ) ||
          screenshots.some((a) => !c.routes.some((r) => r.pageId === a.pageId))
        )
          issue(
            ctx,
            ["commands", i, "artifacts"],
            "preview requires two screenshots per route and one report with unique paths",
          );
        if (
          c.routes.length !== v.pages.length ||
          c.routes.some(
            (r) =>
              !v.pages.some(
                (p) =>
                  p.id === r.pageId &&
                  p.route === r.route &&
                  p.locale === r.locale &&
                  p.audience === r.audience,
              ),
          )
        )
          issue(
            ctx,
            ["commands", i, "routes"],
            "preview routes must map every blueprint page exactly",
          );
        const reviews = v.verification.filter(
          (check) => check.commandId === c.id && check.expected === "review-artifact",
        );
        if (
          reviews.length !== 1 ||
          !reviews[0].required ||
          reviews[0].artifactPath !== c.verificationResultPath
        )
          issue(ctx, ["commands", i], "preview requires one manifest review check");
      }
    }
    if (v.commands.filter((c) => c.template === "preview-render").length > 1)
      issue(ctx, ["commands"], "at most one preview command");
    for (const [i, f] of v.filePlan.entries())
      if (f.source === "command") {
        const c = commandMap.get(f.generatedByCommandId);
        if (
          c?.template !==
          (f.owner === "generated-schema" ? "schema-generate" : "migration-generate")
        )
          issue(ctx, ["filePlan", i], "generated file must reference its owning command template");
      }
    for (const [i, e] of v.deployment.requiredEnvironment.entries()) {
      if (e.owner === "nexpress" && (!e.name.startsWith("NP_") || e.sourceId !== null))
        issue(
          ctx,
          ["deployment", "requiredEnvironment", i],
          "NexPress environment names require NP_ and no source",
        );
      if ((e.owner === "plugin" || e.owner === "adapter") && e.sourceId === null)
        issue(
          ctx,
          ["deployment", "requiredEnvironment", i],
          "installed owner requires a source id",
        );
      if (e.owner === "platform" && e.sourceId !== null)
        issue(ctx, ["deployment", "requiredEnvironment", i], "platform names have no source id");
    }
  });

export const sourceTreeSchema: z.ZodType<NpAgentBuildSourceTreeV1> = z
  .strictObject({
    schemaVersion: z.literal("np.agent-build-source-tree.v1"),
    files: unique(
      z.strictObject({
        path: relativePath.refine(
          (v) => !npIsBuildSourcePathExcludedV1(v.toLowerCase()),
          "excluded tree member",
        ),
        kind: z.literal("file"),
        mode: z.enum(["100644", "100755"]),
        digest: fileDigest,
      }),
      10_000,
      (v) => v.path,
    ),
  })
  .superRefine((v, ctx) => {
    if (
      !collisionFree(v.files.map((f) => f.path)) ||
      v.files.some((f, i) => i > 0 && compareUtf8(v.files[i - 1].path, f.path) >= 0)
    )
      issue(ctx, ["files"], "source files must be collision-free and in UTF-8 byte order");
  });
const stream = z.strictObject({
  base64url: z
    .string()
    .max(Math.ceil((256 * 1024 * 4) / 3))
    .regex(/^[A-Za-z0-9_-]*$/u)
    .refine((v) => {
      if (v.length % 4 === 1) return false;
      const last = v.at(-1) ?? "A",
        alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
      return (
        (v.length % 4 !== 2 || (alphabet.indexOf(last) & 15) === 0) &&
        (v.length % 4 !== 3 || (alphabet.indexOf(last) & 3) === 0) &&
        Math.floor((v.length * 3) / 4) <= 256 * 1024
      );
    }, "must encode at most 256 KiB canonical unpadded base64url"),
  truncated: z.boolean(),
});
export const outputSchema: z.ZodType<NpAgentBuildCommandOutputV1> = z.strictObject({
  schemaVersion: z.literal("np.agent-build-command-output.v1"),
  stdout: stream,
  stderr: stream,
});
