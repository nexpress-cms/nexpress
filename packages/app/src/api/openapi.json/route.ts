import { getAllCollectionSlugs, getCollectionConfig, getPluginRoutes } from "@nexpress/core";
import { NextResponse } from "next/server";

import { ensureFor } from "../../lib/init-core";
import { collectionToManifest, type NpFieldManifest } from "../../lib/manifest";

type OpenApiSchema = Record<string, unknown>;

function fieldToSchema(field: NpFieldManifest): OpenApiSchema {
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
          properties: Object.fromEntries(
            (field.fields ?? []).map((f) => [f.name, fieldToSchema(f)]),
          ),
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
    status: { type: "string", enum: ["draft", "scheduled", "published", "archived", "pending"] },
    _status: {
      type: "string",
      enum: ["draft", "scheduled", "published", "archived", "pending"],
      writeOnly: true,
      description:
        "Request-only status transition sentinel. Use `scheduled` with a future `publishedAt`, or `published` with a future `publishedAt` for backwards-compatible scheduling.",
    },
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
    properties.slug = {
      type: "string",
      description: "Auto-derived from title unless set explicitly.",
    };
  }

  if (manifest.versions.drafts && !manifest.fields.some((field) => field.name === "publishedAt")) {
    properties.publishedAt = {
      type: "string",
      format: "date-time",
      nullable: true,
      description:
        "Framework-managed publish timestamp for draft-enabled collections that do not declare their own publishedAt field.",
    };
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
          description:
            "True when the plugin is currently registered in this process (may lag the DB flag until restart).",
        },
      },
    },
    user_item: {
      type: "object",
      properties: {
        id: { type: "string", format: "uuid" },
        email: { type: "string", format: "email" },
        name: { type: "string" },
        role: { type: "string", enum: ["admin", "editor", "moderator", "author", "viewer"] },
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
        hash: {
          type: "string",
          nullable: true,
          description: "Content SHA used for dedup on import.",
        },
        folderId: { type: "string", format: "uuid", nullable: true },
        storageKey: { type: "string" },
        sizes: { type: "object", additionalProperties: true, nullable: true },
        status: { type: "string", enum: ["processing", "ready", "error"] },
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
        responses: {
          "200": { description: "Sets np-session/np-refresh/np-csrf cookies and returns the user" },
        },
      },
    },
    "/api/auth/logout": {
      post: { summary: "Clear auth cookies", responses: { "204": { description: "No content" } } },
    },
    "/api/auth/me": {
      get: {
        summary: "Current authenticated user",
        responses: { "200": { description: "User object" } },
      },
    },
    "/api/auth/oauth/{provider}/start": {
      get: {
        summary: "Begin an OAuth login (staff side)",
        description:
          "Mints a signed `np-oauth-state` cookie and 302s the browser to the provider's authorize URL. Provider must be registered in-process via `registerOAuthProvider({ id, authorize, exchange })` from `@nexpress/core` — typically by a plugin's `setup()` — and must support the `staff` audience when it declares `audiences`.",
        parameters: [{ in: "path", name: "provider", required: true, schema: { type: "string" } }],
        responses: {
          "307": { description: "Redirect to provider authorize URL" },
          "404": { description: "Provider not registered" },
        },
      },
    },
    "/api/auth/oauth/{provider}/callback": {
      get: {
        summary: "Finish an OAuth login",
        description:
          "Validates the state cookie, calls the provider's `exchange()` for the normalized profile, then resolves the matching `np_users` row in this order: (1) durable `(provider, providerUserId)` link, (2) email-match link, (3) auto-provision new user with role `viewer`. On success sets `np-session` / `np-refresh` / `np-csrf` cookies and 302s to `/admin`. Failures redirect to `/admin/login?oauth_error=…` — never expose provider error text.",
        parameters: [
          { in: "path", name: "provider", required: true, schema: { type: "string" } },
          { in: "query", name: "code", required: true, schema: { type: "string" } },
          { in: "query", name: "state", required: true, schema: { type: "string" } },
        ],
        responses: {
          "307": {
            description:
              "Redirect — `/admin` on success or `/admin/login?oauth_error=…` on failure",
          },
        },
      },
    },
    "/api/members/oauth/{provider}/start": {
      get: {
        summary: "Begin an OAuth login (member side)",
        description:
          "Member-side mirror of `/api/auth/oauth/{provider}/start`. Mints a signed `np-mb-oauth-state` cookie and 302s to the provider. The provider registry is shared with the staff route, but providers that declare `audiences` must include `member`; providers without `audiences` stay visible on both surfaces for back-compat.",
        parameters: [{ in: "path", name: "provider", required: true, schema: { type: "string" } }],
        responses: {
          "307": { description: "Redirect to provider authorize URL" },
          "404": { description: "Provider not registered" },
        },
      },
    },
    "/api/members/oauth/{provider}/callback": {
      get: {
        summary: "Finish an OAuth login (member side)",
        description:
          "Validates `np-mb-oauth-state`, calls `provider.exchange()`, resolves the matching `np_members` row in this order: (1) durable `(provider, subject)` link in `np_member_identities`, (2) email-match link, (3) auto-provision a new member with `status='active'` and `email_verified=true`. On success persists access + refresh hashes in `np_member_sessions`, sets `np-mb-session` / `np-mb-refresh` / `np-mb-csrf` cookies, and 302s to `/`. Suspended/deleted members 302 to `/members/login?oauth_error=member_inactive`. Other failures redirect with `oauth_error=<code>` — never echo provider error text.",
        parameters: [
          { in: "path", name: "provider", required: true, schema: { type: "string" } },
          { in: "query", name: "code", required: true, schema: { type: "string" } },
          { in: "query", name: "state", required: true, schema: { type: "string" } },
        ],
        responses: {
          "307": {
            description: "Redirect — `/` on success or `/members/login?oauth_error=…` on failure",
          },
        },
      },
    },
    "/api/auth/refresh": {
      post: {
        summary: "Exchange refresh token for a new session",
        description:
          "Reads the `np-refresh` cookie and, on success, rotates `np-session` / `np-refresh` / `np-csrf`.",
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
          "400": { description: "Validation error" },
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
                  role: {
                    type: "string",
                    enum: ["admin", "editor", "moderator", "author", "viewer"],
                  },
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
    "/api/members/register": {
      post: {
        summary: "Self-register a public site member",
        description:
          "Creates a `pending` member, mints a 24h email verification token, and enqueues a verify email. Login refuses pending accounts until the token is consumed via `/api/members/verify`. Response is constant on success regardless of email/handle collision (anti-enumeration).",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["email", "password", "handle", "displayName"],
                properties: {
                  email: { type: "string", format: "email" },
                  password: { type: "string", minLength: 8 },
                  handle: {
                    type: "string",
                    minLength: 3,
                    maxLength: 30,
                    pattern: "^[a-z0-9][a-z0-9_-]+$",
                  },
                  displayName: { type: "string", minLength: 1, maxLength: 80 },
                },
              },
            },
          },
        },
        responses: {
          "200": { description: "Acknowledged. Email sent if the registration was new." },
          "400": { description: "Validation error" },
        },
      },
    },
    "/api/members/verify": {
      post: {
        summary: "Consume a member email verification token",
        description: "Flips a pending member to active. Token comes from the registration email.",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["token"],
                properties: { token: { type: "string" } },
              },
            },
          },
        },
        responses: {
          "200": { description: "Verified" },
          "400": { description: "Invalid or expired token" },
        },
      },
    },
    "/api/members/login": {
      post: {
        summary: "Member login",
        description:
          "Sets `np-mb-session` / `np-mb-refresh` / `np-mb-csrf` cookies. Refuses login for non-active members (pending / suspended / deleted) with the same generic 401 used for wrong passwords (anti-enumeration).",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["email", "password"],
                properties: {
                  email: { type: "string", format: "email" },
                  password: { type: "string" },
                },
              },
            },
          },
        },
        responses: {
          "200": { description: "Logged in. Member object in body, cookies set." },
          "401": { description: "Invalid credentials" },
        },
      },
    },
    "/api/members/refresh": {
      post: {
        summary: "Rotate member session",
        description: "Reads `np-mb-refresh`; on success rotates session + refresh + CSRF cookies.",
        responses: {
          "200": { description: "Fresh tokens" },
          "401": { description: "Refresh cookie missing or invalid" },
        },
      },
    },
    "/api/members/logout": {
      post: {
        summary: "Member logout",
        description: "Revokes the matching session row and clears `np-mb-*` cookies.",
        responses: { "200": { description: "Logged out" } },
      },
    },
    "/api/members/me": {
      get: {
        summary: "Authenticated member profile",
        description: "Returns the full self-profile, including email and verification state.",
        responses: {
          "200": { description: "Member self-profile" },
          "401": { description: "Not authenticated" },
        },
      },
      patch: {
        summary: "Update member profile",
        description:
          "Editable fields: `displayName`, `bio`, `avatar`. Including `newPassword` requires `currentPassword`; on success the response carries `mustReauth: true` and clears auth cookies.",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  displayName: { type: "string", minLength: 1, maxLength: 80 },
                  bio: { type: "string", nullable: true, maxLength: 500 },
                  avatar: { type: "string", format: "uuid", nullable: true },
                  newPassword: { type: "string", minLength: 8 },
                  currentPassword: { type: "string" },
                },
              },
            },
          },
        },
        responses: {
          "200": { description: "Updated" },
          "400": { description: "Validation error" },
          "401": { description: "Not authenticated" },
        },
      },
      delete: {
        summary: "Soft-delete the authenticated member",
        description:
          "Sets `status='deleted'` and anonymises identifying columns (display_name, email, handle) so the row's unique constraints free up the originals. Sessions revoked, password nulled, cookies cleared.",
        responses: {
          "200": { description: "Deleted" },
          "401": { description: "Not authenticated" },
        },
      },
    },
    "/api/members/forgot-password": {
      post: {
        summary: "Request a member password reset email",
        description: "Constant 200 regardless of whether the email matched a member.",
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
          "200": { description: "Acknowledged" },
          "400": { description: "Validation error" },
        },
      },
    },
    "/api/members/reset-password": {
      post: {
        summary: "Consume a member reset token + set a new password",
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
    "/api/members/{handle}": {
      parameters: [{ in: "path", name: "handle", required: true, schema: { type: "string" } }],
      get: {
        summary: "Public member profile by handle",
        description:
          "Returns only public-safe columns (display_name, avatar, bio, reputation, joined). 404 for pending / suspended / deleted handles.",
        responses: {
          "200": { description: "Public profile" },
          "404": { description: "No active member with that handle" },
        },
      },
    },
    "/api/users": {
      get: {
        summary: "List users (editor+)",
        parameters: [
          { in: "query", name: "page", schema: { type: "integer", minimum: 1 } },
          { in: "query", name: "limit", schema: { type: "integer", minimum: 1, maximum: 100 } },
          {
            in: "query",
            name: "search",
            schema: { type: "string" },
            description: "Matches against email and name.",
          },
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
                  role: {
                    type: "string",
                    enum: ["admin", "editor", "moderator", "author", "viewer"],
                  },
                },
              },
            },
          },
        },
        responses: {
          "201": {
            description: "Created user",
            content: { "application/json": { schema: { $ref: "#/components/schemas/user_item" } } },
          },
          "409": { description: "Email already registered" },
          "400": { description: "Validation error" },
        },
      },
    },
    "/api/navigation": {
      get: {
        summary: "Get a navigation tree by location",
        parameters: [
          {
            in: "query",
            name: "location",
            schema: { type: "string" },
            description: "Defaults to `main`.",
          },
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
          "400": { description: "Invalid items structure" },
        },
      },
    },
    "/api/settings": {
      get: {
        summary: "Site settings map (admin only)",
        responses: {
          "200": {
            description: "Flattened `key → value` map across every settings row except `theme`.",
            content: {
              "application/json": { schema: { type: "object", additionalProperties: true } },
            },
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
          "400": { description: "key or value missing" },
        },
      },
    },
    "/api/settings/theme": {
      get: {
        summary: "Active theme tokens",
        description:
          "Public endpoint — returns `DEFAULT_THEME` when no theme has been persisted yet.",
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
          "400": { description: "Theme token structure invalid" },
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
          {
            in: "query",
            name: "mimeType",
            schema: { type: "string" },
            description: "Prefix match, e.g. `image/`.",
          },
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
          "400": { description: "Unsupported MIME / file too large / folder not found" },
        },
      },
    },
    "/api/media/{id}": {
      parameters: [
        { in: "path", name: "id", required: true, schema: { type: "string", format: "uuid" } },
      ],
      get: {
        summary: "Get a single media record",
        responses: {
          "200": {
            description: "Media record",
            content: {
              "application/json": { schema: { $ref: "#/components/schemas/media_item" } },
            },
          },
          "404": { description: "Media not found" },
        },
      },
      delete: {
        summary: "Delete a media record (admin only)",
        responses: {
          "200": {
            description: "Deleted",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: { id: { type: "string" }, deleted: { type: "boolean" } },
                },
              },
            },
          },
          "404": { description: "Media not found" },
          "409": { description: "Media is referenced by a document — clear refs first." },
        },
      },
    },
    "/api/media/folders": {
      get: {
        summary: "List media folders",
        parameters: [
          {
            in: "query",
            name: "parentId",
            schema: { type: "string", format: "uuid" },
            description: "Omit to list top-level folders.",
          },
        ],
        responses: {
          "200": {
            description: "Folder array",
            content: {
              "application/json": {
                schema: { type: "array", items: { $ref: "#/components/schemas/media_folder" } },
              },
            },
          },
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
          "201": {
            description: "Created folder",
            content: {
              "application/json": { schema: { $ref: "#/components/schemas/media_folder" } },
            },
          },
          "404": { description: "Parent folder not found" },
          "400": { description: "name missing" },
        },
      },
    },
    "/api/media/folders/{id}": {
      parameters: [
        { in: "path", name: "id", required: true, schema: { type: "string", format: "uuid" } },
      ],
      patch: {
        summary: "Rename a folder (editor+)",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["name"],
                properties: { name: { type: "string" } },
              },
            },
          },
        },
        responses: {
          "200": {
            description: "Updated folder",
            content: {
              "application/json": { schema: { $ref: "#/components/schemas/media_folder" } },
            },
          },
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
        description:
          "Public discovery endpoint — each block declares `type`, `label`, `propsSchema`, etc.",
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
        description:
          "Public discovery endpoint. Mirrors collection definitions with fields, access rules, and labels.",
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
          {
            in: "query",
            name: "path",
            schema: { type: "string" },
            description: "Where to redirect once draft mode is enabled. Defaults to `/`.",
          },
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
    "/api/internal/publish-scheduled": {
      post: {
        summary: "Run the scheduled-publishing sweep",
        description:
          "Bearer-token-protected internal trigger. Set `NP_SCHEDULER_TOKEN` and call from cron. Publishes due rows with `status=scheduled` and `publishedAt <= now`.",
        parameters: [
          {
            in: "header",
            name: "Authorization",
            required: true,
            schema: { type: "string" },
            description: "Bearer token in the form `Bearer <NP_SCHEDULER_TOKEN>`.",
          },
        ],
        responses: {
          "200": {
            description: "Sweep result",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    published: { type: "integer" },
                    byCollection: {
                      type: "object",
                      additionalProperties: {
                        type: "array",
                        items: { type: "string", format: "uuid" },
                      },
                    },
                    at: { type: "string", format: "date-time" },
                  },
                },
              },
            },
          },
          "401": { description: "Missing or invalid bearer token" },
          "503": { description: "`NP_SCHEDULER_TOKEN` is not configured" },
        },
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
          "Invokes an action from the plugin's definition-level `actions` registry or setup-time `ctx.actions.register*` API. Body is forwarded to the handler; widget/action shapes pass `{ collection, documentId }` for collection tabs, or an empty body for global widgets.",
        requestBody: {
          required: false,
          content: {
            "application/json": { schema: { type: "object", additionalProperties: true } },
          },
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
          "Inverse of `POST /api/import`. Full export includes theme, settings, navigation, every collection's documents, media references (id + hash + filename — not the binary), and plugin enabled/config state. Pass `?collections=posts,pages` to scope the payload to content only (theme / settings / navigation / plugins are omitted).",
        parameters: [
          {
            in: "query",
            name: "collections",
            schema: { type: "string" },
            description:
              "Comma-separated slug list. When present, only these collections export and the non-content sections (theme/settings/navigation/plugins) are skipped.",
          },
        ],
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
                    siteUrl: {
                      type: "string",
                      nullable: true,
                      description:
                        "SITE_URL env at export time, useful for downstream URL rewrites.",
                    },
                    partial: {
                      type: "boolean",
                      description: "True when the `collections` filter was applied.",
                    },
                    collectionsExported: { type: "array", items: { type: "string" } },
                    theme: { type: "object", additionalProperties: true, nullable: true },
                    settings: { type: "object", additionalProperties: true },
                    navigation: { type: "object", additionalProperties: true },
                    collections: {
                      type: "object",
                      additionalProperties: {
                        type: "array",
                        items: { type: "object", additionalProperties: true },
                      },
                    },
                    media: { type: "array", items: { $ref: "#/components/schemas/media_item" } },
                    plugins: {
                      type: "array",
                      items: {
                        type: "object",
                        properties: {
                          id: { type: "string" },
                          enabled: { type: "boolean" },
                          config: { type: "object", additionalProperties: true },
                          manifestVersion: { type: "string", nullable: true },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
          "403": { description: "Caller is not an admin" },
          "400": { description: "Unknown collection slug in filter" },
        },
      },
    },
    "/api/import": {
      post: {
        summary: "Import a prior `/api/export` payload (admin only)",
        description:
          "Idempotency: media records are matched by hash (then filename as fallback) before collection docs are written, so re-running on a fresh DB after uploading media produces a consistent result. Plugin code itself is not imported — the plugin must already be registered in `nexpress.config.ts`.\n\nPass `?dryRun=true` to validate the payload without writing — the response returns the same `imported` counts and `warnings` a real run would produce, plus `dryRun: true`. Pass `?collections=a,b` to restrict the import to just those slugs (theme / settings / navigation / plugins in the payload are then ignored with a warning).",
        parameters: [
          {
            in: "query",
            name: "dryRun",
            schema: { type: "boolean" },
            description:
              "When `true`, skip all writes and return the report that would have been generated.",
          },
          {
            in: "query",
            name: "collections",
            schema: { type: "string" },
            description:
              "Comma-separated slug list. When present, only these collections import and theme/settings/navigation/plugins are skipped.",
          },
        ],
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
                  collections: {
                    type: "object",
                    additionalProperties: {
                      type: "array",
                      items: { type: "object", additionalProperties: true },
                    },
                  },
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
                        pluginsUpdated: { type: "integer" },
                      },
                    },
                    warnings: { type: "array", items: { type: "string" } },
                    dryRun: { type: "boolean" },
                    partial: { type: "boolean" },
                  },
                },
              },
            },
          },
          "403": { description: "Caller is not an admin" },
          "400": {
            description:
              "Invalid payload shape, unsupported version, or unknown collection in filter",
          },
        },
      },
    },
    "/api/search": {
      get: {
        summary: "Full-text search across published documents in every collection",
        description:
          'Public endpoint. Uses each collection\'s search_vector column; results are filtered to status="published" automatically and ranked by a shared relevance score.',
        parameters: [
          { in: "query", name: "q", required: true, schema: { type: "string" } },
          {
            in: "query",
            name: "collections",
            schema: { type: "string" },
            description:
              "Comma-separated collection slugs. Omit to search every collection with a search_vector column.",
          },
          { in: "query", name: "limit", schema: { type: "integer", minimum: 1, maximum: 50 } },
          {
            in: "query",
            name: "page",
            schema: { type: "integer", minimum: 1 },
            description: "1-based page number. Ignored when offset is provided.",
          },
          { in: "query", name: "offset", schema: { type: "integer", minimum: 0 } },
        ],
        responses: {
          "200": {
            description: "Globally relevance-ranked search results.",
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
                          score: {
                            type: "number",
                            description:
                              "Relative relevance score when using the built-in Postgres search path. Higher ranks first; scale is not stable.",
                          },
                        },
                      },
                    },
                    total: { type: "integer" },
                    perCollection: { type: "object", additionalProperties: { type: "integer" } },
                    facets: {
                      type: "array",
                      items: {
                        type: "object",
                        properties: {
                          collection: { type: "string" },
                          label: { type: "string" },
                          count: { type: "integer" },
                          selected: { type: "boolean" },
                        },
                      },
                    },
                    limit: { type: "integer" },
                    offset: { type: "integer" },
                    hasNextPage: { type: "boolean" },
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
            content: {
              "application/json": { schema: { $ref: "#/components/schemas/plugin_item" } },
            },
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
            content: {
              "application/json": { schema: { $ref: "#/components/schemas/plugin_item" } },
            },
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
          {
            in: "query",
            name: "where",
            schema: { type: "string", description: "JSON-encoded filter object" },
          },
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
          content: {
            "application/json": { schema: { $ref: `#/components/schemas/${schemaName}` } },
          },
        },
        responses: {
          "201": {
            description: "Created document",
            content: {
              "application/json": { schema: { $ref: `#/components/schemas/${schemaName}` } },
            },
          },
        },
      },
    };

    paths[`/api/collections/${slug}/{id}`] = {
      parameters: [
        { in: "path", name: "id", required: true, schema: { type: "string", format: "uuid" } },
      ],
      get: {
        summary: `Get a single ${manifest.labels.singular.toLowerCase()}`,
        responses: {
          "200": {
            description: "Document",
            content: {
              "application/json": { schema: { $ref: `#/components/schemas/${schemaName}` } },
            },
          },
        },
      },
      patch: {
        summary: `Update a ${manifest.labels.singular.toLowerCase()}`,
        requestBody: {
          required: true,
          content: {
            "application/json": { schema: { $ref: `#/components/schemas/${schemaName}` } },
          },
        },
        responses: { "200": { description: "Updated document" } },
      },
      delete: {
        summary: `Delete a ${manifest.labels.singular.toLowerCase()}`,
        responses: { "204": { description: "Deleted" } },
      },
    };

    paths[`/api/collections/${slug}/bulk`] = {
      post: {
        summary: `Bulk publish / unpublish / delete ${manifest.labels.plural.toLowerCase()}`,
        description:
          "Loops the requested action over each id, returning a per-id success/failure list so the caller can surface partial failures. Capped at 100 ids per request.",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["action", "ids"],
                properties: {
                  action: { type: "string", enum: ["publish", "unpublish", "delete"] },
                  ids: {
                    type: "array",
                    items: { type: "string", format: "uuid" },
                    minItems: 1,
                    maxItems: 100,
                  },
                },
              },
            },
          },
        },
        responses: {
          "200": {
            description: "Per-id outcome",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    action: { type: "string" },
                    succeeded: { type: "array", items: { type: "string", format: "uuid" } },
                    failed: {
                      type: "array",
                      items: {
                        type: "object",
                        properties: {
                          id: { type: "string", format: "uuid" },
                          error: { type: "string" },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
          "400": { description: "Invalid action, empty/oversized ids array, or non-UUID id" },
          "401": { description: "Caller not authenticated" },
          "403": { description: "Caller lacks permission for the action on this collection" },
        },
      },
    };

    if (manifest.versions.drafts) {
      paths[`/api/collections/${slug}/{id}/autosave`] = {
        parameters: [
          { in: "path", name: "id", required: true, schema: { type: "string", format: "uuid" } },
        ],
        post: {
          summary: `Autosave a ${manifest.labels.singular.toLowerCase()} draft`,
          description:
            "Persists the request body as a `status=autosave` revision without touching the main document row. Editor clients call this on a debounce so a crash mid-edit can be recovered from the revisions panel. Requires `versions.drafts.autosave === true` on the collection.",
          requestBody: {
            required: true,
            content: {
              "application/json": { schema: { type: "object", additionalProperties: true } },
            },
          },
          responses: {
            "200": {
              description:
                "Revision summary (or the existing one when the snapshot was a no-op duplicate).",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      id: { type: "string", format: "uuid" },
                      version: { type: "integer" },
                      status: { type: "string", enum: ["autosave"] },
                      createdAt: { type: "string", format: "date-time" },
                      reused: { type: "boolean" },
                    },
                  },
                },
              },
            },
            "400": { description: "Autosave not configured for this collection" },
            "404": { description: "Document not found" },
          },
        },
      };

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
        parameters: [
          { in: "path", name: "id", required: true, schema: { type: "string", format: "uuid" } },
        ],
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
          {
            in: "path",
            name: "revisionId",
            required: true,
            schema: { type: "string", format: "uuid" },
          },
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
                      {
                        type: "object",
                        properties: { snapshot: { type: "object", additionalProperties: true } },
                      },
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
          {
            in: "path",
            name: "revisionId",
            required: true,
            schema: { type: "string", format: "uuid" },
          },
        ],
        post: {
          summary: `Restore a prior revision as the current document`,
          responses: {
            "200": {
              description: "Document after restore",
              content: {
                "application/json": { schema: { $ref: `#/components/schemas/${schemaName}` } },
              },
            },
          },
        },
      };
    }

    // Comment routes — only listed when the collection opted in.
    if (getCollectionConfig(slug).community?.comments) {
      paths[`/api/collections/${slug}/{id}/comments`] = {
        parameters: [
          { in: "path", name: "id", required: true, schema: { type: "string", format: "uuid" } },
        ],
        get: {
          summary: `List comments under a ${manifest.labels.singular.toLowerCase()}`,
          parameters: [
            { in: "query", name: "limit", schema: { type: "integer", minimum: 1, maximum: 200 } },
            { in: "query", name: "offset", schema: { type: "integer", minimum: 0 } },
            { in: "query", name: "order", schema: { type: "string", enum: ["newest", "oldest"] } },
            {
              in: "query",
              name: "includeHidden",
              schema: { type: "string", enum: ["1"] },
              description: "Include hidden comments (mod-only; require an active member session).",
            },
          ],
          responses: {
            "200": {
              description: "Paged comment list",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      comments: {
                        type: "array",
                        items: { type: "object", additionalProperties: true },
                      },
                      totalDocs: { type: "integer" },
                    },
                  },
                },
              },
            },
          },
        },
        post: {
          summary: `Post a comment on a ${manifest.labels.singular.toLowerCase()}`,
          description:
            "Member auth + CSRF required. Body is markdown (limited subset — bold, italic, inline + fenced code, allow-listed http(s)/mailto links). Server stores both the markdown source and the rendered HTML.",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["bodyMd"],
                  properties: {
                    bodyMd: { type: "string", maxLength: 5000 },
                    parentId: { type: "string", format: "uuid", nullable: true },
                  },
                },
              },
            },
          },
          responses: {
            "201": { description: "Created comment" },
            "400": { description: "Comments disabled for this collection or invalid body" },
            "401": { description: "Member auth required" },
            "404": { description: "parentId not found or doesn't belong to this document" },
          },
        },
      };
    }
  }

  // Per-comment endpoints (live regardless of collection — comment id
  // already carries the target context).
  paths[`/api/comments/{id}`] = {
    parameters: [
      { in: "path", name: "id", required: true, schema: { type: "string", format: "uuid" } },
    ],
    patch: {
      summary: "Edit a comment (own or with edit-any-comment grant)",
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: {
              type: "object",
              required: ["bodyMd"],
              properties: { bodyMd: { type: "string", maxLength: 5000 } },
            },
          },
        },
      },
      responses: {
        "200": { description: "Updated comment" },
        "401": { description: "Member auth required" },
        "403": { description: "No permission" },
      },
    },
    delete: {
      summary: "Soft-delete a comment (own or with delete-any-comment grant)",
      responses: {
        "200": { description: "Deleted (status='deleted', body cleared)" },
        "401": { description: "Member auth required" },
        "403": { description: "No permission" },
      },
    },
  };
  paths["/api/comments/{id}/hide"] = {
    parameters: [
      { in: "path", name: "id", required: true, schema: { type: "string", format: "uuid" } },
    ],
    post: {
      summary: "Hide a comment (mod-only)",
      requestBody: {
        required: false,
        content: {
          "application/json": {
            schema: {
              type: "object",
              properties: { reason: { type: "string", nullable: true } },
            },
          },
        },
      },
      responses: {
        "200": { description: "Hidden" },
        "403": { description: "Caller lacks hide-comment for this scope" },
      },
    },
  };
  paths["/api/comments/{id}/restore"] = {
    parameters: [
      { in: "path", name: "id", required: true, schema: { type: "string", format: "uuid" } },
    ],
    post: {
      summary: "Restore a hidden comment (mod-only)",
      responses: {
        "200": { description: "Visible again" },
        "400": { description: "Comment is not hidden" },
        "403": { description: "Caller lacks restore-comment for this scope" },
      },
    },
  };

  paths["/api/reactions"] = {
    get: {
      summary: "Reaction summary for a target",
      parameters: [
        {
          in: "query",
          name: "targetType",
          required: true,
          schema: { type: "string" },
          description:
            "Only `comment` is wired today; the polymorphic shape leaves room for future surfaces.",
        },
        {
          in: "query",
          name: "targetId",
          required: true,
          schema: { type: "string", format: "uuid" },
        },
        {
          in: "query",
          name: "kind",
          schema: { type: "string" },
          description: "Defaults to `like`.",
        },
      ],
      responses: {
        "200": {
          description: "{counts: { kind: count }, mine: kinds[]}",
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  counts: { type: "object", additionalProperties: { type: "integer" } },
                  mine: { type: "array", items: { type: "string" } },
                },
              },
            },
          },
        },
      },
    },
    post: {
      summary: "React to a target (idempotent)",
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: {
              type: "object",
              required: ["targetType", "targetId"],
              properties: {
                targetType: { type: "string" },
                targetId: { type: "string", format: "uuid" },
                kind: { type: "string", description: "Defaults to `like`." },
              },
            },
          },
        },
      },
      responses: {
        "201": { description: "Created (or returned existing if duplicate)" },
        "400": { description: "Unsupported targetType / unknown comment" },
        "401": { description: "Member auth required" },
      },
    },
    delete: {
      summary: "Remove a reaction",
      parameters: [
        { in: "query", name: "targetType", required: true, schema: { type: "string" } },
        {
          in: "query",
          name: "targetId",
          required: true,
          schema: { type: "string", format: "uuid" },
        },
        { in: "query", name: "kind", schema: { type: "string" } },
      ],
      responses: {
        "200": { description: "Reaction removed (no-op if it didn't exist)" },
        "401": { description: "Member auth required" },
      },
    },
  };
  paths["/api/follows"] = {
    get: {
      summary: "List the authenticated member's follows",
      parameters: [
        {
          in: "query",
          name: "targetType",
          schema: { type: "string", enum: ["member", "thread", "tag"] },
        },
        { in: "query", name: "limit", schema: { type: "integer", minimum: 1, maximum: 200 } },
        { in: "query", name: "offset", schema: { type: "integer", minimum: 0 } },
      ],
      responses: {
        "200": { description: "Follow rows" },
        "401": { description: "Member auth required" },
      },
    },
    post: {
      summary: "Follow a member / thread / tag",
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: {
              type: "object",
              required: ["targetType", "targetId"],
              properties: {
                targetType: { type: "string", enum: ["member", "thread", "tag"] },
                targetId: { type: "string", description: "UUID for member/thread; slug for tag." },
              },
            },
          },
        },
      },
      responses: {
        "201": { description: "Followed (or existing follow returned on duplicate)" },
        "400": { description: "Self-follow / unknown target / unsupported type" },
      },
    },
    delete: {
      summary: "Unfollow",
      parameters: [
        { in: "query", name: "targetType", required: true, schema: { type: "string" } },
        { in: "query", name: "targetId", required: true, schema: { type: "string" } },
      ],
      responses: {
        "200": { description: "Removed" },
        "401": { description: "Member auth required" },
      },
    },
  };
  paths["/api/follows/check"] = {
    get: {
      summary: "Probe whether the authenticated member follows a single target",
      description:
        "Single-target probe used by site UI follow buttons. The bulk `/api/follows` returns the caller's full follow list, which is the wrong shape for one-button use.",
      parameters: [
        {
          in: "query",
          name: "targetType",
          required: true,
          schema: { type: "string", enum: ["member", "thread", "tag"] },
        },
        { in: "query", name: "targetId", required: true, schema: { type: "string" } },
      ],
      responses: {
        "200": { description: "{ following: boolean }" },
        "401": { description: "Member auth required" },
      },
    },
  };
  paths["/api/notifications"] = {
    get: {
      summary: "Authenticated member's notification inbox",
      parameters: [
        {
          in: "query",
          name: "count",
          schema: { type: "string", enum: ["1"] },
          description: "Lightweight badge probe — returns just `{ unread }`.",
        },
        {
          in: "query",
          name: "unread",
          schema: { type: "string", enum: ["1"] },
          description: "Filter the list to unread rows.",
        },
        { in: "query", name: "limit", schema: { type: "integer", minimum: 1, maximum: 200 } },
        { in: "query", name: "offset", schema: { type: "integer", minimum: 0 } },
      ],
      responses: {
        "200": { description: "Notification list + unread count" },
        "401": { description: "Member auth required" },
      },
    },
  };
  paths["/api/notifications/mark-read"] = {
    post: {
      summary: "Mark notifications read",
      description:
        "Two modes: `{ all: true }` marks every unread row read; `{ ids: [...] }` (≤ 200) marks the listed ids only. Ids that don't belong to the caller silently no-op.",
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: {
              type: "object",
              properties: {
                all: { type: "boolean" },
                ids: { type: "array", items: { type: "string", format: "uuid" }, maxItems: 200 },
              },
            },
          },
        },
      },
      responses: {
        "200": { description: "{ marked: number, all?: boolean }" },
        "400": { description: "Validation error" },
      },
    },
  };

  paths["/api/reports"] = {
    post: {
      summary: "File a community report",
      description:
        "Members report a comment, thread, reply, or another member. The report enters the moderation queue (`/api/admin/community/reports`). One row per submission — duplicate filings are not deduped.",
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: {
              type: "object",
              required: ["targetType", "targetId", "reason"],
              properties: {
                targetType: { type: "string", enum: ["comment", "thread", "reply", "member"] },
                targetId: { type: "string", format: "uuid" },
                reason: { type: "string", maxLength: 1000 },
              },
            },
          },
        },
      },
      responses: {
        "201": { description: "Report row" },
        "400": { description: "Validation error" },
        "401": { description: "Member auth required" },
      },
    },
  };
  paths["/api/admin/community/reports"] = {
    get: {
      summary: "List moderation reports (staff/mod only)",
      parameters: [
        {
          in: "query",
          name: "status",
          schema: { type: "string", enum: ["unresolved", "resolved", "all"] },
          description: "Default: `unresolved`.",
        },
        {
          in: "query",
          name: "targetType",
          schema: { type: "string", enum: ["comment", "thread", "reply", "member"] },
        },
        { in: "query", name: "limit", schema: { type: "integer", minimum: 1, maximum: 200 } },
        { in: "query", name: "page", schema: { type: "integer", minimum: 1 } },
      ],
      responses: {
        "200": { description: "Paginated report list" },
        "403": { description: "Requires admin / editor / moderator role" },
      },
    },
  };
  paths["/api/admin/community/reports/{id}/resolve"] = {
    post: {
      summary: "Resolve a moderation report",
      description:
        'Marks the report resolved with a free-form `resolution` label (e.g. `"hidden"`, `"banned"`, `"dismissed"`). The actual moderation action (hide / ban / etc.) is a separate call.',
      parameters: [
        { in: "path", name: "id", required: true, schema: { type: "string", format: "uuid" } },
      ],
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: {
              type: "object",
              required: ["resolution"],
              properties: { resolution: { type: "string" } },
            },
          },
        },
      },
      responses: {
        "200": { description: "Updated report row" },
        "400": { description: "Already resolved or validation error" },
        "403": { description: "Requires admin / editor / moderator role" },
        "404": { description: "Report not found" },
      },
    },
  };
  paths["/api/admin/community/bans"] = {
    get: {
      summary: "List active bans for a member",
      parameters: [
        {
          in: "query",
          name: "memberId",
          required: true,
          schema: { type: "string", format: "uuid" },
        },
      ],
      responses: {
        "200": { description: "Active ban rows for the member" },
        "400": { description: "memberId required" },
        "403": { description: "Requires admin / editor / moderator role" },
      },
    },
    post: {
      summary: "Issue a ban",
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: {
              type: "object",
              required: ["memberId", "scopeType"],
              properties: {
                memberId: { type: "string", format: "uuid" },
                scopeType: { type: "string", enum: ["site", "category", "collection"] },
                scopeId: {
                  type: "string",
                  nullable: true,
                  description: "Required for non-site scopes.",
                },
                kind: { type: "string", enum: ["temporary", "permanent"] },
                expiresAt: {
                  type: "string",
                  format: "date-time",
                  description: "Required when kind=temporary.",
                },
                reason: { type: "string", nullable: true },
              },
            },
          },
        },
      },
      responses: {
        "201": { description: "Ban row" },
        "400": { description: "Validation error" },
        "403": { description: "Requires admin / editor / moderator role" },
      },
    },
  };
  paths["/api/admin/community/bans/{id}"] = {
    delete: {
      summary: "Revoke a ban",
      parameters: [
        { in: "path", name: "id", required: true, schema: { type: "string", format: "uuid" } },
      ],
      responses: {
        "200": { description: "{ ok: true }" },
        "403": { description: "Requires admin / editor / moderator role" },
        "404": { description: "Ban not found" },
      },
    },
  };
  paths["/api/admin/community/comments/{id}"] = {
    delete: {
      summary: "Staff delete a comment",
      parameters: [
        { in: "path", name: "id", required: true, schema: { type: "string", format: "uuid" } },
      ],
      responses: {
        "200": { description: "{ ok: true }" },
        "403": { description: "Requires admin / editor / moderator role" },
      },
    },
  };
  paths["/api/admin/community/comments/{id}/hide"] = {
    post: {
      summary: "Staff hide a comment",
      parameters: [
        { in: "path", name: "id", required: true, schema: { type: "string", format: "uuid" } },
      ],
      requestBody: {
        content: {
          "application/json": {
            schema: { type: "object", properties: { reason: { type: "string" } } },
          },
        },
      },
      responses: {
        "200": { description: "{ ok: true }" },
        "403": { description: "Requires admin / editor / moderator role" },
      },
    },
  };
  paths["/api/admin/community/comments/{id}/restore"] = {
    post: {
      summary: "Staff restore a comment",
      parameters: [
        { in: "path", name: "id", required: true, schema: { type: "string", format: "uuid" } },
      ],
      responses: {
        "200": { description: "{ ok: true }" },
        "403": { description: "Requires admin / editor / moderator role" },
      },
    },
  };
  paths["/api/admin/audit"] = {
    get: {
      summary: "Read the moderation audit log",
      parameters: [
        { in: "query", name: "targetType", schema: { type: "string" } },
        { in: "query", name: "targetId", schema: { type: "string", format: "uuid" } },
        { in: "query", name: "actorUserId", schema: { type: "string", format: "uuid" } },
        { in: "query", name: "actorMemberId", schema: { type: "string", format: "uuid" } },
        { in: "query", name: "limit", schema: { type: "integer", minimum: 1, maximum: 200 } },
        { in: "query", name: "page", schema: { type: "integer", minimum: 1 } },
      ],
      responses: {
        "200": { description: "Paginated audit-event list" },
        "403": { description: "Requires admin / editor / moderator role" },
      },
    },
  };

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
        sessionCookie: { type: "apiKey", in: "cookie", name: "np-session" },
        csrfHeader: { type: "apiKey", in: "header", name: "X-CSRF-Token" },
      },
    },
    security: [{ sessionCookie: [], csrfHeader: [] }],
    paths,
  };
}

export async function GET() {
  await ensureFor("plugins");

  return NextResponse.json(buildSpec(), {
    headers: { "Cache-Control": "no-store" },
  });
}
