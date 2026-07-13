import {
  NpForbiddenError,
  NpValidationError,
  hashPassword,
  npUsers,
  runHook,
  can,
} from "@nexpress/core";
import {
  npAuthContractLimits,
  npIsCanonicalAuthEmail,
  npIsAuthNewPassword,
  npIsUserRole,
  npRequireStaffUserItem,
  npRequireStaffUserList,
  npUserRoles,
} from "@nexpress/core/auth-contract";
import { asc, count, ilike, or } from "drizzle-orm";
import type { NextRequest } from "next/server";
import { readJsonBody } from "@nexpress/next";

import { requireAuth, requireGlobalAuth } from "../../lib/auth-helpers";
import { npErrorResponse, npSuccessResponse } from "../../lib/api-response";
import { parseBodyRecord } from "../../lib/collection-helpers";
import { getDb } from "../../lib/db";
import { ensureFor } from "../../lib/init-core";

function parsePositiveInt(value: string | null, fallback: number, max: number): number {
  if (!value) return fallback;
  if (!/^[1-9]\d*$/u.test(value)) {
    throw new NpValidationError("Invalid input", [
      { field: "query", message: "Pagination values must be positive integers" },
    ]);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed > max) {
    throw new NpValidationError("Invalid input", [
      { field: "query", message: `Pagination value must not exceed ${max.toString()}` },
    ]);
  }
  return parsed;
}

export async function GET(request: NextRequest) {
  try {
    await ensureFor("read");
    const user = await requireAuth(request);

    if (!can(user, "content.publish")) {
      throw new NpForbiddenError("users", "read");
    }

    const params = request.nextUrl.searchParams;
    const limit = parsePositiveInt(params.get("limit"), 20, 100);
    const page = parsePositiveInt(params.get("page"), 1, 10_000);
    const search = params.get("search")?.trim() ?? "";
    const offset = (page - 1) * limit;

    const db = getDb();
    const whereClause = search
      ? or(ilike(npUsers.name, `%${search}%`), ilike(npUsers.email, `%${search}%`))
      : undefined;

    const baseSelect = db
      .select({
        id: npUsers.id,
        email: npUsers.email,
        name: npUsers.name,
        role: npUsers.role,
        avatar: npUsers.avatar,
        createdAt: npUsers.createdAt,
        updatedAt: npUsers.updatedAt,
      })
      .from(npUsers)
      .$dynamic();

    const rowsQuery = whereClause
      ? baseSelect.where(whereClause).orderBy(asc(npUsers.name)).limit(limit).offset(offset)
      : baseSelect.orderBy(asc(npUsers.name)).limit(limit).offset(offset);

    const baseCount = db.select({ total: count() }).from(npUsers).$dynamic();
    const countQuery = whereClause ? baseCount.where(whereClause) : baseCount;

    const [docs, totalResult] = await Promise.all([rowsQuery, countQuery]);

    const totalDocs = Number(totalResult[0]?.total ?? 0);
    const totalPages = totalDocs === 0 ? 0 : Math.ceil(totalDocs / limit);

    const result = npRequireStaffUserList({
      docs: docs.map((row) => ({
        ...row,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
      })),
      totalDocs,
      totalPages,
      page,
      limit,
      hasNextPage: page < totalPages,
      hasPrevPage: page > 1 && totalDocs > 0,
    });
    return npSuccessResponse(result);
  } catch (error) {
    return npErrorResponse(error instanceof Error ? error : new Error("Unknown error"));
  }
}

export async function POST(request: NextRequest) {
  try {
    await ensureFor("write");
    const user = await requireGlobalAuth(request);

    if (!can(user, "admin.manage")) {
      throw new NpForbiddenError("users", "create");
    }

    const body = parseBodyRecord(await readJsonBody(request));
    const unknownField = Object.keys(body).find(
      (key) => !["email", "name", "password", "role"].includes(key),
    );
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const password = typeof body.password === "string" ? body.password : "";
    const role = body.role;

    const errors: Array<{ field: string; message: string }> = [];
    if (unknownField) {
      errors.push({ field: unknownField, message: "Unsupported user field" });
    }
    if (!npIsCanonicalAuthEmail(email)) {
      errors.push({ field: "email", message: "Valid email is required" });
    }
    if (!name || name.length > npAuthContractLimits.nameLength) {
      errors.push({
        field: "name",
        message: `Name must contain 1 through ${npAuthContractLimits.nameLength.toString()} characters`,
      });
    }
    if (!npIsAuthNewPassword(password)) {
      errors.push({
        field: "password",
        message: `Password must contain ${npAuthContractLimits.passwordMinLength.toString()} through ${npAuthContractLimits.passwordMaxLength.toString()} characters`,
      });
    }
    if (!npIsUserRole(role)) {
      errors.push({ field: "role", message: `Role must be one of: ${npUserRoles.join(", ")}` });
    }
    if (errors.length > 0) {
      throw new NpValidationError("Invalid input", errors);
    }

    const db = getDb();
    const hashed = await hashPassword(password);

    const [created] = await db
      .insert(npUsers)
      .values({
        email,
        name,
        password: hashed,
        role: npIsUserRole(role) ? role : "author",
      })
      .returning({
        id: npUsers.id,
        email: npUsers.email,
        name: npUsers.name,
        role: npUsers.role,
        avatar: npUsers.avatar,
        createdAt: npUsers.createdAt,
        updatedAt: npUsers.updatedAt,
      });

    if (created) {
      await runHook("auth:afterRegister", {
        user: {
          id: created.id,
          email: created.email,
          role: created.role,
        },
        origin: "admin",
      });
    }

    if (!created) throw new Error("Failed to create user");
    return npSuccessResponse(
      npRequireStaffUserItem({
        ...created,
        createdAt: created.createdAt.toISOString(),
        updatedAt: created.updatedAt.toISOString(),
      }),
      { status: 201 },
    );
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      (error as { code?: string }).code === "23505"
    ) {
      return npErrorResponse(
        new NpValidationError("Invalid input", [
          { field: "email", message: "A user with this email already exists" },
        ]),
      );
    }
    return npErrorResponse(error instanceof Error ? error : new Error("Unknown error"));
  }
}

export const dynamic = "force-dynamic";
