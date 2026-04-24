import { getAllCollectionSlugs, getCollectionConfig, getPluginRoutes } from "@nexpress/core";
import { NextResponse } from "next/server";

import { ensureCoreServices, ensurePluginsLoaded } from "@/lib/init-core";
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
    status: { type: "string", enum: ["draft", "scheduled", "published", "archived"] },
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
  const schemas: Record<string, OpenApiSchema> = {
    plugin_item: {
      type: "object",
      properties: {
        id: { type: "string" },
        name: { type: "string" },
        version: { type: "string", nullable: true },
        description: { type: "string", nullable: true },
        capabilities: { type: "array", items: { type: "string" } },
        hooks: { type: "array", items: { type: "string" } },
        routes: {
          type: "array",
          items: {
            type: "object",
            properties: {
              method: { type: "string" },
              path: { type: "string" },
            },
          },
        },
        enabled: { type: "boolean" },
        config: { type: "object", additionalProperties: true },
        installedAt: { type: "string", format: "date-time" },
        updatedAt: { type: "string", format: "date-time" },
        loaded: {
          type: "boolean",
          description: "True when the plugin is currently registered in this process (may lag the DB flag until restart).",
        },
      },
    },
    user_item: {
      type: "object",
      properties: {
        id: { type: "string", format: "uuid" },
        email: { type: "string", format: "email" },
        name: { type: "string" },
        role: { type: "string", enum: ["admin", "editor", "author", "viewer"] },
        createdAt: { type: "string", format: "date-time" },
        updatedAt: { type: "string", format: "date-time" },
      },
    },
    media_item: {
      type: "object",
      description:
        "Media record. Shape depends on the mime type — image variants (thumb/medium/large/og) live on `sizes`.",
      properties: {
        id: { type: "string", format: "uuid" },
        filename: { type: "string" },
        mimeType: { type: "string" },
        width: { type: "integer", nullable: true },
        height: { type: "integer", nullable: true },
        hash: { type: "string", nullable: true, description: "Content SHA used for dedup on import." },
        folderId: { type: "string", format: "uuid", nullable: true },
        storageKey: { type: "string" },
        sizes: { type: "object", additionalProperties: true, nullable: true },
        status: { type: "string", enum: ["pending", "ready", "failed"] },
        createdAt: { type: "string", format: "date-time" },
      },
    },
    media_folder: {
      type: "object",
      properties: {
        id: { type: "string", format: "uuid" },
        name: { type: "string" },
        parentId: { type: "string", format: "uuid", nullable: true },
        createdAt: { type: "string", format: "date-time" },
      },
    },
    error_response: {
      type: "object",
      properties: {
        error: {
          type: "object",
          properties: {
            code: { type: "string" },
            message: { type: "string" },
            details: { type: "object", additionalProperties: true },
          },
        },
        status: { type: "integer" },
      },
    },
  };
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
    "/api/auth/refresh": {
      post: {
        summary: "Exchange refresh token for a new session",
        description:
          "Reads the `nx-refresh` cookie and, on success, rotates `nx-session` / `nx-refresh` / `nx-csrf`.",
        responses: {
          "200": { description: "Fresh session + CSRF cookie; body contains user + tokens" },
          "401": { description: "Refresh cookie missing, expired, or revoked" },
        },
      },
    },
    "/api/auth/change-password": {
      patch: {
        summary: "Change the current user's password",
        description:
          "Requires session cookie + CSRF header. Bumps `tokenVersion` so existing JWTs are invalidated; auth cookies are cleared on success — the client must log in again.",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["currentPassword", "newPassword"],
                properties: {
                  currentPassword: { type: "string" },
                  newPassword: { type: "string", minLength: 8 },
                },
              },
            },
          },
        },
        responses: {
          "200": { description: "Password changed" },
          "401": { description: "Current password incorrect" },
          "422": { description: "Validation error" },
        },
      },
    },
    "/api/auth/forgot-password": {
      post: {
        summary: "Request a password-reset email",
        description:
          "Returns 200 regardless of whether the email matches a user — response is deliberately constant to avoid enumeration.",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["email"],
                properties: { email: { type: "string", format: "email" } },
              },
            },
          },
        },
        responses: {
          "200": { description: "Enqueued (may or may not have matched a user)" },
        },
      },
    },
    "/api/auth/reset-password": {
      post: {
        summary: "Consume a reset token and set a new password",
        description:
          "Bumps the user's tokenVersion and deletes all sessions so existing JWTs are invalidated.",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["token", "password"],
                properties: {
                  token: { type: "string" },
                  password: { type: "string", minLength: 8 },
                },
              },
            },
          },
        },
        responses: {
          "200": { description: "Password updated" },
          "400": { description: "Token invalid, expired, or password too short" },
        },
      },
    },
    "/api/users/invite": {
      post: {
        summary: "Create a new user and send them an invite link (admin only)",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["email", "name", "role"],
                properties: {
                  email: { type: "string", format: "email" },
                  name: { type: "string" },
                  role: { type: "string", enum: ["admin", "editor", "author", "viewer"] },
                },
              },
            },
          },
        },
        responses: {
          "201": {
            description: "User created; invite job enqueued",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    id: { type: "string", format: "uuid" },
                    email: { type: "string" },
                    name: { type: "string" },
                    role: { type: "string" },
                    inviteExpiresAt: { type: "string", format: "date-time" },
                  },
                },
              },
            },
          },
          "400": { description: "Validation or duplicate email" },
          "403": { description: "Caller is not an admin" },
        },
      },
    },
    "/api/users": {
      get: {
        summary: "List users (editor+)",
        parameters: [
          { in: "query", name: "page", schema: { type: "integer", minimum: 1 } },
          { in: "query", name: "limit", schema: { type: "integer", minimum: 1, maximum: 100 } },
          { in: "query", name: "search", schema: { type: "string" }, description: "Matches against email and name." },
        ],
        responses: {
          "200": {
            description: "Paged user list",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    docs: { type: "array", items: { $ref: "#/components/schemas/user_item" } },
                    totalDocs: { type: "integer" },
                    totalPages: { type: "integer" },
                    page: { type: "integer" },
                    limit: { type: "integer" },
                    hasNextPage: { type: "boolean" },
                    hasPrevPage: { type: "boolean" },
                  },
                },
              },
            },
          },
          "403": { description: "Caller is not editor or above" },
        },
      },
      post: {
        summary: "Create a user directly with a password (admin only)",
        description:
          "For inviting by email instead, use `POST /api/users/invite`. This endpoint takes a pre-set password and does not send a welcome email.",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["email", "name", "password", "role"],
                properties: {
                  email: { type: "string", format: "email" },
                  name: { type: "string" },
                  password: { type: "string", minLength: 8 },
                  role: { type: "string", enum: ["admin", "editor", "author", "viewer"] },
                },
              },
            },
          },
        },
        responses: {
          "201": { description: "Created user", content: { "application/json": { schema: { $ref: "#/components/schemas/user_item" } } } },
          "409": { description: "Email already registered" },
          "422": { description: "Validation error" },
        },
      },
    },
    "/api/navigation": {
      get: {
        summary: "Get a navigation tree by location",
        parameters: [
          { in: "query", name: "location", schema: { type: "string" }, description: "Defaults to `main`." },
        ],
        responses: {
          "200": {
            description: "Navigation payload",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    location: { type: "string" },
                    items: { type: "array", items: { type: "object", additionalProperties: true } },
                  },
                },
              },
            },
          },
        },
      },
      put: {
        summary: "Replace a navigation tree (admin only)",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["items"],
                properties: {
                  location: { type: "string", description: "Defaults to `main`." },
                  items: { type: "array", items: { type: "object", additionalProperties: true } },
                },
              },
            },
          },
        },
        responses: {
          "200": { description: "Updated navigation payload" },
          "403": { description: "Caller is not an admin" },
          "422": { description: "Invalid items structure" },
        },
      },
    },
    "/api/settings": {
      get: {
        summary: "Site settings map (admin only)",
        responses: {
          "200": {
            description: "Flattened `key → value` map across every settings row except `theme`.",
            content: { "application/json": { schema: { type: "object", additionalProperties: true } } },
          },
          "403": { description: "Caller is not an admin" },
        },
      },
      put: {
        summary: "Upsert a single setting key (admin only)",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["key", "value"],
                properties: { key: { type: "string" }, value: {} },
              },
            },
          },
        },
        responses: {
          "200": {
            description: "Updated setting row",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    key: { type: "string" },
                    value: {},
                    updatedAt: { type: "string", format: "date-time" },
                    updatedBy: { type: "string", format: "uuid", nullable: true },
                  },
                },
              },
            },
          },
          "403": { description: "Caller is not an admin" },
          "422": { description: "key or value missing" },
        },
      },
    },
    "/api/settings/theme": {
      get: {
        summary: "Active theme tokens",
        description: "Public endpoint — returns `DEFAULT_THEME` when no theme has been persisted yet.",
        responses: {
          "200": {
            description: "Theme tokens",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    colors: { type: "object", additionalProperties: true },
                    typography: { type: "object", additionalProperties: true },
                    shape: { type: "object", additionalProperties: true },
                  },
                },
              },
            },
          },
        },
      },
      put: {
        summary: "Replace the theme tokens (admin only)",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["colors", "typography", "shape"],
                properties: {
                  colors: { type: "object", additionalProperties: true },
                  typography: { type: "object", additionalProperties: true },
                  shape: { type: "object", additionalProperties: true },
                },
              },
            },
          },
        },
        responses: {
          "200": { description: "Updated theme; triggers public-site revalidation." },
          "403": { description: "Caller is not an admin" },
          "422": { description: "Theme token structure invalid" },
        },
      },
      patch: {
        summary: "Alias of PUT — replace the theme tokens (admin only)",
        responses: { "200": { description: "Updated theme" } },
      },
    },
    "/api/media": {
      get: {
        summary: "List media",
        parameters: [
          { in: "query", name: "page", schema: { type: "integer", minimum: 1 } },
          { in: "query", name: "limit", schema: { type: "integer", minimum: 1, maximum: 100 } },
          { in: "query", name: "folderId", schema: { type: "string", format: "uuid" } },
          { in: "query", name: "mimeType", schema: { type: "string" }, description: "Prefix match, e.g. `image/`." },
        ],
        responses: {
          "200": {
            description: "Paged media list",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    docs: { type: "array", items: { $ref: "#/components/schemas/media_item" } },
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
    },
    "/api/media/upload": {
      post: {
        summary: "Upload a file (editor+)",
        description:
          "Multipart form upload. Images are transcoded asynchronously — expect 202 while variants are generated. Max 10MB.",
        requestBody: {
          required: true,
          content: {
            "multipart/form-data": {
              schema: {
                type: "object",
                required: ["file"],
                properties: {
                  file: { type: "string", format: "binary" },
                  folderId: { type: "string", format: "uuid" },
                },
              },
            },
          },
        },
        responses: {
          "201": { description: "Non-image upload completed synchronously" },
          "202": { description: "Image accepted; variant generation running in a job" },
          "403": { description: "Caller is not editor or above" },
          "422": { description: "Unsupported MIME / file too large / folder not found" },
        },
      },
    },
    "/api/media/{id}": {
      parameters: [{ in: "path", name: "id", required: true, schema: { type: "string", format: "uuid" } }],
      get: {
        summary: "Get a single media record",
        responses: {
          "200": { description: "Media record", content: { "application/json": { schema: { $ref: "#/components/schemas/media_item" } } } },
          "404": { description: "Media not found" },
        },
      },
      delete: {
        summary: "Delete a media record (admin only)",
        responses: {
          "200": { description: "Deleted", content: { "application/json": { schema: { type: "object", properties: { id: { type: "string" }, deleted: { type: "boolean" } } } } } },
          "404": { description: "Media not found" },
          "409": { description: "Media is referenced by a document — clear refs first." },
        },
      },
    },
    "/api/media/folders": {
      get: {
        summary: "List media folders",
        parameters: [
          { in: "query", name: "parentId", schema: { type: "string", format: "uuid" }, description: "Omit to list top-level folders." },
        ],
        responses: {
          "200": { description: "Folder array", content: { "application/json": { schema: { type: "array", items: { $ref: "#/components/schemas/media_folder" } } } } },
        },
      },
      post: {
        summary: "Create a folder (editor+)",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["name"],
                properties: {
                  name: { type: "string" },
                  parentId: { type: "string", format: "uuid" },
                },
              },
            },
          },
        },
        responses: {
          "201": { description: "Created folder", content: { "application/json": { schema: { $ref: "#/components/schemas/media_folder" } } } },
          "404": { description: "Parent folder not found" },
          "422": { description: "name missing" },
        },
      },
    },
    "/api/media/folders/{id}": {
      parameters: [{ in: "path", name: "id", required: true, schema: { type: "string", format: "uuid" } }],
      patch: {
        summary: "Rename a folder (editor+)",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { type: "object", required: ["name"], properties: { name: { type: "string" } } },
            },
          },
        },
        responses: {
          "200": { description: "Updated folder", content: { "application/json": { schema: { $ref: "#/components/schemas/media_folder" } } } },
          "404": { description: "Folder not found" },
        },
      },
      delete: {
        summary: "Delete a folder (admin only)",
        responses: {
          "204": { description: "Deleted" },
          "404": { description: "Folder not found" },
          "409": { description: "Folder has media or child folders" },
        },
      },
    },
    "/api/meta/blocks": {
      get: {
        summary: "Block manifests registered in this instance",
        description: "Public discovery endpoint — each block declares `type`, `label`, `propsSchema`, etc.",
        responses: {
          "200": {
            description: "Block manifest list",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    items: { type: "array", items: { type: "object", additionalProperties: true } },
                  },
                },
              },
            },
          },
        },
      },
    },
    "/api/meta/collections": {
      get: {
        summary: "Collection manifests registered in this instance",
        description: "Public discovery endpoint. Mirrors collection definitions with fields, access rules, and labels.",
        responses: {
          "200": {
            description: "Collection manifest list",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    items: { type: "array", items: { type: "object", additionalProperties: true } },
                  },
                },
              },
            },
          },
        },
      },
    },
    "/api/meta/plugins": {
      get: {
        summary: "Plugin manifests loaded in this process",
        description: "Public surface — capabilities, hooks, routes, and agent metadata.",
        responses: {
          "200": {
            description: "Plugin manifest list",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    items: { type: "array", items: { type: "object", additionalProperties: true } },
                  },
                },
              },
            },
          },
        },
      },
    },
    "/api/preview": {
      get: {
        summary: "Enable Next.js draft mode and redirect (editor+)",
        parameters: [
          { in: "query", name: "path", schema: { type: "string" }, description: "Where to redirect once draft mode is enabled. Defaults to `/`." },
        ],
        responses: {
          "307": { description: "Redirect to the target path with draft cookies set" },
          "403": { description: "Caller is not editor or above" },
        },
      },
    },
    "/api/preview/exit": {
      get: {
        summary: "Disable draft mode and redirect to /",
        responses: { "307": { description: "Redirect" } },
      },
    },
    "/api/plugins/{pluginId}/actions/{actionId}": {
      parameters: [
        { in: "path", name: "pluginId", required: true, schema: { type: "string" } },
        { in: "path", name: "actionId", required: true, schema: { type: "string" } },
      ],
      post: {
        summary: "Dispatch a plugin action (admin only)",
        description:
          "Invokes the action registered by the plugin via `ctx.actions.register(actionId, handler)`. Body is forwarded to the handler; widget/action shapes pass `{ collection, documentId }` for collection tabs, or an empty body for global widgets.",
        requestBody: {
          required: false,
          content: { "application/json": { schema: { type: "object", additionalProperties: true } } },
        },
        responses: {
          "200": {
            description: "Handler result",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    ok: { type: "boolean" },
                    data: {},
                    error: { type: "string" },
                  },
                },
              },
            },
          },
          "403": { description: "Caller is not an admin" },
          "404": { description: "Plugin or action not found" },
        },
      },
    },
    "/api/health": {
      get: {
        summary: "Liveness probe",
        responses: {
          "200": {
            description: "Always-on health payload",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    status: { type: "string", enum: ["ok"] },
                    timestamp: { type: "integer" },
                  },
                },
              },
            },
          },
        },
      },
    },
    "/api/export": {
      get: {
        summary: "Export all content + settings as a single JSON document (admin only)",
        description:
          "Inverse of `POST /api/import`. Includes theme, settings, navigation, every collection's documents, media references (id + hash + filename — not the binary), and plugin enabled/config state.",
        responses: {
          "200": {
            description: "Export payload",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    version: { type: "string", enum: ["1"] },
                    exportedAt: { type: "string", format: "date-time" },
                    theme: { type: "object", additionalProperties: true, nullable: true },
                    settings: { type: "object", additionalProperties: true },
                    navigation: { type: "object", additionalProperties: true },
                    collections: { type: "object", additionalProperties: { type: "array", items: { type: "object", additionalProperties: true } } },
                    media: { type: "array", items: { $ref: "#/components/schemas/media_item" } },
                    plugins: {
                      type: "array",
                      items: {
                        type: "object",
                        properties: {
                          id: { type: "string" },
                          enabled: { type: "boolean" },
                          config: { type: "object", additionalProperties: true },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
          "403": { description: "Caller is not an admin" },
        },
      },
    },
    "/api/import": {
      post: {
        summary: "Import a prior `/api/export` payload (admin only)",
        description:
          "Idempotency: media records are matched by hash (then filename as fallback) before collection docs are written, so re-running on a fresh DB after uploading media produces a consistent result. Plugin code itself is not imported — the plugin must already be registered in `nexpress.config.ts`.",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  version: { type: "string", enum: ["1"] },
                  theme: { type: "object", additionalProperties: true },
                  settings: { type: "object", additionalProperties: true },
                  navigation: { type: "object", additionalProperties: true },
                  collections: { type: "object", additionalProperties: { type: "array", items: { type: "object", additionalProperties: true } } },
                  media: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        id: { type: "string" },
                        filename: { type: "string" },
                        hash: { type: "string" },
                      },
                    },
                  },
                  plugins: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        id: { type: "string" },
                        enabled: { type: "boolean" },
                        config: { type: "object", additionalProperties: true },
                      },
                    },
                  },
                },
              },
            },
          },
        },
        responses: {
          "200": {
            description: "Import report",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    imported: {
                      type: "object",
                      properties: {
                        theme: { type: "integer" },
                        settings: { type: "integer" },
                        navigation: { type: "integer" },
                        pages: { type: "integer" },
                        mediaMatched: { type: "integer" },
                      },
                    },
                    warnings: { type: "array", items: { type: "string" } },
                  },
                },
              },
            },
          },
          "403": { description: "Caller is not an admin" },
          "422": { description: "Invalid payload shape or unsupported version" },
        },
      },
    },
    "/api/search": {
      get: {
        summary: "Full-text search across published documents in every collection",
        description:
          "Public endpoint. Uses each collection's search_vector column; results are filtered to status=\"published\" automatically.",
        parameters: [
          { in: "query", name: "q", required: true, schema: { type: "string" } },
          {
            in: "query",
            name: "collections",
            schema: { type: "string" },
            description: "Comma-separated collection slugs. Omit to search every collection with a search_vector column.",
          },
          { in: "query", name: "limit", schema: { type: "integer", minimum: 1, maximum: 50 } },
          { in: "query", name: "offset", schema: { type: "integer", minimum: 0 } },
        ],
        responses: {
          "200": {
            description: "Search results ranked by ts_rank within each collection.",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    results: {
                      type: "array",
                      items: {
                        type: "object",
                        properties: {
                          collection: { type: "string" },
                          doc: { type: "object", additionalProperties: true },
                        },
                      },
                    },
                    total: { type: "integer" },
                    perCollection: { type: "object", additionalProperties: { type: "integer" } },
                  },
                },
              },
            },
          },
        },
      },
    },
    "/api/plugins": {
      get: {
        summary: "List installed plugins with enabled state + registry info (admin only)",
        responses: {
          "200": {
            description: "Plugin list",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    items: {
                      type: "array",
                      items: { $ref: "#/components/schemas/plugin_item" },
                    },
                  },
                },
              },
            },
          },
          "403": { description: "Caller is not an admin" },
        },
      },
    },
    "/api/plugins/{pluginId}": {
      parameters: [{ in: "path", name: "pluginId", required: true, schema: { type: "string" } }],
      get: {
        summary: "Get a single plugin (admin only)",
        responses: {
          "200": {
            description: "Plugin detail",
            content: { "application/json": { schema: { $ref: "#/components/schemas/plugin_item" } } },
          },
          "404": { description: "Plugin id unknown" },
        },
      },
      patch: {
        summary: "Enable/disable a plugin or update its config (admin only)",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  enabled: { type: "boolean" },
                  config: { type: "object", additionalProperties: true },
                },
                description: "At least one of `enabled` or `config` must be provided.",
              },
            },
          },
        },
        responses: {
          "200": {
            description: "Updated plugin",
            content: { "application/json": { schema: { $ref: "#/components/schemas/plugin_item" } } },
          },
          "404": { description: "Plugin id unknown" },
        },
      },
    },
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

  // Plugin-provided routes. These are resolved from the in-process registry,
  // so the spec only lists plugins that actually loaded (enabled + no errors).
  for (const route of getPluginRoutes()) {
    const fullPath = `/api/plugins/${route.pluginId}${route.path}`;
    const method = route.method.toLowerCase();
    const existing = (paths[fullPath] as Record<string, unknown> | undefined) ?? {};

    paths[fullPath] = {
      ...existing,
      [method]: {
        summary: `Plugin route: ${route.method.toUpperCase()} ${route.path}`,
        tags: [`plugin:${route.pluginId}`],
        description: `Exposed by plugin \`${route.pluginId}\`.`,
        responses: {
          "200": { description: "Plugin response (shape depends on the plugin)" },
          "404": { description: "Plugin or route not found" },
        },
      },
    };
  }

  return {
    openapi: "3.1.0",
    info: {
      title: "NexPress API",
      version: "0.1.0",
      description:
        "Auto-generated from registered collections, media, settings, navigation, plugins, and the core auth / discovery routes. Internal endpoints under `/api/internal/*` are intentionally omitted.",
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

export async function GET() {
  ensureCoreServices();
  await ensurePluginsLoaded();

  return NextResponse.json(buildSpec(), {
    headers: { "Cache-Control": "no-store" },
  });
}
