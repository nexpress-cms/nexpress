# Build Agent and Site Blueprint

> Status: proposed build-plane contract.
> This workflow changes a normal repository; it is not a Runtime Agent
> capability and cannot mutate a live production schema.
> Baseline: `9b1c04e8927e195b8e8e23c7b1261756067ee25f` (2026-07-24).

The Build Agent closes the activation gap between "describe a site" and "own a
working NexPress repository." It uses existing collections, themes, blocks,
patterns, content generation, schema codegen, tests, and deploy planning rather
than introducing an opaque hosted page format.

## 1. Product outcome

A user can provide a short goal such as:

> Build a Korean developer community with editorial articles, multiple forum
> boards, member profiles, a dense portal home, and a restrained dark theme.

The workflow returns:

- a confirmed Site Brief;
- exactly three comparable design directions;
- a selected, exact Site Blueprint;
- a normal generated NexPress repository;
- collection/schema and migration evidence;
- representative content and media placeholders;
- desktop/mobile previews;
- verification results;
- Git/PR and deployment handoff.

The result remains understandable and editable without the generating agent.

## 2. Goals

- Reach a meaningful local preview from a prompt without hiding NexPress
  architecture.
- Generate only through versioned collection, block, pattern, navigation,
  theme-token, plugin, and scaffold contracts.
- Keep design exploration visual while keeping the final output deterministic.
- Separate product decisions in the brief from implementation decisions in the
  blueprint.
- Make every file change reviewable and every command explicit.
- Reuse the same official skill with Codex, Claude Code, Cursor, or another
  repository-capable agent.

## 3. Non-goals

- A freeform Framer/Figma-equivalent canvas.
- Runtime creation of database collections or migrations.
- Generating arbitrary unaudited packages, plugins, server routes, auth,
  payments, or network integrations from one prompt.
- Applying a production migration or deployment automatically.
- Storing provider credentials in the generated repository.
- Depending on a NexPress-hosted backend after project generation.
- Guaranteeing unique visual design from unrestricted generated CSS/JS.

## 4. Artifacts

### 4.0 Canonical build bytes and digests

Build-plane hashes use one implementation that is deliberately separate from
the runtime control-plane `np.agent-canonical-json.v1` helper. For a structured
value, `npBuildCanonicalDigest(purpose, value)`:

1. validates the exact bounded plain-JSON contract and rejects duplicate raw
   keys, prototypes/accessors, cycles/shared references, unsafe/non-finite
   numbers, lone surrogates, and unknown fields;
2. serializes RFC 8785 JCS bytes, preserving Unicode code points without
   normalization, then encodes UTF-8 without BOM;
3. hashes
   `utf8("np.build-canonical-json.v1\0" + purpose + "\0") || jcsBytes`
   with SHA-256; and
4. returns `nb1:sha256:<43-character-unpadded-base64url>`.

`purpose` is selected by the owning schema, never supplied by a blueprint or
agent. The exact v1 structured-purpose registry has 16 entries:

```ts
export const npBuildCanonicalPurposes = [
  "np.build-site-brief.v1",
  "np.build-design-comparison-inputs.v1",
  "np.build-design-direction-projection.v1",
  "np.build-design-direction.v1",
  "np.build-design-direction-set.v1",
  "np.build-site-blueprint.v1",
  "np.build-collection-definition.v1",
  "np.build-generated-media-prompt.v1",
  "np.build-command-registry.v1",
  "np.build-direction-renderer.v1",
  "np.build-render-environment.v1",
  "np.build-direction-render-source.v1",
  "np.build-direction-render-receipt.v1",
  "np.build-command-output.v1",
  "np.build-verification-result.v1",
  "np.build-source-tree.v1",
] as const;
```

Raw regular-file bytes use
`npBuildFileDigest(purpose, bytes) = SHA-256(prefix || u64be(bytes.length) ||
bytes)`, where `prefix` is
`utf8("np.build-file.v1\0" + purpose + "\0")`. Its encoded result is
`nb1:file-sha256:<43-character-unpadded-base64url>`. The exact v1 file-purpose
registry has four entries:

```ts
export const npBuildFilePurposes = [
  "np.build-source-file.v1",
  "np.build-staged-artifact.v1",
  "np.build-preview-artifact.v1",
  "np.build-verification-artifact.v1",
] as const;
```

Source trees are represented before hashing by this exact contract:

```ts
export interface NpAgentBuildSourceTreeV1 {
  schemaVersion: "np.agent-build-source-tree.v1";
  files: Array<{
    path: string;
    kind: "file";
    mode: "100644" | "100755";
    digest: string;
  }>;
}
```

Paths are unique relative POSIX paths sorted by their UTF-8 bytes. Each member
digest uses `np.build-source-file.v1`; directories are implicit, only the
executable bit is retained, and timestamps, owners, inode values, and host
path separators never enter the bytes. Symlinks, hard-link aliases, devices,
sockets, path escapes, case-fold collisions, and files changing during the
read fail validation. V1 excludes `.git/`, `.nexpress/site/review/`,
`.nexpress/site/tmp/`, `.nexpress/site/audit/`, and any directory component
exactly equal to `node_modules`, `dist`, `.next`, `.turbo`, or `coverage`.
The command-registry version owns that closed exclusion list. The source-tree
digest is the structured digest of this manifest with
`np.build-source-tree.v1`.

The field mapping is normative:

