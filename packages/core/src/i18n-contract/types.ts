export interface NpI18nConfig {
  /** Unique canonical BCP 47 locales in stable routing/display order. */
  readonly locales: readonly string[];
  /** Required fallback locale; always one of `locales`. */
  readonly defaultLocale: string;
}

export type NpI18nContractIssueCode =
  "shape" | "unknown-field" | "invalid-field" | "duplicate" | "max-items" | "max-length";

export interface NpI18nContractIssue {
  readonly code: NpI18nContractIssueCode;
  readonly path: string;
  readonly message: string;
}

export type NpI18nContractResult<T> =
  | { readonly ok: true; readonly value: T; readonly issues: readonly [] }
  | { readonly ok: false; readonly value: null; readonly issues: readonly NpI18nContractIssue[] };

/** A flat key -> ICU MessageFormat string map for one canonical locale. */
export type NpTranslationBundle = Readonly<Record<string, string>>;

/** A canonical locale -> translation bundle catalog. */
export type NpTranslationCatalog = Readonly<Record<string, NpTranslationBundle>>;

export type NpTranslationParamValue = string | number | boolean | Date | null | undefined;
export type NpTranslationParams = Readonly<Record<string, NpTranslationParamValue>>;

export interface NpResolveLocaleInput {
  readonly pathname?: string;
  readonly acceptLanguage?: string;
}

export interface NpResolveLocaleResult {
  readonly locale: string;
  readonly source: "path" | "header" | "default";
  readonly pathnameWithoutLocale: string | undefined;
}

export interface NpStringOverrideMutation {
  readonly locale: string;
  readonly key: string;
  readonly value: string | null;
}

export interface NpStringOverrideDeleteQuery {
  readonly locale: string;
  readonly key: string;
}

export interface NpStringOverrideRow {
  readonly siteId: string;
  readonly locale: string;
  readonly key: string;
  readonly value: string | null;
  readonly updatedAt: Date;
  readonly updatedBy: string | null;
}

export type NpStringOverrideCatalog = Readonly<
  Record<string, Readonly<Record<string, string | null>>>
>;

export interface NpI18nStringCell {
  readonly base: string | null;
  readonly override: string | null;
}

export interface NpI18nStringRow {
  readonly key: string;
  readonly values: Readonly<Record<string, NpI18nStringCell>>;
}

export interface NpI18nStringsResponse {
  readonly locales: readonly string[];
  readonly defaultLocale: string;
  readonly keys: readonly NpI18nStringRow[];
  readonly siteId: string;
}

export interface NpTranslationProgressLocaleStats {
  readonly count: number;
  readonly missing: number;
}

export interface NpCollectionTranslationProgress {
  readonly collection: string;
  readonly totalGroups: number;
  readonly perLocale: Readonly<Record<string, NpTranslationProgressLocaleStats>>;
}

export interface NpTranslationProgress {
  readonly defaultLocale: string;
  readonly locales: readonly string[];
  readonly collections: readonly NpCollectionTranslationProgress[];
}

export type NpTranslationProgressResponse = NpTranslationProgress | null;

export type NpI18nConfigResponse =
  | { readonly enabled: false }
  | {
      readonly enabled: true;
      readonly locales: readonly string[];
      readonly defaultLocale: string;
    };

export interface NpI18nRuntimeDiagnostics {
  readonly configured: boolean;
  readonly locales: number;
  readonly baseStrings: number;
  readonly pluginStrings: number;
  readonly effectiveBundleCacheEntries: number;
  readonly compiledMessageCacheEntries: number;
  readonly compileFailures: number;
  readonly formatFailures: number;
  readonly lastFailure: {
    readonly operation: "compile" | "format";
    readonly locale: string;
    readonly key: string;
    readonly message: string;
    readonly occurredAt: string;
  } | null;
}
