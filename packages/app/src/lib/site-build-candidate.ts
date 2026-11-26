import { isProxy } from "node:util/types";
import { defineConfig, type NpConfig } from "@nexpress/core";
import { npRequireCollectionJsonValue } from "@nexpress/core/collection-contract";
import {
  npBuildCanonicalDigest,
  npBuildDirectionProjectionV1,
  npBuildInstalledCatalogDigestV1,
  npBuildInstalledBlockDefinitionFingerprintsV1,
  npProjectBuildCollectionDefinitionV1,
  npRequireAgentBuildCollectionDefinitionV1,
  npRequireAgentBuildDirectionRendererV1,
  npRequireAgentBuildInstalledCatalogV1,
  npRequireAgentBuildSourceTreeV1,
  npRequireAgentSiteBlueprintV1,
  npRequireBuildBlueprintForBriefV1,
  npRequireBuildDirectionSetForBriefV1,
  type NpAgentBuildCollectionDefinitionV1,
  type NpAgentBuildDirectionRendererV1,
  type NpAgentBuildInstalledCatalogV1,
  type NpAgentBuildSourceTreeV1,
  type NpAgentDesignDirectionDraftSetV1,
  type NpAgentSiteBlueprintV1,
} from "@nexpress/core/agent-contract";
import {
  defaultCollections,
  npGetDefaultBuildOwnerBindingsV1,
} from "@nexpress/app/config-defaults";
import type { npValidateConfiguredBuildBlueprintV1 } from "./site-build-blueprint.js";
import {
  npResolveConfiguredBuildCatalogV1,
  type NpSiteBuildOwnerBindingV1,
} from "./site-build-catalog.js";
import { npValidateConfiguredBuildDirectionSetV1 } from "./site-build-proposal.js";

type Validation = Awaited<ReturnType<typeof npValidateConfiguredBuildBlueprintV1>>;
type SourceFile = NpAgentBuildSourceTreeV1["files"][number];
type FileState = Pick<SourceFile, "mode" | "digest">;
const runtimeMetadataPath = ".np-build-runtime.json";

/** Opaque, process-local handle. It must be captured before importing project config. */
export interface NpSiteBuildCandidateOwnerCaptureV1 {
  readonly schemaVersion: "np.site-build-candidate-owner-capture.v1";
}
export interface NpSiteBuildCandidateCallbackOwnerV1 {
  slug: string;
  callbacks: string[];
  /** This is the App factory export owner, not invented Forum/Shop module provenance. */
  owner: "@nexpress/app/config-defaults.defaultCollections" | "source-capsule";
}
export interface NpSiteBuildCandidateBaselineV1 {
  schemaVersion: "np.site-build-candidate-baseline.v1";
  catalog: NpAgentBuildInstalledCatalogV1;
  fingerprint: string;
  blueprintHash: string;
  expectedCollectionDefinitions: NpAgentBuildCollectionDefinitionV1[];
  callbackOwners: NpSiteBuildCandidateCallbackOwnerV1[];
}
/**
 * Required data binding from the host-owned runtime-cache derivation. This is
 * NOT an execution/provenance token. The host must freshly observe metadata
 * bytes, validate their runtime/package/origin bindings and retain both live
 * cache leases. Matching rows alone cannot prove any of those filesystem facts.
 */
export interface NpSiteBuildCandidateRuntimeMetadataDerivationV1 {
  schemaVersion: "np.site-build-candidate-runtime-metadata-derivation.v1";
  owner: "np.site-build-runtime-reference.v1";
  path: ".np-build-runtime.json";
  before: { rendererFingerprint: string; sourceFile: SourceFile };
  after: { rendererFingerprint: string; sourceFile: SourceFile };
}
/**
 * DTO describing the host's independently observed render-profile source delta.
 * `originalSource` is FILTERED, never the original raw repository manifest. The
 * host separately retains/CAS-checks the complete raw original, applies the fixed
 * credential/agent-config/whole-site omissions and then adds only explicitly
 * observed fixture bytes. It EXCLUDES the fixed runtime-owned metadata file,
 * which is bound separately below and remains in both complete renderers. The
 * host must check the full raw delta against the file plan before supplying this
 * DTO. This constructor cannot attest those I/O facts. All other filtered
 * original rows must equal the baseline renderer; build-derived authored source
 * snapshots cannot replace original file-plan preconditions.
 */
