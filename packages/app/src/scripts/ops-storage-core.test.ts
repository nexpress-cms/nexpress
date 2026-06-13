import { describe, expect, it } from "vitest";

import {
  buildOpsStorageMigrationPlan,
  buildOpsStorageJson,
  collectOpsStorageDriftList,
  renderBriefOpsStorageStatus,
} from "./ops-storage-core.js";

describe("ops storage core", () => {
  it("builds a ready storage report", () => {
    expect(
      buildOpsStorageJson({
        adapter: "local",
        summary: {
          mediaRows: 2,
          indexedObjects: 3,
          localFiles: 3,
          missingFiles: 0,
          orphanedFiles: 0,
        },
        checks: [{ id: "storage.adapter", state: "ok", label: "Storage adapter" }],
      }),
    ).toEqual(
      expect.objectContaining({
        schemaVersion: "np.ops-storage.v1",
        ok: true,
        status: "ready",
        operation: "status",
        nextCommand: null,
        projectNextCommand: null,
      }),
    );
  });

  it("marks local media drift as attention", () => {
    const report = buildOpsStorageJson({
      adapter: "local",
      summary: {
        mediaRows: 1,
        indexedObjects: 1,
        localFiles: 2,
        missingFiles: 1,
        orphanedFiles: 1,
      },
      checks: [
        {
          id: "storage.local_integrity",
          state: "warn",
          label: "Local media files",
          detail: "1 missing, 1 orphaned",
        },
      ],
    });

    expect(report).toEqual(
      expect.objectContaining({
        ok: true,
        status: "attention",
        nextCommand: "nexpress ops storage verify --json",
        projectNextCommand: "pnpm run ops:storage -- verify --json",
      }),
    );
  });

  it("renders compact human output", () => {
    const report = buildOpsStorageJson({
      adapter: "s3",
      summary: {
        mediaRows: 0,
        indexedObjects: 0,
        localFiles: null,
        missingFiles: 0,
        orphanedFiles: 0,
      },
      checks: [{ id: "storage.s3_config", state: "ok", label: "S3 storage config" }],
    });

    expect(renderBriefOpsStorageStatus(report, { color: false })).toBe(
      [
        "NexPress ops storage",
        "ready: s3 (status)",
        "media: 0 rows, 0 indexed objects",
        "[ok] storage.s3_config S3 storage config",
      ].join("\n"),
    );
  });

  it("builds verify reports with verify follow-up commands", () => {
    const report = buildOpsStorageJson({
      adapter: "local",
      operation: "verify",
      summary: {
        mediaRows: 0,
        indexedObjects: 0,
        localFiles: null,
        missingFiles: 0,
        orphanedFiles: 0,
      },
      checks: [
        {
          id: "storage.local_directory",
          state: "warn",
          label: "Local storage directory",
        },
      ],
    });

    expect(report).toEqual(
      expect.objectContaining({
        operation: "verify",
        status: "attention",
        nextCommand: "nexpress ops storage test --json",
      }),
    );
  });

  it("renders storage test mutation audits", () => {
    const report = buildOpsStorageJson({
      adapter: "local",
      operation: "test",
      summary: {
        mediaRows: 0,
        indexedObjects: 0,
        localFiles: 0,
        missingFiles: 0,
        orphanedFiles: 0,
      },
      checks: [{ id: "storage.adapter", state: "ok", label: "Storage adapter" }],
      mutation: {
        action: "test",
        applied: false,
        mode: "dry-run",
        error: null,
        result: { probe: "dry-run" },
      },
    });

    expect(renderBriefOpsStorageStatus(report, { color: false })).toContain(
      "mutation: test applied=false",
    );
  });

  it("blocks local drift lists when the active adapter is not local", async () => {
    const report = await collectOpsStorageDriftList({
      operation: "missing-files",
      env: { NP_STORAGE_ADAPTER: "s3" },
    });

    expect(report).toEqual(
      expect.objectContaining({
        schemaVersion: "np.ops-storage-list.v1",
        ok: false,
        status: "blocked",
        adapter: "s3",
        operation: "missing-files",
        items: [],
      }),
    );
  });

  it("builds a read-only local-to-S3 migration plan contract", async () => {
    const report = await buildOpsStorageMigrationPlan({
      env: {
        NP_STORAGE_ADAPTER: "local",
        NP_S3_BUCKET: "media",
        NP_S3_REGION: "us-east-1",
      },
    });

    expect(report).toEqual(
      expect.objectContaining({
        schemaVersion: "np.ops-storage-migration-plan.v1",
        source: "local",
        target: "s3",
      }),
    );
    expect(report.commands).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          phase: "apply",
          command:
            "nexpress ops storage migrate apply --target s3 --execute --approve storage-migrate",
          projectCommand:
            "pnpm run ops:storage -- migrate apply --target s3 --execute --approve storage-migrate",
          requiresApproval: true,
        }),
      ]),
    );
  });

  it("blocks unsupported storage migration targets", async () => {
    const report = await buildOpsStorageMigrationPlan({
      target: "ftp",
      env: { NP_STORAGE_ADAPTER: "local" },
    });

    expect(report).toEqual(
      expect.objectContaining({
        ok: false,
        status: "blocked",
        target: "ftp",
      }),
    );
    expect(report.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "storage.migration_target",
          state: "error",
        }),
      ]),
    );
  });
});
