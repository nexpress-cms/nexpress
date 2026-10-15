import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { buildDoctorJson, type DoctorJsonOutput } from "../../scripts/doctor-output";
import { buildReleaseJson, type ReleaseJson } from "../../scripts/release-core";
import type { NpOpsStatusV1 } from "@nexpress/core/agent-contract";

export interface NpAgentOperatorReportSourcesV1 {
  /** Host-selected retained output from the shipped Doctor JSON owner. No CLI is invoked. */
  doctor?: { path: string; maximumAgeSeconds?: number };
  /** Host-selected retained np.release.v1 output. No release command is invoked. */
  release?: { path: string; maximumAgeSeconds?: number };
}
const checkId = (v: unknown): v is string =>
  typeof v === "string" &&
  v.length <= 96 &&
  /^[a-z][a-z0-9_-]{0,39}(?:\.[a-z][a-z0-9_-]{0,39})*$/.test(v);
const record = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
/** Concrete bounded artifact reader. Paths/errors/report command text never leave this owner. */
async function read(source: { path: string; maximumAgeSeconds?: number }) {
  const age = source.maximumAgeSeconds ?? 300;
  if (!Number.isSafeInteger(age) || age < 1 || age > 86400)
    throw new Error("Invalid report bound.");
  const handle = await open(
    source.path,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  );
  try {
    const before = await handle.stat();
    if (
      !before.isFile() ||
      before.size > 65536 ||
      before.mtimeMs > Date.now() ||
      Date.now() - before.mtimeMs > age * 1000
    )
      throw new Error("Report unavailable.");
    const bytes = Buffer.alloc(65537);
    const loaded = await handle.read(bytes, 0, bytes.length, 0);
    const content = bytes.subarray(0, loaded.bytesRead).toString("utf8");
    const after = await handle.stat();
    if (
      Buffer.byteLength(content) > 65536 ||
      before.size !== after.size ||
      before.mtimeMs !== after.mtimeMs ||
      before.ctimeMs !== after.ctimeMs
    )
      throw new Error("Report changed.");
    return JSON.parse(content) as unknown;
  } finally {
    await handle.close();
  }
}
export async function npCollectAgentOperatorReportChecksV1(
  sources: NpAgentOperatorReportSourcesV1,
): Promise<NpOpsStatusV1["checks"]> {
  const checks: NpOpsStatusV1["checks"] = [];
  for (const family of ["doctor", "release"] as const) {
    const source = sources[family];
    if (!source) continue;
    try {
      const value = await read(source);
      if (!record(value)) throw new Error("Invalid report.");
      if (family === "doctor") {
        if (
          value.schemaVersion !== "np.doctor.v1" ||
          !Array.isArray(value.checks) ||
          value.checks.length < 1 ||
          value.checks.length > 64 ||
          !["dev", "prod"].includes(String(value.mode)) ||
          ![null, "docker", "vercel", "fly", "railway", "render"].includes(
            value.target as string | null,
          ) ||
          value.checks.some(
            (c) =>
              !record(c) || !checkId(c.id) || !["ok", "warn", "error"].includes(String(c.state)),
          ) ||
          new Set(value.checks.map((c) => (c as Record<string, unknown>).id)).size !==
            value.checks.length
        )
          throw new Error("Invalid Doctor report.");
        const report = value as unknown as DoctorJsonOutput;
        const expected = buildDoctorJson({
          prodMode: report.mode === "prod",
          target: report.target,
          checks: report.checks,
        });
        if (
          expected.ok !== report.ok ||
          expected.blocksDeploy !== report.blocksDeploy ||
          JSON.stringify(expected.summary) !== JSON.stringify(report.summary)
        )
          throw new Error("Invalid Doctor summary.");
        checks.push(
          ...report.checks.map((c) => ({
            id: c.id,
            state: c.state,
            label: "Recorded Doctor check",
            detail:
              "Bounded recent shipped Doctor report. This is retained evidence, not a fresh external health probe.",
          })),
        );
      } else {
        const allowed = [
          "ops.preflight",
          "ops.health",
          "ops.backup",
          "ops.jobs",
          "ops.migrate",
          "ops.storage",
          "ops.plugins",
        ];
        if (
          value.schemaVersion !== "np.release.v1" ||
          !["check", "plan", "verify"].includes(String(value.mode)) ||
          !Array.isArray(value.steps) ||
          value.steps.length < 1 ||
          value.steps.length > 7 ||
          value.steps.some(
            (s) =>
              !record(s) ||
              !allowed.includes(String(s.id)) ||
              typeof s.ok !== "boolean" ||
              !Number.isInteger(s.exitCode) ||
              typeof s.status !== "string" ||
              (s.report !== null && !record(s.report)),
          ) ||
          new Set(value.steps.map((s) => (s as Record<string, unknown>).id)).size !==
            value.steps.length
        )
          throw new Error("Invalid release report.");
        const report = value as unknown as ReleaseJson;
        const expected = buildReleaseJson({
          mode: report.mode,
          target: report.target,
          url: report.url,
          steps: report.steps,
        });
        if (
          expected.ok !== report.ok ||
          expected.status !== report.status ||
          JSON.stringify(expected.summary) !== JSON.stringify(report.summary)
        )
          throw new Error("Invalid release summary.");
        checks.push(
          ...report.steps.map((step) => {
            const one = buildReleaseJson({ mode: report.mode, steps: [step] });
            return {
              id: step.id,
              state:
                one.status === "blocked"
                  ? ("error" as const)
                  : one.status === "attention"
                    ? ("warn" as const)
                    : ("ok" as const),
              label: "Recorded release step",
              detail:
                "Bounded recent shipped release report. Commands, destinations and private diagnostics are excluded.",
            };
          }),
        );
      }
    } catch {
      checks.push({
        id: `${family}.observation`,
        state: "warn",
        label: `Recorded ${family} evidence`,
        detail:
          "Recorded source evidence is unavailable, stale, oversized or invalid; its health is unknown.",
      });
    }
  }
  return checks;
}
