import { z } from "zod";
import { npAnalyzeCollectionDefinition } from "../config/collection-definition-contract.js";
import type { NpAgentJsonObject, NpAgentJsonValue } from "../agent-contract/types.js";
import { requireArtifact } from "./artifact.js";
import { compareUtf8, digest, fail, jsonObject, text, unique } from "./primitives.js";

/** Source-bound projection, not a serialized executable or a replacement collection config. */
export interface NpAgentBuildCollectionDefinitionV1 extends NpAgentJsonObject {
  schemaVersion: "np.agent-build-collection-definition.v1";
  configuration: NpAgentJsonObject;
  callbacks: string[];
  sourceCapsuleDigest: string | null;
}

const index = "(?:0|[1-9][0-9]*)";
const callbackPointer = new RegExp(
  `^/(?:access/(?:create|read|update|delete)|hooks/(?:beforeCreate|afterCreate|beforeUpdate|afterUpdate|beforeDelete|afterDelete|beforeRead|afterRead)/${index}|seo/urlPath|community/memberWrite/(?:access/(?:create|update|delete)|resolveCreateStatus)|fields/${index}(?:/fields/${index})*/(?:validate|admin/condition))$`,
  "u",
);
const callback = text(512).refine(
  (value) => callbackPointer.test(value),
  "must address an owning collection callback slot",
);
const limits = Object.freeze({ bytes: 1024 * 1024, depth: 16 });

function validationOnlyConfiguration(value: NpAgentBuildCollectionDefinitionV1): unknown {
  const configuration = structuredClone(value.configuration);
  for (const pointer of value.callbacks) {
    const parts = pointer.slice(1).split("/");
    let container: unknown = configuration;
    for (const part of parts.slice(0, -1)) {
      if (container === null || typeof container !== "object" || !Object.hasOwn(container, part))
        fail("build.collection.callbacks", "callback path must exist in configuration");
      container = Reflect.get(container, part);
    }
    const key = parts.at(-1)!;
    if (
      container === null ||
      typeof container !== "object" ||
      !Object.hasOwn(container, key) ||
      Reflect.get(container, key) !== null
    )
      fail("build.collection.callbacks", "callback slot must contain an exact null placeholder");
    Object.defineProperty(container, key, {
      configurable: true,
      enumerable: true,
      writable: true,
      value: () => {
        throw new Error("Build definition validation cannot invoke callbacks");
      },
    });
  }
  // The private validation copy contains sentinels only. It is never returned or executed.
  return configuration;
}

const schema: z.ZodType<NpAgentBuildCollectionDefinitionV1> = z
  .strictObject({
    schemaVersion: z.literal("np.agent-build-collection-definition.v1"),
    configuration: jsonObject,
    callbacks: unique(callback, 1024).refine(
      (items) => items.every((item, i) => i === 0 || compareUtf8(items[i - 1], item) < 0),
      "must be in UTF-8 order",
    ),
    sourceCapsuleDigest: digest.nullable(),
  })
  .superRefine((value, ctx) => {
    if ((value.callbacks.length === 0) !== (value.sourceCapsuleDigest === null))
      ctx.addIssue({
        code: "custom",
        message: "callback bindings require one exact source capsule; pure data has no capsule",
      });
    try {
      if (npAnalyzeCollectionDefinition(validationOnlyConfiguration(value)).length)
        ctx.addIssue({
          code: "custom",
          message: "must satisfy the actual collection authoring contract",
        });
    } catch {
      ctx.addIssue({ code: "custom", message: "invalid collection callback bindings" });
    }
  });

export function npRequireAgentBuildCollectionDefinitionV1(
  value: unknown,
): NpAgentBuildCollectionDefinitionV1 {
  return requireArtifact(value, schema, limits);
}

/**
 * Host projection of an observed definition. Callback identity is bound to a
 * freshly observed module/package capsule, never Function.toString or dropped
 * ACL/hook properties. The caller must recompute it from installed source;
 * an input digest alone establishes no module provenance or authority.
 */
export function npProjectBuildCollectionDefinitionV1(
  configuration: unknown,
  sourceCapsuleDigest: string,
): NpAgentBuildCollectionDefinitionV1 {
  if (!digest.safeParse(sourceCapsuleDigest).success)
    fail("build.collection.source", "invalid source capsule digest");
  const callbacks: string[] = [];
  const ancestors = new Set<object>();
  let nodes = 0;
  function visit(value: unknown, pointer: string, depth: number): NpAgentJsonValue {
    if (++nodes > 50_000 || depth > 14)
      fail("build.collection.configuration", "definition exceeds bounded traversal");
    if (typeof value === "function") {
      if (!callbackPointer.test(pointer))
        fail("build.collection.callback", "function outside a supported authoring callback slot");
      callbacks.push(pointer);
      return null;
    }
    if (value === null || typeof value === "boolean") return value;
    if (typeof value === "string") {
      if (value.length > 512 * 1024) fail("build.collection.configuration", "string is too large");
      return value;
    }
    if (
      typeof value === "number" &&
      Number.isFinite(value) &&
      (!Number.isInteger(value) || Number.isSafeInteger(value))
    )
      return value;
    if (typeof value !== "object" || ancestors.has(value))
      fail("build.collection.configuration", "unsupported or cyclic authoring value");
    if (!Array.isArray(value) && ![Object.prototype, null].includes(Object.getPrototypeOf(value)))
      fail("build.collection.configuration", "authoring values must be plain data");
    if (Object.getOwnPropertySymbols(value).length)
      fail("build.collection.configuration", "symbol keys are unsupported");
    ancestors.add(value);
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const result: NpAgentJsonValue[] | NpAgentJsonObject = Array.isArray(value) ? [] : {};
    if (
      Array.isArray(value) &&
      (value.length > 10_000 ||
        Object.keys(value).length !== value.length ||
        Array.from({ length: value.length }, (_, index) => String(index)).some(
          (key) => !Object.hasOwn(value, key),
        ))
    )
      fail("build.collection.configuration", "sparse or oversized arrays are unsupported");
    for (const [key, descriptor] of Object.entries(descriptors)) {
      if (Array.isArray(value) && key === "length") continue;
      if (!descriptor.enumerable || !("value" in descriptor))
        fail(
          "build.collection.configuration",
          "accessors and hidden authoring properties are unsupported",
        );
      // Optional authoring properties normalize undefined to absence; array holes never do.
      if (descriptor.value === undefined && !Array.isArray(value)) continue;
      const escaped = key.replaceAll("~", "~0").replaceAll("/", "~1");
      Object.defineProperty(result, key, {
        enumerable: true,
        configurable: true,
        writable: true,
        value: visit(descriptor.value, `${pointer}/${escaped}`, depth + 1),
      });
    }
    ancestors.delete(value);
    return result;
  }
  const projected = visit(configuration, "", 0);
  callbacks.sort(compareUtf8);
  return npRequireAgentBuildCollectionDefinitionV1({
    schemaVersion: "np.agent-build-collection-definition.v1",
    configuration: projected,
    callbacks,
    sourceCapsuleDigest: callbacks.length ? sourceCapsuleDigest : null,
  });
}
