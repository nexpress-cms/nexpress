"use client";

import { useEffect, useState } from "react";

import { nxFetch } from "../lib/api-client.js";
import { Badge } from "../ui/badge.js";
import { Button } from "../ui/button.js";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card.js";
import { Input } from "../ui/input.js";
import { Label } from "../ui/label.js";
import { Switch } from "../ui/switch.js";
import { PageHeader } from "../layout/page-header.js";

export interface CommunitySettings {
  reactionKinds: string[];
  registrationEnabled: boolean;
  memberUploadQuota: { perDay: number | null; total: number | null };
}

const DEFAULT_SETTINGS: CommunitySettings = {
  reactionKinds: ["like"],
  registrationEnabled: true,
  memberUploadQuota: { perDay: null, total: null },
};

const KIND_RE = /^[a-z][a-z0-9_-]{0,29}$/;

interface CommunitySettingsViewProps {
  /**
   * When false, the page renders read-only — fetched values display
   * but the inputs and Save button are disabled. The server enforces
   * this independently (PUT requires admin role); the prop is just
   * UX so mods don't see a Save button that would always 403.
   */
  canEdit: boolean;
}

export function CommunitySettingsView({ canEdit }: CommunitySettingsViewProps) {
  const [settings, setSettings] = useState<CommunitySettings>(DEFAULT_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pendingKind, setPendingKind] = useState("");

  useEffect(() => {
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const res = await nxFetch("/api/admin/community/settings");
        const raw = (await res.json().catch(() => null)) as Record<string, unknown> | null;
        if (!res.ok || !raw) {
          setError(extractErrorMessage(raw) ?? `HTTP ${res.status}`);
          return;
        }
        const data = (raw.data ?? raw) as Partial<CommunitySettings>;
        const quotaRaw = (data.memberUploadQuota ?? {}) as Partial<
          CommunitySettings["memberUploadQuota"]
        >;
        setSettings({
          reactionKinds: Array.isArray(data.reactionKinds)
            ? data.reactionKinds.filter((k): k is string => typeof k === "string")
            : DEFAULT_SETTINGS.reactionKinds,
          registrationEnabled:
            typeof data.registrationEnabled === "boolean"
              ? data.registrationEnabled
              : DEFAULT_SETTINGS.registrationEnabled,
          memberUploadQuota: {
            perDay:
              typeof quotaRaw.perDay === "number" ? quotaRaw.perDay : null,
            total:
              typeof quotaRaw.total === "number" ? quotaRaw.total : null,
          },
        });
      } catch {
        setError("Unable to load community settings.");
      } finally {
        setLoading(false);
      }
    }
    void load();
  }, []);

  async function save() {
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const res = await nxFetch("/api/admin/community/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings),
      });
      const raw = (await res.json().catch(() => null)) as Record<string, unknown> | null;
      if (!res.ok || !raw) {
        setError(extractErrorMessage(raw) ?? `HTTP ${res.status}`);
        return;
      }
      const data = (raw.data ?? raw) as CommunitySettings;
      setSettings(data);
      setMessage("Community settings saved.");
    } catch {
      setError("Unable to save community settings.");
    } finally {
      setSaving(false);
    }
  }

  function addKind() {
    const trimmed = pendingKind.trim().toLowerCase();
    if (!trimmed) return;
    if (!KIND_RE.test(trimmed)) {
      setError(`Invalid kind '${trimmed}'. Use lowercase letters, digits, '_' or '-' (max 30).`);
      return;
    }
    if (settings.reactionKinds.includes(trimmed)) {
      setError(`'${trimmed}' is already in the list.`);
      return;
    }
    setError(null);
    setSettings((s) => ({ ...s, reactionKinds: [...s.reactionKinds, trimmed] }));
    setPendingKind("");
  }

  function removeKind(kind: string) {
    setSettings((s) => ({ ...s, reactionKinds: s.reactionKinds.filter((k) => k !== kind) }));
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Community settings"
        description="Site-wide knobs for member registration and the reactions members can leave on community content. Changes apply immediately."
      />

      {error ? (
        <div className="rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      ) : null}
      {message ? (
        <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 px-4 py-3 text-sm text-emerald-700 dark:text-emerald-400">
          {message}
        </div>
      ) : null}

      <Card className="border-border/60 shadow-sm">
        <CardHeader>
          <CardTitle className="text-lg">Member registration</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-1">
              <Label htmlFor="registration-enabled" className="text-sm font-medium">
                Self-registration
              </Label>
              <p className="text-sm text-muted-foreground">
                When off, the public sign-up endpoint returns 403. Existing members
                can still sign in; new members must be provisioned manually.
              </p>
            </div>
            <Switch
              id="registration-enabled"
              checked={settings.registrationEnabled}
              disabled={loading || saving || !canEdit}
              onCheckedChange={(v) =>
                setSettings((s) => ({ ...s, registrationEnabled: v }))
              }
            />
          </div>
        </CardContent>
      </Card>

      <Card className="border-border/60 shadow-sm">
        <CardHeader>
          <CardTitle className="text-lg">Reaction kinds</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Members can only add reactions whose kind is in this list. Removing a
            kind doesn&rsquo;t delete existing reactions — members can still un-react
            them. An empty list disables reactions entirely.
          </p>
          <div className="flex flex-wrap gap-2">
            {settings.reactionKinds.length === 0 ? (
              <span className="text-sm text-muted-foreground">
                No reaction kinds configured.
              </span>
            ) : (
              settings.reactionKinds.map((kind) => (
                <Badge key={kind} variant="secondary" className="gap-2 px-3 py-1.5 text-sm">
                  <span className="font-mono">{kind}</span>
                  {canEdit ? (
                    <button
                      type="button"
                      onClick={() => removeKind(kind)}
                      disabled={saving}
                      className="text-muted-foreground hover:text-destructive"
                      aria-label={`Remove ${kind}`}
                    >
                      ×
                    </button>
                  ) : null}
                </Badge>
              ))
            )}
          </div>
          {canEdit ? (
            <div className="flex items-end gap-2">
              <div className="flex-1 space-y-1">
                <Label htmlFor="pending-kind" className="text-xs uppercase tracking-wide text-muted-foreground">
                  Add kind
                </Label>
                <Input
                  id="pending-kind"
                  value={pendingKind}
                  onChange={(e) => setPendingKind(e.target.value)}
                  placeholder="e.g. love, fire, thanks"
                  disabled={saving}
                />
              </div>
              <Button type="button" variant="outline" onClick={addKind} disabled={saving}>
                Add
              </Button>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card className="border-border/60 shadow-sm">
        <CardHeader>
          <CardTitle className="text-lg">Member upload quota</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Limits image uploads from member accounts. Leave a field blank for
            unlimited. Admin / member deletes free up quota — staff uploads
            are never gated. The 24h window is rolling, not calendar-day.
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1">
              <Label
                htmlFor="quota-per-day"
                className="text-xs uppercase tracking-wide text-muted-foreground"
              >
                Max uploads per 24h
              </Label>
              <Input
                id="quota-per-day"
                type="number"
                min={0}
                step={1}
                value={
                  settings.memberUploadQuota.perDay === null
                    ? ""
                    : String(settings.memberUploadQuota.perDay)
                }
                placeholder="Unlimited"
                disabled={loading || saving || !canEdit}
                onChange={(e) =>
                  setSettings((s) => ({
                    ...s,
                    memberUploadQuota: {
                      ...s.memberUploadQuota,
                      perDay:
                        e.target.value.trim() === ""
                          ? null
                          : Math.max(0, Math.floor(Number(e.target.value))),
                    },
                  }))
                }
              />
            </div>
            <div className="space-y-1">
              <Label
                htmlFor="quota-total"
                className="text-xs uppercase tracking-wide text-muted-foreground"
              >
                Lifetime cap
              </Label>
              <Input
                id="quota-total"
                type="number"
                min={0}
                step={1}
                value={
                  settings.memberUploadQuota.total === null
                    ? ""
                    : String(settings.memberUploadQuota.total)
                }
                placeholder="Unlimited"
                disabled={loading || saving || !canEdit}
                onChange={(e) =>
                  setSettings((s) => ({
                    ...s,
                    memberUploadQuota: {
                      ...s.memberUploadQuota,
                      total:
                        e.target.value.trim() === ""
                          ? null
                          : Math.max(0, Math.floor(Number(e.target.value))),
                    },
                  }))
                }
              />
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="flex items-center justify-end gap-3">
        {canEdit ? (
          <Button onClick={() => void save()} disabled={loading || saving}>
            {saving ? "Saving…" : "Save changes"}
          </Button>
        ) : (
          <span className="text-sm text-muted-foreground">
            Read-only view. Admin role required to edit.
          </span>
        )}
      </div>
    </div>
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
