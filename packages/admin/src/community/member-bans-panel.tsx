"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

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
import { Input } from "../ui/input.js";
import { Label } from "../ui/label.js";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select.js";
import { Switch } from "../ui/switch.js";

const SCOPE_OPTIONS = [
  { value: "site", label: "Site-wide" },
  { value: "category", label: "Category" },
  { value: "collection", label: "Collection" },
] as const;

type BanScope = (typeof SCOPE_OPTIONS)[number]["value"];

export interface BanRow {
  id: string;
  memberId: string;
  scopeType: BanScope;
  scopeId: string | null;
  kind: "temporary" | "permanent";
  expiresAt: string | null;
  reason: string | null;
  byUserId: string | null;
  byMemberId: string | null;
  createdAt: string;
}

interface MemberBansPanelProps {
  memberId: string;
  memberHandle: string;
  /**
   * Staff-mod or above can issue / revoke bans. When false the panel
   * still renders the active list (read-only). The server enforces
   * the permission independently — this prop just hides the buttons
   * to avoid baiting mods with a 403 on click.
   */
  canModify: boolean;
}

interface BanFormState {
  scopeType: BanScope;
  scopeId: string;
  kind: "temporary" | "permanent";
  expiresAt: string;
  reason: string;
}

const EMPTY_FORM: BanFormState = {
  scopeType: "site",
  scopeId: "",
  kind: "temporary",
  expiresAt: "",
  reason: "",
};

/**
 * Active-ban list + Issue / Revoke flow on the member detail page.
 * Backend was wired in 9.5 (issueBan / revokeBan / listBansForMember
 * + `/api/admin/community/bans` GET/POST and `[id]` DELETE); this
 * component finally surfaces those affordances in the admin UI.
 *
 * Only ACTIVE bans show up here — the backend filters expired temp
 * bans server-side. Revoke flow deletes the row outright; the
 * `member.unban` audit event preserves history. Members hit by a
 * site-wide ban can't write community content (assertNotBanned
 * fires before every comment / doc create), so the operator's
 * mental model is "anything in this list is currently restricting
 * the account".
 */
