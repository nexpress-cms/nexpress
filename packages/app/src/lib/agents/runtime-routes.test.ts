import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import {
  npAgentRuntimeStudioReadRoutesV1,
  npAgentRuntimeAdminOperationIdsV1,
  npGetAgentAdminOperationV1,
} from "@nexpress/core/agent-contract";
import { handleAgentRuntimeAdminRequest } from "./runtime-admin.js";

vi.mock("./runtime-admin.js", () => ({ handleAgentRuntimeAdminRequest: vi.fn() }));
beforeEach(() => vi.clearAllMocks());
const id = "10000000-0000-4000-8000-000000000001";

describe("Runtime route inventory and thin wrappers", () => {
  const root = resolve(fileURLToPath(new URL(".", import.meta.url)), "../../../../..");
  const inventory = [
    ...npAgentRuntimeStudioReadRoutesV1.map((route) => ({
      ...route,
      operation:
        route.kind === "configurations"
          ? route.detail
            ? "configuration"
            : "configurations"
          : route.kind === "policies"
            ? route.detail
              ? "policy"
              : "policies"
            : route.kind === "budgets"
              ? "budget"
              : route.kind === "runtime-status"
                ? "status"
                : route.kind,
    })),
    ...npAgentRuntimeAdminOperationIdsV1.map((id) => {
      const operation = npGetAgentAdminOperationV1(id);
      return { method: operation.method, path: operation.pathTemplate, operation: id };
    }),
  ];
  it("locks the exact nine read and fifteen installed Admin operations", () => {
    expect(npAgentRuntimeStudioReadRoutesV1).toHaveLength(9);
    expect(npAgentRuntimeAdminOperationIdsV1).toHaveLength(15);
    expect(new Set(inventory.map(({ method, path }) => `${method} ${path}`)).size).toBe(24);
  });
  it.each(inventory)(
    "keeps $method $path shared across reference and scaffold",
    async ({ path, method, operation }) => {
      const segment = path.replace(/^\/api\//u, "").replaceAll("{id}", "[id]");
      const modulePath = `../../api/${segment}/route.ts`;
      const route: Record<string, unknown> = await import(modulePath);
      const handler = route[method];
      if (typeof handler !== "function") throw new Error(`Missing ${method} ${path} export`);
      const request = new NextRequest(`https://site.example${path.replace("{id}", id)}`, {
        method,
      });
      const response = new Response(null, { status: 204 });
      vi.mocked(handleAgentRuntimeAdminRequest).mockResolvedValue(response);
      expect(await handler(request, { params: Promise.resolve({ id }) })).toBe(response);
      expect(handleAgentRuntimeAdminRequest).toHaveBeenCalledExactlyOnceWith(
        request,
        operation,
        ...(path.includes("{id}") ? [id] : []),
      );
      for (const base of ["apps/web/src/app/api", "packages/cli/templates/snapshot/src/app/api"]) {
        const wrapper = readFileSync(resolve(root, base, segment, "route.ts"), "utf8");
        expect(wrapper).toContain(`from "@nexpress/app/api/${segment}/route"`);
        expect(wrapper).toContain('dynamic = "force-dynamic"');
        expect(wrapper).not.toMatch(/createAgentRuntime|executeAdmin|new |fetch\(/u);
      }
    },
  );
});