export interface NpSiteBuildCandidateSourceDeltaV1 {
  schemaVersion: "np.site-build-candidate-source-delta.v1";
  scope: "render-profile-filtered";
  originalSource: NpAgentBuildSourceTreeV1;
  baselineRendererFingerprint: string;
  candidateRendererFingerprint: string;
  runtimeMetadata: NpSiteBuildCandidateRuntimeMetadataDerivationV1;
  changes: Array<{ path: string; before: FileState | null; after: FileState }>;
}

interface GraphNode {
  value: object;
  prototype: object | null;
  properties: Array<{ key: PropertyKey; descriptor: PropertyDescriptor }>;
}
interface Captured {
  renderer: NpAgentBuildDirectionRendererV1;
  rendererFingerprint: string;
  bindings: NpSiteBuildOwnerBindingV1[];
  graph: GraphNode[];
  collections: Map<
    string,
    { definition: NpAgentBuildCollectionDefinitionV1; callbacks: Map<string, unknown> }
  >;
}
const captures = new WeakMap<NpSiteBuildCandidateOwnerCaptureV1, Captured>();
const compare = (left: string, right: string) =>
  Buffer.compare(Buffer.from(left), Buffer.from(right));
function fail(message: string): never {
  throw new Error(`Invalid configured Build candidate: ${message}`);
}
// Only detached owner-validated JSON reaches this comparison.
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort(compare)
      .map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? fail("unsupported declaration value");
}
function equal(left: unknown, right: unknown): boolean {
  return canonical(left) === canonical(right);
}
function record(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    isProxy(value) ||
    ![null, Object.prototype].includes(Object.getPrototypeOf(value))
  )
    fail("expected an own-data record");
  const actual = Reflect.ownKeys(value);
  if (actual.some((key) => typeof key !== "string") || !equal([...actual].sort(), [...keys].sort()))
    fail("record fields do not match the exact profile");
  const result: Record<string, unknown> = Object.create(null);
  for (const key of keys) {
    const entry = Object.getOwnPropertyDescriptor(value, key);
    if (!entry || !("value" in entry) || !entry.enumerable)
      fail("record requires own data properties");
    result[key] = entry.value;
  }
  return result;
}
function list(value: unknown, maximum: number): unknown[] {
  if (
    !Array.isArray(value) ||
    isProxy(value) ||
    value.length > maximum ||
    Reflect.ownKeys(value).length !== value.length + 1
  )
    fail("inventory must be a bounded dense array");
  return Array.from({ length: value.length }, (_, index) => {
    const entry = Object.getOwnPropertyDescriptor(value, String(index));
    if (!entry || !("value" in entry) || !entry.enumerable)
      fail("inventory requires own data items");
    return entry.value;
  });
}
function requireRenderProfile(source: NpAgentBuildSourceTreeV1): void {
  let fixtures = 0;
  for (const { path } of source.files) {
    if (
      path
        .split("/")
        .some((name) =>
          /^(?:\.git|\.env(?:\..*)?|\.npmrc|\.netrc|\.pnpmfile\..*|\.aws|\.ssh|\.codex|\.claude|\.agents|id_rsa|id_ed25519|.*\.(?:pem|key|p12|pfx))$/iu.test(
            name,
          ),
        )
    )
      fail("render-profile manifest contains an omitted credential or agent-config path");
    if (
      /^\.nexpress\/site(?:\/|$)/iu.test(path) &&
      (!/^\.nexpress\/site\/fixtures\/[A-Za-z0-9][A-Za-z0-9._-]{0,127}\.json$/u.test(path) ||
        ++fixtures > 200)
    )
      fail("render-profile site inputs require the bounded explicit fixture inventory");
  }
}

