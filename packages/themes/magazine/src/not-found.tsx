import * as React from "react";

/**
 * Phase F.9 — magazine 404 page.
 *
 * Editorial style — large display headline + dateline + return-
 * home link. Server component; rendered by `(site)/not-found.tsx`
 * when the active theme contributes notFound.
 */
export function MagazineNotFound(): React.ReactElement {
  return (
    <div className="np-magazine-not-found np-magazine-message">
      <p className="np-magazine-message-eyebrow">— 404 —</p>
      <h1 className="np-magazine-message-title">
        This story isn&apos;t in the archive.
      </h1>
      <p className="np-magazine-message-body">
        The page you were looking for has been moved, retitled, or never made
        it to print. Try the homepage or search the archive.
      </p>
      <div className="np-magazine-message-actions">
        <a className="np-magazine-cta" href="/">
          Return to the homepage
        </a>
      </div>
    </div>
  );
}
