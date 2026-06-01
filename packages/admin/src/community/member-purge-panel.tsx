"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { npFetch } from "../lib/api-client.js";
import { Button } from "../ui/button.js";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card.js";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog.js";

export interface MemberPurgeResult {
  comments: number;
  documents: Record<string, number>;
  media: { deleted: number; skipped: number };
}

interface MemberPurgePanelProps {
  memberId: string;
  memberHandle: string;
}

/**
 * Admin-only "Delete all content" affordance on the member detail
 * page. Calls the 9.7l `/api/admin/members/[id]/purge-content`
 * endpoint and shows a per-bucket count after success. The button
 * is gated by a confirm dialog because the action is hard to
 * reverse (comments are tombstoned, docs are hard-deleted, media
 * is soft-deleted).
 */
export function MemberPurgePanel({ memberId, memberHandle }: MemberPurgePanelProps) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<MemberPurgeResult | null>(null);

  const handlePurge = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const res = await npFetch(`/api/admin/members/${memberId}/purge-content`, {
        method: "POST",
      });
      const raw = (await res.json().catch(() => null)) as Record<string, unknown> | null;
      if (!res.ok || !raw) {
        const message = extractErrorMessage(raw) ?? `HTTP ${res.status}`;
        setError(message);
        return;
      }
      const data = (raw.data ?? raw) as MemberPurgeResult;
      setResult(data);
      setConfirming(false);
      // Refresh server components — the linked identities panel
      // doesn't change, but if any list views are upstream they'll
      // re-fetch.
      router.refresh();
    } catch {
      setError("Purge failed. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Card className="min-w-0 border-destructive/40 shadow-sm">
      <CardHeader>
        <CardTitle className="text-destructive">Danger zone</CardTitle>
      </CardHeader>
      <CardContent className="min-w-0 space-y-4">
        <p className="break-words text-sm text-muted-foreground">
          Delete every piece of content this member authored — comments, discussions, uploaded
          images. Existing references in other docs are preserved (the operator must clean those up
          separately, see the count of skipped media). The action is logged in the audit trail. The
          member account itself is NOT deleted; ban or revoke identity separately if needed.
        </p>

        {error ? (
          <div
            role="alert"
            className="break-words rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive"
          >
            {error}
          </div>
        ) : null}

        {result ? (
          <div
            role="status"
            className="break-words rounded-xl border border-emerald-500/30 bg-emerald-500/5 px-4 py-3 text-sm text-emerald-700 dark:text-emerald-400"
          >
            <p>
              <strong>
                Purge complete for <span className="break-all">@{memberHandle}</span>.
              </strong>
            </p>
            <ul className="mt-2 list-inside list-disc space-y-1">
              <li>{result.comments} comments deleted</li>
              {Object.entries(result.documents).map(([slug, count]) => (
                <li key={slug}>
                  {count} <span className="break-all">{slug}</span> deleted
                </li>
              ))}
              <li>
                {result.media.deleted} media deleted
                {result.media.skipped > 0
                  ? ` (${result.media.skipped} skipped — still referenced; unlink first)`
                  : ""}
              </li>
            </ul>
          </div>
        ) : null}

        <div>
          <Button
            type="button"
            variant="destructive"
            className="w-full sm:w-auto"
            onClick={() => setConfirming(true)}
            disabled={submitting}
          >
            Delete all content
          </Button>
        </div>
      </CardContent>

      {confirming ? (
        <Dialog open onOpenChange={(open) => !open && setConfirming(false)}>
          <DialogContent className="min-w-0" data-np-member-purge-dialog>
            <DialogHeader>
              <DialogTitle className="break-words">
                Delete all content by @{memberHandle}?
              </DialogTitle>
              <DialogDescription className="break-words">
                This wipes comments, member-authored docs, and uploaded media in one sweep. Audit
                log records the action. Items still referenced from other docs (embedded media) are
                skipped — you&rsquo;ll see them in the count and can clean up separately. The member
                account itself is untouched.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setConfirming(false)}
                disabled={submitting}
              >
                Cancel
              </Button>
              <Button
                type="button"
                variant="destructive"
                onClick={() => void handlePurge()}
                disabled={submitting}
              >
                {submitting ? "Purging…" : "Delete all content"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}
    </Card>
  );
}

function extractErrorMessage(raw: Record<string, unknown> | null): string | null {
  if (!raw) return null;
  const err = raw.error as Record<string, unknown> | undefined;
  if (!err) return typeof raw.message === "string" ? raw.message : null;
  return typeof err.message === "string" ? err.message : null;
}
