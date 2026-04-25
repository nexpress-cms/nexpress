"use client";

import Link from "next/link";

import { Badge } from "../ui/badge.js";
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
}

const STATUS_COLOR: Record<MemberListRow["status"], string> = {
  active: "bg-emerald-100 text-emerald-800",
  pending: "bg-amber-100 text-amber-800",
  suspended: "bg-rose-100 text-rose-800",
  deleted: "bg-slate-200 text-slate-700",
};

export function MembersListView({ members, totalDocs }: MembersListViewProps) {
  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center gap-3">
          <h1 className="text-3xl font-semibold tracking-tight">Members</h1>
          <Badge variant="secondary">{totalDocs}</Badge>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          Public site members. Moderation actions ship in Phase 9.5.
        </p>
      </div>

      <Card className="border-border/60 shadow-sm">
        <CardHeader>
          <CardTitle className="text-lg">All members</CardTitle>
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
                </tr>
              </thead>
              <tbody>
                {members.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-10 text-center text-muted-foreground">
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