| Field                                                                                               | Exact input and purpose                                                                                                     |
| --------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| every `briefHash`                                                                                   | complete `NpAgentSiteBriefV1`; `np.build-site-brief.v1`                                                                     |
| every `comparisonInputsDigest`                                                                      | complete comparison input; `np.build-design-comparison-inputs.v1`                                                           |
| every `projectionDigest`/`selectedDirectionProjectionDigest`                                        | exact resolved direction projection, excluding preview refs and the digest field; `np.build-design-direction-projection.v1` |
| `selectedDirectionHash`                                                                             | complete selected direction; `np.build-design-direction.v1`                                                                 |
| `directionSetHash`                                                                                  | complete direction set; `np.build-design-direction-set.v1`                                                                  |
| acknowledged/result `blueprintHash`                                                                 | complete blueprint, which has no self-hash field; `np.build-site-blueprint.v1`                                              |
| collection `definitionHash`                                                                         | exact validated definition; `np.build-collection-definition.v1`                                                             |
| generated-media `promptDigest`                                                                      | exact bounded prompt envelope, never raw freeform bytes; `np.build-generated-media-prompt.v1`                               |
| `commandRegistryFingerprint`                                                                        | exact executable/template/exclusion registry; `np.build-command-registry.v1`                                                |
| direction `rendererFingerprint`                                                                     | exact renderer package/content inventory; `np.build-direction-renderer.v1`                                                  |
| `renderEnvironmentFingerprint`                                                                      | exact frozen browser/font/time/random environment object; `np.build-render-environment.v1`                                  |
| render source/`renderReceiptDigest`                                                                 | complete named source/receipt body; their same-named structured purposes                                                    |
| command `outputDigest`                                                                              | exact bounded `NpAgentBuildCommandOutputV1`; `np.build-command-output.v1`                                                   |
| verification `manifestDigest`                                                                       | complete result excluding `manifestDigest`; `np.build-verification-result.v1`                                               |
| receipt source tree, `baselineTreeDigest`, `finalSourceDigest`                                      | exact source-tree manifest; `np.build-source-tree.v1`                                                                       |
| collection/file-plan `expectedSourceHash`/`expectedHash` and file-plan `contentHash`                | raw current/final project file; `np.build-source-file.v1`                                                                   |
| staged seed-media `contentHash`                                                                     | raw staged media; `np.build-staged-artifact.v1`                                                                             |
| direction preview `digest`                                                                          | canonicalized raw image; `np.build-preview-artifact.v1`                                                                     |
| verification screenshot/report `digest`                                                             | raw observed file; `np.build-verification-artifact.v1`                                                                      |
| `discoveryFingerprint`, block-definition fingerprints, and installed-package integrity/fingerprints | their already versioned owning NexPress/package contracts; they are validated, not wrapped in a second build hash           |

`NpAgentBuildCommandOutputV1` contains schema version, separately captured
bounded stdout/stderr as unpadded base64url raw bytes, and a truncation boolean
for each stream; no terminal color conversion or newline rewriting occurs.
Each stream retains at most 256 KiB, with truncation represented in the hashed
object. Build digests are local integrity/precondition values, not signatures
or proof that a different OS principal approved the content.

Core/CLI fixtures publish the canonical bytes and expected digest for every
purpose, plus raw-file and tree vectors covering empty/binary/CRLF files,
executable mode, Unicode paths, ordering, excluded roots, and rejected link or
case-collision inputs. Adding/reassigning a purpose, changing an excluded
root, or changing hash input membership is a versioned contract change.

### 4.1 Site Brief

The brief captures product intent without code/file details.

```ts
export interface NpAgentSiteBriefV1 {
  schemaVersion: "np.agent-site-brief.v1";
  project: {
    name: string;
    summary: string;
    primaryGoal: string;
    successSignals: string[];
  };
  audience: Array<{
    name: string;
    needs: string[];
    priority: "primary" | "secondary";
  }>;
  content: Array<{
    name: string;
    purpose: string;
    author: "staff" | "member" | "both";
    lifecycle: "static" | "editorial" | "community";
    expectedVolume: "small" | "medium" | "large";
  }>;
  pages: Array<{
    name: string;
    purpose: string;
    priority: "required" | "recommended";
  }>;
  features: string[];
  locales: string[];
  design: {
    adjectives: string[];
    avoid: string[];
    references: Array<{ label: string; url: string | null }>;
    accessibility: "AA";
  };
  operations: {
    target: "local" | "vercel" | "railway" | "render" | "fly" | "docker";
    expectedEditors: number | null;
    expectedMembers: number | null;
    agentOperation: boolean;
  };
  constraints: string[];
  assumptions: string[];
  unresolved: string[];
}
```

Rules:

- closed and bounded;
- references are inspiration, not content to copy;
- unconfirmed assumptions remain explicit;
- credentials, personal data, raw source content, and generated code are
  forbidden;
- the brief must have no unresolved item that changes the data model,
  authentication audience, public/member authoring model, locale strategy, or
  deployment/storage requirements before blueprint generation.

The exact brief bounds are: 20 audiences, 64 content types, 200 pages, 100
features, 20 locales, 20 design adjectives/avoid items/references, and 100
constraints/assumptions/unresolved items. A needs/signal list has at most 20
items. Names are at most 120 characters, goals/needs/items 500, and prose
summaries 2,000. Reference URLs are null or canonical HTTPS URLs of at most
2,048 characters and carry no credential; they are untrusted citations, not
fetch instructions. The full brief is at most 512 KiB and depth 8.

### 4.2 Design Direction

Each of the three directions uses the same information architecture and sample
content so the user compares visual systems rather than different products.

