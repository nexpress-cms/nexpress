"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Loader2, Plus, Trash2, Users } from "lucide-react";

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
import { Input } from "../ui/input.js";
import { Label } from "../ui/label.js";
import { PageHeader } from "../layout/page-header.js";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select.js";

/**
 * Phase 15.6 — per-site membership management.
 *
 *   /admin/sites/{id}/members
 *
 * Lists every (user, role) grant on the given site; admins
 * (super-admin or per-site admin) can grant a new
 * membership by user id + role, and revoke existing ones.
 *
 * v1 grants by raw user id — there's no user picker yet
 * (would require a /api/admin/users search endpoint with
 * email autocomplete). Operators paste the user id from
 * /admin/users.
 */

interface Membership {
  siteId: string;
  userId: string;
  role: string;
  createdAt: string;
  updatedAt: string;
}

const ROLES = ["admin", "editor", "moderator", "author", "viewer"] as const;

export function MembershipsView({ siteId }: { siteId: string }) {
  const [memberships, setMemberships] = useState<Membership[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [busyUserId, setBusyUserId] = useState<string | null>(null);

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [siteId]);

  async function load() {
    setError(null);
    try {
      const res = await npFetch(`/api/admin/sites/${encodeURIComponent(siteId)}/memberships`);
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as {
          error?: { message?: string };
        } | null;
        setError(body?.error?.message ?? "Unable to load memberships.");
        setMemberships([]);
        return;
      }
      const body = (await res.json().catch(() => null)) as { docs?: Membership[] } | null;
      setMemberships(body?.docs ?? []);
    } catch {
      setError("Unable to load memberships.");
    }
  }

  async function handleRevoke(userId: string) {
    if (
      !confirm(
        "Revoke this membership? The user will fall back to their global default role on this site.",
      )
    ) {
      return;
    }
    setBusyUserId(userId);
    setError(null);
    try {
      const res = await npFetch(
        `/api/admin/sites/${encodeURIComponent(siteId)}/memberships/${encodeURIComponent(userId)}`,
        { method: "DELETE" },
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as {
          error?: { message?: string };
        } | null;
        setError(body?.error?.message ?? "Unable to revoke.");
        return;
      }
      await load();
    } catch {
      setError("Unable to revoke.");
    } finally {
      setBusyUserId(null);
    }
  }

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <PageHeader
        title={
          <span className="flex min-w-0 items-center gap-2">
            <Users className="size-5 text-neutral-500" />
            <span className="min-w-0 break-words">Site members</span>
          </span>
        }
        description={
          <>
            Members of{" "}
            <code className="break-all rounded bg-neutral-100 px-1 py-0.5 font-mono text-[12px] text-neutral-700 dark:bg-neutral-900 dark:text-neutral-300">
              {siteId}
            </code>{" "}
            with explicit roles. Users not listed here fall back to their global default role.
          </>
        }
        className="min-w-0"
        actions={
          <>
            <Link href="/admin/sites">
              <Button variant="ghost" size="sm" className="w-full sm:w-auto">
                <ArrowLeft />
                All sites
              </Button>
            </Link>
            <Button onClick={() => setCreateOpen(true)} className="w-full sm:w-auto">
              <Plus />
              Grant membership
            </Button>
          </>
        }
      />

      {error ? (
        <div className="break-words rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      ) : null}

      {!memberships ? (
        <Card>
          <CardContent className="text-[13px] text-muted-foreground">
            <Loader2 className="mr-2 inline h-4 w-4 animate-spin" />
            Loading memberships…
          </CardContent>
        </Card>
      ) : memberships.length === 0 ? (
        <Card className="min-w-0">
          <CardContent className="break-words text-[13px] text-muted-foreground">
            No explicit memberships on this site. Grant one to start scoping roles per tenant.
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader className="border-b-0 pb-0">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              {memberships.length} membership
              {memberships.length === 1 ? "" : "s"}
            </CardTitle>
          </CardHeader>
          <CardContent className="divide-y divide-border/60 p-0">
            {memberships.map((m) => (
              <div
                key={m.userId}
                className="grid min-w-0 gap-3 px-5 py-3 sm:flex sm:items-center sm:justify-between"
              >
                <div className="min-w-0 space-y-1">
                  <p className="break-all font-mono text-xs">{m.userId}</p>
                  <p className="text-[11px] text-muted-foreground">
                    Granted {new Date(m.createdAt).toLocaleString()}
                  </p>
                </div>
                <div className="grid min-w-0 grid-cols-2 items-center gap-2 sm:flex sm:gap-3">
                  <span className="justify-self-start rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-medium text-primary capitalize">
                    {m.role}
                  </span>
                  <Button
                    size="sm"
                    variant="outline"
                    className="w-full sm:w-auto"
                    disabled={busyUserId === m.userId}
                    onClick={() => void handleRevoke(m.userId)}
                  >
                    {busyUserId === m.userId ? (
                      <Loader2 className="size-3 animate-spin" />
                    ) : (
                      <Trash2 className="size-3" />
                    )}
                    Revoke
                  </Button>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <GrantDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        siteId={siteId}
        onCreated={() => {
          setCreateOpen(false);
          void load();
        }}
      />
    </div>
  );
}

interface UserSearchResult {
  id: string;
  email: string;
  name: string;
}

function GrantDialog({
  open,
  onOpenChange,
  siteId,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  siteId: string;
  onCreated: () => void;
}) {
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<UserSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState<UserSearchResult | null>(null);
  const [role, setRole] = useState<(typeof ROLES)[number]>("editor");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setSearch("");
      setResults([]);
      setSelected(null);
      setRole("editor");
      setError(null);
    }
  }, [open]);

  // Phase 15.8 — debounced user search via the existing
  // /api/users?search= endpoint. 250ms debounce keeps the
  // typing experience responsive without blasting the DB.
  useEffect(() => {
    if (!open || selected || !search.trim()) {
      setResults([]);
      return;
    }
    const runSearch = async () => {
      setSearching(true);
      try {
        const res = await npFetch(`/api/users?search=${encodeURIComponent(search.trim())}&limit=8`);
        if (!res.ok) {
          setResults([]);
          return;
        }
        const body = (await res.json().catch(() => null)) as { docs?: UserSearchResult[] } | null;
        setResults(body?.docs ?? []);
      } finally {
        setSearching(false);
      }
    };
    const handle = setTimeout(() => {
      void runSearch();
    }, 250);
    return () => clearTimeout(handle);
  }, [search, selected, open]);

  async function handleSubmit() {
    if (!selected) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await npFetch(`/api/admin/sites/${encodeURIComponent(siteId)}/memberships`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: selected.id, role }),
      });
      const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
      if (!res.ok) {
        setError(body?.error?.message ?? "Unable to grant membership.");
        return;
      }
      onCreated();
    } catch {
      setError("Unable to grant membership.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="min-w-0">
        <DialogHeader>
          <DialogTitle className="break-words">
            Grant membership on <span className="break-all">{siteId}</span>
          </DialogTitle>
          <DialogDescription className="break-words">
            Search by email or name. Granting on a site overrides the user&apos;s global default
            role for queries scoped to this site.
          </DialogDescription>
        </DialogHeader>

        <div className="min-w-0 space-y-4">
          <div className="min-w-0 space-y-2">
            <Label htmlFor="grant-user-search" className="break-words">
              User
            </Label>
            {selected ? (
              <div className="grid min-w-0 gap-2 rounded-xl border border-border/70 bg-muted/30 px-3 py-2 sm:flex sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="break-words text-sm font-medium">{selected.name}</p>
                  <p className="break-all text-xs text-muted-foreground">{selected.email}</p>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="w-full sm:w-auto"
                  onClick={() => {
                    setSelected(null);
                    setSearch("");
                  }}
                >
                  Change
                </Button>
              </div>
            ) : (
              <>
                <Input
                  id="grant-user-search"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Email or name…"
                  className="min-w-0"
                />
                {search.trim() ? (
                  <div className="min-w-0 rounded-xl border border-border/70 bg-background">
                    {searching ? (
                      <p className="px-3 py-2 text-xs text-muted-foreground">
                        <Loader2 className="size-3 animate-spin" />
                        Searching…
                      </p>
                    ) : results.length === 0 ? (
                      <p className="px-3 py-2 text-xs text-muted-foreground">No users match.</p>
                    ) : (
                      <ul className="max-h-48 overflow-auto divide-y divide-border/60">
                        {results.map((r) => (
                          <li key={r.id}>
                            <button
                              type="button"
                              className="grid min-w-0 w-full gap-1 px-3 py-2 text-left text-sm hover:bg-muted/40 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] sm:items-center"
                              onClick={() => {
                                setSelected(r);
                                setSearch("");
                              }}
                            >
                              <span className="min-w-0 truncate font-medium">{r.name}</span>
                              <span className="min-w-0 break-all text-xs text-muted-foreground sm:truncate sm:text-right">
                                {r.email}
                              </span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                ) : null}
              </>
            )}
          </div>
          <div className="min-w-0 space-y-2">
            <Label htmlFor="grant-role" className="break-words">
              Role
            </Label>
            <Select value={role} onValueChange={(v) => setRole(v as (typeof ROLES)[number])}>
              <SelectTrigger id="grant-role" className="min-w-0">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ROLES.map((r) => (
                  <SelectItem key={r} value={r} className="capitalize">
                    {r}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {error ? (
            <p className="break-words rounded-xl border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
              {error}
            </p>
          ) : null}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={() => void handleSubmit()} disabled={submitting || !selected}>
            {submitting ? <Loader2 className="size-3.5 animate-spin" /> : null}
            Grant
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
