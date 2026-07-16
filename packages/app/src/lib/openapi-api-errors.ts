import {
  npApiErrorCodePattern,
  npApiErrorContractLimits,
  npErrorCodes,
  npErrorStatusByCode,
} from "@nexpress/core/api-contract";

type OpenApiObject = Record<string, unknown>;

const HTTP_METHODS = new Set(["get", "head", "post", "put", "patch", "delete", "options"]);
const API_ERROR_SCHEMA_REF = "#/components/schemas/error_response";
const API_ERROR_RESPONSE_REF = "#/components/responses/api_error";

function isRecord(value: unknown): value is OpenApiObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const apiErrorContent = {
  "application/json": { schema: { $ref: API_ERROR_SCHEMA_REF } },
} as const;

export function npCreateApiErrorOpenApiSchemas(): Record<string, OpenApiObject> {
  const validationIssue = {
    type: "object",
    additionalProperties: false,
    required: ["field", "message"],
    properties: {
      field: {
        type: "string",
        minLength: 1,
        maxLength: npApiErrorContractLimits.validationFieldLength,
      },
      message: {
        type: "string",
        minLength: 1,
        maxLength: npApiErrorContractLimits.messageLength,
      },
    },
  };
  const detailValue = {
    anyOf: [
      { type: "null" },
      { type: "boolean" },
      { type: "number" },
      { type: "string", maxLength: npApiErrorContractLimits.detailStringLength },
      {
        type: "array",
        maxItems: npApiErrorContractLimits.detailArrayItems,
        items: { $ref: "#/components/schemas/api_error_detail_value" },
      },
      {
        type: "object",
        maxProperties: npApiErrorContractLimits.detailObjectKeys,
        propertyNames: { maxLength: npApiErrorContractLimits.detailKeyLength },
        additionalProperties: { $ref: "#/components/schemas/api_error_detail_value" },
      },
    ],
  };
  const errorResponse = {
    type: "object",
    additionalProperties: false,
    required: ["error", "status"],
    properties: {
      error: {
        type: "object",
        additionalProperties: false,
        required: ["code", "message"],
        properties: {
          code: {
            type: "string",
            pattern: npApiErrorCodePattern,
            maxLength: npApiErrorContractLimits.codeLength,
            description:
              "Known NexPress codes have stable status mappings; plugins may add safe uppercase extension codes.",
          },
          message: {
            type: "string",
            minLength: 1,
            maxLength: npApiErrorContractLimits.messageLength,
          },
          details: { $ref: "#/components/schemas/api_error_detail_value" },
        },
      },
      status: { type: "integer", minimum: 400, maximum: 599 },
    },
    allOf: [
      ...npErrorCodes.map((code) => ({
        if: {
          properties: {
            error: {
              properties: { code: { const: code } },
              required: ["code"],
            },
          },
          required: ["error"],
        },
        then: { properties: { status: { const: npErrorStatusByCode[code] } } },
      })),
      {
        if: {
          properties: {
            error: {
              properties: { code: { const: "VALIDATION_ERROR" } },
              required: ["code"],
            },
          },
          required: ["error"],
        },
        then: {
          properties: {
            error: {
              required: ["details"],
              properties: {
                details: {
                  type: "array",
                  minItems: 1,
                  maxItems: npApiErrorContractLimits.validationIssues,
                  items: { $ref: "#/components/schemas/api_validation_issue" },
                },
              },
            },
          },
        },
      },
    ],
    "x-np-known-code-statuses": npErrorStatusByCode,
  };

  return {
    api_validation_issue: validationIssue,
    api_error_detail_value: detailValue,
    error_response: errorResponse,
  };
}

export const npApiErrorOpenApiResponses: Record<string, OpenApiObject> = {
  api_error: {
    description: "Canonical NexPress API error envelope",
    content: apiErrorContent,
  },
};

function withCanonicalErrorContent(value: unknown): OpenApiObject {
  const response = isRecord(value) ? value : { description: "Request failed" };
  const existingContent = isRecord(response.content) ? response.content : {};
  return {
    ...response,
    content: { ...existingContent, ...apiErrorContent },
  };
}

export function npApplyApiErrorOpenApiResponses(
  paths: Record<string, OpenApiObject>,
): Record<string, OpenApiObject> {
  return Object.fromEntries(
    Object.entries(paths).map(([path, pathValue]) => {
      const pathItem = isRecord(pathValue) ? pathValue : {};
      const nextPathItem: OpenApiObject = { ...pathItem };
      for (const [method, operationValue] of Object.entries(pathItem)) {
        if (!HTTP_METHODS.has(method) || !isRecord(operationValue)) continue;
        const responses = isRecord(operationValue.responses) ? operationValue.responses : {};
        const nextResponses: OpenApiObject = { ...responses };
        for (const [status, response] of Object.entries(responses)) {
          if (/^[45][0-9]{2}$/u.test(status)) {
            nextResponses[status] = withCanonicalErrorContent(response);
          }
        }
        if (!("default" in nextResponses)) {
          nextResponses.default = { $ref: API_ERROR_RESPONSE_REF };
        }
        nextPathItem[method] = { ...operationValue, responses: nextResponses };
      }
      return [path, nextPathItem];
    }),
  );
}
