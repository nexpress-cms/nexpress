import { findDocuments } from "@nexpress/core";
import Link from "next/link";
import { notFound } from "next/navigation";

import { DiscussionForm } from "@/components/discussion-form";
import { ensureFor } from "@/lib/init-core";
import { getSiteMember } from "@/lib/site-member";
import type { NpRichTextContent } from "@nexpress/editor";

interface EditDiscussionPageProps {
  params: Promise<{ slug: string }>;
}

export default async function EditDiscussionPage({ params }: EditDiscussionPageProps) {
  await ensureFor("read");
  const { slug } = await params;
  const member = await getSiteMember();
  if (!member) {
    // 404 instead of redirecting to /members/login. The
    // author needs to be signed in to even see this URL
    // exists; anonymous discovery shouldn't reveal the edit
    // slug, and a redirect would silently leak existence
    // (the redirect target reveals the slug as `?next=`).
    notFound();
  }

  const result = await findDocuments("discussions", { where: { slug }, limit: 1 });
  const doc = result.docs[0];
  if (!doc) notFound();

  const memberAuthorId = (doc.memberAuthorId as string | null) ?? null;
  // The server pipeline re-checks ownership on PATCH, so a forged
  // cookie can't sneak past — but we render 404 here too so the
  // edit form isn't even shown to non-authors. (Mirrors the
  // detail page's visibility rule for non-published rows.)
  if (memberAuthorId !== member.id) {
    notFound();
  }

  return (
    <div className="np-discussions">
      <header className="np-discussions-header">
        <h1>Edit discussion</h1>
        <Link href={`/discussions/${slug}`} className="np-tab">
          ← Back to discussion
        </Link>
      </header>
      <DiscussionForm
        mode="edit"
        initial={{
          docId: doc.id as string,
          slug,
          title: doc.title as string,
          body: (doc.body as NpRichTextContent | null) ?? null,
        }}
      />
    </div>
  );
}
