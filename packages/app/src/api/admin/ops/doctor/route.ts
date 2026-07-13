import { NpForbiddenError, NpValidationError, can } from "@nexpress/core";
import type { NextRequest } from "next/server";

import { npErrorResponse, npSuccessResponse } from "../../../../lib/api-response";
import { requireGlobalAuth } from "../../../../lib/auth-helpers";
import { ensureFor } from "../../../../lib/init-core";
import {
  DEPLOY_TARGETS,
  inferDeployTargetFromEnv,
  isDeployTarget,
  type DeployTarget,
} from "../../../../scripts/deploy-targets";
import type * as DoctorCore from "../../../../scripts/doctor-core";

export async function GET(request: NextRequest) {
  try {
    await ensureFor("plugins");
    const user = await requireGlobalAuth(request);
    if (!can(user, "admin.manage")) {
      throw new NpForbiddenError("ops-doctor", "read");
    }

    const searchParams = request.nextUrl.searchParams;
    const prodMode = readBooleanParam("prod", searchParams.get("prod")) ?? false;
    const includeFixPlan = readBooleanParam("fixPlan", searchParams.get("fixPlan")) ?? false;
    const target = resolveTarget(searchParams.get("target"), prodMode);
    const doctorCore = await loadDoctorCore();

    return npSuccessResponse(
      await doctorCore.collectDoctorReport({
        prodMode,
        target,
        includeFixPlan,
        env: process.env,
      }),
    );
  } catch (error) {
    return npErrorResponse(error instanceof Error ? error : new Error("Unknown error"));
  }
}

export const dynamic = "force-dynamic";

async function loadDoctorCore(): Promise<typeof DoctorCore> {
  return import("@nexpress/app/scripts/doctor-core");
}

function resolveTarget(rawTarget: string | null, prodMode: boolean): DeployTarget | null {
  if (rawTarget) {
    if (!isDeployTarget(rawTarget)) {
      throw new NpValidationError("Invalid query parameters", [
        {
          field: "target",
          message: `target must be one of: ${DEPLOY_TARGETS.join(", ")}`,
        },
      ]);
    }
    return prodMode ? rawTarget : null;
  }
  if (!prodMode) return null;
  return inferDeployTargetFromEnv(process.env);
}

function readBooleanParam(name: string, rawValue: string | null): boolean | null {
  if (rawValue === null || rawValue === "") return null;
  const value = rawValue.toLowerCase();
  if (value === "1" || value === "true" || value === "yes" || value === "on") return true;
  if (value === "0" || value === "false" || value === "no" || value === "off") return false;
  throw new NpValidationError("Invalid query parameters", [
    {
      field: name,
      message: `${name} must be one of: 1, true, yes, on, 0, false, no, off`,
    },
  ]);
}