/**
 * Snapshot only the finite configured declaration graph. Function bodies,
 * prototypes and arbitrary module/package graphs are not walked. Callable
 * identity is preserved; this is not a proof of arbitrary closure/global state.
 */
function snapshot(
  roots: readonly unknown[],
  accessorOwners: "pristine" | readonly GraphNode[],
): GraphNode[] {
  const graph: GraphNode[] = [],
    seen = new Set<object>();
  let properties = 0;
  const visit = (value: unknown, depth: number): void => {
    if ((typeof value !== "object" || value === null) && typeof value !== "function") return;
    if (isProxy(value)) fail("proxy declarations are unsupported");
    if (seen.has(value)) return;
    if (depth > 24 || seen.size >= 50_000) fail("declaration graph exceeds its bound");
    seen.add(value);
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Reflect.ownKeys(descriptors);
    if (keys.length > 2048 || (properties += keys.length) > 100_000)
      fail("declaration properties exceed their bound");
    const entries = keys.map((key) => {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor) fail("declaration property disappeared");
      if (!("value" in descriptor) && accessorOwners !== "pristine") {
        const known = accessorOwners
          .find((node) => node.value === value)
          ?.properties.find((entry) => entry.key === key)?.descriptor;
        if (!known || known.get !== descriptor.get || known.set !== descriptor.set)
          fail("accessor declarations are unsupported");
      }
      return { key, descriptor };
    });
    graph.push({ value, prototype: Object.getPrototypeOf(value), properties: entries });
    // Function bodies/closures/prototypes stay opaque. Own static data such as
    // React defaultProps is still part of the bounded declaration graph.
    entries.forEach((entry) => {
      if (typeof value === "function" && entry.key === "prototype") return;
      if ("value" in entry.descriptor) visit(entry.descriptor.value, depth + 1);
    });
  };
  roots.forEach((root) => visit(root, 0));
  return graph;
}
function assertGraph(graph: readonly GraphNode[]): void {
  for (const node of graph) {
    if (isProxy(node.value) || Object.getPrototypeOf(node.value) !== node.prototype)
      fail("captured declaration graph changed");
    const keys = Reflect.ownKeys(node.value);
    if (
      keys.length !== node.properties.length ||
      keys.some((key, index) => key !== node.properties[index].key)
    )
      fail("captured declaration properties changed");
    for (const { key, descriptor: before } of node.properties) {
      const after = Object.getOwnPropertyDescriptor(node.value, key);
      if (
        !after ||
        "value" in after !== "value" in before ||
        after.enumerable !== before.enumerable ||
        after.configurable !== before.configurable ||
        after.writable !== before.writable ||
        !Object.is(after.value, before.value) ||
        after.get !== before.get ||
        after.set !== before.set
      )
        fail("captured static declaration or executable identity changed");
    }
  }
}
function captured(handle: NpSiteBuildCandidateOwnerCaptureV1): Captured {
  const value = captures.get(handle);
  if (!value) fail("a capture from this process before config loading is required");
  assertGraph(value.graph);
  return value;
}
function pointer(value: unknown, path: string): unknown {
  for (const token of path.slice(1).split("/")) {
    if ((typeof value !== "object" || value === null) && typeof value !== "function")
      fail("callback slot disappeared");
    if (isProxy(value)) fail("proxy callback declarations are unsupported");
    const entry = Object.getOwnPropertyDescriptor(value, token);
    if (!entry || !("value" in entry)) fail("callback slot is not an own data property");
    value = entry.value;
  }
  return value;
}
function collectionOwners(
  config: NpConfig,
  owner: Captured,
): NpSiteBuildCandidateCallbackOwnerV1[] {
  return config.collections
    .map((collection) => {
      const definition = npProjectBuildCollectionDefinitionV1(
        collection,
        owner.rendererFingerprint,
      );
      if (!definition.callbacks.length) return null;
      const pristine = owner.collections.get(collection.slug);
      const exact =
        pristine &&
        // defineConfig appends actual theme-required static fields. Those are
        // checked by the complete expected-definition comparison, while the
        // package callback slots and original export graph remain exact.
        equal(definition.callbacks, pristine.definition.callbacks) &&
        definition.callbacks.every(
          (path) => pointer(collection, path) === pristine.callbacks.get(path),
        );
      return {
        slug: collection.slug,
        callbacks: [...definition.callbacks],
        owner: exact
          ? ("@nexpress/app/config-defaults.defaultCollections" as const)
          : ("source-capsule" as const),
      };
    })
    .filter((row): row is NpSiteBuildCandidateCallbackOwnerV1 => row !== null)
    .sort((left, right) => compare(left.slug, right.slug));
}

