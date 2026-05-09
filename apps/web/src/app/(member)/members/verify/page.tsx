import Link from "next/link";

import { VerifyTokenConsumer } from "@/components/member-verify-consumer";
import { ensureFor } from "@/lib/init-core";

interface VerifyPageProps {
  searchParams: Promise<{ token?: string }>;
}

export default async function MemberVerifyPage({ searchParams }: VerifyPageProps) {
  await ensureFor("read");
  const { token } = await searchParams;

  if (!token) {
    return (
      <div className="np-members-auth">
        <h1>Verify your email</h1>
        <p className="np-form-error">
          Missing verification token. Open the link from the email we sent
          you, or{" "}
          <Link href="/members/register">register again</Link>.
        </p>
      </div>
    );
  }

  return (
    <div className="np-members-auth">
      <h1>Verifying your email…</h1>
      <VerifyTokenConsumer token={token} />
    </div>
  );
}