export function MemberBansPanel({ memberId, memberHandle, canModify }: MemberBansPanelProps) {
  const router = useRouter();
  const [bans, setBans] = useState<BanRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [issuing, setIssuing] = useState(false);
  const [issueOpen, setIssueOpen] = useState(false);
  const [form, setForm] = useState<BanFormState>(EMPTY_FORM);
  const [revokingId, setRevokingId] = useState<string | null>(null);

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [memberId]);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await npFetch(
        `/api/admin/community/bans?memberId=${encodeURIComponent(memberId)}`,
      );
      const raw = (await res.json().catch(() => null)) as Record<string, unknown> | null;
      if (!res.ok || !raw) {
        setError(extractErrorMessage(raw) ?? `HTTP ${res.status}`);
        return;
      }
      const data = (raw.data ?? raw) as { docs?: BanRow[] };
      setBans(Array.isArray(data.docs) ? data.docs : []);
    } catch {
      setError("Unable to load bans.");
    } finally {
      setLoading(false);
    }
  }

  async function issue() {
    setIssuing(true);
    setError(null);
    try {
      const body: Record<string, unknown> = {
        memberId,
        scopeType: form.scopeType,
        kind: form.kind,
      };
      if (form.scopeType !== "site") {
        body.scopeId = form.scopeId.trim();
      }
      if (form.kind === "temporary") {
        // The form's `datetime-local` value is in the user's tz with
        // no offset suffix — feed it through `new Date()` to get the
        // browser's interpretation, then ISO-stringify so the API
        // sees an unambiguous UTC timestamp.
        body.expiresAt = form.expiresAt ? new Date(form.expiresAt).toISOString() : "";
      }
      if (form.reason.trim()) {
        body.reason = form.reason.trim();
      }

      const res = await npFetch("/api/admin/community/bans", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const raw = (await res.json().catch(() => null)) as Record<string, unknown> | null;
      if (!res.ok || !raw) {
        setError(extractErrorMessage(raw) ?? `HTTP ${res.status}`);
        return;
      }
      setIssueOpen(false);
      setForm(EMPTY_FORM);
      await load();
      router.refresh();
    } catch {
      setError("Unable to issue ban.");
    } finally {
      setIssuing(false);
    }
  }

  async function revoke(banId: string) {
    setRevokingId(banId);
    setError(null);
    try {
      const res = await npFetch(`/api/admin/community/bans/${encodeURIComponent(banId)}`, {
        method: "DELETE",
      });
      const raw = (await res.json().catch(() => null)) as Record<string, unknown> | null;
      if (!res.ok) {
        setError(extractErrorMessage(raw) ?? `HTTP ${res.status}`);
        return;
      }
      await load();
      router.refresh();
    } catch {
      setError("Unable to revoke ban.");
    } finally {
      setRevokingId(null);
    }
  }

  return (
    <Card className="min-w-0">
      <CardHeader className="grid gap-3 sm:flex sm:flex-row sm:items-center sm:justify-between sm:gap-4">
        <CardTitle className="min-w-0">Bans</CardTitle>
        {canModify ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="min-h-10 w-full sm:min-h-0 sm:w-auto"
            onClick={() => {
              setForm(EMPTY_FORM);
              setIssueOpen(true);
            }}
            disabled={loading}
          >
            Issue ban
          </Button>
        ) : null}
      </CardHeader>
      <CardContent className="min-w-0 space-y-4">
        {error ? (
          <div
            role="alert"
            className="break-words rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive"
          >
            {error}
          </div>
        ) : null}

        {loading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : bans.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No active bans. Issuing a ban prevents{" "}
            <span className="break-all">@{memberHandle}</span> from posting comments or new
            community content within the chosen scope.
          </p>
        ) : (
          <ul className="space-y-2">
            {bans.map((ban) => (
              <li
                key={ban.id}
                className="grid gap-3 rounded-xl border border-border/60 bg-muted/30 px-4 py-3 sm:flex sm:items-start sm:justify-between"
              >
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="destructive">{ban.scopeType}</Badge>
                    {ban.scopeId ? (
                      <code className="inline-block max-w-full break-all rounded bg-background px-2 py-0.5 font-mono text-xs">
                        {ban.scopeId}
                      </code>
                    ) : null}
                    <Badge variant="secondary">{ban.kind}</Badge>
                    {ban.expiresAt ? (
                      <span className="text-xs text-muted-foreground">
                        until {new Date(ban.expiresAt).toLocaleString()}
                      </span>
                    ) : null}
                  </div>
                  {ban.reason ? (
                    <p className="break-words text-sm text-foreground/80">{ban.reason}</p>
                  ) : null}
                  <p className="text-xs text-muted-foreground">
                    Issued {new Date(ban.createdAt).toLocaleString()}
                  </p>
                </div>
                {canModify ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="min-h-10 w-full sm:min-h-0 sm:w-auto"
                    onClick={() => void revoke(ban.id)}
                    disabled={revokingId === ban.id}
                  >
                    {revokingId === ban.id ? "Revoking…" : "Revoke"}
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </CardContent>

      {issueOpen ? (
        <Dialog open onOpenChange={(open) => !open && setIssueOpen(false)}>
          <DialogContent className="min-w-0" data-np-member-ban-dialog>
            <DialogHeader>
              <DialogTitle className="break-words">Ban @{memberHandle}</DialogTitle>
              <DialogDescription className="break-words">
                Choose a scope and duration. Site-wide bans block every community write; scoped bans
                restrict the chosen category/collection. The action is recorded in the audit log.
              </DialogDescription>
            </DialogHeader>

            <div className="min-w-0 space-y-4">
              <div className="min-w-0 space-y-1">
                <Label className="text-xs uppercase tracking-wide text-muted-foreground">
                  Scope
                </Label>
                <Select
                  value={form.scopeType}
                  onValueChange={(v) => setForm((f) => ({ ...f, scopeType: v as BanScope }))}
                >
                  <SelectTrigger className="min-w-0">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {SCOPE_OPTIONS.map((o) => (
                      <SelectItem key={o.value} value={o.value}>
                        {o.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {form.scopeType !== "site" ? (
                <div className="min-w-0 space-y-1">
                  <Label
                    htmlFor="ban-scope-id"
                    className="text-xs uppercase tracking-wide text-muted-foreground"
                  >
                    {form.scopeType === "category" ? "Category id" : "Collection slug"}
                  </Label>
                  <Input
                    id="ban-scope-id"
                    value={form.scopeId}
                    onChange={(e) => setForm((f) => ({ ...f, scopeId: e.target.value }))}
                    placeholder={
                      form.scopeType === "collection" ? "posts, discussions, …" : "category-uuid"
                    }
                  />
                </div>
              ) : null}

              <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-4">
                <div className="min-w-0 space-y-1">
                  <Label htmlFor="ban-permanent" className="text-sm font-medium">
                    Permanent ban
                  </Label>
                  <p className="break-words text-xs text-muted-foreground">
                    Permanent bans never expire — revoke from this panel to lift them.
                  </p>
                </div>
                <Switch
                  id="ban-permanent"
                  checked={form.kind === "permanent"}
                  onCheckedChange={(v) =>
                    setForm((f) => ({ ...f, kind: v ? "permanent" : "temporary" }))
                  }
                />
              </div>

              {form.kind === "temporary" ? (
                <div className="min-w-0 space-y-1">
                  <Label
                    htmlFor="ban-expires-at"
                    className="text-xs uppercase tracking-wide text-muted-foreground"
                  >
                    Expires at
                  </Label>
                  <Input
                    id="ban-expires-at"
                    type="datetime-local"
                    value={form.expiresAt}
                    onChange={(e) => setForm((f) => ({ ...f, expiresAt: e.target.value }))}
                  />
                </div>
              ) : null}

              <div className="min-w-0 space-y-1">
                <Label
                  htmlFor="ban-reason"
                  className="text-xs uppercase tracking-wide text-muted-foreground"
                >
                  Reason (optional)
                </Label>
                <Input
                  id="ban-reason"
                  value={form.reason}
                  onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))}
                  placeholder="Repeat spam, harassment, etc."
                />
              </div>
            </div>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setIssueOpen(false)}
                disabled={issuing}
              >
                Cancel
              </Button>
              <Button
                type="button"
                variant="destructive"
                onClick={() => void issue()}
                disabled={issuing}
              >
                {issuing ? "Issuing…" : "Issue ban"}
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
  const detail = Array.isArray(err.details) ? err.details[0] : null;
  if (detail && typeof detail === "object" && "message" in detail) {
    const msg = (detail as { message?: unknown }).message;
    if (typeof msg === "string") return msg;
  }
  return typeof err.message === "string" ? err.message : null;
}
