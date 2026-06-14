import { describe, expect, it } from "vitest";

import { buildRunbookJson, renderBriefRunbook, type RunbookEvidence } from "./runbook-core.js";

const readyEvidence: RunbookEvidence = {
  id: "ops.jobs",
  command: "pnpm run ops:jobs -- --json",
  ok: true,
  status: "ready",
  nextCommand: null,
};

describe("runbook core", () => {
  it("builds a ready runbook contract", () => {
    expect(
      buildRunbookJson({
        runbook: "worker-not-draining",
        evidence: [readyEvidence],
        artifactPath: ".nexpress/runbooks/worker.json",
      }),
    ).toEqual(
      expect.objectContaining({
        schemaVersion: "np.runbook.v1",
        ok: true,
        status: "ready",
        runbook: "worker-not-draining",
        risk: "medium",
        audit: { artifactPath: ".nexpress/runbooks/worker.json" },
      }),
    );
  });

  it("promotes blocked evidence to a blocked runbook", () => {
    const report = buildRunbookJson({
      runbook: "migration-crashed",
      evidence: [
        {
          id: "ops.status",
          command: "pnpm run ops:status -- --json",
          ok: false,
          status: "blocked",
          nextCommand: "pnpm run doctor -- --fix-plan",
        },
      ],
    });

    expect(report).toEqual(
      expect.objectContaining({
        ok: false,
        status: "blocked",
        risk: "high",
        nextCommands: [
          "pnpm run doctor -- --fix-plan",
          "nexpress ops migrate status --json",
          "nexpress ops migrate plan --json",
          "nexpress ops migrate rollback-plan --json",
        ],
        projectNextCommands: [
          "pnpm run doctor -- --fix-plan",
          "pnpm run ops:migrate -- status --json",
          "pnpm run ops:migrate -- plan --json",
          "pnpm run ops:migrate -- rollback-plan --json",
        ],
      }),
    );
  });

  it("preserves nested evidence next commands in runbook order", () => {
    const report = buildRunbookJson({
      runbook: "backup-restore-drill",
      evidence: [
        {
          id: "ops.backup.restore-plan",
          command: "pnpm run ops:backup -- restore-plan latest --json",
          schemaVersion: "np.ops-backup-restore-plan.v1",
          ok: false,
          status: "blocked",
          nextCommand: "nexpress ops backup restore-plan latest --json",
          nextCommands: [
            "nexpress ops backup verify latest --json",
            "nexpress release check --target docker --json",
          ],
        },
      ],
    });

    expect(report.nextCommands).toEqual([
      "nexpress ops backup restore-plan latest --json",
      "nexpress ops backup verify latest --json",
      "nexpress release check --target docker --json",
    ]);
    expect(report.projectNextCommands).toEqual([
      "pnpm run ops:backup -- restore-plan latest --json",
      "pnpm run ops:backup -- verify latest --json",
      "pnpm run ops:release -- check --target docker --json",
    ]);
    expect(report.evidence[0]).toEqual(
      expect.objectContaining({
        schemaVersion: "np.ops-backup-restore-plan.v1",
        nextCommands: [
          "nexpress ops backup verify latest --json",
          "nexpress release check --target docker --json",
        ],
      }),
    );
  });

  it("renders compact human output", () => {
    const report = buildRunbookJson({
      runbook: "worker-not-draining",
      evidence: [readyEvidence],
    });

    expect(renderBriefRunbook(report, { color: false })).toContain("ready: Worker not draining");
    expect(renderBriefRunbook(report, { color: false })).toContain("- [ok] ops.jobs ready");
  });

  it("renders runbook artifact paths in brief output", () => {
    const report = buildRunbookJson({
      runbook: "worker-not-draining",
      evidence: [readyEvidence],
      artifactPath: ".nexpress/runbooks/worker.json",
    });

    expect(renderBriefRunbook(report, { color: false })).toContain(
      "artifact: .nexpress/runbooks/worker.json",
    );
  });

  it("suggests an executable worker command when no worker evidence exists", () => {
    const report = buildRunbookJson({
      runbook: "worker-not-draining",
      evidence: [],
    });

    expect(report.nextCommands).toContain("NP_ENABLE_JOBS=1 pnpm run worker");
    expect(report.projectNextCommands).toContain("NP_ENABLE_JOBS=1 pnpm run worker");
  });

  it("suggests bounded retry and drain probes from worker evidence", () => {
    const report = buildRunbookJson({
      runbook: "worker-not-draining",
      evidence: [
        {
          ...readyEvidence,
          status: "attention",
          summary: {
            failed: 2,
            retry: 1,
            created: 3,
            active: 0,
          },
          nextCommand: "nexpress ops jobs retry-all --state failed --json",
        },
      ],
    });

    expect(report.nextCommands).toEqual([
      "nexpress ops jobs retry-all --state failed --json",
      "nexpress ops jobs drain --json",
    ]);
    expect(report.projectNextCommands).toEqual([
      "pnpm run ops:jobs -- retry-all --state failed --json",
      "pnpm run ops:jobs -- drain --json",
    ]);
  });

  it("suggests verify and probe commands for storage migration runbooks", () => {
    const report = buildRunbookJson({
      runbook: "storage-local-to-s3",
      evidence: [
        {
          id: "ops.storage",
          command: "pnpm run ops:storage -- --json",
          ok: true,
          status: "attention",
          nextCommand: "nexpress ops storage verify --json",
        },
      ],
    });

    expect(report.nextCommands).toEqual([
      "nexpress ops storage verify --json",
      "nexpress ops storage missing-files --json",
      "nexpress ops storage orphaned-files --json",
      "nexpress ops storage migrate plan --target s3 --json",
      "nexpress ops storage test --json",
      "nexpress ops preflight --target vercel --json",
    ]);
  });
});
