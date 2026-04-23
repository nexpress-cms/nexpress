import { getAllCollectionSlugs, getCollectionConfig } from "@nexpress/core";
import { NextResponse } from "next/server";

import { ensureCoreServices } from "@/lib/init-core";
import { collectionToManifest, type NxFieldManifest } from "@/lib/manifest";

type OpenApiSchema = Record<string, unknown>;

function fieldToSchema(field: NxFieldManifest): OpenApiSchema {
  switch (field.type) {
    case "text":
    case "textarea":
    case "email":
    case "select":
    case "radio":
      return { type: "string", ...(field.options && { enum: field.options.map((o) => o.value) }) };
    case "number":
      return { type: field.integerOnly ? "integer" : "number" };
    case "checkbox":
      return { type: "boolean" };
    case "date":
      return { type: "string", format: "date-time" };
    case "richText":
    case "blocks":
    case "json":
      return { type: "object", additionalProperties: true };
    case "upload":
    case "relationship":
      return field.hasMany
        ? { type: "array", items: { type: "string", format: "uuid" } }
        : { type: "string", format: "uuid" };
    case "array":
      return {
        type: "array",
        items: {
          type: "object",
          properties: Object.fromEntries((field.fields ?? []).map((f) => [f.name, fieldToSchema(f)])),
        },
      };
    case "group":
      return {
        type: "object",
        properties: Object.fromEntries((field.fields ?? []).map((f) => [f.name, fieldToSchema(f)])),
      };
    default:
      return { type: "object", additionalProperties: true };
  }
}

function collectionSchema(manifest: ReturnType<typeof collectionToManifest>): OpenApiSchema {
  const properties: Record<string, OpenApiSchema> = {
    id: { type: "string", format: "uuid", readOnly: true },
    status: { type: "string", enum: ["draft", "published", "archived"] },
    createdAt: { type: "string", format: "date-time", readOnly: true },
    updatedAt: { type: "string", format: "date-time", readOnly: true },
  };

  for (const field of manifest.fields) {
    if (field.type === "row" || field.type === "collapsible") continue;
    properties[field.name] = {
      ...fieldToSchema(field),
      ...(field.description && { description: field.description }),
    };
  }

  if (manifest.slug_auto) {
    properties.slug = { type: "string", description: "Auto-derived from title unless set explicitly." };
  }

  const required = manifest.fields
    .filter((f) => f.required && f.type !== "row" && f.type !== "collapsible")
    .map((f) => f.name);

  return {
    type: "object",
    properties,
    required,
  };
}

