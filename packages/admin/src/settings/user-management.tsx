"use client";

import { useEffect, useState } from "react";
import type { NxUserRole } from "@nexpress/core";
import { MailPlus, Plus } from "lucide-react";

import { nxFetch } from "../lib/api-client.js";
import { Badge } from "../ui/badge.js";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select.js";

type UserRow = {
  id: string;
  name: string;
  email: string;
  role: NxUserRole;
};

const ROLE_OPTIONS: NxUserRole[] = ["admin", "editor", "author", "viewer"];

export function UserManagement() {
  const [users, setUsers] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteSubmitting, setInviteSubmitting] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [inviteForm, setInviteForm] = useState<{
    name: string;
    email: string;
    password: string;
    role: NxUserRole;
  }>({ name: "", email: "", password: "", role: "author" });

  const [emailInviteOpen, setEmailInviteOpen] = useState(false);
  const [emailInviteSubmitting, setEmailInviteSubmitting] = useState(false);
  const [emailInviteError, setEmailInviteError] = useState<string | null>(null);
  const [emailInviteToast, setEmailInviteToast] = useState<string | null>(null);
  const [emailInviteForm, setEmailInviteForm] = useState<{
    name: string;
    email: string;
    role: NxUserRole;
  }>({ name: "", email: "", role: "author" });

  useEffect(() => {
    void fetchUsers();
  }, []);

  async function fetchUsers() {
    setLoading(true);
    setError(null);

    try {
      const response = await nxFetch("/api/users?limit=100");
      const payload = (await response.json().catch(() => null)) as unknown;

      if (!response.ok) {
        setError(getErrorMessage(payload, "Unable to load users."));
        return;
      }

      if (isRecord(payload) && Array.isArray(payload.docs)) {
        setUsers(payload.docs.filter(isUserRow));
      } else {
        setUsers([]);
      }
    } catch {
      setError("Unable to load users.");
    } finally {
      setLoading(false);
    }
  }

  async function submitInvite() {
    setInviteSubmitting(true);
    setInviteError(null);

    try {
      const response = await nxFetch("/api/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(inviteForm),
      });

      const payload = (await response.json().catch(() => null)) as unknown;

      if (!response.ok) {
        setInviteError(getErrorMessage(payload, "Unable to create user."));
        return;
      }

      setInviteOpen(false);
      setInviteForm({ name: "", email: "", password: "", role: "author" });
      await fetchUsers();
    } catch {
      setInviteError("Unable to create user.");
    } finally {
      setInviteSubmitting(false);
    }
  }

  async function submitEmailInvite() {
    setEmailInviteSubmitting(true);
    setEmailInviteError(null);

    try {
      const response = await nxFetch("/api/users/invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(emailInviteForm),
      });

      const payload = (await response.json().catch(() => null)) as unknown;

      if (!response.ok) {
        setEmailInviteError(getErrorMessage(payload, "Unable to send invite."));
        return;
      }

      setEmailInviteOpen(false);
      setEmailInviteToast(
        `Invite sent to ${emailInviteForm.email}. They can set their password via the email link.`,
      );
      setEmailInviteForm({ name: "", email: "", role: "author" });
      await fetchUsers();
    } catch {
      setEmailInviteError("Unable to send invite.");
    } finally {
      setEmailInviteSubmitting(false);
    }
  }

  return (
    <Card className="border-border/70 bg-card/80 shadow-sm">
      <CardHeader className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <CardTitle>User management</CardTitle>
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => setEmailInviteOpen(true)}>
            <MailPlus className="mr-2 h-4 w-4" />
            Invite user
          </Button>
          <Button variant="outline" onClick={() => setInviteOpen(true)}>
            <Plus className="mr-2 h-4 w-4" />
            Create with password
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {emailInviteToast ? (
          <div className="flex items-start justify-between gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
            <span>{emailInviteToast}</span>
            <button
              type="button"
              className="text-xs uppercase tracking-wide text-emerald-700 hover:text-emerald-900"
              onClick={() => setEmailInviteToast(null)}
            >
              dismiss
            </button>
          </div>
        ) : null}

        {error ? (
          <div className="rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
            {error}
          </div>
        ) : null}

        <div className="overflow-hidden rounded-2xl border border-border/70">
          <div className="grid grid-cols-[1fr_1.2fr_140px] gap-4 border-b border-border/70 bg-muted/35 px-4 py-3 text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
            <span>Name</span>
            <span>Email</span>
            <span>Role</span>
          </div>
          <div className="divide-y divide-border/70">
            {loading ? (
              Array.from({ length: 3 }).map((_, index) => (
                <div
                  key={`user-skeleton-${index}`}
                  className="h-14 animate-pulse bg-muted/20"
                />
              ))
            ) : users.length === 0 ? (
              <div className="px-4 py-8 text-center text-sm text-muted-foreground">
                No users found.
              </div>
            ) : (
              users.map((user) => (
                <div
                  key={user.id}
                  className="grid grid-cols-[1fr_1.2fr_140px] gap-4 px-4 py-4 text-sm"
                >
                  <div className="font-medium text-foreground">{user.name}</div>
                  <div className="text-muted-foreground">{user.email}</div>
                  <div>
                    <Badge variant="secondary">{user.role}</Badge>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </CardContent>

      <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create user</DialogTitle>
            <DialogDescription>
              Add a new user to the system. They can sign in with the password you set here.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {inviteError ? (
              <div className="rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
                {inviteError}
              </div>
            ) : null}

            <div className="space-y-2">
              <Label htmlFor="new-user-name">Name</Label>
              <Input
                id="new-user-name"
                value={inviteForm.name}
                onChange={(event) =>
                  setInviteForm((current) => ({ ...current, name: event.target.value }))
                }
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="new-user-email">Email</Label>
              <Input
                id="new-user-email"
                type="email"
                value={inviteForm.email}
                onChange={(event) =>
                  setInviteForm((current) => ({ ...current, email: event.target.value }))
                }
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="new-user-password">Password</Label>
              <Input
                id="new-user-password"
                type="password"
                value={inviteForm.password}
                onChange={(event) =>
                  setInviteForm((current) => ({ ...current, password: event.target.value }))
                }
              />
              <p className="text-xs text-muted-foreground">Minimum 8 characters.</p>
            </div>

            <div className="space-y-2">
              <Label>Role</Label>
              <Select
                value={inviteForm.role}
                onValueChange={(value) =>
                  setInviteForm((current) => ({ ...current, role: value as NxUserRole }))
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select role" />
                </SelectTrigger>
                <SelectContent>
                  {ROLE_OPTIONS.map((role) => (
                    <SelectItem key={role} value={role}>
                      {role}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setInviteOpen(false)}
              disabled={inviteSubmitting}
            >
              Cancel
            </Button>
            <Button onClick={() => void submitInvite()} disabled={inviteSubmitting}>
              {inviteSubmitting ? "Creating..." : "Create user"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={emailInviteOpen} onOpenChange={setEmailInviteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Invite user</DialogTitle>
            <DialogDescription>
              Send an email invitation. The user sets their own password via the link — valid
              for 7 days.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {emailInviteError ? (
              <div className="rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
                {emailInviteError}
              </div>
            ) : null}

            <div className="space-y-2">
              <Label htmlFor="invite-user-name">Name</Label>
              <Input
                id="invite-user-name"
                value={emailInviteForm.name}
                onChange={(event) =>
                  setEmailInviteForm((current) => ({ ...current, name: event.target.value }))
                }
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="invite-user-email">Email</Label>
              <Input
                id="invite-user-email"
                type="email"
                value={emailInviteForm.email}
                onChange={(event) =>
                  setEmailInviteForm((current) => ({ ...current, email: event.target.value }))
                }
              />
            </div>

            <div className="space-y-2">
              <Label>Role</Label>
              <Select
                value={emailInviteForm.role}
                onValueChange={(value) =>
                  setEmailInviteForm((current) => ({ ...current, role: value as NxUserRole }))
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select role" />
                </SelectTrigger>
                <SelectContent>
                  {ROLE_OPTIONS.map((role) => (
                    <SelectItem key={role} value={role}>
                      {role}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setEmailInviteOpen(false)}
              disabled={emailInviteSubmitting}
            >
              Cancel
            </Button>
            <Button onClick={() => void submitEmailInvite()} disabled={emailInviteSubmitting}>
              {emailInviteSubmitting ? "Sending..." : "Send invite"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isUserRow(value: unknown): value is UserRow {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === "string" &&
    typeof value.name === "string" &&
    typeof value.email === "string" &&
    typeof value.role === "string" &&
    (ROLE_OPTIONS as string[]).includes(value.role)
  );
}

function getErrorMessage(payload: unknown, fallback: string): string {
  if (isRecord(payload)) {
    if (typeof payload.error === "string") return payload.error;
    if (isRecord(payload.error) && typeof payload.error.message === "string") {
      return payload.error.message;
    }
  }
  return fallback;
}
