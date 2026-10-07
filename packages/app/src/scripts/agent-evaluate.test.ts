import { link, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  npRequireAgentEvaluationArtifactV1,
  npRequireAgentEvaluationReviewArtifactV1,
} from "@nexpress/core/agent-contract";
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
  it("reviews Publisher proposals offline, saves exact labels and compares the matched cohort", async () => {
    const dir = await directory();
    const sourcePath = join(dir, "source.json"),
      reviewPath = join(dir, "review.json"),
      labelsPath = join(dir, "labels.json");
    expect((await run(["--dataset", "publisher.v1", "--out", sourcePath, "--json"])).code).toBe(0);
    const templateResult = await run(["--review", sourcePath, "--out", reviewPath, "--json"]);
    expect(templateResult.code).toBe(0);
    expect(templateResult.resolveProvider).not.toHaveBeenCalled();
    const template = await npRequireAgentEvaluationReviewArtifactV1(
      JSON.parse(await readFile(reviewPath, "utf8")),
    );
    expect(template.summary.reviewed).toBe(0);
    const e = template.entries.find((entry) => entry.eligible)!;
    const labels = [
      {
        caseId: e.caseId,
        caseHash: e.caseHash,
        predictionHash: e.predictionHash,
        sourceHash: e.sourceHash,
        outcome: "accept",
        reviewer: "offline-reviewer",
        reviewedAt: "2026-10-05T12:00:00.000Z",
        notes: "Verified against synthetic source.",
        editedProposal: null,
      },
    ];
    await writeFile(labelsPath, JSON.stringify(labels));
    const reviewed = await run([
      "--review",
      sourcePath,
      "--reviews",
      labelsPath,
      "--out",
      reviewPath,
      "--json",
    ]);
    expect(reviewed.code).toBe(0);
    expect(reviewed.resolveProvider).not.toHaveBeenCalled();
    expect(JSON.parse(reviewed.output).artifact.summary.accepted).toBe(1);
    const comparison = await run([
      "--review",
      sourcePath,
      "--reviews",
      labelsPath,
      "--compare",
      reviewPath,
      "--json",
    ]);
    expect(JSON.parse(comparison.output).comparison).toMatchObject({
      comparable: true,
      acceptBasisPointsDelta: 0,
    });
    labels[0].predictionHash = "tampered";
    await writeFile(labelsPath, JSON.stringify(labels));
    expect(
      JSON.parse((await run(["--review", sourcePath, "--reviews", labelsPath, "--json"])).output)
        .errorCode,
    ).toBe("ARTIFACT_INVALID");
  });
  // This workflow revalidates complete artifacts for each alias and tampering check.
  it("refuses review symlink inputs, source/label/baseline overwrites and hardlink aliases", async () => {
    const dir = await directory();
    const sourcePath = join(dir, "source.json"),
      labelsPath = join(dir, "labels.json"),
      reviewPath = join(dir, "review.json"),
      alias = join(dir, "source-alias.json"),
      symbolic = join(dir, "source-symlink.json");
    await run(["--dataset", "publisher.v1", "--out", sourcePath]);
    await writeFile(labelsPath, "[]");
    await run(["--review", sourcePath, "--out", reviewPath]);
    await link(sourcePath, alias);
    await symlink(sourcePath, symbolic);
    const sourceBytes = await readFile(sourcePath, "utf8"),
      reviewBytes = await readFile(reviewPath, "utf8");
    for (const args of [
      ["--review", symbolic],
      ["--review", sourcePath, "--out", sourcePath],
      ["--review", sourcePath, "--out", alias],
      ["--review", sourcePath, "--reviews", labelsPath, "--out", labelsPath],
      ["--review", sourcePath, "--compare", reviewPath, "--out", reviewPath],
      ["--review", sourcePath, "--out", symbolic],
    ]) {
      const result = await run([...args, "--json"]);
      expect(result.code).toBe(1);
      expect(result.resolveProvider).not.toHaveBeenCalled();
      expect(result.output).not.toContain(dir);
    }
    expect(await readFile(sourcePath, "utf8")).toBe(sourceBytes);
    expect(await readFile(reviewPath, "utf8")).toBe(reviewBytes);
    expect(await readFile(labelsPath, "utf8")).toBe("[]");
    const tampered = JSON.parse(reviewBytes);
    tampered.summary.accepted = 100;
    await writeFile(reviewPath, JSON.stringify(tampered));
    expect(
      JSON.parse((await run(["--review", sourcePath, "--compare", reviewPath, "--json"])).output)
        .errorCode,
    ).toBe("ARTIFACT_INVALID");
  }, 20_000);
});
