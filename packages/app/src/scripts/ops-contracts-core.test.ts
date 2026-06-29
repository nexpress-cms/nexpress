import { describe, expect, it } from "vitest";

import { buildOpsContractsJson, renderBriefOpsContracts } from "./ops-contracts-core.js";

describe("ops contracts core", () => {
  it("builds the local ops contract registry", () => {
    const report = buildOpsContractsJson();

    expect(report).toEqual(
      expect.objectContaining({
        schemaVersion: "np.ops-contracts.v1",
        ok: true,
        status: "ready",
      }),
    );
    expect(report.summary.contracts).toBe(report.contracts.length);
    expect(report.summary.shipped).toBeGreaterThan(10);
    expect(report.summary.deferred).toBe(0);
    expect(report.summary.destructiveDeferred).toBe(0);
    expect(report.contracts.map((contract) => contract.id)).toEqual(
      [...report.contracts.map((contract) => contract.id)].sort(),
    );
  });

  it("documents the shipped release and runbook artifacts", () => {
    const report = buildOpsContractsJson();
    const contracts = report.contracts.find((contract) => contract.id === "ops.contracts");
    const release = report.contracts.find((contract) => contract.id === "release");
    const runbook = report.contracts.find((contract) => contract.id === "runbook");

    expect(contracts).toEqual(
      expect.objectContaining({
        status: "shipped",
        risk: "read-only",
        schemaVersions: ["np.ops-contracts.v1"],
        supports: expect.objectContaining({ json: true, brief: true }),
      }),
    );
    expect(release).toEqual(
      expect.objectContaining({
        status: "shipped",
        risk: "bounded-mutation",
        schemaVersions: ["np.release.v1", "np.release-plan.v1", "np.release-apply.v1"],
        supports: expect.objectContaining({ json: true, out: true }),
        artifact: expect.objectContaining({ writes: true }),
        approval: expect.objectContaining({ required: true }),
      }),
    );
    expect(runbook).toEqual(
      expect.objectContaining({
        status: "shipped",
        risk: "read-only",
        schemaVersions: ["np.runbook.v1"],
        supports: expect.objectContaining({ json: true, out: true }),
        artifact: expect.objectContaining({ writes: true }),
      }),
    );
  });

  it("documents shipped approval-gated mutation surfaces", () => {
    const report = buildOpsContractsJson();
    const mutationContracts = report.contracts.filter((contract) =>
      [
        "ops.migrate.apply-safe",
        "ops.storage.migrate-apply",
        "ops.backup.restore-apply",
        "ops.plugins.mutate",
      ].includes(contract.id),
    );

    expect(mutationContracts).toHaveLength(4);
    for (const contract of mutationContracts) {
      expect(contract).toEqual(
        expect.objectContaining({
          status: "shipped",
          artifact: expect.objectContaining({ writes: true }),
          approval: expect.objectContaining({ required: true }),
        }),
      );
      expect(contract.schemaVersions.length).toBeGreaterThan(0);
    }
  });

  it("documents the shipped read-only admin ops API separately from mutations", () => {
    const report = buildOpsContractsJson();
    const readApi = report.contracts.find((contract) => contract.id === "remote.ops-api.read");
    const mutationApi = report.contracts.find((contract) => contract.id === "remote.ops-api");

    expect(readApi).toEqual(
      expect.objectContaining({
        status: "shipped",
        risk: "read-only",
        command: "GET /api/admin/ops/status|doctor|health|readiness|jobs|storage|plugins",
        schemaVersions: expect.arrayContaining(["np.ops.v1", "np.doctor.v1"]),
        supports: expect.objectContaining({ json: true }),
      }),
    );
    expect(mutationApi).toEqual(
      expect.objectContaining({
        status: "shipped",
        risk: "destructive",
        command: "POST /api/admin/ops/actions",
        schemaVersions: expect.arrayContaining(["np.ops-cache-revalidate.v1"]),
      }),
    );
    expect(mutationApi?.notes.join(" ")).toContain("NP_REMOTE_OPS_MUTATIONS=1");
    expect(mutationApi?.notes.join(" ")).toContain("cache.revalidate");
  });

  it("renders compact contract output", () => {
    const output = renderBriefOpsContracts(buildOpsContractsJson(), { color: false });

    expect(output).toContain("NexPress ops contracts");
    expect(output).toContain("[shipped] release bounded-mutation");
    expect(output).toContain("[shipped] remote.ops-api destructive");
  });
});
