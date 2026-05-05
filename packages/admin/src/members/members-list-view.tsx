"use client";

import { Search } from "lucide-react";
import Link from "next/link";

import { Badge } from "../ui/badge.js";
import { Button } from "../ui/button.js";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card.js";
import { Input } from "../ui/input.js";
import { Label } from "../ui/label.js";
import { PageHeader } from "../layout/page-header.js";
import { StatusBadge } from "../ui/status-badge.js";

export interface MemberListRow {
  id: string;
  handle: string;
  email: string;
  displayName: string;
  status: "active" | "pending" | "suspended" | "deleted";
  reputation: number;
  createdAt: string;
}

interface MembersListViewProps {
  members: MemberListRow[];
  totalDocs: number;
  /** Phase 9.10 — current filter values (echo back into the form). */
  filterQuery?: string;
  filterStatus?: string;
}

export function MembersListView({
  members,
  totalDocs,
  filterQuery = "",
  filterStatus = "",
}: MembersListViewProps) {
  const isFiltered = filterQuery.length > 0 || filterStatus.length > 0;
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={
          <span className="flex items-center gap-2.5">
            Members
            <Badge variant="secondary">{totalDocs}</Badge>
          </span>
        }
        description="Public site members. Open a row for ban / purge / identity actions."
      />

      {/*
        Phase 9.10 — filter form. Plain GET so the URL carries
        the current state (works without JS, reload-safe,
        bookmarkable). The page server-component reads the
        same params and re-runs the query.
      */}
      <form
        method="GET"
        className="flex flex-wrap items-end gap-3 rounded-xl border border-neutral-200/80 bg-neutral-50/60 p-4 dark:border-neutral-800/80 dark:bg-neutral-900/40"
      >
        <div className="flex-1 min-w-[200px] space-y-1.5">
          <Label htmlFor="np-members-q">Search</Label>
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-neutral-400" />
            <Input
              id="np-members-q"
              type="search"
              name="q"
              defaultValue={filterQuery}
              placeholder="handle, email, or display name"
              className="pl-8"
            />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="np-members-status">Status</Label>
          <select
            id="np-members-status"
            name="status"
            defaultValue={filterStatus}
            className="flex h-8 rounded-lg border border-neutral-200/80 bg-white px-2.5 text-[13px] text-neutral-950 outline-none transition-colors focus-visible:border-[var(--np-color-brand)] focus-visible:ring-[3px] focus-visible:ring-[var(--np-color-brand-ring)] dark:border-neutral-800 dark:bg-neutral-950 dark:text-neutral-50"
          >
            <option value="">All</option>
            <option value="active">Active</option>
            <option value="pending">Pending</option>
            <option value="suspended">Suspended</option>
            <option value="deleted">Deleted</option>
          </select>
        </div>
        <Button type="submit" size="sm">
          Apply
        </Button>
        {isFiltered ? (
          <a
            href="/admin/members"
            className="text-[12px] text-neutral-500 underline-offset-[3px] hover:underline dark:text-neutral-400"
          >
            Clear
          </a>
        ) : null}
      </form>

      <Card>
        <CardHeader>
          <CardTitle>
            {isFiltered ? "Filtered members" : "All members"}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-hidden rounded-xl border border-border/60">
            <table className="w-full text-sm">
              <thead className="bg-neutral-50/60 text-left text-[11px] font-medium uppercase tracking-[0.08em] text-neutral-500 dark:bg-neutral-900/40 dark:text-neutral-400">
                <tr>
                  <th className="h-9 px-3.5 font-medium">Handle</th>
                  <th className="h-9 px-3.5 font-medium">Display name</th>
                  <th className="h-9 px-3.5 font-medium">Email</th>
                  <th className="h-9 px-3.5 font-medium">Status</th>
                  <th className="h-9 px-3.5 font-medium">Joined</th>
                  <th className="h-9 px-3.5 font-medium" />
                </tr>
              </thead>
              <tbody>
                {members.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-10 text-center text-muted-foreground">
                      No members yet.
                    </td>
                  </tr>
                ) : (
                  members.map((member) => (
                    <tr key={member.id} className="border-t border-border/60">
                      <td className="px-4 py-3 align-middle">
                        <Link
                          href={`/u/${member.handle}`}
                          target="_blank"
                          className="font-medium underline-offset-4 hover:underline"
                        >
                          @{member.handle}
                        </Link>
                      </td>
                      <td className="px-4 py-3 align-middle">{member.displayName}</td>
                      <td className="px-4 py-3 align-middle text-muted-foreground">
                        {member.email}
                      </td>
                      <td className="px-4 py-3 align-middle">
                        <StatusBadge status={member.status} />
                      </td>
                      <td className="px-4 py-3 align-middle text-muted-foreground">
                        {new Date(member.createdAt).toLocaleDateString()}
                      </td>
                      <td className="px-4 py-3 align-middle text-right">
                        <Link
                          href={`/admin/members/${member.id}`}
                          className="text-sm underline-offset-4 hover:underline"
                        >
                          Manage →
                        </Link>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
