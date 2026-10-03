import { mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import { npRequireAgentEvaluationArtifactV1 } from "@nexpress/core/agent-contract";
import { parseAgentEvaluateArgsV1, runAgentEvaluateProcessV1 } from "./agent-evaluate.js";

const directories: string[] = [];
async function directory() {
  const path = await mkdtemp(join(tmpdir(), "np-agent-evaluate-"));
  directories.push(path);
  return path;
}
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});
const network = [
  "--provider",
  "isolated",
  "--dataset",
  "operator.v1",
  "--model",
  "pinned-v1",
  "--max-calls",
  "8",
  "--max-input-tokens",
  "1000",
  "--max-output-tokens",
  "1000",
  "--max-cost-micros",
  "1",
  "--confirm-network",
];
async function run(argv: string[], resolveProvider = vi.fn(() => Promise.resolve(null))) {
  let output = "";
  const code = await runAgentEvaluateProcessV1({
    argv,
    resolveProvider,
    output: {
      write: (chunk: string) => {
        output += chunk;
        return true;
      },
    },
  });
  return { code, output, resolveProvider };
}
describe("bounded Agent evaluation command", () => {
  it("writes a validated offline artifact and compares it without resolving a provider", async () => {
    const path = join(await directory(), "artifact.json");
    const first = await run(["--json", "--out", path]);
    expect(first.code).toBe(0);
    expect(first.resolveProvider).not.toHaveBeenCalled();
    const artifact = await npRequireAgentEvaluationArtifactV1(
      JSON.parse(await readFile(path, "utf8")),
    );
    expect(artifact.mode).toBe("fake");
    expect(artifact.ok).toBe(true);
    const second = await run(["--json", "--compare", path]);
    expect(second.code).toBe(0);
    expect(JSON.parse(second.output).comparison).not.toBeNull();
    const differentBudget = await run(["--compare", path, "--max-calls", "99"]);
    expect(differentBudget.code).toBe(0);
    expect(differentBudget.output).toContain("not comparable (BUDGET_MISMATCH)");
    expect(differentBudget.output).toContain("no regression conclusion");
    const text = await run([]);
    expect(text.output).toContain("model usefulness is not measured");
  });
  it("rejects missing confirmation, duplicate flags and invalid caps before provider lookup", async () => {
    for (const args of [
      network.filter((arg) => arg !== "--confirm-network"),
      ["--provider", "fake", "--provider", "fake"],
      ["--dataset", "private.json"],
      [...network, "--json", "--json"],
      ["--max-calls", "1e3"],
    ]) {
      const result = await run([...args, "--json"]);
      expect(result.code).toBe(1);
      expect(result.resolveProvider).not.toHaveBeenCalled();
      expect(JSON.parse(result.output).artifact).toBeNull();
    }
    const result = await run([...network, "--json"]);
    expect(result.resolveProvider).toHaveBeenCalledOnce();
    expect(JSON.parse(result.output).errorCode).toBe("PROVIDER_UNAVAILABLE");
  });
  it("contains provider errors and refuses symlink artifacts without disclosing paths", async () => {
    const provider = vi.fn(() => Promise.reject(new Error("private-provider-credential")));
    const failed = await run([...network, "--json"], provider);
    expect(failed.output).not.toContain("private-provider-credential");
    const dir = await directory();
    const target = join(dir, "private-artifact");
    await writeFile(target, "private-artifact-secret");
    const link = join(dir, "linked.json");
    await symlink(target, link);
    for (const args of [
      ["--compare", link],
      ["--out", link],
    ]) {
      const result = await run([...args, "--json"]);
      expect(result.code).toBe(1);
      expect(result.output).not.toContain(dir);
      expect(result.output).not.toContain("private-artifact-secret");
    }
    expect(await readFile(target, "utf8")).toBe("private-artifact-secret");
  });
  it("accepts pnpm's separator and defaults only to the versioned fake suite", () => {
    expect(parseAgentEvaluateArgsV1(["--", "--json"])).toMatchObject({
      provider: "fake",
      model: "deterministic-v1",
      dataset: "operator.v1",
      confirmNetwork: false,
      json: true,
    });
  });
});
