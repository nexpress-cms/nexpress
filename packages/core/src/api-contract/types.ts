export const npErrorCodes = [
  "FORBIDDEN",
  "CSRF_INVALID",
  "NOT_FOUND",
  "VALIDATION_ERROR",
  "UNAUTHORIZED",
  "CONFLICT",
  "RATE_LIMITED",
  "TOO_MANY_REQUESTS",
  "INVALID_URL",
  "METHOD_NOT_ALLOWED",
  "SERVICE_UNAVAILABLE",
  "EMAIL_ADAPTER_MISSING_DEPENDENCY",
  "EMAIL_DELIVERY_FAILED",
  "SITE_CONTEXT_MISSING",
  "INTERNAL_ERROR",
] as const;

export type NpErrorCode = (typeof npErrorCodes)[number];

export const npErrorStatusByCode = {
  FORBIDDEN: 403,
  CSRF_INVALID: 403,
  NOT_FOUND: 404,
  VALIDATION_ERROR: 400,
  UNAUTHORIZED: 401,
  CONFLICT: 409,
  RATE_LIMITED: 429,
  TOO_MANY_REQUESTS: 429,
  INVALID_URL: 400,
  METHOD_NOT_ALLOWED: 405,
  SERVICE_UNAVAILABLE: 503,
  EMAIL_ADAPTER_MISSING_DEPENDENCY: 500,
  EMAIL_DELIVERY_FAILED: 502,
  SITE_CONTEXT_MISSING: 500,
  INTERNAL_ERROR: 500,
} as const satisfies Record<NpErrorCode, number>;

/**
 * Known framework codes receive autocomplete while plugins may still define
 * safe extension codes. Runtime validation owns the final code grammar.
 */
export type NpErrorCodeInput = NpErrorCode | (string & Record<never, never>);

export type NpApiErrorDetailPrimitive = string | number | boolean | null;
export type NpApiErrorDetailValue =
  NpApiErrorDetailPrimitive | NpApiErrorDetailValue[] | { [key: string]: NpApiErrorDetailValue };

export type NpApiValidationIssue = {
  field: string;
  message: string;
};

export interface NpApiError {
  error: {
    code: NpErrorCodeInput;
    message: string;
    details?: NpApiErrorDetailValue;
  };
  status: number;
}

export type NpApiContractIssueCode =
  | "shape"
  | "unknown-field"
  | "invalid-code"
  | "invalid-status"
  | "status-mismatch"
  | "limit"
  | "unsafe-value";

export interface NpApiContractIssue {
  code: NpApiContractIssueCode;
  path: string;
  message: string;
}
