import type { NpAgentJsonObject } from "../agent-contract/types.js";
import type { NpBlockContent } from "../fields/block-content.js";
import type { NpNavigationItems } from "../navigation/types.js";
import type { NpThemeTokensOverlay } from "../theme/types.js";
import type { NpPluginDiscoveryItem } from "../discovery-contract/types.js";

export interface NpAgentPreviewViewportV1 {
  width: number;
  height: number;
  deviceScaleFactor: 1 | 2;
}

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
    requiredCapabilities: NpPluginDiscoveryItem["capabilities"];
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

export interface NpAgentBuildSourceTreeV1 {
  schemaVersion: "np.agent-build-source-tree.v1";
  files: Array<{
    path: string;
    kind: "file";
    mode: "100644" | "100755";
    digest: string;
  }>;
}

export interface NpAgentBuildCommandOutputV1 {
  schemaVersion: "np.agent-build-command-output.v1";
  stdout: { base64url: string; truncated: boolean };
  stderr: { base64url: string; truncated: boolean };
}
