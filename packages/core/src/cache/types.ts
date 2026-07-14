export const npCacheInvalidationSources = [
  "collection",
  "navigation",
  "plugin",
  "plugin-config",
  "setup",
  "site",
  "theme",
  "theme-settings",
] as const;

export type NpCacheInvalidationSource = (typeof npCacheInvalidationSources)[number];
export type NpCacheInvalidationPathType = "layout" | "page";

export interface NpCacheInvalidationPath {
  readonly path: string;
  readonly type?: NpCacheInvalidationPathType;
}

export type NpCacheInvalidationPathInput = string | NpCacheInvalidationPath;

export interface NpCacheInvalidationRequest {
  readonly source: NpCacheInvalidationSource;
  readonly collection?: string;
  readonly documentSlug?: string;
  readonly navigationLocation?: string;
  readonly pluginId?: string;
  readonly siteId: string | null;
  readonly themeId?: string;
  readonly paths?: readonly NpCacheInvalidationPathInput[];
  readonly tags?: readonly string[];
}

export interface NpNormalizedCacheInvalidationRequest extends Omit<
  NpCacheInvalidationRequest,
  "paths" | "tags"
> {
  readonly paths: readonly NpCacheInvalidationPath[];
  readonly tags: readonly string[];
}

export interface NpCdnPurgeRequest extends Omit<NpNormalizedCacheInvalidationRequest, "paths"> {
  readonly paths: readonly string[];
}

/** Existing purge adapters may omit kind; new adapters should provide one for diagnostics. */
export interface NpCdnPurgeAdapter {
  readonly kind?: string;
  purge(request: NpCdnPurgeRequest): void | Promise<void>;
  shutdown?(): void | Promise<void>;
}

export type NpCacheInvalidationStatus = "applied" | "partial" | "unavailable";
export type NpCdnPurgeStatus = "applied" | "failed" | "not-configured" | "skipped";

export interface NpCacheInvalidationTargetResult {
  readonly requested: number;
  readonly succeeded: number;
  readonly failed: number;
}

export interface NpCacheInvalidationCdnResult {
  readonly status: NpCdnPurgeStatus;
  readonly adapterKind: string | null;
}

export interface NpCacheInvalidationResult {
  readonly status: NpCacheInvalidationStatus;
  readonly paths: NpCacheInvalidationTargetResult;
  readonly tags: NpCacheInvalidationTargetResult;
  readonly cdn: NpCacheInvalidationCdnResult;
}

/** Host implementation installed by `@nexpress/next` during bootstrap. */
export interface NpCacheInvalidationAdapter {
  readonly kind: string;
  invalidate(
    request: NpNormalizedCacheInvalidationRequest,
  ): NpCacheInvalidationResult | Promise<NpCacheInvalidationResult>;
  shutdown?(): void | Promise<void>;
}

export type NpCacheInvalidationFailureOperation = "dispatch" | "result-contract" | "shutdown";

export interface NpCacheInvalidationFailure {
  readonly operation: NpCacheInvalidationFailureOperation;
  readonly adapterKind: string;
  readonly source: NpCacheInvalidationSource | null;
  readonly message: string;
  readonly occurredAt: string;
}

export interface NpCacheInvalidationDiagnostics {
  readonly attempts: number;
  readonly applied: number;
  readonly partial: number;
  readonly unavailable: number;
  readonly dispatchFailures: number;
  readonly resultContractFailures: number;
  readonly shutdownFailures: number;
  readonly lastFailure: NpCacheInvalidationFailure | null;
}
