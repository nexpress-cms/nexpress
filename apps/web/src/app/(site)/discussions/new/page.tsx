import Link from "next/link";

import { ensureFor } from "@/lib/init-core";
import { getSiteMember } from "@/lib/site-member";

import { DiscussionForm } from "@/components/discussion-form";

export default async function NewDiscussionPage() {
  await ensureFor("read");
  const member = await getSiteMember();

  if (!member) {
    return (
      <div className="nx-discussions">
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
    <div className="nx-discussions">
      <header className="nx-discussions-header">
        <h1>Start a discussion</h1>
        <Link href="/discussions" className="nx-tab">
          ← Back to discussions
        </Link>
      </header>
      <DiscussionForm mode="create" />
    </div>
  );
}
