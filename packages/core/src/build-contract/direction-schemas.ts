import { z } from "zod";
import { blockContent, tokens, viewport, viewports, collisionFree } from "./schemas.js";
import {
  compareUtf8,
  digest,
  fileDigest,
  fingerprint,
  id,
  jsonObject,
  locale,
  route,
  sortedIds,
  strings,
  text,
  under,
  unique,
} from "./primitives.js";
import type {
  NpAgentDesignComparisonInputsV1,
  NpAgentDesignDirectionProjectionV1,
  NpAgentDesignDirectionV1,
  NpAgentDesignDirectionDraftV1,
  NpAgentDesignDirectionSetV1,
  NpAgentDesignDirectionDraftSetV1,
  NpAgentDirectionRenderSourceV1,
  NpAgentDirectionRenderReceiptBodyV1,
  NpAgentDirectionRenderReceiptRecordV1,
} from "./direction-types.js";

const sorted = <T>(
  schema: z.ZodType<T>,
  max: number,
  key: (value: T) => string = (value) => String(value),
) =>
  unique(schema, max, key).refine(
    (items) => items.every((item, i) => i === 0 || compareUtf8(key(items[i - 1]), key(item)) < 0),
    "must be sorted by UTF-8 bytes",
  );
const timestamp = z
  .string()
  .refine(
    (value) =>
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value) &&
      Number.isFinite(Date.parse(value)) &&
      new Date(value).toISOString() === value,
    "must be canonical UTC time",
  );
const output = z.strictObject({
  relativePath: under(".nexpress/site/review/directions"),
  digest: fileDigest,
  mime: z.enum(["image/png", "image/webp"]),
  bytes: z
    .number()
    .int()
    .min(1)
    .max(10 * 1024 * 1024),
});
const previewRef = z
  .strictObject({
    ...output.shape,
    id,
    viewport,
    directionId: id,
    pageIds: sortedIds(6).min(1),
    directionProjectionDigest: digest,
    rendererFingerprint: digest,
    renderReceiptId: id,
    renderReceiptDigest: digest,
    comparisonInputsDigest: digest,
    createdAt: timestamp,
    expiresAt: timestamp.nullable(),
  })
  .superRefine((value, ctx) => {
    if (value.expiresAt !== null && value.expiresAt <= value.createdAt)
      ctx.addIssue({ code: "custom", path: ["expiresAt"], message: "must be later than creation" });
    if (!value.relativePath.endsWith(value.mime === "image/png" ? ".png" : ".webp"))
      ctx.addIssue({
        code: "custom",
        path: ["relativePath"],
        message: "extension must match MIME",
      });
  });

export const comparisonSchema: z.ZodType<NpAgentDesignComparisonInputsV1> = z
  .strictObject({
    schemaVersion: z.literal("np.agent-design-comparison-inputs.v1"),
    briefHash: digest,
    informationArchitecture: unique(
      z.strictObject({
        pageId: id,
        route,
        purpose: text(2000),
        audience: z.enum(["public", "member"]),
        locale: locale.nullable(),
        fixtureIds: sortedIds(1000),
      }),
      200,
      (page) => page.pageId,
    ).min(1),
    sampleContent: unique(
      z.strictObject({
        id,
        pageId: id,
        locale: locale.nullable(),
        label: text(128),
        data: jsonObject,
      }),
      1000,
      (sample) => sample.id,
    ),
    previewPageIds: sortedIds(6).min(1),
    projectionInputs: z.strictObject({
      discoveryFingerprint: fingerprint,
      themeBaseIds: sorted(text(128), 64).min(1),
      patternIds: sorted(id, 1000),
      templateIds: sorted(id, 200),
      blockDefinitionFingerprints: sorted(fingerprint, 1000),
    }),
    viewports,
  })
  .superRefine((value, ctx) => {
    const pages = new Map(value.informationArchitecture.map((page) => [page.pageId, page]));
    const samples = new Map(value.sampleContent.map((sample) => [sample.id, sample]));
    const issue = (message: string) => ctx.addIssue({ code: "custom", message });
    if (new Set(value.informationArchitecture.map((page) => page.route)).size !== pages.size)
      issue("routes must be unique");
    if (value.previewPageIds.some((pageId) => !pages.has(pageId)))
      issue("preview pages must belong to IA");
    for (const page of value.informationArchitecture) {
      for (const sampleId of page.fixtureIds) {
        const sample = samples.get(sampleId);
        if (!sample || sample.pageId !== page.pageId || sample.locale !== page.locale)
          issue("fixture must belong to its exact IA page and locale");
      }
    }
    for (const sample of value.sampleContent) {
      const page = pages.get(sample.pageId);
      if (!page || page.locale !== sample.locale || !page.fixtureIds.includes(sample.id))
        issue("sample must resolve to a referencing IA page and locale");
    }
  });

