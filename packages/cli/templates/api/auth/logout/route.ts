import { NextResponse } from "next/server";

import { clearAuthCookies } from "@/lib/auth-helpers";

export function POST() {
  const response = NextResponse.redirect(
    new URL("/admin/login", process.env.SITE_URL ?? "http://localhost:3000"),
    { status: 303 },
  );
  clearAuthCookies(response);
  return response;
}
