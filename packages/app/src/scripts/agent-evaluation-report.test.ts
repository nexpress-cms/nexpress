import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { npRequireAgentEvaluationReportV1 } from "@nexpress/core/agents";
import { runAgentEvaluateProcessV1 } from "./agent-evaluate.js";
const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});
async function run(argv: string[]) {
  let output = "";
  const resolveProvider = vi.fn(() => Promise.resolve(null));
  const code = await runAgentEvaluateProcessV1({
    argv: [...argv, "--json"],
    resolveProvider,
    output: {
      write: (chunk: string) => {
        output += chunk;
        return true;
      },
    },
  });
  expect(resolveProvider).not.toHaveBeenCalled();
  return { code, result: JSON.parse(output) };
}
it("writes a recomputable report, retains missing evidence and never overwrites a prior report on invalid input", async () => {
  const dir = await mkdtemp(join(tmpdir(), "np-report-app-"));
  dirs.push(dir);
  await mkdir(join(dir, "reports"));
  const source = join(dir, "evaluation.json"),
    review = join(dir, "review.json"),
    path = join(dir, "reports", "manifest.json"),
    out = join(dir, "report.json");
  expect((await run(["--dataset", "operator-plan.v1", "--out", source])).code).toBe(0);
  expect((await run(["--review", source, "--out", review])).code).toBe(0);
  const manifest = {
    schemaVersion: "np.agent-eval-report-manifest.v1",
    entries: [
      {
        recipe: "operator",
        evaluation: "../evaluation.json",
        review: "../review.json",
        baseline: { evaluation: "../evaluation.json", review: "../review.json" },
      },
    ],
  };
  await writeFile(path, JSON.stringify(manifest));
  const reported = await run(["--report", path, "--out", out]);
  expect(reported.code).toBe(0);
  expect(reported.result.schemaVersion).toBe("np.agent-eval-report-command.v1");
  const artifact = await npRequireAgentEvaluationReportV1(JSON.parse(await readFile(out, "utf8")));
  expect(artifact.fullR6).toBe("not-established");
  expect(artifact.rows.map((row) => row.status)).toEqual(["missing", "present", "missing"]);
  expect(artifact.rows[1].reviewComparison.result).toMatchObject({
    comparable: false,
    reason: "NO_MATCHED_REVIEW_COHORT",
  });
  expect((await run(["--report", path, "--out", source])).result.errorCode).toBe(
    "ARTIFACT_UNAVAILABLE",
  );
  const before = await readFile(out, "utf8");
  await writeFile(path, JSON.stringify({ ...manifest, unexpected: true }));
  expect((await run(["--report", path, "--out", out])).result.errorCode).toBe("ARTIFACT_INVALID");
  expect(await readFile(out, "utf8")).toBe(before);
  for (const args of [
    ["--report", path, "--dataset", "operator-plan.v1"],
    ["--report", path, "--review", source],
    ["--report", path, "--confirm-network"],
  ])
    expect((await run(args)).result.errorCode).toBe("ARGUMENT_INVALID");
}, 20_000);
