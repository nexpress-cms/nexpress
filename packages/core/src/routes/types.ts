/** Code-owned route metadata declared by a NexPress application. */
export interface NpCustomRouteDefinition {
  readonly path: string;
  readonly label: string;
  readonly description?: string;
  readonly icon?: string;
  readonly group?: string;
}

export type NpCustomRouteKind = "static" | "dynamic";

/** Exact Admin/API wire entry derived from one validated definition. */
export interface NpCustomRoute extends NpCustomRouteDefinition {
  readonly kind: NpCustomRouteKind;
  readonly source: string;
}

/** Exact response returned by `GET /api/admin/custom-routes`. */
export interface NpCustomRoutesResponse {
  readonly routes: readonly NpCustomRoute[];
}

export type NpCustomRouteContractIssueCode =
  | "shape"
  | "unknown-field"
  | "invalid-field"
  | "duplicate-path"
  | "duplicate-parameter"
  | "max-items"
  | "source-collision";

export interface NpCustomRouteContractIssue {
  readonly code: NpCustomRouteContractIssueCode;
  readonly path: string;
  readonly message: string;
}

export type NpCustomRouteValidationResult =
  { readonly ok: true } | { readonly ok: false; readonly issue: NpCustomRouteContractIssue };
