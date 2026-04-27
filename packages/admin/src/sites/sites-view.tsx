"use client";

import { useEffect, useState } from "react";
import { Globe2, Loader2, Plus, Star, Trash2 } from "lucide-react";

import { nxFetch } from "../lib/api-client.js";
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

  useEffect(() => {
    void load();
  }, []);

  async function load() {
    setError(null);
    try {
      const res = await nxFetch("/api/admin/sites");
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

  async function handleDelete(id: string) {
    if (!confirm(`Delete site "${id}"? Content for this site will become inaccessible.`)) {
      return;
    }
    setBusyId(id);
    setError(null);
    try {
      const res = await nxFetch(`/api/admin/sites/${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as
          | { error?: { message?: string } }
          | null;
        setError(body?.error?.message ?? "Unable to delete site.");
        return;
      }
      await load();
    } catch {
      setError("Unable to delete site.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1">
          <p className="text-sm font-medium uppercase tracking-[0.24em] text-muted-foreground">
            Multi-tenancy
          </p>
          <h1 className="text-3xl font-semibold tracking-tight text-foreground">
            Sites
          </h1>
          <p className="max-w-2xl text-sm text-muted-foreground">
            Each site is an independent tenant — its own content, navigation,
            settings. Requests are routed by hostname; unmatched hosts fall
            through to the default site.
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="mr-2 h-4 w-4" />
          Add site
        </Button>
      </div>

      {error ? (
        <div className="rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      ) : null}

      {!sites ? (
        <Card>
          <CardContent className="pt-6 text-sm text-muted-foreground">
            <Loader2 className="mr-2 inline h-4 w-4 animate-spin" />
            Loading sites…
          </CardContent>
        </Card>
      ) : sites.length === 0 ? (
        <Card>
          <CardContent className="pt-6 text-sm text-muted-foreground">
            No sites configured. (This shouldn&apos;t be possible — the framework
            seeds a default site at install time.)
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {sites.map((site) => (
            <Card key={site.id} className="border-border/70 shadow-sm">
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
                <div className="flex items-center justify-end">
                  {!site.isDefault ? (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={busyId === site.id}
                      onClick={() => void handleDelete(site.id)}
                    >
                      {busyId === site.id ? (
                        <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />
                      ) : (
                        <Trash2 className="mr-1.5 h-3 w-3" />
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
    </div>
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
      const res = await nxFetch("/api/admin/sites", {
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
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : null}
            Create site
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