```ts
export interface NpAgentPreviewViewportV1 {
  width: number;
  height: number;
  deviceScaleFactor: 1 | 2;
}

export interface NpAgentPreviewArtifactRefV1 {
  id: string;
  relativePath: string;
  digest: string;
  mime: "image/png" | "image/webp";
  bytes: number;
  viewport: NpAgentPreviewViewportV1;
  directionId: string;
  pageIds: string[];
  directionProjectionDigest: string;
  rendererFingerprint: string;
  renderReceiptId: string;
  renderReceiptDigest: string;
  comparisonInputsDigest: string;
  createdAt: string;
  expiresAt: string | null;
}

export interface NpAgentDesignComparisonInputsV1 {
  schemaVersion: "np.agent-design-comparison-inputs.v1";
  briefHash: string;
  informationArchitecture: Array<{
    pageId: string;
    route: string;
    purpose: string;
    audience: "public" | "member";
    locale: string | null;
    fixtureIds: string[];
  }>;
  sampleContent: Array<{
    id: string;
    pageId: string;
    locale: string | null;
    label: string;
    data: NpAgentJsonObject;
  }>;
  previewPageIds: string[];
  projectionInputs: {
    discoveryFingerprint: string;
    themeBaseIds: string[];
    patternIds: string[];
    templateIds: string[];
    blockDefinitionFingerprints: string[];
  };
  viewports: {
    desktop: NpAgentPreviewViewportV1;
    mobile: NpAgentPreviewViewportV1;
  };
}

export type NpAgentDesignPageBindingV1 =
  | {
      pageId: string;
      source: "pattern";
      patternId: string;
      overrides: NpAgentJsonObject;
      templateId: null;
      blocks: NpBlockContent;
    }
  | {
      pageId: string;
      source: "custom";
      patternId: null;
      overrides: null;
      templateId: string;
      blocks: NpBlockContent;
    };

export interface NpAgentDesignDirectionV1 {
  schemaVersion: "np.agent-design-direction.v1";
  id: string;
  name: string;
  rationale: string;
  themeBase: string;
  tokens: NpThemeTokensOverlay;
  typography: { heading: string; body: string; mono: string | null };
  layout: {
    density: "compact" | "comfortable" | "spacious";
    contentWidth: string;
    navigation: string;
  };
  pageBindings: NpAgentDesignPageBindingV1[];
  previewArtifact: {
    desktop: NpAgentPreviewArtifactRefV1;
    mobile: NpAgentPreviewArtifactRefV1;
  };
  tradeoffs: string[];
  comparisonInputsDigest: string;
  discoveryFingerprint: string;
  projectionDigest: string;
}

export interface NpAgentDesignDirectionSetV1 {
  schemaVersion: "np.agent-design-direction-set.v1";
  briefHash: string;
  comparisonInputs: NpAgentDesignComparisonInputsV1;
  comparisonInputsDigest: string;
  discoveryFingerprint: string;
  directions: [NpAgentDesignDirectionV1, NpAgentDesignDirectionV1, NpAgentDesignDirectionV1];
}

export type NpAgentDesignDirectionDraftV1 = Omit<
  NpAgentDesignDirectionV1,
  "schemaVersion" | "previewArtifact" | "projectionDigest"
> & {
  schemaVersion: "np.agent-design-direction-draft.v1";
};

export interface NpAgentDesignDirectionDraftSetV1 {
  schemaVersion: "np.agent-design-direction-draft-set.v1";
  briefHash: string;
  comparisonInputs: NpAgentDesignComparisonInputsV1;
  comparisonInputsDigest: string;
  discoveryFingerprint: string;
  directions: [
    NpAgentDesignDirectionDraftV1,
    NpAgentDesignDirectionDraftV1,
    NpAgentDesignDirectionDraftV1,
  ];
}

export interface NpAgentDirectionRenderSourceV1 {
  schemaVersion: "np.agent-direction-render-source.v1";
  briefHash: string;
  comparisonInputsDigest: string;
  directionId: string;
  directionProjection: NpAgentJsonObject;
  directionProjectionDigest: string;
  viewportName: "desktop" | "mobile";
  viewport: NpAgentPreviewViewportV1;
  orderedPageIds: string[];
  sourceTreeDigest: string;
  rendererFingerprint: string;
  renderEnvironmentFingerprint: string;
}

export interface NpAgentDirectionRenderReceiptBodyV1 {
  schemaVersion: "np.agent-direction-render-receipt.v1";
  renderSourceDigest: string;
  directionId: string;
  directionProjectionDigest: string;
  comparisonInputsDigest: string;
  viewportName: "desktop" | "mobile";
  viewport: NpAgentPreviewViewportV1;
  orderedPageIds: string[];
  sourceTreeDigest: string;
  rendererFingerprint: string;
  renderEnvironmentFingerprint: string;
  output: {
    relativePath: string;
    digest: string;
    mime: "image/png" | "image/webp";
    bytes: number;
  };
}

export interface NpAgentDirectionRenderReceiptRecordV1 {
  schemaVersion: "np.agent-direction-render-receipt-record.v1";
  id: string;
  body: NpAgentDirectionRenderReceiptBodyV1;
  digest: string;
  observedAt: string;
}
```

Directions may select different bundled themes or token/pattern compositions,
but all values must pass the live discovery/theme/block contracts. Generated
preview images are evidence; the exact tokens/pattern selections are the source
of truth.

Only the set artifact can establish comparability. Its analyzer requires
exactly three unique direction ids in stored order. It reparses the embedded
comparison input, recomputes `comparisonInputsDigest`, and requires the set,
all three directions, and all six preview refs to carry that byte-equal digest.
Top-level/embedded brief and discovery fingerprints must also match. An
isolated direction is not valid blueprint-selection evidence.

Comparison input has at most 200 unique page ids/routes and 1,000 unique
sample fixtures. Every `fixtureId` and sample `pageId` resolves exactly; every
direction binding uses `pageId` from that same information architecture, never
an ambiguous display name. Projection inventories are sorted unique members of
the frozen discovery catalog. Every direction has exactly one page binding per
information-architecture page id. Pattern bindings reparse overrides and
store the exact resolved blocks; custom bindings store the exact template and
blocks with null pattern/overrides. Sample JSON uses the shared bounds,
contains representative non-PII fixtures only, and the complete comparison
input is at most 1 MiB/depth 10. Each direction has at most 200 page bindings and 20
tradeoffs; names/ids/package/typeface fields are at most 128 characters and
rationale/tradeoff prose 2,000. One canonical direction is at most 1 MiB and
depth 12; the complete set is at most 4 MiB and depth 13.
`previewPageIds` contains 1–6 sorted unique information-architecture page ids
and is identical for all directions. Each desktop/mobile artifact is a
registry-generated montage of those exact pages in that order and viewport;
it is not evidence for unlisted pages, whose structural comparability remains
covered by the page-binding contract and final full-route verification.

Each information-architecture route is canonical for its explicit nullable
locale: null means the project's default-locale route and a non-null value must
be in the brief locale inventory and match the route's live locale prefix.
The final preview command copies page id, route, locale, audience, and fixture
ids byte-for-byte from this array; it never derives locale from sample content
or browser defaults.

Preview refs point only to regular non-symlink files under
`.nexpress/site/review/directions/`; each is `1..10 MiB`, has a canonical
`np.build-preview-artifact.v1` digest, and its declared MIME must match sniffed bytes. Artifact ids
are write-once within the local build audit registry. Validation rereads and
hashes the bytes and requires the exact corresponding
`comparisonInputs.viewports` value and comparison digest; an overwrite,
missing/expired artifact, digest/size/MIME mismatch, or reused id with
different metadata invalidates the set. The canonical direction/set hashes
bind all comparison bytes, preview metadata, and digests, so reviewed pixels
cannot silently change under the same selection hash.

`projectionDigest` is computed over the canonical direction fields excluding
`previewArtifact` and `projectionDigest` itself. Before sealing the set, the
CLI-owned direction renderer resolves that projection plus comparison
fixtures, renders every `previewPageId`, and appends the exact source, receipt
body, and local receipt record above. `renderSourceDigest` and
`renderReceiptDigest` use their named build purposes; `observedAt` and the
registry locator `id` are outside the receipt digest. Every preview ref must
match one record/body/digest and recomputed source digest; receipt reuse across
directions or renderer/source mismatch is invalid.

The record is a cache and diagnostic locator, not a signature or provenance
claim. `direction validate` always reruns the same renderer in a fresh
egress-closed temporary environment, canonicalizes the output image, and
byte-compares it with all six stored montage files before accepting a set. It
also recomputes every source/receipt/file digest from the current pinned
renderer and frozen inputs. A missing renderer, sandbox/fingerprint mismatch,
non-deterministic output, caller-written image, or receipt-only match fails;
there is no receipt-only/offline-success mode. This protects against stale or
forged repository artifacts while the CLI and its package/OS integrity remain
the local trusted computing base. It does not claim to defeat a malicious
process with the same ability to replace the running CLI itself.

