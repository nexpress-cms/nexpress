import { findDocuments } from "@nexpress/core";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { DiscussionForm } from "@/components/discussion-form";
import { ensureCoreServices } from "@/lib/init-core";
import { getSiteMember } from "@/lib/site-member";
import type { NxRichTextContent } from "@nexpress/editor";

interface EditDiscussionPageProps {
  params: Promise<{ slug: string }>;
}

export default async function EditDiscussionPage({ params }: EditDiscussionPageProps) {
  ensureCoreServices();
  const { slug } = await params;
  const member = await getSiteMember();
  if (!member) {
    redirect(`/members/login?next=/discussions/${slug}/edit`);
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
    <div className="nx-discussions">
      <header className="nx-discussions-header">
        <h1>Edit discussion</h1>
        <Link href={`/discussions/${slug}`} className="nx-tab">
          ← Back to discussion
        </Link>
      </header>
      <DiscussionForm
        mode="edit"
        initial={{
          docId: doc.id as string,
          slug,
          title: doc.title as string,
          body: (doc.body as NxRichTextContent | null) ?? null,
        }}
      />
    </div>
  );
}
