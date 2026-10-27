import type { NpAgentJsonObject } from "../agent-contract/types.js";
import type { NpBlockContent } from "../fields/block-content.js";
import type { NpThemeTokensOverlay } from "../theme/types.js";
import type { NpAgentPreviewViewportV1 } from "./types.js";

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
  viewports: { desktop: NpAgentPreviewViewportV1; mobile: NpAgentPreviewViewportV1 };
}

export type NpAgentDesignPageBindingV1 = {
  pageId: string;
  blocks: NpBlockContent;
} & (
  | { source: "pattern"; patternId: string; overrides: NpAgentJsonObject; templateId: null }
  | { source: "custom"; patternId: null; overrides: null; templateId: string }
);

/** The complete direction body minus previewArtifact and projectionDigest. */
export interface NpAgentDesignDirectionProjectionV1 {
  schemaVersion: "np.agent-design-direction.v1";
  id: string;
  name: string;
  rationale: string;
  themeBase: string;
  tokens: NpThemeTokensOverlay;
  typography: { heading: string; body: string; mono: string | null };
  layout: {
    /** Use the installed theme's unmodified layout unless an installed presentation owner supports overrides. */
    density: "theme-native" | "compact" | "comfortable" | "spacious";
    contentWidth: string;
    navigation: string;
  };
  pageBindings: NpAgentDesignPageBindingV1[];
  tradeoffs: string[];
  comparisonInputsDigest: string;
  discoveryFingerprint: string;
}

export interface NpAgentDesignDirectionV1 extends NpAgentDesignDirectionProjectionV1 {
  previewArtifact: { desktop: NpAgentPreviewArtifactRefV1; mobile: NpAgentPreviewArtifactRefV1 };
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
  NpAgentDesignDirectionProjectionV1,
  "schemaVersion"
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
  directionProjection: NpAgentDesignDirectionProjectionV1;
  directionProjectionDigest: string;
  viewportName: "desktop" | "mobile";
  viewport: NpAgentPreviewViewportV1;
  orderedPageIds: string[];
  sourceTreeDigest: string;
  rendererFingerprint: string;
  renderEnvironmentFingerprint: string;
}
export interface NpAgentDirectionRenderReceiptBodyV1 extends Omit<
  NpAgentDirectionRenderSourceV1,
  "schemaVersion" | "briefHash" | "directionProjection"
> {
  schemaVersion: "np.agent-direction-render-receipt.v1";
  renderSourceDigest: string;
  output: { relativePath: string; digest: string; mime: "image/png" | "image/webp"; bytes: number };
}
export interface NpAgentDirectionRenderReceiptRecordV1 {
  schemaVersion: "np.agent-direction-render-receipt-record.v1";
  id: string;
  body: NpAgentDirectionRenderReceiptBodyV1;
  digest: string;
  observedAt: string;
}