`overrides` is the shared depth/node/byte-bounded JSON object, not arbitrary
runtime data. The selected pattern and every referenced block definition
reparse it with their exact live prop schemas and must resolve to the stored
`blocks`; unknown keys, unavailable pattern/template/block ids, or different
resolved bytes invalidate the direction before preview.

### 4.3 Site Blueprint

The blueprint is the complete generation plan.

```ts
export interface NpAgentBlueprintCollection {
  id: string;
  action: "reuse" | "create" | "update";
  slug: string;
  sourcePath: string;
  expectedSourceHash: string | null;
  definition: NpAgentJsonObject;
  definitionHash: string;
  migrationClass: "none" | "additive" | "rename" | "destructive-review";
}

export interface NpAgentBlueprintPage {
  id: string;
  route: string;
  locale: string | null;
  audience: "public" | "member";
  source: "pattern" | "custom";
  patternId: string | null;
  patternOverrides: NpAgentJsonObject | null;
  templateId: string | null;
  blocks: NpBlockContent;
}

export interface NpAgentBlueprintNavigation {
  location: string;
  items: NpNavigationItems;
}

export interface NpAgentBlueprintSeedPlan {
  mode: "none" | "demo-fixtures";
  documents: Array<{
    documentId: string;
    collection: string;
    locale: string | null;
    translationGroupId: string | null;
    dependsOnDocumentIds: string[];
    data: NpAgentJsonObject;
    provenance: "demo";
  }>;
  media: NpAgentBlueprintSeedMedia[];
}

export interface NpAgentGeneratedMediaPromptV1 {
  schemaVersion: "np.agent-generated-media-prompt.v1";
  prompt: string;
  avoid: string[];
  aspectRatio: "1:1" | "4:3" | "3:4" | "16:9" | "9:16";
  textPolicy: { kind: "none"; exactText: [] } | { kind: "exact"; exactText: string[] };
  referenceArtifactIds: string[];
}

export type NpAgentBlueprintSeedMedia =
  | {
      mediaId: string;
      kind: "operator-supplied";
      materialization: "staged";
      sourceArtifactId: string;
      stagedArtifactPath: string;
      contentHash: string;
      mimeType: string;
      byteSize: number;
      rightsConfirmedBy: string;
      provenanceNote: string;
      alt: string;
    }
  | {
      mediaId: string;
      kind: "licensed-reference";
      materialization: "reference-only";
      sourceUrl: string;
      license: {
        name: string;
        spdxId: string | null;
        url: string;
      };
      creator: string;
      attribution: string;
      fetch: false;
      provenanceNote: string;
      alt: string;
    }
  | {
      mediaId: string;
      kind: "generated";
      materialization: "staged";
      stagedArtifactPath: string;
      contentHash: string;
      mimeType: string;
      byteSize: number;
      generatorId: string;
      generationPrompt: NpAgentGeneratedMediaPromptV1;
      promptDigest: string;
      rightsNote: string;
      provenanceNote: string;
      alt: string;
    }
  | {
      mediaId: string;
      kind: "placeholder";
      materialization: "reference-only";
      placeholderId: string;
      provenanceNote: string;
      alt: string;
    };

export interface NpAgentBlueprintDeploymentPlan {
  target: "local" | "vercel" | "railway" | "render" | "fly" | "docker";
  database: "postgres";
  storage: "local" | "s3" | "custom";
  workerRequired: boolean;
  requiredEnvironment: Array<{
    name: string;
    owner: "nexpress" | "platform" | "adapter" | "plugin";
    sourceId: string | null;
  }>;
  notes: string[];
}

interface NpAgentBlueprintFileChangeCommon {
  path: string;
  action: "create" | "update";
  owner:
    | "config"
    | "collection"
    | "theme"
    | "page"
    | "navigation"
    | "plugin-config"
    | "dependency"
    | "seed"
    | "generated-schema"
    | "migration"
    | "test"
    | "docs";
  expectedHash: string | null;
  contentHash: string;
  rationale: string;
}

export type NpAgentBlueprintFileChange =
  | (NpAgentBlueprintFileChangeCommon & {
      source: "staged";
      stagedArtifactPath: string;
      generatedByCommandId: null;
    })
  | (NpAgentBlueprintFileChangeCommon & {
      source: "command";
      stagedArtifactPath: null;
      generatedByCommandId: string;
    });

interface NpAgentBlueprintCommandCommon {
  id: string;
  cwd: "project";
  prerequisites: string[];
  timeoutSeconds: number;
}

export type NpAgentBlueprintCommand =
  | (NpAgentBlueprintCommandCommon & {
      template: "format";
      files: string[];
    })
  | (NpAgentBlueprintCommandCommon & {
      template: "schema-generate";
    })
  | (NpAgentBlueprintCommandCommon & {
      template: "migration-generate";
      name: string;
    })
  | (NpAgentBlueprintCommandCommon & {
      template: "typecheck" | "lint" | "build";
      workspaceFilter: string | null;
    })
  | (NpAgentBlueprintCommandCommon & {
      template: "test";
      workspaceFilter: string | null;
      integration: boolean;
    })
  | (NpAgentBlueprintCommandCommon & {
      template: "doctor";
      production: boolean;
      target: "vercel" | "railway" | "render" | "fly" | "docker" | null;
    })
  | (NpAgentBlueprintCommandCommon & {
      template: "preview-render";
      comparisonInputsDigest: string;
      renderEnvironmentFingerprint: string;
      routes: Array<{
        pageId: string;
        route: string;
        locale: string | null;
        audience: "public" | "member";
        fixtureIds: string[];
      }>;
      viewports: {
        desktop: NpAgentPreviewViewportV1;
        mobile: NpAgentPreviewViewportV1;
      };
      checks: ["interaction-smoke", "links", "metadata", "accessibility", "overflow"];
      artifacts: Array<
        | {
            kind: "screenshot";
            pageId: string;
            viewport: "desktop" | "mobile";
            path: string;
          }
        | {
            kind: "report";
            path: string;
          }
      >;
      verificationResultPath: string;
    })
  | (NpAgentBlueprintCommandCommon & {
      template: "verify";
    });

interface NpAgentBlueprintCheckCommon {
  id: string;
  commandId: string;
  required: boolean;
}

export type NpAgentBlueprintCheck =
  | (NpAgentBlueprintCheckCommon & {
      expected: "exit-zero" | "no-diff";
      artifactPath: null;
    })
  | (NpAgentBlueprintCheckCommon & {
      expected: "review-artifact";
      artifactPath: string;
    });

export type NpAgentBuildPreviewCheckIdV1 =
  "interaction-smoke" | "links" | "metadata" | "accessibility" | "overflow";

export type NpAgentBuildPreviewIssueCodeV1 =
  | "INTERACTION_FAILED"
  | "LINK_TARGET_MISSING"
  | "EXTERNAL_LINK_UNVERIFIED"
  | "METADATA_MISSING"
  | "METADATA_INVALID"
  | "ACCESSIBILITY_VIOLATION"
  | "LAYOUT_OVERFLOW"
  | "AUDIENCE_MISMATCH"
  | "UNEXPECTED_REQUEST"
  | "CHECK_TIMEOUT";

export interface NpAgentBuildPreviewReportV1 {
  schemaVersion: "np.agent-build-preview-report.v1";
  blueprintHash: string;
  comparisonInputsDigest: string;
  renderEnvironmentFingerprint: string;
  routes: Array<{
    pageId: string;
    route: string;
    locale: string | null;
    audience: "public" | "member";
    checks: Array<{
      id: NpAgentBuildPreviewCheckIdV1;
      status: "pass" | "warning" | "fail";
      issueIds: string[];
    }>;
  }>;
  issues: Array<{
    id: string;
    pageId: string;
    checkId: NpAgentBuildPreviewCheckIdV1;
    severity: "warning" | "error";
    code: NpAgentBuildPreviewIssueCodeV1;
    safeSummary: string;
    target:
      | { kind: "route"; route: string }
      | { kind: "selector"; selectorDigest: string }
      | { kind: "external-origin"; origin: string }
      | null;
    evidenceArtifactPaths: string[];
  }>;
}

export interface NpAgentBuildVerificationResultV1 {
  schemaVersion: "np.agent-build-verification-result.v1";
  blueprintHash: string;
  commandRegistryFingerprint: string;
  renderEnvironmentFingerprint: string;
  baselineTreeDigest: string;
  finalSourceDigest: string;
  commandResults: Array<{
    commandId: string;
    exitCode: number;
    outputDigest: string;
    durationMs: number;
  }>;
  artifacts: Array<
    | {
        kind: "screenshot";
        path: string;
        digest: string;
        bytes: number;
        mime: "image/png" | "image/webp";
        pageId: string;
        viewport: "desktop" | "mobile";
      }
    | {
        kind: "report";
        path: string;
        digest: string;
        bytes: number;
        mime: "application/json";
        pageId: null;
        viewport: null;
      }
  >;
  manifestDigest: string;
  startedAt: string;
  finishedAt: string;
}

export interface NpAgentBlueprintRisk {
  id: string;
  category: "data" | "auth" | "content" | "design" | "operations" | "dependency";
  severity: "low" | "medium" | "high" | "critical";
  summary: string;
  mitigation: string;
  blocking: boolean;
}

export interface NpAgentSiteBlueprintV1 {
  schemaVersion: "np.agent-site-blueprint.v1";
  briefHash: string;
  directionSetHash: string;
  selectedDirectionId: string;
  selectedDirectionHash: string;
  selectedDirectionProjectionDigest: string;
  discoveryFingerprint: string;
  framework: {
    nexpressVersion: string;
    nodeRange: string;
    pnpmVersion: string;
  };
  theme: {
    package: string;
    tokens: NpThemeTokensOverlay;
  };
  collections: NpAgentBlueprintCollection[];
  pages: NpAgentBlueprintPage[];
  navigation: NpAgentBlueprintNavigation[];
  plugins: Array<{
    source: "installed";
    package: string;
    version: string;
    discoveryFingerprint: string;
    reason: string;
    requiredCapabilities: NpPluginCapability[];
    configPlaceholders: string[];
  }>;
  seed: NpAgentBlueprintSeedPlan;
  deployment: NpAgentBlueprintDeploymentPlan;
  filePlan: NpAgentBlueprintFileChange[];
  commandRegistryFingerprint: string;
  commands: NpAgentBlueprintCommand[];
  verification: NpAgentBlueprintCheck[];
  risks: NpAgentBlueprintRisk[];
}
```

