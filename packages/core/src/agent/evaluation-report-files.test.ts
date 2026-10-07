import { mkdtemp, writeFile, readFile, mkdir, symlink, link, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import {
  npReadAgentEvaluationReportInputV1,
  npAssertAgentEvaluationReportOutputV1,
} from "./evaluation-report-files.js";
import { npAgentEvaluationReportMaxBytesV1 } from "../agent-contract/evaluation-report-contract.js";
const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});
async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), "np-report-files-"));
  dirs.push(dir);
  await mkdir(join(dir, "inputs"));
  const paths = ["evaluation.json", "review.json", "baseline.json", "baseline-review.json"];
  for (const name of paths) await writeFile(join(dir, name), JSON.stringify({ name }));
  const manifest = {
    schemaVersion: "np.agent-eval-report-manifest.v1",
    entries: [
      {
        recipe: "operator",
        evaluation: "../evaluation.json",
        review: "../review.json",
        baseline: { evaluation: "../baseline.json", review: "../baseline-review.json" },
      },
    ],
  };
  const path = join(dir, "inputs", "manifest.json");
  await writeFile(path, JSON.stringify(manifest));
  return { dir, path, manifest };
}
it("resolves manifest-relative inputs and protects every source, including hardlink and symlink output aliases", async () => {
  const { dir, path } = await fixture();
  const loaded = await npReadAgentEvaluationReportInputV1("inputs/manifest.json", dir);
  expect(loaded.input.entries[0]).toMatchObject({
    recipe: "operator",
    current: { evaluation: { name: "evaluation.json" }, review: { name: "review.json" } },
    baseline: { evaluation: { name: "baseline.json" }, review: { name: "baseline-review.json" } },
  });
  expect(loaded.sourcePaths).toHaveLength(5);
  for (const source of loaded.sourcePaths)
    await expect(
      npAssertAgentEvaluationReportOutputV1(source, loaded.sourcePaths),
    ).rejects.toThrow();
  for (const alias of ["hard.json", "sym.json"]) {
    if (alias === "hard.json") await link(join(dir, "baseline.json"), join(dir, alias));
    else await symlink(path, join(dir, alias));
    await expect(
      npAssertAgentEvaluationReportOutputV1(alias, loaded.sourcePaths, dir),
    ).rejects.toThrow();
  }
  await expect(
    npAssertAgentEvaluationReportOutputV1("report.json", loaded.sourcePaths, dir),
  ).resolves.toBeUndefined();
  expect(JSON.parse(await readFile(join(dir, "evaluation.json"), "utf8"))).toEqual({
    name: "evaluation.json",
  });
});
it("rejects symlink inputs, non-files and aggregate byte overflow before report construction", async () => {
  const { dir, path, manifest } = await fixture();
  await symlink(path, join(dir, "manifest-link.json"));
  await expect(
    npReadAgentEvaluationReportInputV1(join(dir, "manifest-link.json")),
  ).rejects.toThrow();
  manifest.entries[0].evaluation = "..";
  await writeFile(path, JSON.stringify(manifest));
  await expect(npReadAgentEvaluationReportInputV1(path)).rejects.toThrow();
  await symlink(join(dir, "evaluation.json"), join(dir, "linked.json"));
  manifest.entries[0].evaluation = "../linked.json";
  await writeFile(path, JSON.stringify(manifest));
  await expect(npReadAgentEvaluationReportInputV1(path)).rejects.toThrow();
  manifest.entries[0].evaluation = "../evaluation.json";
  await writeFile(path, JSON.stringify(manifest));
  const text = JSON.stringify("x".repeat(npAgentEvaluationReportMaxBytesV1 / 2));
  await writeFile(join(dir, "evaluation.json"), text);
  await writeFile(join(dir, "review.json"), text);
  await expect(npReadAgentEvaluationReportInputV1(path)).rejects.toThrow();
});
