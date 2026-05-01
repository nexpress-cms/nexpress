import type { ReactNode } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { verifyTokenFull } from "@nexpress/core";
import { getDb } from "@/lib/bootstrap";

export const dynamic = "force-dynamic";

export default async function AdminProtectedLayout({ children }: { children: ReactNode }) {
  const token = (await cookies()).get("nx-session")?.value;
  if (!token) redirect("/admin/login");

  const secret =
    process.env.NX_SECRET ?? process.env.NX_AUTH_SECRET ?? process.env.AUTH_SECRET;
  if (!secret) throw new Error("NX_SECRET must be set");

  try {
    await verifyTokenFull(token, secret, getDb() as never);
  } catch {
    redirect("/admin/login");
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <header className="border-b bg-white px-6 py-4">
        <div className="mx-auto flex max-w-6xl items-center justify-between">
          <a className="text-lg font-semibold" href="/admin">
            NexPress Admin
          </a>
          <form action="/api/auth/logout" method="post">
            <button type="submit" className="text-sm underline">
              Sign out
            </button>
          </form>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-6 py-8">{children}</main>
    </div>
  );
}
