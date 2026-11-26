import { mkdtemp, writeFile, rm, symlink, utimes } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { buildDoctorJson } from "../../scripts/doctor-output";
import { buildReleaseJson } from "../../scripts/release-core";
import { npCollectAgentOperatorReportChecksV1 } from "./operator-report-sources";
const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});
async function file(name: string, value: unknown) {
  const directory = await mkdtemp(join(tmpdir(), "np-operator-report-"));
  directories.push(directory);
  const path = join(directory, name);
  await writeFile(path, JSON.stringify(value));
  // APFS may record submillisecond mtimes beyond the current Date.now() tick.
  const recordedAt = new Date(Date.now() - 1000);
  await utimes(path, recordedAt, recordedAt);
  return path;
}
describe("explicit retained Doctor and release evidence", () => {
  it("consumes shipped contracts preserving failed stable IDs and excluding private report fields", async () => {
    const doctor = await file(
      "doctor.json",
      buildDoctorJson({
        prodMode: true,
        target: "docker",
        checks: [
          {
            id: "jobs.contract",
            state: "error",
            label: "private label",
            detail: "/private/secret",
            hint: "secret command",
          },
        ],
      }),
    );
    const release = await file(
      "release.json",
      buildReleaseJson({
        mode: "check",
        target: "docker",
        url: "https://private.example",
        steps: [
          {
            id: "ops.migrate",
            command: "secret command",
            ok: false,
            exitCode: 1,
            status: "blocked",
            nextCommand: null,
            report: null,
            error: "/private/password",
          },
        ],
      }),
    );
    const checks = await npCollectAgentOperatorReportChecksV1({
      doctor: { path: doctor },
      release: { path: release },
    });
    expect(checks.map((c) => ({ id: c.id, state: c.state }))).toEqual([
      { id: "jobs.contract", state: "error" },
      { id: "ops.migrate", state: "error" },
    ]);
    expect(JSON.stringify(checks)).not.toMatch(/secret|password|private\.example|private label/);
  });
  it("keeps absent owners inactive and stale, oversized, symlink and inconsistent evidence unknown", async () => {
    expect(await npCollectAgentOperatorReportChecksV1({})).toEqual([]);
    const path = await file("doctor.json", {
      schemaVersion: "np.doctor.v1",
      mode: "dev",
      target: null,
      checks: [{ id: "jobs.contract", state: "error", label: "Jobs" }],
      ok: true,
      blocksDeploy: false,
      summary: { total: 1, errors: 0, warnings: 0 },
    });
    expect(await npCollectAgentOperatorReportChecksV1({ doctor: { path } })).toMatchObject([
      { id: "doctor.observation", state: "warn" },
    ]);
    await writeFile(path, " ".repeat(65537));
    expect(await npCollectAgentOperatorReportChecksV1({ doctor: { path } })).toMatchObject([
      { state: "warn" },
    ]);
    await writeFile(
      path,
      JSON.stringify(
        buildDoctorJson({
          prodMode: false,
          target: null,
          checks: [{ id: "jobs.contract", state: "ok", label: "Jobs" }],
        }),
      ),
    );
    const link = path + ".link";
    await symlink(path, link);
    expect(await npCollectAgentOperatorReportChecksV1({ doctor: { path: link } })).toMatchObject([
      { state: "warn" },
    ]);
    await utimes(path, new Date(0), new Date(0));
    expect(await npCollectAgentOperatorReportChecksV1({ doctor: { path } })).toMatchObject([
      { state: "warn" },
    ]);
  });
});
