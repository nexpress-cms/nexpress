import * as React from "react";

/**
 * Phase M.ref — magazine member-tree 404.
 *
 * Mirrors `MagazineNotFound`'s editorial voice but tuned for the
 * member context — CTA points at `/members/login` rather than `/`,
 * and the headline acknowledges stale auth links (the most common
 * cause of 404s inside `/members/*`).
 */
export function MagazineMembersNotFound(): React.ReactElement {
  return (
    <div className="np-magazine-members-not-found np-magazine-message">
      <p className="np-magazine-message-eyebrow">Subscriber desk</p>
      <h1 className="np-magazine-message-title">That link has gone to print.</h1>
      <p className="np-magazine-message-body">
        Verification and password-reset links expire after a single use or a
        short window. If you arrived here from an email, request a fresh link
        from the sign-in page.
      </p>
      <div className="np-magazine-message-actions">
        <a className="np-magazine-cta" href="/members/login">
          Go to sign in
        </a>
      </div>
    </div>
  );
}