Every blueprint page maps one information-architecture page byte-for-byte by
id, route, locale, and audience. The validator proves a public route renders
without authentication; a member route withholds protected content from an
anonymous request and renders only with the isolated synthetic member fixture.
A mismatch is a blocking auth/design failure, not a screenshot warning.

`filePlan` contains allowed exact paths, action (`create`/`update`), owner
surface, expected hash, final content digest, source, and rationale. A staged
source points under `.nexpress/site/files/`; a command source points to one
declared command id and is permitted only for owner `generated-schema` or
`migration`. A staged path is a relative POSIX project path with no absolute
path, `..`, symlink escape, control character, or secret file; the CLI verifies
its digest before writing. It does not contain arbitrary shell.
`commands` are a closed discriminated template union with working directory,
typed arguments, prerequisites, and a `1..3_600` second timeout. The CLI-owned
template registry—not the blueprint—derives the fixed executable/subcommand,
argv grammar, mutation class, approval requirement, and registry fingerprint.
Files/filters/names are each at most 512 characters and execution never invokes
a shell. An unknown template/argument or changed registry fingerprint
invalidates the blueprint.

Collection `definition` and seed `data` use bounded transport JSON, then
reparse through the live collection-definition/document analyzers. `blocks`,
navigation, and theme tokens use the shipped exact contracts directly.
Unknown fields/types fail before any file write.

Command and check references are closed. Command/check ids are unique;
prerequisites and `generatedByCommandId` resolve to exactly one command,
self-edges and cycles are rejected, and `commands` is stored in canonical
topological order with id as the tie-breaker. Every check references one
command. `artifactPath` is non-null exactly for `review-artifact` and points
under `.nexpress/site/review/`; it is null for the other expectations. A
blueprint never predicts a post-execution screenshot hash. Every executed
command has a required `exit-zero` check; every source-mutating command also
has a required `no-diff` check, meaning the final tracked source tree equals
the baseline plus the exact `filePlan`, including every declared final content
hash.

The registry declares each template's fixed tracked-source mutation class and
fixed ignored/ephemeral output roots. `format` may touch only staged
`filePlan` paths. Schema and migration generation may touch only their
`source:"command"` rows. Verification/build outputs may use only the
registry-owned ignored roots and never count as source changes. A command that
writes an undeclared tracked path, omits a declared command-owned path, or
produces a different final hash fails and restores the pre-command source
snapshot before later commands can run.

`preview-render` is the only v1 browser-artifact command. Its route/page/
fixture set and viewports must be byte-equal to the selected direction's
comparison inputs, and its blueprint/comparison digests must match the
envelope. The CLI injects the already computed enclosing blueprint hash into
the execution context/result; the blueprint never contains its own digest. It
declares exactly one desktop and one mobile screenshot per route
plus one canonical JSON report; paths are unique descendants of
`.nexpress/site/review/final/`. Exactly one required `review-artifact` check
points to `verificationResultPath`; that manifest binds every observed
screenshot/report path, digest, MIME, size, page, and viewport. Thus a
200-page plan uses 401 artifact entries but one manifest check and remains
inside the 64-check ceiling.