/**
 * Trusted isolated-worker API, never an authored JSON permission claim. Call
 * BEFORE importing project config in each fresh worker. It captures the exact
 * shipped App defaults, including Forum/Shop factory collections, and the
 * existing theme/plugin/route owner paths. It performs no bootstrap or I/O.
 */
export async function npCaptureDefaultBuildCandidateOwnersV1(
  rendererValue: unknown,
): Promise<NpSiteBuildCandidateOwnerCaptureV1> {
  const renderer = npRequireAgentBuildDirectionRendererV1(rendererValue);
  const rendererFingerprint = await npBuildCanonicalDigest(
    "np.build-direction-renderer.v1",
    renderer,
  );
  if (renderer.packages.filter((entry) => entry.name === "@nexpress/app").length !== 1)
    fail("default collection capture requires one observed App package");
  const bindings = npGetDefaultBuildOwnerBindingsV1();
  const roots = [
    defaultCollections,
    ...bindings.flatMap((binding) => [binding.value, ...(binding.routes ?? [])]),
  ];
  const graph = snapshot(roots, "pristine");
  const collections: Captured["collections"] = new Map();
  for (const collection of defaultCollections) {
    const definition = npProjectBuildCollectionDefinitionV1(collection, rendererFingerprint);
    if (collections.has(collection.slug)) fail("default collection exports are ambiguous");
    collections.set(collection.slug, {
      definition,
      callbacks: new Map(definition.callbacks.map((path) => [path, pointer(collection, path)])),
    });
  }
  assertGraph(graph);
  const handle = Object.freeze({
    schemaVersion: "np.site-build-candidate-owner-capture.v1" as const,
  });
  captures.set(handle, { renderer, rendererFingerprint, bindings, graph, collections });
  return handle;
}

/**
 * Produce a transport record only from the actual baseline validator result in
 * the trusted worker. The host must authenticate this record's origin. Parsing
 * or hashing it later cannot establish that it came from a native execution.
 */
