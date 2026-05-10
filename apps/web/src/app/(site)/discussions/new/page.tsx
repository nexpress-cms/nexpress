import Link from "next/link";

import { ensureFor } from "@/lib/init-core";
import { getSiteMember } from "@nexpress/next";

import { DiscussionForm } from "@/components/discussion-form";

export default async function NewDiscussionPage() {
  await ensureFor("read");
  const member = await getSiteMember();

  if (!member) {
    return (
      <div className="np-discussions">
        <h1>Start a discussion</h1>
        <p>
          You need to be signed in to post.{" "}
          <Link href="/members/login?next=/discussions/new">Sign in</Link>
          {" or "}
          <Link href="/members/register?next=/discussions/new">create an account</Link>.
        </p>
      </div>
    );
  }

  return (
    <div className="np-discussions">
      <header className="np-discussions-header">
        <h1>Start a discussion</h1>
        <Link href="/discussions" className="np-tab">
          ← Back to discussions
        </Link>
      </header>
      <DiscussionForm mode="create" />
    </div>
  );
}
