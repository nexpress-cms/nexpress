import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type * as NpCore from "@nexpress/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  sync: vi.fn(),
  update: vi.fn(),
  query: vi.fn(),
  connect: vi.fn(),
  end: vi.fn(),
  clients: [] as unknown[],
}));
vi.mock("@nexpress/core", async (importOriginal) => ({
  ...(await importOriginal<typeof NpCore>()),
  syncPluginRegistrations: mocks.sync,
  updatePluginState: mocks.update,
}));
vi.mock("pg", () => ({
  default: {
    Client: class {
      constructor() {
        mocks.clients.push(this);
      }
      connect = mocks.connect;
      query = mocks.query;
      end = mocks.end;
    },
  },
}));
vi.mock("drizzle-orm/node-postgres", () => ({ drizzle: (client: unknown) => client }));
import { runOpsPluginsMutation } from "./ops-plugins-core.js";
const projects: string[] = [];
beforeEach(() => {
  vi.clearAllMocks();
  mocks.clients.length = 0;
  mocks.query.mockResolvedValue({ rows: [{ id: "default", siteExists: true, enabled: null }] });
  mocks.sync.mockResolvedValue(undefined);
  mocks.update.mockResolvedValue({ enabled: false });
});
afterEach(async () => {
  await Promise.all(projects.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});
async function fixture() {
  const cwd = await mkdtemp(join(tmpdir(), "np-ops-plugin-domain-"));
  projects.push(cwd);
  await writeFile(
    join(cwd, "nexpress.config.ts"),
    'export default { plugins: [{ manifest: { id: "demo", name: "Demo", version: "1.0.0" } }] };\n',
  );
  return {
    action: "disable" as const,
    pluginId: "demo",
    siteId: "default",
    cwd,
    env: { DATABASE_URL: "postgres://synthetic.invalid/test" },
    out: join(cwd, "result.json"),
  };
}
describe("local plugin activation shares the committed Core owner", () => {
  it("uses its existing client and shared mutation facade instead of direct activation SQL", async () => {
    const f = await fixture(),
      result = await runOpsPluginsMutation({ ...f, execute: true, approve: "plugin-disable" });
    expect(result.mutation.applied).toBe(true);
    expect(mocks.clients).toHaveLength(1);
    expect(mocks.sync).toHaveBeenCalledWith(mocks.clients[0], ["demo"]);
    expect(mocks.update).toHaveBeenCalledWith(
      mocks.clients[0],
      "demo",
      { enabled: false },
      "default",
      { actor: { kind: "system", component: "ops.plugins" } },
    );
    expect(
      mocks.query.mock.calls.every(
        ([sql]) => typeof sql === "string" && !/insert|update|delete/iu.test(sql),
      ),
    ).toBe(true);
    expect(mocks.end).toHaveBeenCalledOnce();
  });
  it("never turns a source/commit failure into success or exposes its private message", async () => {
    const f = await fixture();
    mocks.update.mockRejectedValueOnce(new Error("private-source-key-marker"));
    const result = await runOpsPluginsMutation({ ...f, execute: true, approve: "plugin-disable" });
    expect(result.mutation.applied).toBe(false);
    expect(JSON.stringify(result)).not.toContain("private-source-key-marker");
    expect(mocks.end).toHaveBeenCalledOnce();
  });
  it("preserves explicit approval and read-only planning without activating plugins", async () => {
    const f = await fixture();
    await runOpsPluginsMutation({ ...f, execute: true });
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.connect).not.toHaveBeenCalled();
    await runOpsPluginsMutation({ ...f, execute: false });
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.sync).not.toHaveBeenCalled();
  });
});
