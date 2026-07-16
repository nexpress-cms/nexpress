export type NpDiscoveryJsonPrimitive = string | number | boolean | null;
export type NpDiscoveryJsonValue =
  NpDiscoveryJsonPrimitive | NpDiscoveryJsonValue[] | { [key: string]: NpDiscoveryJsonValue };

export type NpDiscoveryContractIssueCode =
  "shape" | "unknown-field" | "invalid-field" | "limit" | "duplicate" | "invariant";

export interface NpDiscoveryContractIssue {
  readonly code: NpDiscoveryContractIssueCode;
  readonly path: string;
  readonly message: string;
}

export type NpDiscoveryContractResult<T> =
  | { readonly ok: true; readonly value: T; readonly issues: readonly [] }
  | {
      readonly ok: false;
      readonly value: null;
      readonly issues: readonly NpDiscoveryContractIssue[];
    };

export interface NpDiscoveryResponse<T> {
  readonly items: T[];
}

export type NpCollectionDiscoveryFieldType =
  | "text"
  | "textarea"
  | "number"
  | "richText"
  | "blocks"
  | "checkbox"
  | "date"
  | "upload"
  | "relationship"
  | "select"
  | "radio"
  | "email"
  | "json"
  | "array"
  | "group"
  | "row"
  | "collapsible";

export interface NpCollectionDiscoveryField {
  readonly name: string;
  readonly type: NpCollectionDiscoveryFieldType;
  readonly source: string;
  readonly label?: string;
  readonly description?: string;
  readonly required?: boolean;
  readonly defaultValue?: NpDiscoveryJsonValue;
  readonly options?: Array<{ readonly label: string; readonly value: string }>;
  readonly relationTo?: string | string[];
  readonly hasMany?: boolean;
  readonly integerOnly?: boolean;
  readonly fields?: NpCollectionDiscoveryField[];
}

export interface NpCollectionDiscoveryItem {
  readonly slug: string;
  readonly source: string;
  readonly labels: { readonly singular: string; readonly plural: string };
  readonly description?: string;
  readonly slug_auto: boolean;
  readonly i18n: boolean;
  readonly timestamps: boolean;
  readonly versions: {
    readonly drafts: boolean;
    readonly max?: number;
  };
  readonly fields: NpCollectionDiscoveryField[];
}

export type NpCollectionDiscoveryResponse = NpDiscoveryResponse<NpCollectionDiscoveryItem>;

export type NpBlockDiscoveryPropFieldType =
  | "text"
  | "textarea"
  | "number"
  | "boolean"
  | "select"
  | "url"
  | "richtext"
  | "image"
  | "color"
  | "collection"
  | "array"
  | "media";

export interface NpBlockDiscoveryPropField {
  readonly name: string;
  readonly label: string;
  readonly type: NpBlockDiscoveryPropFieldType;
  readonly translatable?: boolean;
  readonly required?: boolean;
  readonly defaultValue?: NpDiscoveryJsonValue;
  readonly options?: Array<{ readonly label: string; readonly value: string }>;
  readonly description?: string;
  readonly placeholder?: string;
  readonly min?: number;
  readonly max?: number;
  readonly step?: number;
  readonly pattern?: string;
  readonly patternMessage?: string;
  readonly rows?: number;
  readonly group?: string;
  readonly hiddenWhen?: Array<readonly [string, NpDiscoveryJsonValue]>;
  readonly visibleWhen?: Array<readonly [string, NpDiscoveryJsonValue]>;
  readonly itemSchema?: NpBlockDiscoveryPropField[];
  readonly itemDefault?: { readonly [key: string]: NpDiscoveryJsonValue };
  readonly accept?: string[];
}

export interface NpBlockDiscoveryItem {
  readonly type: string;
  readonly label: string;
  readonly source: string;
  readonly description?: string;
  readonly icon?: string;
  readonly iconKind?: "lucide" | "emoji";
  readonly category?: string;
  readonly keywords: string[];
  readonly defaultProps: { readonly [key: string]: NpDiscoveryJsonValue };
  readonly propsSchema: NpBlockDiscoveryPropField[];
  readonly acceptsChildren: boolean;
  readonly summaryFields: string[];
  readonly allowedChildTypes: string[];
  readonly minChildren?: number;
  readonly maxChildren?: number;
}

export type NpBlockDiscoveryResponse = NpDiscoveryResponse<NpBlockDiscoveryItem>;

export const npPluginDiscoveryProvideKeys = [
  "blocks",
  "patterns",
  "templates",
  "translations",
  "collections",
  "adminExtensions",
  "actions",
  "apiRoutes",
  "pageRoutes",
  "scheduledTasks",
  "hooks",
] as const;

export type NpPluginDiscoveryProvideKey = (typeof npPluginDiscoveryProvideKeys)[number];
export type NpPluginDiscoveryProvides = Record<NpPluginDiscoveryProvideKey, string[]>;

export interface NpPluginDiscoveryItem {
  readonly apiVersion: "1" | null;
  readonly legacy: boolean;
  readonly id: string;
  readonly name: string;
  readonly version: string | null;
  readonly description: string | null;
  readonly author: { readonly name: string; readonly url?: string } | null;
  readonly license: string | null;
  readonly nexpress: {
    readonly minVersion: string;
    readonly maxVersion: string | null;
  } | null;
  readonly capabilities: string[];
  readonly allowedHosts: string[];
  readonly requires: string[];
  readonly provides: NpPluginDiscoveryProvides;
  readonly agent: {
    readonly description: string;
    readonly category: string | null;
    readonly tags: string[];
    readonly configSchema?: { readonly [key: string]: NpDiscoveryJsonValue };
  };
  readonly usesTokens: string[];
  readonly styleSlots: Record<string, string>;
  readonly hooks: string[];
  readonly routes: Array<{
    readonly method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
    readonly path: string;
    readonly description?: string;
    readonly auth: boolean;
  }>;
  readonly pageRoutes: Array<{
    readonly pattern: string;
    readonly surface: "site" | "member";
    readonly locale: "auto" | "none";
  }>;
  readonly scheduledTasks: Array<{
    readonly id: string;
    readonly cron: string;
    readonly description?: string;
  }>;
  readonly actions: Array<{
    readonly id: string;
    readonly kind: "action" | "metric" | "status" | "table";
    readonly source: "definition" | "setup";
    readonly description?: string;
  }>;
}

export type NpPluginDiscoveryResponse = NpDiscoveryResponse<NpPluginDiscoveryItem>;