const binding = z.discriminatedUnion("source", [
  z.strictObject({
    pageId: id,
    source: z.literal("pattern"),
    patternId: id,
    overrides: jsonObject,
    templateId: z.null(),
    blocks: blockContent,
  }),
  z.strictObject({
    pageId: id,
    source: z.literal("custom"),
    patternId: z.null(),
    overrides: z.null(),
    templateId: id,
    blocks: blockContent,
  }),
]);
const projectionFields = {
  id,
  name: text(128),
  rationale: text(2000),
  themeBase: text(128),
  tokens,
  typography: z.strictObject({ heading: text(128), body: text(128), mono: text(128).nullable() }),
  layout: z.strictObject({
    density: z.enum(["theme-native", "compact", "comfortable", "spacious"]),
    contentWidth: text(128),
    navigation: text(128),
  }),
  pageBindings: sorted(binding, 200, (page) => page.pageId).min(1),
  tradeoffs: strings(20, 2000),
  comparisonInputsDigest: digest,
  discoveryFingerprint: fingerprint,
};
export const projectionSchema: z.ZodType<NpAgentDesignDirectionProjectionV1> = z.strictObject({
  schemaVersion: z.literal("np.agent-design-direction.v1"),
  ...projectionFields,
});
export const directionSchema: z.ZodType<NpAgentDesignDirectionV1> = z.strictObject({
  schemaVersion: z.literal("np.agent-design-direction.v1"),
  ...projectionFields,
  projectionDigest: digest,
  previewArtifact: z.strictObject({ desktop: previewRef, mobile: previewRef }),
});
export const draftDirectionSchema: z.ZodType<NpAgentDesignDirectionDraftV1> = z.strictObject({
  schemaVersion: z.literal("np.agent-design-direction-draft.v1"),
  ...projectionFields,
});