export async function npObserveConfiguredBuildCandidateBaselineV1(input: {
  capture: NpSiteBuildCandidateOwnerCaptureV1;
  config: unknown;
  validation: Validation;
}): Promise<NpSiteBuildCandidateBaselineV1> {
  const owner = captured(input.capture);
  const configGraph = snapshot([input.config], owner.graph); // No new accessor/proxy may run in defineConfig.
  const config = defineConfig(input.config as NpConfig);
  const validation = record(input.validation, [
    "scope",
    "catalog",
    "fingerprint",
    "blueprint",
    "blueprintHash",
    "expectedCollectionDefinitions",
  ]);
  const blueprint = npRequireAgentSiteBlueprintV1(validation.blueprint);
  const actual = await npResolveConfiguredBuildCatalogV1(config, owner.renderer, owner.bindings);
  const catalog = npRequireAgentBuildInstalledCatalogV1(validation.catalog);
  if (!equal(catalog, actual.catalog) || validation.fingerprint !== actual.fingerprint)
    fail("baseline validator must bind the actual captured config and renderer");
  const blueprintHash = await npBuildCanonicalDigest("np.build-site-blueprint.v1", blueprint);
  if (blueprintHash !== validation.blueprintHash || validation.scope !== "declarations-only")
    fail("baseline validation must retain its exact blueprint binding");
  const definitions = list(validation.expectedCollectionDefinitions, 64).map(
    npRequireAgentBuildCollectionDefinitionV1,
  );
  if (definitions.length > 64) fail("expected collection inventory exceeds its bound");
  // Recheck the validator's actual complete expectation, including unchanged
  // collections omitted from blueprint.collections and static planned additions.
  if (!equal(expectedForPlan(catalog, blueprint), definitions))
    fail("baseline expected definitions do not match the complete validated collection plan");
  const result: NpSiteBuildCandidateBaselineV1 = {
    schemaVersion: "np.site-build-candidate-baseline.v1",
    catalog,
    fingerprint: actual.fingerprint,
    blueprintHash,
    expectedCollectionDefinitions: definitions,
    callbackOwners: collectionOwners(config, owner),
  };
  assertGraph(configGraph);
  captured(input.capture);
  return result;
}
function bySlug(
  left: NpAgentBuildCollectionDefinitionV1,
  right: NpAgentBuildCollectionDefinitionV1,
): number {
  if (typeof left.configuration.slug !== "string" || typeof right.configuration.slug !== "string")
    fail("collection definitions require canonical slugs");
  return compare(left.configuration.slug, right.configuration.slug);
}
function expectedForPlan(
  catalog: NpAgentBuildInstalledCatalogV1,
  blueprint: NpAgentSiteBlueprintV1,
): NpAgentBuildCollectionDefinitionV1[] {
  const expected = new Map(catalog.collections.map((entry) => [entry.configuration.slug, entry]));
  for (const plan of blueprint.collections) {
    const current = expected.get(plan.slug);
    if (plan.action === "reuse") {
      if (!current || !equal(current, plan.definition)) fail("reused baseline definition changed");
      continue;
    }
    if ((plan.action === "create") === Boolean(current))
      fail("baseline collection action is inconsistent");
    if (
      !equal(current ?? null, plan.definition) &&
      (current?.callbacks.length || plan.definition.callbacks.length)
    )
      fail("changed callback authoring is unsupported");
    expected.set(plan.slug, plan.definition);
  }
  return [...expected.values()].sort(bySlug);
}

function requireRuntimeMetadata(value: unknown): NpSiteBuildCandidateRuntimeMetadataDerivationV1 {
  const body = record(value, ["schemaVersion", "owner", "path", "before", "after"]);
  if (
    body.schemaVersion !== "np.site-build-candidate-runtime-metadata-derivation.v1" ||
    body.owner !== "np.site-build-runtime-reference.v1" ||
    body.path !== runtimeMetadataPath
  )
    fail("runtime metadata requires its exact fixed derivation profile");
  const side = (value: unknown) => {
    const fields = record(value, ["rendererFingerprint", "sourceFile"]);
    if (typeof fields.rendererFingerprint !== "string" || fields.rendererFingerprint.length > 128)
      fail("runtime metadata requires an exact renderer binding");
    const row = record(fields.sourceFile, ["path", "kind", "mode", "digest"]);
    if (row.path !== runtimeMetadataPath || row.kind !== "file" || row.mode !== "100644")
      fail("only the fixed non-executable runtime metadata row may be derived");
    const sourceFile = npRequireAgentBuildSourceTreeV1({
      schemaVersion: "np.agent-build-source-tree.v1",
      files: [{ path: row.path, kind: row.kind, mode: row.mode, digest: row.digest }],
    }).files[0];
    return { rendererFingerprint: fields.rendererFingerprint, sourceFile };
  };
  return {
    schemaVersion: "np.site-build-candidate-runtime-metadata-derivation.v1",
    owner: "np.site-build-runtime-reference.v1",
    path: runtimeMetadataPath,
    before: side(body.before),
    after: side(body.after),
  };
}

