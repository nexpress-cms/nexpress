"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  Globe2,
  Loader2,
  Plus,
  Star,
  Trash2,
  Users,
} from "lucide-react";

import { npFetch } from "../lib/api-client.js";
import { Button } from "../ui/button.js";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "../ui/card.js";
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
import { Textarea } from "../ui/textarea.js";
import { PageHeader } from "../layout/page-header.js";

interface SiteUsage {
  collections: Record<string, number>;
  settings: number;
  navigation: number;
  memberships: number;
  stringOverrides: number;
  total: number;
}

interface DeleteDialogState {
  site: Site;
  usage: SiteUsage | null;
  loading: boolean;
  cascade: boolean;
  busy: boolean;
}

/**
 * Phase 15.3 — multi-site admin view.
 *
 *   /admin/sites                  list + create / delete
 *
 * Sites are tenants — the framework already creates a
 * `default` row at install time so single-tenant deployments
 * don't have to manage anything here. Adding more sites lets
 * one NexPress instance host independent content trees keyed
 * by hostname; the middleware maps the request's Host header
 * to the matching site, falling back to the default when
 * unmatched.
 */
interface Site {
  id: string;
  name: string;
  hostname: string | null;
  description: string | null;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

export function SitesView() {
  const [sites, setSites] = useState<Site[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [deleteDialog, setDeleteDialog] = useState<DeleteDialogState | null>(
    null,
  );

  useEffect(() => {
    void load();
  }, []);

  async function load() {
    setError(null);
    try {
      const res = await npFetch("/api/admin/sites");
      const body = (await res.json().catch(() => null)) as
        | { docs?: Site[]; error?: { message?: string } }
        | null;
      if (!res.ok) {
        setError(body?.error?.message ?? "Unable to load sites.");
        return;
      }
      setSites(body?.docs ?? []);
    } catch {
      setError("Unable to load sites.");
    }
  }

  async function openDeleteDialog(site: Site) {
    // Phase 15.9 — fetch the usage summary first so the
    // operator sees what cascade=true would touch BEFORE
    // confirming. The dialog stays loading until the summary
    // arrives.
    setDeleteDialog({
      site,
      usage: null,
      loading: true,
      cascade: false,
      busy: false,
    });
    setError(null);
    try {
      const res = await npFetch(
        `/api/admin/sites/${encodeURIComponent(site.id)}/usage`,
      );
      const body = (await res.json().catch(() => null)) as
        | { usage?: SiteUsage; error?: { message?: string } }
        | null;
      if (!res.ok || !body?.usage) {
        setError(body?.error?.message ?? "Unable to load site usage.");
        setDeleteDialog(null);
        return;
      }
      setDeleteDialog((prev) =>
        prev && prev.site.id === site.id
          ? { ...prev, usage: body.usage ?? null, loading: false }
          : prev,
      );
    } catch {
      setError("Unable to load site usage.");
      setDeleteDialog(null);
    }
  }

  async function handleConfirmDelete() {
    if (!deleteDialog) return;
    const { site, usage, cascade } = deleteDialog;
    if (!usage) return;
    setDeleteDialog({ ...deleteDialog, busy: true });
    setBusyId(site.id);
    setError(null);
    try {
      const cascadeParam =
        usage.total > 0 && cascade ? "?cascade=true" : "";
      const res = await npFetch(
        `/api/admin/sites/${encodeURIComponent(site.id)}${cascadeParam}`,
        {
          method: "DELETE",
        },
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as
          | { error?: { message?: string } }
          | null;
        setError(body?.error?.message ?? "Unable to delete site.");
        setDeleteDialog((prev) =>
          prev ? { ...prev, busy: false } : prev,
        );
        return;
      }
      setDeleteDialog(null);
      await load();
    } catch {
      setError("Unable to delete site.");
      setDeleteDialog((prev) => (prev ? { ...prev, busy: false } : prev));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Sites"
        description="Each site is an independent tenant — its own content, navigation, settings. Requests are routed by hostname; unmatched hosts fall through to the default site."
        actions={
          <Button onClick={() => setCreateOpen(true)}>
            <Plus />
            Add site
          </Button>
        }
      />

      {error ? (
        <div className="rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      ) : null}

      {!sites ? (
        <Card>
          <CardContent className="text-[13px] text-muted-foreground">
            <Loader2 className="mr-2 inline h-4 w-4 animate-spin" />
            Loading sites…
          </CardContent>
        </Card>
      ) : sites.length === 0 ? (
        <Card>
          <CardContent className="text-[13px] text-muted-foreground">
            No sites configured. (This shouldn&apos;t be possible — the framework
            seeds a default site at install time.)
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {sites.map((site) => (
            <Card key={site.id}>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between gap-3">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Globe2 className="h-4 w-4 text-muted-foreground" />
                    {site.name}
                  </CardTitle>
                  {site.isDefault ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">
                      <Star className="h-3 w-3" /> Default
                    </span>
                  ) : null}
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="space-y-1 text-xs text-muted-foreground">
                  <p>
                    <span className="font-mono uppercase tracking-wider opacity-70">
                      ID
                    </span>{" "}
                    <code>{site.id}</code>
                  </p>
                  <p>
                    <span className="font-mono uppercase tracking-wider opacity-70">
                      Host
                    </span>{" "}
                    {site.hostname ? (
                      <code>{site.hostname}</code>
                    ) : (
                      <span className="italic">any (default)</span>
                    )}
                  </p>
                  {site.description ? (
                    <p className="pt-1 text-foreground">{site.description}</p>
                  ) : null}
                </div>
                <div className="flex items-center justify-end gap-2">
                  <Link href={`/admin/sites/${encodeURIComponent(site.id)}/members`}>
                    <Button variant="outline" size="sm">
                      <Users className="size-3" />
                      Members
                    </Button>
                  </Link>
                  {!site.isDefault ? (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={busyId === site.id}
                      onClick={() => void openDeleteDialog(site)}
                    >
                      {busyId === site.id ? (
                        <Loader2 className="size-3 animate-spin" />
                      ) : (
                        <Trash2 className="size-3" />
                      )}
                      Delete
                    </Button>
                  ) : null}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <CreateSiteDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={() => {
          setCreateOpen(false);
          void load();
        }}
      />

      <DeleteSiteDialog
        state={deleteDialog}
        onClose={() => setDeleteDialog(null)}
        onCascadeChange={(value) =>
          setDeleteDialog((prev) =>
            prev ? { ...prev, cascade: value } : prev,
          )
        }
        onConfirm={() => void handleConfirmDelete()}
      />
    </div>
  );
}

function DeleteSiteDialog({
  state,
  onClose,
  onCascadeChange,
  onConfirm,
}: {
  state: DeleteDialogState | null;
  onClose: () => void;
  onCascadeChange: (value: boolean) => void;
  onConfirm: () => void;
}) {
  const open = state !== null;
  const usage = state?.usage;
  const hasData = usage ? usage.total > 0 : false;
  const cascadeRequired = hasData;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            Delete site{state ? ` "${state.site.name}"` : ""}?
          </DialogTitle>
          <DialogDescription>
            This action removes the site from the registry. Site-scoped
            data is left in place unless you opt into cascade.
          </DialogDescription>
        </DialogHeader>

        {!state ? null : state.loading ? (
          <p className="text-sm text-muted-foreground">
            <Loader2 className="size-3 animate-spin" />
            Loading usage…
          </p>
        ) : usage ? (
          <div className="space-y-4">
            {hasData ? (
              <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-900 dark:text-amber-100">
                <p className="flex items-start gap-2 font-medium">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  This site has {usage.total} attached row(s) across{" "}
                  {Object.keys(usage.collections).length} collection(s) +
                  system tables. Without cascade they become orphaned.
                </p>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                No site-scoped rows attached. Safe to delete.
              </p>
            )}

            {hasData ? (
              <ul className="rounded-md border border-border/60 bg-muted/30 p-3 text-xs">
                {Object.entries(usage.collections)
                  .filter(([, count]) => count > 0)
                  .map(([slug, count]) => (
                    <li
                      key={slug}
                      className="flex items-center justify-between py-1"
                    >
                      <code className="font-mono">{slug}</code>
                      <span className="tabular-nums">{count}</span>
                    </li>
                  ))}
                {usage.settings > 0 ? (
                  <li className="flex items-center justify-between py-1">
                    <code className="font-mono">nx_settings</code>
                    <span className="tabular-nums">{usage.settings}</span>
                  </li>
                ) : null}
                {usage.navigation > 0 ? (
                  <li className="flex items-center justify-between py-1">
                    <code className="font-mono">nx_navigation</code>
                    <span className="tabular-nums">{usage.navigation}</span>
                  </li>
                ) : null}
                {usage.memberships > 0 ? (
                  <li className="flex items-center justify-between py-1">
                    <code className="font-mono">nx_site_memberships</code>
                    <span className="tabular-nums">{usage.memberships}</span>
                  </li>
                ) : null}
                {usage.stringOverrides > 0 ? (
                  <li className="flex items-center justify-between py-1">
                    <code className="font-mono">nx_string_overrides</code>
                    <span className="tabular-nums">
                      {usage.stringOverrides}
                    </span>
                  </li>
                ) : null}
              </ul>
            ) : null}

            {cascadeRequired ? (
              <label className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={state.cascade}
                  onChange={(event) => onCascadeChange(event.target.checked)}
                  className="mt-0.5"
                />
                <span>
                  Cascade-delete every row above. This is{" "}
                  <strong>irreversible</strong> — there's no soft-delete or
                  archive.
                </span>
              </label>
            ) : null}
          </div>
        ) : null}

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={state?.busy}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={onConfirm}
            disabled={
              !state ||
              state.loading ||
              state.busy ||
              (cascadeRequired && !state.cascade)
            }
          >
            {state?.busy ? (
              <Loader2 className="size-3 animate-spin" />
            ) : (
              <Trash2 className="size-3" />
            )}
            {cascadeRequired ? "Delete site + cascade" : "Delete site"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CreateSiteDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  onCreated: () => void;
}) {
  const [id, setId] = useState("");
  const [name, setName] = useState("");
  const [hostname, setHostname] = useState("");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setId("");
      setName("");
      setHostname("");
      setDescription("");
      setError(null);
    }
  }, [open]);

  async function handleSubmit() {
    setSubmitting(true);
    setError(null);
    try {
      const res = await npFetch("/api/admin/sites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id,
          name,
          hostname: hostname || null,
          description: description || null,
        }),
      });
      const body = (await res.json().catch(() => null)) as
        | { error?: { message?: string } }
        | null;
      if (!res.ok) {
        setError(body?.error?.message ?? "Unable to create site.");
        return;
      }
      onCreated();
    } catch {
      setError("Unable to create site.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add a site</DialogTitle>
          <DialogDescription>
            Each site is an independent tenant. The id is the stable handle
            used in URLs and the database; pick a short lowercase string.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="site-id">Site id</Label>
            <Input
              id="site-id"
              value={id}
              onChange={(e) => setId(e.target.value)}
              placeholder="acme"
            />
            <p className="text-xs text-muted-foreground">
              Lowercase letters, digits, hyphens; must start with a letter.
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="site-name">Display name</Label>
            <Input
              id="site-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Acme Corp"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="site-hostname">Hostname (optional)</Label>
            <Input
              id="site-hostname"
              value={hostname}
              onChange={(e) => setHostname(e.target.value)}
              placeholder="acme.example.com"
            />
            <p className="text-xs text-muted-foreground">
              Requests with this <code>Host</code> header route to this site.
              Leave blank for sites you&apos;ll route by some other mechanism
              (path prefix, future support).
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="site-description">Description (optional)</Label>
            <Textarea
              id="site-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
            />
          </div>
          {error ? (
            <p className="rounded-xl border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
              {error}
            </p>
          ) : null}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
          >
            Cancel
          </Button>
          <Button
            onClick={() => void handleSubmit()}
            disabled={submitting || !id || !name}
          >
            {submitting ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : null}
            Create site
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
