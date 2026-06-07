"use client";

import { useCallback, useEffect, useState } from "react";

import { npFetch } from "../lib/api-client.js";
import { Badge } from "../ui/badge.js";
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

export interface LinkedIdentity {
  id: string;
  provider: string;
  /**
   * The durable provider subject. Staff identities use the
   * `providerUserId` column name; members use `subject`. Both serve
   * the same role — we surface them as a single field for the UI.
   */
  subject: string;
  email?: string | null;
  metadata?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

interface LinkedIdentitiesPanelProps {
  /** Either "user" or "member". Drives endpoint selection + heading. */
  subjectKind: "user" | "member";
  /** The user/member id whose identities are being managed. */
  subjectId: string;
  /**
   * When false, the Revoke buttons are hidden and dialog actions
   * disabled. The server enforces this independently — moderator
   * roles may list member identities but only admins can revoke.
   */
  canRevoke: boolean;
}

/**
 * Lists OAuth identity links and lets an admin revoke each one.
 * Mounted under the staff and member detail pages — keeps the shape
 * shared because the UX is identical aside from the endpoint and
 * subject column name.
 */
export function LinkedIdentitiesPanel({
  subjectKind,
  subjectId,
  canRevoke,
}: LinkedIdentitiesPanelProps) {
  const [identities, setIdentities] = useState<LinkedIdentity[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [revoking, setRevoking] = useState<LinkedIdentity | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const basePath =
    subjectKind === "user"
      ? `/api/admin/users/${subjectId}/identities`
      : `/api/admin/members/${subjectId}/identities`;

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await npFetch(basePath);
      const raw = (await res.json().catch(() => null)) as Record<string, unknown> | null;
      if (!res.ok || !raw) {
        setError(extractErrorMessage(raw) ?? `HTTP ${res.status}`);
        return;
      }
      const data = (raw.data ?? raw) as { identities?: unknown };
      const rows = Array.isArray(data.identities) ? (data.identities as LinkedIdentity[]) : [];
      // Server returns `providerUserId` for staff and `subject` for
      // members — coalesce so the UI has one field to render.
      setIdentities(
        rows.map((row) => ({
          ...row,
          subject:
            (row as { subject?: string; providerUserId?: string }).subject ??
            (row as { providerUserId?: string }).providerUserId ??
            "",
        })),
      );
    } catch {
      setError("Unable to load linked identities.");
    } finally {
      setLoading(false);
    }
  }, [basePath]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      void refresh();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [refresh]);

  async function handleRevoke() {
    if (!revoking) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await npFetch(`${basePath}/${revoking.id}`, { method: "DELETE" });
      if (!res.ok) {
        const raw = (await res.json().catch(() => null)) as Record<string, unknown> | null;
        setError(extractErrorMessage(raw) ?? `HTTP ${res.status}`);
        return;
      }
      setMessage(`Revoked ${revoking.provider} identity.`);
      setRevoking(null);
      await refresh();
    } catch {
      setError("Unable to revoke identity.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card className="min-w-0">
      <CardHeader>
        <CardTitle className="break-words">Linked OAuth identities</CardTitle>
      </CardHeader>
      <CardContent className="min-w-0 space-y-4">
        <p className="break-words text-sm text-muted-foreground">
          Provider accounts that resolve to this {subjectKind}. Revoking a link drops the durable
          mapping; the {subjectKind} can re-link by signing in via OAuth again.
        </p>

        {error ? (
          <div className="break-words rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
            {error}
          </div>
        ) : null}
        {message ? (
          <div className="break-words rounded-xl border border-emerald-500/30 bg-emerald-500/5 px-4 py-3 text-sm text-emerald-700 dark:text-emerald-400">
            {message}
          </div>
        ) : null}

        <div className="space-y-3 md:hidden">
          {loading ? (
            <div className="rounded-xl border border-border/60 px-4 py-10 text-center text-sm text-muted-foreground">
              Loading…
            </div>
          ) : identities.length === 0 ? (
            <div className="rounded-xl border border-border/60 px-4 py-10 text-center text-sm text-muted-foreground">
              No linked identities.
            </div>
          ) : (
            identities.map((identity) => (
              <div
                key={identity.id}
                className="space-y-3 rounded-xl border border-border/60 bg-background/70 p-4"
              >
                <div className="grid gap-2">
                  <Badge variant="secondary" className="max-w-full break-all font-mono">
                    {identity.provider}
                  </Badge>
                  <span className="break-words text-xs text-muted-foreground">
                    {new Date(identity.createdAt).toLocaleString()}
                  </span>
                </div>
                <div className="space-y-1">
                  <p className="break-all font-mono text-xs text-muted-foreground">
                    {identity.subject}
                  </p>
                  {identity.email ? (
                    <p className="break-all text-xs text-foreground">{identity.email}</p>
                  ) : null}
                </div>
                {canRevoke ? (
                  <Button
                    size="sm"
                    variant="outline"
                    className="w-full"
                    onClick={() => setRevoking(identity)}
                    disabled={submitting}
                  >
                    Revoke
                  </Button>
                ) : null}
              </div>
            ))
          )}
        </div>

        <div className="hidden overflow-x-auto rounded-xl border border-border/60 md:block">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="bg-neutral-50/60 text-left text-[11px] font-medium uppercase tracking-[0.08em] text-neutral-500 dark:bg-neutral-900/40 dark:text-neutral-400">
              <tr>
                <th className="h-9 px-3.5 font-medium">Provider</th>
                <th className="h-9 px-3.5 font-medium">Subject</th>
                <th className="h-9 px-3.5 font-medium">Linked</th>
                <th className="h-9 px-3.5 font-medium" />
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={4} className="px-4 py-10 text-center text-muted-foreground">
                    Loading…
                  </td>
                </tr>
              ) : identities.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-4 py-10 text-center text-muted-foreground">
                    No linked identities.
                  </td>
                </tr>
              ) : (
                identities.map((identity) => (
                  <tr key={identity.id} className="border-t border-border/60 align-top">
                    <td className="px-4 py-3">
                      <Badge variant="secondary" className="max-w-full break-all font-mono">
                        {identity.provider}
                      </Badge>
                    </td>
                    <td className="px-4 py-3">
                      <div className="break-all font-mono text-xs text-muted-foreground">
                        {identity.subject}
                      </div>
                      {identity.email ? (
                        <div className="mt-1 break-all text-xs">{identity.email}</div>
                      ) : null}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {new Date(identity.createdAt).toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {canRevoke ? (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setRevoking(identity)}
                          disabled={submitting}
                        >
                          Revoke
                        </Button>
                      ) : null}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </CardContent>

      {revoking ? (
        <Dialog open onOpenChange={(open) => !open && setRevoking(null)}>
          <DialogContent className="min-w-0">
            <DialogHeader>
              <DialogTitle className="break-words">Revoke {revoking.provider} link?</DialogTitle>
              <DialogDescription className="break-words">
                This drops the durable provider link. The {subjectKind} can re-link by signing in
                via {revoking.provider} again. Existing sessions are not affected.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setRevoking(null)}
                disabled={submitting}
              >
                Cancel
              </Button>
              <Button
                type="button"
                variant="destructive"
                onClick={() => void handleRevoke()}
                disabled={submitting}
              >
                {submitting ? "Revoking…" : "Revoke"}
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