The single report file reparses as `NpAgentBuildPreviewReportV1` before it can
enter the verification manifest. Routes are in the command's frozen order;
each has exactly the five declared checks in that same fixed order, issue ids
are sorted unique and resolve exactly once, and every issue refers to its own
route/check. There are at most 2,000 issues, 20 evidence paths per issue, and a
safe summary is at most 500 characters. Selector targets store only the
domain-separated selector digest; external targets store a canonical
queryless HTTPS origin. Raw HTML, response bodies, cookies, headers, DOM text,
credentials, arbitrary URLs, and model prose are forbidden. The canonical
UTF-8 JSON report remains within 512 KiB; otherwise the command fails and no
successful manifest is written.

The fixed registry implementation starts the already-built app on a random
loopback port, waits to a bounded readiness deadline, installs only the
declared deterministic fixtures, runs the five checks and captures declared
routes/viewports, hashes each closed output, then terminates the entire child
process group in `finally`. A `member` route receives only a
registry-created synthetic local member/session bound to the isolated fixture
database; a public route receives no auth. Admin/private routes are outside
the Build visual contract and use non-visual schema/authorization tests.

The child runs from an isolated temporary copy of the planned tree with an
empty inherited environment. The registry supplies only fixed runtime names
(`PATH`, `NODE_ENV=test`, loopback host/port, `TZ=UTC`, `CI=1`) plus
fresh synthetic `NP_SECRET`, temporary database URL, and temporary storage
root; no repository `.env`, production database, home credential, provider
key, cloud metadata, or user cookie is mounted. Source is read-only after
startup except declared review/temp roots. The server process and browser are
both placed in an egress sandbox permitting only their exact loopback channel;
if the host cannot prove that boundary, preview verification fails with
`PREVIEW_SANDBOX_UNAVAILABLE`. Attempted environment/secret access, filesystem
escape, or server-side egress is a blocking check failure.

`renderEnvironmentFingerprint` binds the registry version, exact Chromium
executable digest, bundled-font file digests, `UTC`, per-route locale,
`prefers-color-scheme:light`, `prefers-reduced-motion:reduce`, fixed viewport
device scale, a frozen framework clock, deterministic random seed, and image
canonicalizer version. The harness disables CSS transitions/animations and
caret/cursor blinking, waits for the declared font bundle and network-idle
condition, rejects undeclared local fonts, and canonicalizes PNG/WebP metadata
before hashing. The command and result fingerprints must match. Two runs under
the same environment are byte-deterministic; a browser/font/canonicalizer
change creates a new fingerprint rather than pretending an equal artifact.

It invokes no shell, accepts no arbitrary command or origin, sends no ambient
cookie/Authorization value, and blocks all other network requests. Timeout,
browser crash, unexpected route/request/artifact, attempted sandbox escape, or
a surviving child process fails the command and artifact check.

After all commands finish, the CLI writes
`NpAgentBuildVerificationResultV1` atomically at the declared result path. The
manifest is keyed by the already sealed blueprint, command-registry,
baseline-tree, and observed final-source digests; `manifestDigest` hashes its
canonical body excluding that field. The apply audit stores the result path
and digest. Handoff/approval trusts observed result hashes only after
recomputing the manifest, source digests, command outputs, and every artifact;
a missing/stale result is not replaced by a blueprint-supplied expectation.

The blueprint has at most 64 collections, 200 pages, 32 navigation locations,
64 plugins, 1,000 seed documents, 200 media fixtures, 500 file changes, 32
commands, 64 checks, and 100 risks. Every array is unique by its canonical id
or domain key. General ids/paths/labels are at most 128/512/120 characters;
operator prose is at most 4,000 characters; the complete canonical blueprint
is at most 4 MiB and depth 16.
The one `preview-render` command has at most 200 routes and exactly
`2 * routes + 1` artifact declarations, hence at most 401; its verification
result has the same bound and is at most 2 MiB excluding referenced image
files.

Every plugin is installed-only in v1: its package/version/fingerprint and
capabilities must match the current installed discovery contract. The
blueprint cannot propose, download, add, upgrade, or distinguish an
unreviewed package through prose.
Configuration placeholders and deployment environment names contain names
only, are unique, and match `[A-Z][A-Z0-9_]{0,127}`; values are forbidden.
Each name is resolved to owner `nexpress`, `platform`, `adapter`, or `plugin`.
NexPress-owned names must use `NP_`; standard platform names such as
`DATABASE_URL` use their shipped inventory, and adapter/plugin-owned names must
be declared by installed discovery. A blueprint cannot mint an undeclared
environment variable.

Semantic invariants are exact: a `pattern` page requires `patternId` plus a
non-null (possibly empty) `patternOverrides` object and forbids `templateId`;
a `custom` page requires `templateId` and forbids both `patternId` and
`patternOverrides`. `seed.mode:"none"` requires empty document/media arrays.
Collection/file `create` requires `expectedSourceHash`/`expectedHash=null`;
`update` requires the current non-null hash and fails on mismatch. Reused
collections require an unchanged live definition hash and no migration.
`directionSetHash` is the canonical hash of the complete
`NpAgentDesignDirectionSetV1`; `selectedDirectionHash` is the canonical hash of
one exact member. The set hash, member id/direction bytes, set `briefHash`,
common-input digests, and rehashed write-once preview artifacts must all match
before blueprint validation, file staging, generation, and preview. The set,
direction, and blueprint `discoveryFingerprint` must equal
the same frozen theme/pattern/block/plugin catalog. `projectionDigest` is
computed from the resolved theme package/tokens plus sorted page-id→source→
pattern/override or template→resolved-block bindings. Blueprint page ids and
routes must be an exact projection of the comparison information architecture,
and each must match one selected direction binding. Blueprint validation
reparses each pattern page's persisted `patternOverrides`, resolves it to exact
`blocks`, requires those bytes—or a custom page's template/blocks—to equal the
selected direction binding and `page.blocks`, independently recomputes the
projection, and requires byte equality with
`selectedDirectionProjectionDigest` and the selected direction's
`projectionDigest`; citing Direction A while generating Direction B therefore
fails before staging.
Deployment preflight is derived from the closed `deployment.target`; the
blueprint cannot supply a command or open preflight target string.

