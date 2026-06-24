import { NpForbiddenError, NpValidationError, can } from "@nexpress/core";
import { readJsonBody } from "@nexpress/next";
import type { NextRequest } from "next/server";

import { npErrorResponse, npSuccessResponse } from "../../../../lib/api-response";
import { requireAuth } from "../../../../lib/auth-helpers";
import { ensureFor } from "../../../../lib/init-core";
import type * as OpsBackupCore from "../../../../scripts/ops-backup-core";
import type * as OpsMigrateCore from "../../../../scripts/ops-migrate-core";
import type * as OpsPluginsCore from "../../../../scripts/ops-plugins-core";
import type * as OpsStorageCore from "../../../../scripts/ops-storage-core";

type AdminOpsAction =
  | "storage.migrate.apply"
  | "plugins.enable"
  | "plugins.disable"
  | "migrate.apply-safe"
  | "backup.restore.apply";

interface AdminOpsActionBody {
  action?: unknown;
  execute?: unknown;
  approve?: unknown;
  target?: unknown;
  pluginId?: unknown;
  manifestId?: unknown;
}

function readBodyRecord(value: unknown): AdminOpsActionBody {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new NpValidationError("Invalid input", [
      { field: "body", message: "Expected a JSON object" },
    ]);
  }
  return value;
}

function readAction(value: unknown): AdminOpsAction {
  if (
    value === "storage.migrate.apply" ||
    value === "plugins.enable" ||
    value === "plugins.disable" ||
    value === "migrate.apply-safe" ||
    value === "backup.restore.apply"
  ) {
    return value;
  }
  throw new NpValidationError("Invalid input", [
    { field: "action", message: "Unsupported admin ops action" },
  ]);
}

function readOptionalString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function readExecute(value: unknown): boolean {
  if (value === undefined) return false;
  if (typeof value === "boolean") return value;
  throw new NpValidationError("Invalid input", [
    { field: "execute", message: "Must be a boolean" },
  ]);
}

function requireString(value: unknown, field: string): string {
  const parsed = readOptionalString(value);
  if (parsed) return parsed;
  throw new NpValidationError("Invalid input", [{ field, message: "Required" }]);
}

export async function POST(request: NextRequest) {
  try {
    await ensureFor("write");
    const user = await requireAuth(request);
    if (!can(user, "admin.manage")) {
      throw new NpForbiddenError("ops-actions", "mutate");
    }
    if (process.env.NP_REMOTE_OPS_MUTATIONS !== "1") {
      throw new NpForbiddenError("ops-actions", "mutate");
    }

    const body = readBodyRecord(await readJsonBody(request));
    const action = readAction(body.action);
    const execute = readExecute(body.execute);
    const approve = readOptionalString(body.approve);

    switch (action) {
      case "storage.migrate.apply": {
        const storageCore = await loadStorageCore();
        return npSuccessResponse(
          await storageCore.runOpsStorageMigrationApply({
            target: readOptionalString(body.target) ?? "s3",
            execute,
            approve,
          }),
        );
      }
      case "plugins.enable":
      case "plugins.disable": {
        const pluginsCore = await loadPluginsCore();
        return npSuccessResponse(
          await pluginsCore.runOpsPluginsMutation({
            action: action === "plugins.enable" ? "enable" : "disable",
            pluginId: requireString(body.pluginId, "pluginId"),
            execute,
            approve,
          }),
        );
      }
      case "migrate.apply-safe": {
        const migrateCore = await loadMigrateCore();
        return npSuccessResponse(
          await migrateCore.runOpsMigrateApply({
            safe: true,
            execute,
            approve,
          }),
        );
      }
      case "backup.restore.apply": {
        const backupCore = await loadBackupCore();
        return npSuccessResponse(
          await backupCore.runOpsBackupRestoreApply({
            manifestId: readOptionalString(body.manifestId) ?? "latest",
            execute,
            approve,
          }),
        );
      }
    }
  } catch (error) {
    return npErrorResponse(error instanceof Error ? error : new Error("Unknown error"));
  }
}

export const dynamic = "force-dynamic";

async function loadStorageCore(): Promise<typeof OpsStorageCore> {
  return (await import("@nexpress/app/scripts/ops-storage-core")) as unknown as typeof OpsStorageCore;
}

async function loadPluginsCore(): Promise<typeof OpsPluginsCore> {
  return (await import("@nexpress/app/scripts/ops-plugins-core")) as unknown as typeof OpsPluginsCore;
}

async function loadMigrateCore(): Promise<typeof OpsMigrateCore> {
  return (await import("@nexpress/app/scripts/ops-migrate-core")) as unknown as typeof OpsMigrateCore;
}

async function loadBackupCore(): Promise<typeof OpsBackupCore> {
  return (await import("@nexpress/app/scripts/ops-backup-core")) as unknown as typeof OpsBackupCore;
}
