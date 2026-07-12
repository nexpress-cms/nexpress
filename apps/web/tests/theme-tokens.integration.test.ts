import { DEFAULT_THEME, npSettings } from "@nexpress/core";
import { npValidateThemeTokens } from "@nexpress/core/theme";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  buildRequest,
  closeTestDb,
  ensureMigrated,
  getTestDb,
  readJson,
  seedUser,
  skipIfNoTestDb,
  truncateAll,
} from "./harness.js";

import { GET, PUT } from "@/app/api/settings/theme/route";
import { GET as openApiGET } from "@/app/api/openapi.json/route";

describe.skipIf(skipIfNoTestDb())("theme token API contract (integration)", () => {
  beforeAll(async () => {
    await ensureMigrated();
  });
  beforeEach(async () => {
    await truncateAll();
  });
  afterAll(async () => {
    await closeTestDb();
  });

  it("returns a fully resolved token tree", async () => {
    const response = await GET(buildRequest("/api/settings/theme"));
    const { status, body } = await readJson<unknown>(response);
    expect(status).toBe(200);
    expect(npValidateThemeTokens(body)).toEqual({ ok: true });
  });

  it("persists a complete valid tree and returns it through the resolver", async () => {
    const session = await seedUser({ role: "admin" });
    const theme = {
      ...DEFAULT_THEME,
      colors: { ...DEFAULT_THEME.colors, primary: "#123456" },
    };
    const putResponse = await PUT(
      buildRequest("/api/settings/theme", { method: "PUT", session, body: theme }),
    );
    expect(putResponse.status).toBe(200);

    const getResponse = await GET(buildRequest("/api/settings/theme"));
    const { body } = await readJson<typeof DEFAULT_THEME>(getResponse);
    expect(body.colors.primary).toBe("#123456");
    expect(body.typography).toEqual(DEFAULT_THEME.typography);
  });

  it("rejects incomplete, unknown, and unsafe tokens before persistence", async () => {
    const session = await seedUser({ role: "admin" });
    const invalidBodies: unknown[] = [
      { colors: {}, typography: {}, shape: {} },
      { ...DEFAULT_THEME, colors: { ...DEFAULT_THEME.colors, brand: "#fff" } },
      {
        ...DEFAULT_THEME,
        colors: { ...DEFAULT_THEME.colors, primary: "url(https://example.com/x)" },
      },
    ];

    for (const body of invalidBodies) {
      const response = await PUT(
        buildRequest("/api/settings/theme", { method: "PUT", session, body }),
      );
      expect(response.status).toBe(400);
    }

    const db = await getTestDb();
    const rows = await db.select().from(npSettings);
    expect(rows.filter((row) => row.key === "theme")).toHaveLength(0);
  });

  it("fails closed when a malformed persisted overlay is read", async () => {
    const db = await getTestDb();
    await db.insert(npSettings).values({
      key: "theme",
      value: { colors: { primary: 42 } },
    });

    const response = await GET(buildRequest("/api/settings/theme"));
    const { status, body } = await readJson<{
      error: { code: string; details: Array<{ field: string }> };
    }>(response);
    expect(status).toBe(400);
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(body.error.details[0]?.field).toBe("settings.theme.colors.primary");
  });

  it("publishes the same closed token tree in OpenAPI", async () => {
    const response = await openApiGET();
    const { body } = await readJson<{
      paths: {
        "/api/settings/theme": {
          put: {
            requestBody: {
              content: {
                "application/json": {
                  schema: {
                    additionalProperties: boolean;
                    required: string[];
                    properties: Record<
                      string,
                      { additionalProperties: boolean; properties: Record<string, unknown> }
                    >;
                  };
                };
              };
            };
          };
        };
      };
    }>(response);
    const schema =
      body.paths["/api/settings/theme"].put.requestBody.content["application/json"].schema;
    expect(schema.additionalProperties).toBe(false);
    expect(schema.required).toEqual(["colors", "typography", "shape"]);
    expect(schema.properties.colors.additionalProperties).toBe(false);
    expect(schema.properties.colors.properties).toHaveProperty("primarySoft");
    expect(schema.properties.typography.properties).toHaveProperty("fontSize4xl");
    expect(schema.properties.shape.properties).toHaveProperty("shadowLg");
  });
});