function requireDelta(value: unknown): NpSiteBuildCandidateSourceDeltaV1 {
  const json = record(value, [
    "baselineRendererFingerprint",
    "candidateRendererFingerprint",
    "changes",
    "originalSource",
    "runtimeMetadata",
    "schemaVersion",
    "scope",
  ]);
  if (
    json.schemaVersion !== "np.site-build-candidate-source-delta.v1" ||
    json.scope !== "render-profile-filtered"
  )
    fail("source delta must use the exact bounded v1 profile");
  // The exact changes are compared with freshly parsed renderer manifests below;
  // no claim, extra field or chosen path can expand that inventory.
  return {
    schemaVersion: "np.site-build-candidate-source-delta.v1",
    scope: "render-profile-filtered",
    originalSource: npRequireAgentBuildSourceTreeV1(json.originalSource),
    runtimeMetadata: requireRuntimeMetadata(json.runtimeMetadata),
    baselineRendererFingerprint:
      typeof json.baselineRendererFingerprint === "string" &&
      json.baselineRendererFingerprint.length <= 128
        ? json.baselineRendererFingerprint
        : fail("invalid baseline renderer binding"),
    candidateRendererFingerprint:
      typeof json.candidateRendererFingerprint === "string" &&
      json.candidateRendererFingerprint.length <= 128
        ? json.candidateRendererFingerprint
        : fail("invalid candidate renderer binding"),
    changes: list(json.changes, 500).map((value) => {
      const row = record(value, ["path", "before", "after"]);
      const state = (value: unknown): FileState => {
        const fields = record(value, ["mode", "digest"]);
        if (
          (fields.mode !== "100644" && fields.mode !== "100755") ||
          typeof fields.digest !== "string" ||
          fields.digest.length > 128
        )
          fail("invalid source file state");
        return { mode: fields.mode, digest: fields.digest };
      };
      if (typeof row.path !== "string" || row.path.length > 512) fail("invalid source delta path");
      return {
        path: row.path,
        before: row.before === null ? null : state(row.before),
        after: state(row.after),
      };
    }),
  };
}

/**
 * Validate freshly loaded post-apply declarations. This does not apply files,
 * run a schema/migration, save seeds, authenticate screenshots or authorize any
 * user action. Native/host source and installed-package leases remain mandatory.
 * Source-changing custom callbacks and changed default components are unsupported.
 */
