import { describe, expect, it, vi } from "vitest";
import type * as NpCore from "@nexpress/core";

vi.mock("@nexpress/core", async (importOriginal) => {
  const actual = await importOriginal<typeof NpCore>();
  return {
    ...actual,
    getPluginRoutes: () => [
      {
        pluginId: "payments",
        method: "POST",
        path: "/json",
        bodyMode: "json",
        auth: false,
        handler: vi.fn(),
      },
      {
        pluginId: "payments",
        method: "POST",
        path: "/webhook",
        bodyMode: "raw",
        auth: true,
        handler: vi.fn(),
      },
    ],
  };
});

vi.mock("../../lib/init-core", () => ({ ensureFor: vi.fn(() => Promise.resolve()) }));

import { buildSpec } from "./route.js";

describe("OpenAPI plugin request bodies", () => {
  it("distinguishes parsed JSON from bounded exact raw bytes", () => {
    const spec = buildSpec(new Set(["payments"])) as {
      paths: Record<
        string,
        {
          post: {
            security: unknown[];
            requestBody?: {
              description?: string;
              content: Record<string, { schema: Record<string, unknown> }>;
            };
          };
        }
      >;
    };

    expect(spec.paths["/api/plugins/payments/json"]?.post.requestBody).toEqual({
      required: false,
      content: {
        "application/json": {
          schema: {},
        },
      },
    });
    expect(spec.paths["/api/plugins/payments/json"]?.post.security).toEqual([]);
    expect(spec.paths["/api/plugins/payments/webhook"]?.post.requestBody).toEqual({
      required: false,
      description: "Exact request bytes, limited to 1048576 bytes.",
      content: {
        "*/*": {
          schema: { type: "string", format: "binary" },
        },
      },
    });
    expect(spec.paths["/api/plugins/payments/webhook"]?.post.security).toEqual([
      { sessionCookie: [] },
    ]);
  });
});
