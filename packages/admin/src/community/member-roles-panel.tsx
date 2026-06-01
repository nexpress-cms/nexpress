"use client";

import { useEffect, useMemo, useState } from "react";
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

type CommunityScope = "site" | "category" | "collection" | "thread";

export interface MemberRoleGrantRow {
  id: string;
  memberId: string;
  role: string;
  scopeType: CommunityScope;
  scopeId: string | null;
  grantedBy: string | null;
  grantedAt: string;
  expiresAt: string | null;
}

interface RoleDefinition {
  role: string;
  scopeType: CommunityScope;
  capabilities: readonly string[];
  label?: string;
  source?: string | null;
}

interface MemberRolesPanelProps {
  memberId: string;
  memberHandle: string;
  /**
   * Granting / revoking is admin-only — granting moderation roles
   * to a member is a privilege escalation. Editors and staff-mods
   * already moderate from their own logins; they don't get to
   * deputize other accounts. Read access is staff-mod via the GET
   * handler so non-admins still see the active grant list.
   */
  canModify: boolean;
}

interface GrantFormState {
  role: string;
  scopeType: CommunityScope;
  scopeId: string;
  expiresAt: string;
}

const EMPTY_FORM: GrantFormState = {
  role: "",
  scopeType: "site",
  scopeId: "",
  expiresAt: "",
};

/**
 * Member role grant panel on `/admin/members/[id]`. Lists currently-
 * active grants from `np_member_roles` and lets admins promote a
 * member to a community role (`community-mod` site-wide,
 * `category-mod` on a category, `collection-mod` on a collection,
 * etc.). The role registry is loaded once on mount; the picker is
 * filtered by the chosen scope so a `category-mod` definition
 * doesn't show up under scope `collection`.
 */