export async function npValidateConfiguredBuildCandidateV1(input: {
  baseline: NpSiteBuildCandidateBaselineV1;
  capture: NpSiteBuildCandidateOwnerCaptureV1;
  config: unknown;
  renderer: unknown;
  brief: unknown;
  sealedDirections: unknown;
  blueprint: unknown;
  sourceDelta: unknown;
}) {
  const owner = captured(input.capture);
  const renderer = npRequireAgentBuildDirectionRendererV1(input.renderer);
  if (!equal(renderer, owner.renderer))
    fail("candidate capture must bind its actual current renderer");
  const baselineValue = record(input.baseline, [
    "blueprintHash",
    "callbackOwners",
    "catalog",
    "expectedCollectionDefinitions",
    "fingerprint",
    "schemaVersion",
  ]);
  if (baselineValue.schemaVersion !== "np.site-build-candidate-baseline.v1")
    fail("baseline requires the exact observed record");
  const baseline = npRequireAgentBuildInstalledCatalogV1(baselineValue.catalog);
  requireRenderProfile(baseline.sourceCapsule.projectSources);
  requireRenderProfile(renderer.projectSources);
  const baselineFingerprint = await npBuildInstalledCatalogDigestV1(baseline);
  if (baselineValue.fingerprint !== baselineFingerprint)
    fail("baseline catalog fingerprint is inconsistent");
  const blueprint = await npRequireBuildBlueprintForBriefV1(input.brief, input.blueprint);
  if (blueprint.filePlan.some((row) => row.path === runtimeMetadataPath))
    fail("runtime-owned metadata cannot be an authored file-plan target");
  const blueprintHash = await npBuildCanonicalDigest("np.build-site-blueprint.v1", blueprint);
  if (
    blueprintHash !== baselineValue.blueprintHash ||
    blueprint.discoveryFingerprint !== baselineFingerprint
  )
    fail("candidate must retain the exact baseline-validated blueprint");
  const set = await npRequireBuildDirectionSetForBriefV1(
    input.brief,
    input.sealedDirections,
    "sealed",
  );
  const selected = set.directions.find((entry) => entry.id === blueprint.selectedDirectionId);
  if (
    !selected ||
    set.discoveryFingerprint !== baselineFingerprint ||
    blueprint.directionSetHash !==
      (await npBuildCanonicalDigest("np.build-design-direction-set.v1", set)) ||
    blueprint.selectedDirectionHash !==
      (await npBuildCanonicalDigest("np.build-design-direction.v1", selected)) ||
    blueprint.selectedDirectionProjectionDigest !== selected.projectionDigest
  )
    fail("candidate selection must retain the original sealed baseline evidence");
  if (!equal(baseline.sourceCapsule.packages, renderer.packages))
    fail("all observed installed package instances must remain exactly equal");
  const baselineRendererFingerprint = await npBuildCanonicalDigest(
    "np.build-direction-renderer.v1",
    baseline.sourceCapsule,
  );
  const delta = requireDelta(input.sourceDelta);
  const originalWithoutMetadata = {
    ...baseline.sourceCapsule.projectSources,
    files: baseline.sourceCapsule.projectSources.files.filter(
      (row) => row.path !== runtimeMetadataPath,
    ),
  };
  if (
    delta.baselineRendererFingerprint !== baselineRendererFingerprint ||
    delta.candidateRendererFingerprint !== owner.rendererFingerprint ||
    !equal(delta.originalSource, originalWithoutMetadata)
  )
    fail(
      "original source and baseline renderer must match; build-derived baselines are unsupported",
    );
  const before = new Map(
    baseline.sourceCapsule.projectSources.files.map((file) => [file.path, file]),
  );
  const after = new Map(renderer.projectSources.files.map((file) => [file.path, file]));
  if (
    !before.has(runtimeMetadataPath) ||
    !after.has(runtimeMetadataPath) ||
    delta.runtimeMetadata.before.rendererFingerprint !== baselineRendererFingerprint ||
    delta.runtimeMetadata.after.rendererFingerprint !== owner.rendererFingerprint ||
    !equal(delta.runtimeMetadata.before.sourceFile, before.get(runtimeMetadataPath)) ||
    !equal(delta.runtimeMetadata.after.sourceFile, after.get(runtimeMetadataPath))
  )
    fail("runtime metadata derivation must bind both exact complete renderer rows");
  const changes: NpSiteBuildCandidateSourceDeltaV1["changes"] = [];
  for (const path of [...new Set([...before.keys(), ...after.keys()])].sort(compare)) {
    // Only this fixed, separately bound host derivation is outside the raw plan.
    // Its row is retained in the renderer/callback/catalog fingerprints above.
    if (path === runtimeMetadataPath) continue;
    const prior = before.get(path),
      current = after.get(path);
    if (equal(prior ?? null, current ?? null)) continue;
    if (!current) fail("unplanned source removal is unsupported");
    changes.push({
      path,
      before: prior ? { mode: prior.mode, digest: prior.digest } : null,
      after: { mode: current.mode, digest: current.digest },
    });
  }
  if (
    changes.length &&
    delta.runtimeMetadata.before.sourceFile.digest === delta.runtimeMetadata.after.sourceFile.digest
  )
    fail("changed authored source requires freshly derived runtime metadata");
  if (!equal(changes, delta.changes) || changes.length !== blueprint.filePlan.length)
    fail("complete source delta must exactly equal the blueprint file plan");
  for (const change of changes) {
    const plan = blueprint.filePlan.find((entry) => entry.path === change.path);
    if (
      !plan ||
      plan.expectedHash !== (change.before?.digest ?? null) ||
      plan.contentHash !== change.after.digest ||
      plan.action !== (change.before ? "update" : "create") ||
      change.after.mode !== (change.before?.mode ?? "100644")
    )
      fail("source action, raw hash and preserved mode must match the exact planned delta");
  }
  const configGraph = snapshot([input.config], owner.graph);
  const config = defineConfig(input.config as NpConfig);
  const current = await npResolveConfiguredBuildCatalogV1(config, renderer, owner.bindings);
  const expectedDefinitions = list(baselineValue.expectedCollectionDefinitions, 64).map(
    npRequireAgentBuildCollectionDefinitionV1,
  );
  if (!equal(expectedForPlan(baseline, blueprint), expectedDefinitions))
    fail("baseline expected inventory must retain the exact validated collection plan");
  const rebound = expectedDefinitions.map((definition) => ({
    ...definition,
    sourceCapsuleDigest: definition.callbacks.length ? owner.rendererFingerprint : null,
  }));
  if (!equal(current.catalog.collections, rebound))
    fail(
      "actual candidate collection registration and definitions must equal the complete expectation",
    );
  const actualOwners = collectionOwners(config, owner);
  const baselineOwners = list(baselineValue.callbackOwners, 64).map((row) =>
    npRequireCollectionJsonValue(row),
  );
  if (!equal(actualOwners, baselineOwners)) fail("callback executable ownership changed");
  if (
    baselineRendererFingerprint !== owner.rendererFingerprint &&
    actualOwners.some((row) => row.owner === "source-capsule")
  )
    fail("source-changing custom callback rebinding is unsupported");
  const {
    sourceCapsule: _baselineSource,
    collections: _baselineCollections,
    ...baselineInstalled
  } = baseline;
  const {
    sourceCapsule: _currentSource,
    collections: _currentCollections,
    ...currentInstalled
  } = current.catalog;
  if (!equal(baselineInstalled, currentInstalled))
    fail("installed themes, plugins, locales and declaration owners must remain unchanged");
  // New internal draft for CURRENT catalog validation. Never relabel old preview
  // artifacts, sealed directions or the original blueprint as current evidence.
  const comparisonInputs = structuredClone(set.comparisonInputs);
  comparisonInputs.projectionInputs.discoveryFingerprint = current.fingerprint;
  comparisonInputs.projectionInputs.blockDefinitionFingerprints = [
    ...new Set(
      (await npBuildInstalledBlockDefinitionFingerprintsV1(current.catalog))
        .filter((entry) =>
          comparisonInputs.projectionInputs.themeBaseIds.includes(entry.themePackage),
        )
        .map((entry) => entry.fingerprint),
    ),
  ].sort(compare);
  const comparisonInputsDigest = await npBuildCanonicalDigest(
    "np.build-design-comparison-inputs.v1",
    comparisonInputs,
  );
  const directions = set.directions.map((direction) => ({
    ...npBuildDirectionProjectionV1(direction),
    schemaVersion: "np.agent-design-direction-draft.v1" as const,
    discoveryFingerprint: current.fingerprint,
    comparisonInputsDigest,
  })) as NpAgentDesignDirectionDraftSetV1["directions"];
  const candidateDraft: NpAgentDesignDirectionDraftSetV1 = {
    schemaVersion: "np.agent-design-direction-draft-set.v1",
    briefHash: set.briefHash,
    comparisonInputs,
    comparisonInputsDigest,
    discoveryFingerprint: current.fingerprint,
    directions,
  };
  const actualDirection = await npValidateConfiguredBuildDirectionSetV1(
    config,
    renderer,
    owner.bindings,
    input.brief,
    candidateDraft,
    "draft",
  );
  assertGraph(configGraph);
  captured(input.capture);
  return {
    scope: "post-apply-declarations-only" as const,
    baselineDiscoveryFingerprint: baselineFingerprint,
    currentDiscoveryFingerprint: current.fingerprint,
    baselineRendererFingerprint,
    currentRendererFingerprint: owner.rendererFingerprint,
    blueprintHash,
    sourceValidationScope: "host-observed-render-profile-manifests" as const,
    originalRawSourceCas: "required-from-host" as const,
    runtimeMetadataDerivation: delta.runtimeMetadata,
    runtimeMetadataObservation: "host-live-byte-owner-required" as const,
    catalog: current.catalog,
    actualCollectionDefinitions: current.catalog.collections,
    callbackOwners: actualOwners,
    candidateDraft: actualDirection.set,
    selectedDirectionId: selected.id,
    // The exact actual schemas/callbacks equal those already used by the baseline
    // validator for this unchanged seed. No ACL/hook or persistence was executed.
    seedValidation: "exact-actual-definitions-match-validated-baseline" as const,
    runtimeEvidence: "unverified" as const,
  };
}
