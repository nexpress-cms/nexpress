import {
  NpForbiddenError,
  NpValidationError,
  hashPassword,
  npUsers,
  runHook,
  type NpUserRole,
  can,
} from "@nexpress/core";
import { asc, count, ilike, or } from "drizzle-orm";
import type { NextRequest } from "next/server";
import { readJsonBody } from "@nexpress/next";

import { requireAuth, requireGlobalAuth } from "../../lib/auth-helpers";
import { npErrorResponse, npSuccessResponse } from "../../lib/api-response";
import { getDb } from "../../lib/db";
import { ensureFor } from "../../lib/init-core";

const VALID_ROLES: readonly NpUserRole[] = ["admin", "editor", "moderator", "author", "viewer"];

function parsePositiveInt(value: string | null, fallback: number, max: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, max);
}

export async function GET(request: NextRequest) {
  try {
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

    return npSuccessResponse({
      docs,
      totalDocs,
      totalPages,
      page,
      limit,
      hasNextPage: page < totalPages,
      hasPrevPage: page > 1 && totalDocs > 0,
    });
  } catch (error) {
    return npErrorResponse(error instanceof Error ? error : new Error("Unknown error"));
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await requireGlobalAuth(request);

    if (!can(user, "admin.manage")) {
      throw new NpForbiddenError("users", "create");
    }

    const body = (await readJsonBody(request)) as Record<string, unknown>;
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const password = typeof body.password === "string" ? body.password : "";
    const role = typeof body.role === "string" ? (body.role as NpUserRole) : "author";

    const errors: Array<{ field: string; message: string }> = [];
    if (!email || !email.includes("@")) {
      errors.push({ field: "email", message: "Valid email is required" });
    }
    if (!name) {
      errors.push({ field: "name", message: "Name is required" });
    }
    if (password.length < 8) {
      errors.push({ field: "password", message: "Password must be at least 8 characters" });
    }
    if (!VALID_ROLES.includes(role)) {
      errors.push({ field: "role", message: `Role must be one of: ${VALID_ROLES.join(", ")}` });
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
        role,
      })
      .returning({
        id: npUsers.id,
        email: npUsers.email,
        name: npUsers.name,
        role: npUsers.role,
        createdAt: npUsers.createdAt,
        updatedAt: npUsers.updatedAt,
      });

    if (created) {
      await ensureFor("plugins");
      await runHook("auth:afterRegister", {
        user: {
          id: created.id,
          email: created.email,
          role: created.role,
        },
        origin: "admin",
      });
    }

    return npSuccessResponse(created, { status: 201 });
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
