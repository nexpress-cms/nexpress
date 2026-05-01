import Link from "next/link";
import { redirect } from "next/navigation";

import { RegisterForm } from "@/components/member-register-form";
import { ensureFor } from "@/lib/init-core";
import { nextQuery, safeNext } from "@/lib/safe-next";
import { getSiteMember } from "@/lib/site-member";

interface RegisterPageProps {
  searchParams: Promise<{ next?: string }>;
}

export default async function MemberRegisterPage({ searchParams }: RegisterPageProps) {
  await ensureFor("read");
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
