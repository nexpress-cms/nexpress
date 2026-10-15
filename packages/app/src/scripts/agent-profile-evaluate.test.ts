import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runAgentEvaluateProcessV1 } from "./agent-evaluate";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});
describe("new profile evaluation CLI composition", () => {
  it.each(["moderator-assessment.v1", "publisher.v3"])(
    "exports, reviews and reports %s without bootstrap or network",
    async (dataset) => {
      const root = await mkdtemp(join(tmpdir(), "np-profile-cli-"));
      directories.push(root);
      const evaluation = join(root, "evaluation.json");
      const review = join(root, "review.json");
      const report = join(root, "report.json");
      const manifest = join(root, "manifest.json");
      const resolveProvider = vi.fn();
      const output = { write: vi.fn(() => true) };
      expect(
        await runAgentEvaluateProcessV1({
          argv: ["--dataset", dataset, "--out", evaluation, "--json"],
          output,
          resolveProvider,
        }),
      ).toBe(0);
      expect(resolveProvider).not.toHaveBeenCalled();
      const artifact = JSON.parse(await readFile(evaluation, "utf8")) as {
        ok: boolean;
        suiteVersion: string;
      };
      expect(artifact.ok).toBe(true);
      expect(
        await runAgentEvaluateProcessV1({
          argv: ["--dataset", dataset, "--compare", evaluation, "--json"],
          output,
          resolveProvider,
        }),
      ).toBe(0);
      expect(artifact.suiteVersion).toBe(
        dataset === "publisher.v3"
          ? "publisher-selection-review:3"
          : "moderator-semantic-assessment:1",
      );
      expect(
        await runAgentEvaluateProcessV1({
          argv: ["--review", evaluation, "--out", review, "--json"],
          output,
          resolveProvider,
        }),
      ).toBe(0);
      const reviewed = JSON.parse(await readFile(review, "utf8")) as {
        schemaVersion: string;
        summary: { reviewed: number; unreviewed: number };
      };
      expect(reviewed.schemaVersion).toBe("np.agent-profile-eval-review.v1");
      expect(reviewed.summary.reviewed).toBe(0);
      expect(reviewed.summary.unreviewed).toBeGreaterThan(0);
      const recipe = dataset === "publisher.v3" ? "publisher-selection" : "moderator-assessment";
      await writeFile(
        manifest,
        JSON.stringify({
          schemaVersion: "np.agent-eval-report-manifest.v1",
          entries: [
            { recipe, evaluation: "evaluation.json", review: "review.json", baseline: null },
          ],
        }),
      );
      expect(
        await runAgentEvaluateProcessV1({
          argv: ["--report", manifest, "--out", report, "--json"],
          output,
          resolveProvider,
        }),
      ).toBe(0);
      const reported = JSON.parse(await readFile(report, "utf8")) as {
        fullR6: string;
        modelUsefulness: string;
        rows: { recipe: string; fixtureGate: string }[];
      };
      expect(reported.rows.find((row) => row.recipe === recipe)?.fixtureGate).toBe("passed");
      expect(reported.fullR6).toBe("not-established");
      expect(reported.modelUsefulness).toBe("not-established");
      expect(resolveProvider).not.toHaveBeenCalled();
    },
  );
});
