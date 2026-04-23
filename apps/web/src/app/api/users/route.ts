import {
  NxForbiddenError,
  NxValidationError,
  hasRole,
  hashPassword,
  nxUsers,
  type NxUserRole,
} from "@nexpress/core";
import { asc, count, ilike, or } from "drizzle-orm";
import type { NextRequest } from "next/server";

import { requireAuth, requireCsrf } from "@/lib/auth-helpers";
import { nxErrorResponse, nxSuccessResponse } from "@/lib/api-response";
import { getDb } from "@/lib/db";

const VALID_ROLES: readonly NxUserRole[] = ["admin", "editor", "author", "viewer"];

function parsePositiveInt(value: string | null, fallback: number, max: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, max);
}

export async function GET(request: NextRequest) {
  try {
    const user = await requireAuth(request);

    if (!hasRole(user, "editor")) {
      throw new NxForbiddenError("users", "read");
    }

    const params = request.nextUrl.searchParams;
    const limit = parsePositiveInt(params.get("limit"), 20, 100);
    const page = parsePositiveInt(params.get("page"), 1, 10_000);
    const search = params.get("search")?.trim() ?? "";
    const offset = (page - 1) * limit;

    const db = getDb();
    const whereClause = search
      ? or(ilike(nxUsers.name, `%${search}%`), ilike(nxUsers.email, `%${search}%`))
      : undefined;

    const baseSelect = db
      .select({
        id: nxUsers.id,
        email: nxUsers.email,
        name: nxUsers.name,
        role: nxUsers.role,
        avatar: nxUsers.avatar,
        createdAt: nxUsers.createdAt,
        updatedAt: nxUsers.updatedAt,
      })
      .from(nxUsers)
      .$dynamic();

    const rowsQuery = whereClause
      ? baseSelect.where(whereClause).orderBy(asc(nxUsers.name)).limit(limit).offset(offset)
      : baseSelect.orderBy(asc(nxUsers.name)).limit(limit).offset(offset);

    const baseCount = db.select({ total: count() }).from(nxUsers).$dynamic();
    const countQuery = whereClause ? baseCount.where(whereClause) : baseCount;

    const [docs, totalResult] = await Promise.all([rowsQuery, countQuery]);

    const totalDocs = Number(totalResult[0]?.total ?? 0);
    const totalPages = totalDocs === 0 ? 0 : Math.ceil(totalDocs / limit);

    return nxSuccessResponse({
      docs,
      totalDocs,
      totalPages,
      page,
      limit,
      hasNextPage: page < totalPages,
      hasPrevPage: page > 1 && totalDocs > 0,
    });
  } catch (error) {
    return nxErrorResponse(error instanceof Error ? error : new Error("Unknown error"));
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await requireAuth(request);
    requireCsrf(request);

    if (!hasRole(user, "admin")) {
      throw new NxForbiddenError("users", "create");
    }

    const body = (await request.json()) as Record<string, unknown>;
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const password = typeof body.password === "string" ? body.password : "";
    const role = typeof body.role === "string" ? (body.role as NxUserRole) : "author";

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
      throw new NxValidationError("Invalid input", errors);
    }

    const db = getDb();
    const hashed = await hashPassword(password);

    const [created] = await db
      .insert(nxUsers)
      .values({
        email,
        name,
        password: hashed,
        role,
      })
      .returning({
        id: nxUsers.id,
        email: nxUsers.email,
        name: nxUsers.name,
        role: nxUsers.role,
        createdAt: nxUsers.createdAt,
        updatedAt: nxUsers.updatedAt,
      });

    return nxSuccessResponse(created, { status: 201 });
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      (error as { code?: string }).code === "23505"
    ) {
      return nxErrorResponse(
        new NxValidationError("Invalid input", [
          { field: "email", message: "A user with this email already exists" },
        ]),
      );
    }
    return nxErrorResponse(error instanceof Error ? error : new Error("Unknown error"));
  }
}

export const dynamic = "force-dynamic";
