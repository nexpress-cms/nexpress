import { describe, expect, it } from "vitest";

import { buildOpsStorageJson, renderBriefOpsStorageStatus } from "./ops-storage-core.js";

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
        nextCommand: null,
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
        nextCommand: "nexpress ops storage status --json",
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
        "ready: s3",
        "media: 0 rows, 0 indexed objects",
        "[ok] storage.s3_config S3 storage config",
      ].join("\n"),
    );
  });
});