Every seed document/media id is a canonical stable id allocated in the
blueprint before data parsing. Document relationship/media fields contain
those final ids directly; `$ref`, client-id placeholders, and post-write id
substitution are forbidden. A media field may reference only
`materialization:"staged"` media. Its artifact must be under
`.nexpress/site/media/`, be a regular non-symlink file, and match the declared
digest, MIME allowlist, and `1..25 MiB` byte count before the first seed write.
`reference-only` licensed references/placeholders can appear only in explicit
non-media reference metadata or preview fallback slots; they are never fetched
or persisted as uploaded media. `dependsOnDocumentIds` is the exact sorted
subset of blueprint document ids referenced by `data`; unknown/missing edges
fail validation. V1 rejects dependency cycles and writes fixtures in the
canonical topological order with collection/id tie-breakers. Locale siblings
share an explicit `translationGroupId`; it is not inferred from titles/slugs.
This allows every document to be reparsed against the live generated schema
before the first seed write.

A generated media row stores the complete redacted
`NpAgentGeneratedMediaPromptV1`; `promptDigest` is recomputed from that object.
The prompt is at most 4,000 characters, `avoid` has at most 20 strings of 200
characters, exact text has at most 20 strings of 200 characters, and reference
ids are sorted unique with at most 20 members. Credentials, personal data,
provider request ids, hidden system prompts, and inline/base64 reference bytes
are forbidden. `generatorId` identifies the external generator contract but
does not make the prompt digest an attestation that the provider produced the
bytes; the staged artifact digest remains the integrity fact.

## 5. Workflow

### Stage 1 — Discover

Read:

- current repository and `AGENTS.md`;
- installed package versions;
- `src/nexpress.config.ts`;
- project collections;
- active/bundled theme definitions;
- public block/collection/plugin discovery fixtures where a site is running;
- deployment intent and existing changes.

The agent must detect a new scaffold versus an existing project. An existing
dirty worktree is preserved; overlapping planned files require an explicit
merge/review step.

### Stage 2 — Brief

Convert the prompt and supplied references into the exact brief. Ask only
questions that materially change data, public/member authorship, locale,
deployment, or design direction. Non-blocking details remain named
assumptions.

The user approves the brief hash before code planning. Editing the brief
invalidates directions and blueprint derived from the old hash.

### Stage 3 — Three design directions

Generate exactly three one-shot comparable directions from:

- bundled or installed theme bases;
- canonical theme-token inventory;
- registered blocks and props schemas;
- registered patterns/templates and allowed-child rules;
- representative seed content;
- the same desktop/mobile viewport set.

The agent renders each direction and checks:

- responsive layout;
- content hierarchy;
- typography and contrast;
- long Korean/English text;
- navigation overflow;
- empty/list/detail states;
- theme/block contract validity.

The three artifacts are persisted once in one canonical direction set. The
user selects one member by id/hash for the blueprint. Combining directions
creates a new explicit direction and new set rather than silently mutating the
reviewed artifact.

The external coding agent writes only
`NpAgentDesignDirectionDraftSetV1`; that schema forbids `previewArtifact`.
`nexpress site direction render` validates/canonicalizes the draft, computes
the three projection digests, runs the trusted direction renderer, writes six
montages plus six cache receipts, injects their refs, and atomically seals
`NpAgentDesignDirectionSetV1`. `direction validate` accepts only that final
set, independently rerenders all six montages in a fresh sandbox, and requires
byte equality in addition to rechecking every digest/receipt. This separates
proposed visual inputs from deterministic evidence production and avoids
requiring an invalid final artifact as renderer input.

### Stage 4 — Blueprint

Resolve product intent into:

- existing versus new collection definitions;
- relationships and field/editor types;
- public/member/staff ownership and visibility;
- pages, patterns, templates, navigation, theme tokens;
- exact already-installed plugins and their configuration placeholders;
- seed data and media placeholders;
- local services and deployment/storage requirements;
- exact file changes and commands.

The planner prefers existing framework collections, blocks, patterns, themes,
plugins, and package exports. A custom implementation is proposed only when no
registered surface fits and the blueprint names ownership, tests, and
maintenance cost.

### Stage 5 — Generate

Generation order:

1. create scaffold when starting a new repository;
2. pin intended NexPress/package versions;
3. update project config and collection source;
4. add/select theme, tokens, patterns, pages, and navigation;
5. configure selected already-installed plugins without adding or upgrading a
   package;
6. generate schema and TypeScript artifacts;
7. generate/review migration SQL without applying production migration;
8. add representative seed content;
9. format affected files.

Every relative TypeScript import uses `.js`; client code does not import
server-only core; collection changes follow codegen; framework identifiers use
the `np` prefix.

### Stage 6 — Verify and iterate

Run in proportion to changes:

- format/check;
- targeted package/app typecheck, lint, and tests;
- schema generation parity;
- migration inspection;
- app build;
- local Doctor/setup readiness;
- local browser preview;
- desktop/mobile screenshots and interaction smoke test;
- link, metadata, accessibility, and overflow checks;
- packed-scaffold acceptance when scaffold/template code changes.

Visual iteration changes the exact direction/blueprint token or pattern input,
not only the screenshot. Verification artifacts record blueprint hash and
source commit/worktree state.

### Stage 7 — Handoff

Return:

- brief, complete direction set, selected direction id/hash, and blueprint
  artifacts;
- files created/changed and contracts affected;
- migration/schema status and commands not run;
- verification results and preview URLs/images;
- required environment variables by name, never values;
- next local/deploy commands;
- assumptions, unresolved risks, and rollback/revert guidance.

Optional Git publication follows the normal intentional commit/PR workflow.
Deployment uses existing deploy-plan, preflight, release, and verify contracts.

## 6. Proposed CLI and skill surface

The final command naming should fit the existing `create-nexpress` and
project-side `nexpress` split. Proposed flow:

```bash
# New project: generate scaffold, then produce a brief template/artifact.
npx create-nexpress my-site --agent

cd my-site

# Create a schema-complete template, then let the external coding agent fill it.
pnpm exec nexpress site brief init --out .nexpress/site/brief.template.json

# Deterministically validate/canonicalize artifacts written by that agent.
pnpm exec nexpress site brief validate \
  --file .nexpress/site/brief.json \
  --out .nexpress/site/brief.canonical.json
pnpm exec nexpress site direction render \
  --brief .nexpress/site/brief.canonical.json \
  --draft .nexpress/site/directions.draft.json \
  --review-dir .nexpress/site/review/directions \
  --out .nexpress/site/directions.json
pnpm exec nexpress site direction validate \
  --brief .nexpress/site/brief.canonical.json \
  --file .nexpress/site/directions.json \
  --out .nexpress/site/directions.canonical.json
pnpm exec nexpress site plan validate \
  --brief .nexpress/site/brief.canonical.json \
  --directions .nexpress/site/directions.canonical.json \
  --blueprint .nexpress/site/blueprint.json \
  --out .nexpress/site/blueprint.canonical.json

# Applies repository file changes only; dry-run by default.
pnpm exec nexpress site generate \
  --directions .nexpress/site/directions.canonical.json \
  --blueprint .nexpress/site/blueprint.canonical.json
pnpm exec nexpress site generate \
  --directions .nexpress/site/directions.canonical.json \
  --blueprint .nexpress/site/blueprint.canonical.json \
  --execute --acknowledge-plan <blueprintHash>

# Existing contracts finish the loop.
pnpm run schema:gen
pnpm db:generate
pnpm verify
pnpm run deploy:plan -- --target vercel --json
```