export function MemberRolesPanel({ memberId, memberHandle, canModify }: MemberRolesPanelProps) {
  const router = useRouter();
  const [grants, setGrants] = useState<MemberRoleGrantRow[]>([]);
  const [definitions, setDefinitions] = useState<RoleDefinition[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [grantOpen, setGrantOpen] = useState(false);
  const [granting, setGranting] = useState(false);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [form, setForm] = useState<GrantFormState>(EMPTY_FORM);

  // Roles available for the current scope. The picker resets to the
  // first match when the scope changes so the form never holds an
  // invalid (role, scope) pair.
  const eligibleRoles = useMemo(
    () => definitions.filter((d) => d.scopeType === form.scopeType),
    [definitions, form.scopeType],
  );

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [memberId]);

  // Snap `form.role` to the first eligible role whenever the scope
  // changes — otherwise a leftover `category-mod` selection survives
  // a scope flip to `site` and the API rejects the grant.
  useEffect(() => {
    if (form.role && !eligibleRoles.some((r) => r.role === form.role)) {
      setForm((f) => ({ ...f, role: eligibleRoles[0]?.role ?? "" }));
    }
  }, [eligibleRoles, form.role]);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [grantsRes, rolesRes] = await Promise.all([
        npFetch(`/api/admin/community/role-grants?memberId=${encodeURIComponent(memberId)}`),
        npFetch("/api/admin/community/roles"),
      ]);
      const grantsRaw = (await grantsRes.json().catch(() => null)) as Record<
        string,
        unknown
      > | null;
      const rolesRaw = (await rolesRes.json().catch(() => null)) as Record<string, unknown> | null;
      if (!grantsRes.ok || !grantsRaw) {
        setError(extractErrorMessage(grantsRaw) ?? `HTTP ${grantsRes.status}`);
        return;
      }
      if (!rolesRes.ok || !rolesRaw) {
        setError(extractErrorMessage(rolesRaw) ?? `HTTP ${rolesRes.status}`);
        return;
      }
      const grantsData = (grantsRaw.data ?? grantsRaw) as { docs?: MemberRoleGrantRow[] };
      const rolesData = (rolesRaw.data ?? rolesRaw) as { docs?: RoleDefinition[] };
      setGrants(Array.isArray(grantsData.docs) ? grantsData.docs : []);
      setDefinitions(Array.isArray(rolesData.docs) ? rolesData.docs : []);
    } catch {
      setError("Unable to load role grants.");
    } finally {
      setLoading(false);
    }
  }

  async function grant() {
    setGranting(true);
    setError(null);
    try {
      const body: Record<string, unknown> = {
        memberId,
        role: form.role,
        scopeType: form.scopeType,
      };
      if (form.scopeType !== "site") {
        body.scopeId = form.scopeId.trim();
      }
      if (form.expiresAt) {
        body.expiresAt = new Date(form.expiresAt).toISOString();
      }

      const res = await npFetch("/api/admin/community/role-grants", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const raw = (await res.json().catch(() => null)) as Record<string, unknown> | null;
      if (!res.ok || !raw) {
        setError(extractErrorMessage(raw) ?? `HTTP ${res.status}`);
        return;
      }
      setGrantOpen(false);
      setForm(EMPTY_FORM);
      await load();
      router.refresh();
    } catch {
      setError("Unable to grant role.");
    } finally {
      setGranting(false);
    }
  }

  async function revoke(grantId: string) {
    setRevokingId(grantId);
    setError(null);
    try {
      const res = await npFetch(`/api/admin/community/role-grants/${encodeURIComponent(grantId)}`, {
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
      setError("Unable to revoke grant.");
    } finally {
      setRevokingId(null);
    }
  }

  return (
    <Card className="min-w-0">
      <CardHeader className="grid gap-3 sm:flex sm:flex-row sm:items-center sm:justify-between sm:gap-4">
        <CardTitle className="min-w-0">Community roles</CardTitle>
        {canModify ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="min-h-10 w-full sm:min-h-0 sm:w-auto"
            onClick={() => {
              setForm({
                ...EMPTY_FORM,
                role: definitions.find((d) => d.scopeType === "site")?.role ?? "",
              });
              setGrantOpen(true);
            }}
            disabled={loading}
          >
            Grant role
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
        ) : grants.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            <span className="break-all">@{memberHandle}</span> has no community role grants.
            Granting a role gives this member the moderation capabilities for the chosen scope.
          </p>
        ) : (
          <ul className="space-y-2">
            {grants.map((g) => {
              const def = definitions.find((d) => d.role === g.role && d.scopeType === g.scopeType);
              return (
                <li
                  key={g.id}
                  className="grid gap-3 rounded-xl border border-border/60 bg-muted/30 px-4 py-3 sm:flex sm:items-start sm:justify-between"
                >
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="default">{def?.label ?? g.role}</Badge>
                      <Badge variant="secondary">{g.scopeType}</Badge>
                      {g.scopeId ? (
                        <code className="inline-block max-w-full break-all rounded bg-background px-2 py-0.5 font-mono text-xs">
                          {g.scopeId}
                        </code>
                      ) : null}
                      {g.expiresAt ? (
                        <span className="text-xs text-muted-foreground">
                          until {new Date(g.expiresAt).toLocaleString()}
                        </span>
                      ) : null}
                    </div>
                    {def && def.capabilities.length > 0 ? (
                      <p className="break-words text-xs text-muted-foreground">
                        {def.capabilities.length} capabilities ·{" "}
                        {def.capabilities.slice(0, 4).join(", ")}
                        {def.capabilities.length > 4 ? "…" : ""}
                      </p>
                    ) : null}
                    <p className="text-xs text-muted-foreground">
                      Granted {new Date(g.grantedAt).toLocaleString()}
                    </p>
                  </div>
                  {canModify ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="min-h-10 w-full sm:min-h-0 sm:w-auto"
                      onClick={() => void revoke(g.id)}
                      disabled={revokingId === g.id}
                    >
                      {revokingId === g.id ? "Revoking…" : "Revoke"}
                    </Button>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>

      {grantOpen ? (
        <Dialog open onOpenChange={(open) => !open && setGrantOpen(false)}>
          <DialogContent className="min-w-0" data-np-member-role-dialog>
            <DialogHeader>
              <DialogTitle className="break-words">Grant role to @{memberHandle}</DialogTitle>
              <DialogDescription className="break-words">
                Granting a role gives this member the moderation capabilities for the chosen scope.
                Use site-wide for `community-mod`, or pick a category / collection / thread to limit
                the grant. The action is recorded in the audit log.
              </DialogDescription>
            </DialogHeader>

            <div className="min-w-0 space-y-4">
              <div className="min-w-0 space-y-1">
                <Label className="text-xs uppercase tracking-wide text-muted-foreground">
                  Scope
                </Label>
                <Select
                  value={form.scopeType}
                  onValueChange={(v) => setForm((f) => ({ ...f, scopeType: v as CommunityScope }))}
                >
                  <SelectTrigger className="min-w-0">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="site">Site-wide</SelectItem>
                    <SelectItem value="category">Category</SelectItem>
                    <SelectItem value="collection">Collection</SelectItem>
                    <SelectItem value="thread">Thread</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="min-w-0 space-y-1">
                <Label className="text-xs uppercase tracking-wide text-muted-foreground">
                  Role
                </Label>
                {eligibleRoles.length === 0 ? (
                  <p className="break-words text-sm text-muted-foreground">
                    No roles registered for this scope.
                  </p>
                ) : (
                  <Select
                    value={form.role}
                    onValueChange={(v) => setForm((f) => ({ ...f, role: v }))}
                  >
                    <SelectTrigger className="min-w-0">
                      <SelectValue placeholder="Pick a role" />
                    </SelectTrigger>
                    <SelectContent>
                      {eligibleRoles.map((r) => (
                        <SelectItem key={r.role} value={r.role}>
                          {r.label ?? r.role}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>

              {form.scopeType !== "site" ? (
                <div className="min-w-0 space-y-1">
                  <Label
                    htmlFor="grant-scope-id"
                    className="text-xs uppercase tracking-wide text-muted-foreground"
                  >
                    {form.scopeType === "collection"
                      ? "Collection slug"
                      : form.scopeType === "category"
                        ? "Category id"
                        : "Thread id"}
                  </Label>
                  <Input
                    id="grant-scope-id"
                    value={form.scopeId}
                    onChange={(e) => setForm((f) => ({ ...f, scopeId: e.target.value }))}
                    placeholder={
                      form.scopeType === "collection"
                        ? "posts, discussions, …"
                        : form.scopeType === "category"
                          ? "category-uuid"
                          : "thread-uuid"
                    }
                  />
                </div>
              ) : null}

              <div className="min-w-0 space-y-1">
                <Label
                  htmlFor="grant-expires-at"
                  className="text-xs uppercase tracking-wide text-muted-foreground"
                >
                  Expires at (optional)
                </Label>
                <Input
                  id="grant-expires-at"
                  type="datetime-local"
                  value={form.expiresAt}
                  onChange={(e) => setForm((f) => ({ ...f, expiresAt: e.target.value }))}
                />
                <p className="break-words text-xs text-muted-foreground">
                  Leave blank for a permanent grant.
                </p>
              </div>
            </div>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setGrantOpen(false)}
                disabled={granting}
              >
                Cancel
              </Button>
              <Button type="button" onClick={() => void grant()} disabled={granting || !form.role}>
                {granting ? "Granting…" : "Grant role"}
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
