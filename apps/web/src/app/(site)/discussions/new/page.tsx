import Link from "next/link";

import { ensureCoreServices } from "@/lib/init-core";
import { getSiteMember } from "@/lib/site-member";

import { DiscussionForm } from "@/components/discussion-form";

export default async function NewDiscussionPage() {
  ensureCoreServices();
  const member = await getSiteMember();

  if (!member) {
    // Member login / register UI is a separate scope (not bundled
    // into 9.7f). When a site ships those pages, swap this hint for
    // links to them. The framework's `/api/members/login` endpoint
    // exists; only the public-facing form is missing.
    return (
      <div className="nx-discussions">
        <h1>Start a discussion</h1>
        <p>
          You need to be signed in as a member to post a discussion.
          The login + register UI ships separately —{" "}
          <Link href="/discussions">browse existing discussions</Link>{" "}
          while you wait.
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