The CLI is a deterministic artifact/render/validation/apply layer, not the
model. The renderer materializes only schema-complete direction drafts; it
does not invent themes, tokens, patterns, pages, or prose. The
official skill teaches an external coding agent how to gather context, propose
three directions, write the exact artifacts, call the CLI, inspect output,
render, and verify. No `site brief` or `site plan` command accepts a natural
language prompt or calls a provider; creation/generation language in this
document refers to the external coding agent unless an exact deterministic CLI
subcommand is named.

Both dry-run and execute generation reload `--directions`, recompute
`directionSetHash` and the selected member/projection/preview digests, and
reject changed, missing, or expired evidence. A plan-validated blueprint never
turns its hash into permission to skip direction-set verification.

`--acknowledge-plan` is an exact hash precondition and operator-safety prompt,
not proof of human authorization. The implementable CLI authority boundary is
the local OS process's existing repository write permission plus both explicit
`--execute` and byte-equal `--acknowledge-plan <blueprintHash>` arguments. In
an interactive controlling TTY the CLI additionally displays the canonical
file/command/risk summary and requires a fresh typed phrase derived from the
hash. In a non-interactive process both flags are sufficient and the CLI
records `authorizationSource:"noninteractive-process"`; any coding-host
file/command approval remains out-of-band audit evidence that NexPress neither
receives nor claims to verify. There is no undefined host-attestation token.
This authority reaches only the bounded repository file/command plan and never
a database migration apply, production credential, or deployment.

CLI apply constraints:

- plan hash required;
- path allowlist limited to the project, never workspace/home roots;
- structured file operations, no generated shell strings;
- no overwrite outside `filePlan`;
- preserve unrelated user changes;
- no secret/env-value writes;
- no database migration apply or production deploy;
- audit artifact under `.nexpress/site/`.

## 7. Collection and migration policy

The Build Agent may author `defineCollection()` source because it works in the
repository plane. It must:

- prefer extending existing project/built-in shapes where semantics match;
- use exact recursive field definitions and explicit access/visibility;
- define source ownership;
- update all relationships together;
- run schema/type generation;
- produce a reviewed Drizzle migration;
- flag destructive/rename operations separately;
- never apply migration to a production `DATABASE_URL`;
- run `pnpm verify` before handoff.

A schema rename plus feature work should be split into contract/migration and
downstream PRs. Auth, payment, safety, or policy semantics require explicit
human alignment before generation.

## 8. Content and media generation

Seed content exists to make the design and content model testable.

- Every item is marked fixture/demo provenance.
- Claims, testimonials, customer names, metrics, addresses, and legal copy are
  fictional or operator supplied; the agent must not invent them as facts.
- Rich text and blocks use canonical envelopes.
- Relationships reference generated stable ids.
- Locale siblings are explicit.
- Images are operator-provided, licensed stock references, generated with
  recorded provenance, or labelled placeholders.
- Alt text describes the selected image rather than a prompt.
- Production publish is not implied by seed generation.

Large imports use the existing content-transfer/import boundaries after the
schema exists; they are not embedded as unbounded blueprint content.

## 9. Design grammar

The quality strategy is constrained composition rather than arbitrary markup.

1. Theme tokens define color, type scale, spacing, radius, shadow, and other
   published inventory.
2. Blocks define exact props, defaults, container behavior, and allowed
   children.
3. Patterns/templates define proven section/page composition.
4. Layout uses the exact responsive block placement contract.
5. Theme/public hooks render the same data used by production.
6. Custom CSS/components are an explicit owned extension with source, tests,
   responsive behavior, and accessibility acceptance.

The design-direction generator should rank/reuse patterns based on purpose,
keywords, required content, and theme ownership. Unknown blocks or props fail
before preview.

## 10. Existing-project behavior

For an established NexPress project:

- discovery starts from current design tokens, components, collections, routes,
  content shapes, and package versions;
- the brief distinguishes "preserve" from "change";
- design directions remain recognizable as the current brand unless the user
  asks for a redesign;
- file plan minimizes touched shared files;
- generated output is a branchable proposal, not a new scaffold;
- migrations preserve identity and data, with backfill/rollback notes;
- existing dirty changes are never overwritten or reverted.

## 11. Security and privacy

- Repository content, references, and imported pages are untrusted model data,
  not instructions.
- The skill cannot weaken repository `AGENTS.md`, security controls, tests, or
  approval rules based on content it reads.
- Provider credentials stay in the coding-agent environment or supported
  secret store and never enter artifacts.
- External reference fetching is bounded, domain-visible, and citation/licence
  aware.
- Generated packages/scripts require allowlist/review; arbitrary install
  instructions from a reference are ignored.
- The Build Agent receives no Runtime Agent principal or production service
  token by default.

## 12. Failure behavior

- Invalid brief/direction/blueprint: return exact issues; write nothing.
- Unsupported feature: name the missing framework/plugin surface and propose a
  separate owned extension.
- Generation conflict: stop before overwriting and report path/current hash.
- Failed schema generation/migration plan/build/test: keep changes for review,
  mark handoff blocked, and do not deploy.
- Failed visual verification: retain artifacts and exact source hash; update
  blueprint before re-render.
- Provider/model unavailable: artifacts already written remain inspectable and
  resumable by hash; deterministic CLI validation still works.

## 13. Acceptance criteria

The first release must prove:

1. a fresh Korean community brief produces three comparable, valid,
   desktop/mobile directions;
2. selection produces a normal scaffold with exact collections, theme, blocks,
   navigation, and seeds;
3. an editorial/docs brief produces a materially different but contract-valid
   blueprint without arbitrary framework forks;
4. changing a collection generates types/schema and a reviewable migration but
   never applies it to production;
5. rerunning the same blueprint is idempotent or reports exact user-file
   conflicts;
6. existing unrelated/dirty files are preserved;
7. no secret appears in source, artifacts, logs, or screenshots;
8. generated app passes format, typecheck, tests, build, Doctor, and relevant
   scaffold acceptance;
9. preview screenshots correspond to the selected blueprint hash;
10. a developer can continue without the agent using normal NexPress files,
    commands, Admin, and deployment docs.
