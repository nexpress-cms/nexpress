import Link from "next/link";
import { redirect } from "next/navigation";

import { RegisterForm } from "@/components/member-register-form";
import { ensureCoreServices } from "@/lib/init-core";
import { getSiteMember } from "@/lib/site-member";

interface RegisterPageProps {
  searchParams: Promise<{ next?: string }>;
}

export default async function MemberRegisterPage({ searchParams }: RegisterPageProps) {
  ensureCoreServices();
  const { next } = await searchParams;
  const member = await getSiteMember();
  if (member) {
    redirect(safeNext(next));
  }

  return (
    <div className="nx-members-auth">
      <h1>Create an account</h1>
      <RegisterForm />
      <p className="nx-members-auth-alt">
        Already have an account?{" "}
        <Link href={`/members/login${nextQuery(next)}`}>Sign in</Link>
      </p>
    </div>
  );
}

function safeNext(next: string | undefined): string {
  if (!next || typeof next !== "string") return "/";
  if (!next.startsWith("/") || next.startsWith("//")) return "/";
  return next;
}

function nextQuery(next: string | undefined): string {
  const safe = safeNext(next);
  if (safe === "/") return "";
  return `?next=${encodeURIComponent(safe)}`;
}
