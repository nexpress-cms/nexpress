"use client";

import { Search } from "lucide-react";
import Link from "next/link";

import { Badge } from "../ui/badge.js";
import { Button } from "../ui/button.js";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card.js";

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

const STATUS_COLOR: Record<MemberListRow["status"], string> = {
  active: "bg-emerald-500/15 text-emerald-800 dark:text-emerald-300",
  pending: "bg-amber-500/15 text-amber-800 dark:text-amber-300",
  suspended: "bg-rose-500/15 text-rose-800 dark:text-rose-300",
  deleted: "bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-200",
};

export function MembersListView({
  members,
  totalDocs,
  filterQuery = "",
  filterStatus = "",
}: MembersListViewProps) {
  const isFiltered = filterQuery.length > 0 || filterStatus.length > 0;
  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center gap-3">
          <h1 className="text-3xl font-semibold tracking-tight">Members</h1>
          <Badge variant="secondary">{totalDocs}</Badge>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          Public site members. Open a row for ban / purge / identity actions.
        </p>
      </div>

      {/*
        Phase 9.10 — filter form. Plain GET so the URL carries
        the current state (works without JS, reload-safe,
        bookmarkable). The page server-component reads the
        same params and re-runs the query.
      */}
      <form
        method="GET"
        className="flex flex-wrap items-end gap-3 rounded-xl border border-border/60 bg-muted/30 p-4"
      >
        <div className="flex-1 min-w-[200px] space-y-1">
          <label
            htmlFor="nx-members-q"
            className="text-xs font-medium text-muted-foreground"
          >
            Search
          </label>
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
            <input
              id="nx-members-q"
              type="search"
              name="q"
              defaultValue={filterQuery}
              placeholder="handle, email, or display name"
              className="w-full rounded-md border border-border/70 bg-background py-2 pl-8 pr-3 text-sm"
            />
          </div>
        </div>
        <div className="space-y-1">
          <label
            htmlFor="nx-members-status"
            className="text-xs font-medium text-muted-foreground"
          >
            Status
          </label>
          <select
            id="nx-members-status"
            name="status"
            defaultValue={filterStatus}
            className="rounded-md border border-border/70 bg-background px-3 py-2 text-sm"
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
            className="text-xs text-muted-foreground underline-offset-4 hover:underline"
          >
            Clear
          </a>
        ) : null}
      </form>

      <Card className="border-border/60 shadow-sm">
        <CardHeader>
          <CardTitle className="text-lg">
            {isFiltered ? "Filtered members" : "All members"}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-hidden rounded-xl border border-border/60">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-left text-muted-foreground">
                <tr>
                  <th className="px-4 py-3 font-medium">Handle</th>
                  <th className="px-4 py-3 font-medium">Display name</th>
                  <th className="px-4 py-3 font-medium">Email</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Joined</th>
                  <th className="px-4 py-3 font-medium" />
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
                        <span
                          className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_COLOR[member.status]}`}
                        >
                          {member.status}
                        </span>
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
