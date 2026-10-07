import { constants } from "node:fs";
import { open, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import {
  npAgentEvaluationReportMaxBytesV1,
  npRequireAgentEvaluationReportManifestV1,
  type NpAgentEvaluationReportInputV1,
} from "../agent-contract/evaluation-report-contract.js";

/** Explicit local files only, with one aggregate byte budget for the whole report. */
export async function npReadAgentEvaluationReportInputV1(
  manifestPath: string,
  cwd = process.cwd(),
): Promise<{ input: NpAgentEvaluationReportInputV1; sourcePaths: string[] }> {
  const sourcePaths: string[] = [];
  let remaining = npAgentEvaluationReportMaxBytesV1;
  async function read(path: string): Promise<unknown> {
    const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
      const metadata = await file.stat();
      if (!metadata.isFile() || metadata.size > remaining) throw new Error("Invalid report input");
      const buffer = Buffer.alloc(remaining + 1);
      let length = 0;
      while (length < buffer.length) {
        const { bytesRead } = await file.read(buffer, length, buffer.length - length, length);
        if (!bytesRead) break;
        length += bytesRead;
      }
      if (length > remaining) throw new Error("Invalid report input");
      remaining -= length;
      sourcePaths.push(path);
      return JSON.parse(buffer.subarray(0, length).toString("utf8")) as unknown;
    } finally {
      await file.close();
    }
  }
  const path = resolve(cwd, manifestPath);
  const manifest = npRequireAgentEvaluationReportManifestV1(await read(path));
  const entries: NpAgentEvaluationReportInputV1["entries"] = [];
  for (const entry of manifest.entries) {
    const load = (file: string) => read(resolve(dirname(path), file));
    entries.push({
      recipe: entry.recipe,
      current: {
        evaluation: await load(entry.evaluation),
        review: entry.review === null ? null : await load(entry.review),
      },
      baseline:
        entry.baseline === null
          ? null
          : {
              evaluation: await load(entry.baseline.evaluation),
              review: entry.baseline.review === null ? null : await load(entry.baseline.review),
            },
    });
  }
  return { input: { schemaVersion: "np.agent-eval-report-input.v1", entries }, sourcePaths };
}

/** Protect the manifest and every declared input, including existing hardlink aliases. */
export async function npAssertAgentEvaluationReportOutputV1(
  outPath: string,
  sourcePaths: readonly string[],
  cwd = process.cwd(),
): Promise<void> {
  const destination = resolve(cwd, outPath);
  if (sourcePaths.includes(destination)) throw new Error("Invalid report output");
  const target = await stat(destination).catch((error: unknown) => {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT")
      return null;
    throw error;
  });
  if (target)
    for (const path of sourcePaths) {
      const source = await stat(path);
      if (source.dev === target.dev && source.ino === target.ino)
        throw new Error("Invalid report output");
    }
}