function buildSpec(): OpenApiSchema {
  const slugs = getAllCollectionSlugs();
  const schemas: Record<string, OpenApiSchema> = {};
  const paths: Record<string, OpenApiSchema> = {
    "/api/auth/login": {
      post: {
        summary: "Log in with email and password",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["email", "password"],
                properties: { email: { type: "string" }, password: { type: "string" } },
              },
            },
          },
        },
        responses: { "200": { description: "Sets nx-session/nx-refresh/nx-csrf cookies and returns the user" } },
      },
    },
    "/api/auth/logout": { post: { summary: "Clear auth cookies", responses: { "204": { description: "No content" } } } },
    "/api/auth/me": { get: { summary: "Current authenticated user", responses: { "200": { description: "User object" } } } },
  };

  for (const slug of slugs) {
    const manifest = collectionToManifest(getCollectionConfig(slug));
    const schemaName = `${slug}_document`;
    schemas[schemaName] = collectionSchema(manifest);

    paths[`/api/collections/${slug}`] = {
      get: {
        summary: `List ${manifest.labels.plural.toLowerCase()}`,
        parameters: [
          { in: "query", name: "page", schema: { type: "integer", minimum: 1 } },
          { in: "query", name: "limit", schema: { type: "integer", minimum: 1, maximum: 100 } },
          { in: "query", name: "sort", schema: { type: "string" } },
          { in: "query", name: "search", schema: { type: "string" } },
          { in: "query", name: "where", schema: { type: "string", description: "JSON-encoded filter object" } },
        ],
        responses: {
          "200": {
            description: "Paged result",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    docs: { type: "array", items: { $ref: `#/components/schemas/${schemaName}` } },
                    totalDocs: { type: "integer" },
                    totalPages: { type: "integer" },
                    page: { type: "integer" },
                    limit: { type: "integer" },
                  },
                },
              },
            },
          },
        },
      },
      post: {
        summary: `Create a ${manifest.labels.singular.toLowerCase()}`,
        requestBody: {
          required: true,
          content: { "application/json": { schema: { $ref: `#/components/schemas/${schemaName}` } } },
        },
        responses: {
          "201": { description: "Created document", content: { "application/json": { schema: { $ref: `#/components/schemas/${schemaName}` } } } },
        },
      },
    };

    paths[`/api/collections/${slug}/{id}`] = {
      parameters: [{ in: "path", name: "id", required: true, schema: { type: "string", format: "uuid" } }],
      get: {
        summary: `Get a single ${manifest.labels.singular.toLowerCase()}`,
        responses: { "200": { description: "Document", content: { "application/json": { schema: { $ref: `#/components/schemas/${schemaName}` } } } } },
      },
      patch: {
        summary: `Update a ${manifest.labels.singular.toLowerCase()}`,
        requestBody: { required: true, content: { "application/json": { schema: { $ref: `#/components/schemas/${schemaName}` } } } },
        responses: { "200": { description: "Updated document" } },
      },
      delete: {
        summary: `Delete a ${manifest.labels.singular.toLowerCase()}`,
        responses: { "204": { description: "Deleted" } },
      },
    };

    if (manifest.versions.drafts) {
      const revisionSummary: OpenApiSchema = {
        type: "object",
        properties: {
          id: { type: "string", format: "uuid" },
          version: { type: "integer" },
          status: { type: "string", enum: ["draft", "published", "autosave"] },
          changedFields: { type: "array", items: { type: "string" } },
          authorId: { type: "string", format: "uuid", nullable: true },
          createdAt: { type: "string", format: "date-time" },
        },
      };

      paths[`/api/collections/${slug}/{id}/revisions`] = {
        parameters: [{ in: "path", name: "id", required: true, schema: { type: "string", format: "uuid" } }],
        get: {
          summary: `List revisions for a ${manifest.labels.singular.toLowerCase()}`,
          parameters: [
            { in: "query", name: "limit", schema: { type: "integer", minimum: 1, maximum: 100 } },
            { in: "query", name: "offset", schema: { type: "integer", minimum: 0 } },
          ],
          responses: {
            "200": {
              description: "Paged revisions",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      revisions: { type: "array", items: revisionSummary },
                      total: { type: "integer" },
                    },
                  },
                },
              },
            },
          },
        },
      };

      paths[`/api/collections/${slug}/{id}/revisions/{revisionId}`] = {
        parameters: [
          { in: "path", name: "id", required: true, schema: { type: "string", format: "uuid" } },
          { in: "path", name: "revisionId", required: true, schema: { type: "string", format: "uuid" } },
        ],
        get: {
          summary: `Get a single revision with snapshot`,
          responses: {
            "200": {
              description: "Revision with full snapshot",
              content: {
                "application/json": {
                  schema: {
                    allOf: [
                      revisionSummary,
                      { type: "object", properties: { snapshot: { type: "object", additionalProperties: true } } },
                    ],
                  },
                },
              },
            },
          },
        },
      };

      paths[`/api/collections/${slug}/{id}/revisions/{revisionId}/restore`] = {
        parameters: [
          { in: "path", name: "id", required: true, schema: { type: "string", format: "uuid" } },
          { in: "path", name: "revisionId", required: true, schema: { type: "string", format: "uuid" } },
        ],
        post: {
          summary: `Restore a prior revision as the current document`,
          responses: {
            "200": {
              description: "Document after restore",
              content: { "application/json": { schema: { $ref: `#/components/schemas/${schemaName}` } } },
            },
          },
        },
      };
    }
  }

  return {
    openapi: "3.1.0",
    info: {
      title: "NexPress API",
      version: "0.1.0",
      description: "Auto-generated from registered collections plus the core auth routes.",
    },
    servers: [{ url: process.env.SITE_URL ?? "http://localhost:3000" }],
    components: {
      schemas,
      securitySchemes: {
        sessionCookie: { type: "apiKey", in: "cookie", name: "nx-session" },
        csrfHeader: { type: "apiKey", in: "header", name: "X-CSRF-Token" },
      },
    },
    security: [{ sessionCookie: [], csrfHeader: [] }],
    paths,
  };
}

export function GET() {
  ensureCoreServices();

  return NextResponse.json(buildSpec(), {
    headers: { "Cache-Control": "no-store" },
  });
}