function setIssues(
  value: NpAgentDesignDirectionSetV1 | NpAgentDesignDirectionDraftSetV1,
  ctx: z.RefinementCtx,
): void {
  const comparison = value.comparisonInputs;
  const issue = (message: string) => ctx.addIssue({ code: "custom", message });
  if (
    value.briefHash !== comparison.briefHash ||
    value.discoveryFingerprint !== comparison.projectionInputs.discoveryFingerprint
  )
    issue("embedded brief and catalog must match");
  if (new Set(value.directions.map((direction) => direction.id)).size !== 3)
    issue("must contain three unique direction ids");
  const artifactIds = new Set<string>(),
    paths: string[] = [],
    receiptIds = new Set<string>();
  for (const direction of value.directions) {
    if (
      direction.comparisonInputsDigest !== value.comparisonInputsDigest ||
      direction.discoveryFingerprint !== value.discoveryFingerprint
    )
      issue("directions must share exact comparison and discovery");
    if (!comparison.projectionInputs.themeBaseIds.includes(direction.themeBase))
      issue("theme must belong to declared inventory");
    const bindingIds = new Set(direction.pageBindings.map((page) => page.pageId));
    if (
      bindingIds.size !== comparison.informationArchitecture.length ||
      comparison.informationArchitecture.some((page) => !bindingIds.has(page.pageId))
    )
      issue("bindings must cover exact IA");
    for (const page of direction.pageBindings) {
      if (
        page.source === "pattern"
          ? !comparison.projectionInputs.patternIds.includes(page.patternId)
          : !comparison.projectionInputs.templateIds.includes(page.templateId)
      )
        issue("binding must belong to declared pattern/template inventory");
    }
    if (!("previewArtifact" in direction)) continue;
    for (const name of ["desktop", "mobile"] as const) {
      const ref = direction.previewArtifact[name];
      if (artifactIds.has(ref.id) || receiptIds.has(ref.renderReceiptId))
        issue("preview ids, paths and receipts must be unique across the set");
      artifactIds.add(ref.id);
      paths.push(ref.relativePath);
      receiptIds.add(ref.renderReceiptId);
      if (
        ref.directionId !== direction.id ||
        ref.directionProjectionDigest !== direction.projectionDigest ||
        ref.comparisonInputsDigest !== value.comparisonInputsDigest
      )
        issue("preview must bind its exact direction and comparison");
      const expectedViewport = comparison.viewports[name];
      if (
        ref.viewport.width !== expectedViewport.width ||
        ref.viewport.height !== expectedViewport.height ||
        ref.viewport.deviceScaleFactor !== expectedViewport.deviceScaleFactor
      )
        issue("preview viewport must match comparison");
      if (ref.pageIds.join("\0") !== comparison.previewPageIds.join("\0"))
        issue("montage pages must match the shared ordered preview pages");
    }
  }
  if (!collisionFree(paths)) issue("preview paths must not alias or collide with parent files");
}
const setFields = {
  briefHash: digest,
  comparisonInputs: comparisonSchema,
  comparisonInputsDigest: digest,
  discoveryFingerprint: fingerprint,
};
export const directionSetSchema: z.ZodType<NpAgentDesignDirectionSetV1> = z
  .strictObject({
    schemaVersion: z.literal("np.agent-design-direction-set.v1"),
    ...setFields,
    directions: z.tuple([directionSchema, directionSchema, directionSchema]),
  })
  .superRefine(setIssues);
export const draftSetSchema: z.ZodType<NpAgentDesignDirectionDraftSetV1> = z
  .strictObject({
    schemaVersion: z.literal("np.agent-design-direction-draft-set.v1"),
    ...setFields,
    directions: z.tuple([draftDirectionSchema, draftDirectionSchema, draftDirectionSchema]),
  })
  .superRefine(setIssues);

const sourceFields = {
  comparisonInputsDigest: digest,
  directionId: id,
  directionProjectionDigest: digest,
  viewportName: z.enum(["desktop", "mobile"]),
  viewport,
  orderedPageIds: sortedIds(6).min(1),
  sourceTreeDigest: digest,
  rendererFingerprint: digest,
  renderEnvironmentFingerprint: digest,
};
export const renderSourceSchema: z.ZodType<NpAgentDirectionRenderSourceV1> = z
  .strictObject({
    schemaVersion: z.literal("np.agent-direction-render-source.v1"),
    briefHash: digest,
    ...sourceFields,
    directionProjection: projectionSchema,
  })
  .superRefine((value, ctx) => {
    if (
      value.directionProjection.id !== value.directionId ||
      value.directionProjection.comparisonInputsDigest !== value.comparisonInputsDigest
    )
      ctx.addIssue({ code: "custom", message: "source must bind its exact projection" });
    if (
      value.orderedPageIds.some(
        (id) => !value.directionProjection.pageBindings.some((binding) => binding.pageId === id),
      )
    )
      ctx.addIssue({ code: "custom", message: "render pages must belong to projection" });
  });
export const renderReceiptSchema: z.ZodType<NpAgentDirectionRenderReceiptBodyV1> = z.strictObject({
  schemaVersion: z.literal("np.agent-direction-render-receipt.v1"),
  ...sourceFields,
  renderSourceDigest: digest,
  output,
});
export const renderReceiptRecordSchema: z.ZodType<NpAgentDirectionRenderReceiptRecordV1> =
  z.strictObject({
    schemaVersion: z.literal("np.agent-direction-render-receipt-record.v1"),
    id,
    body: renderReceiptSchema,
    digest,
    observedAt: timestamp,
  });
