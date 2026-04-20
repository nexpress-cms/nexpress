"use client";

import type { NxAuthUser } from "@nexpress/core";

import { Badge } from "../ui/badge.js";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "../ui/card.js";

const placeholderUsers: Array<Pick<NxAuthUser, "id" | "name" | "email" | "role">> = [
  {
    id: "demo-admin",
    name: "Avery Admin",
    email: "avery@example.com",
    role: "admin",
  },
  {
    id: "demo-editor",
    name: "Morgan Editor",
    email: "morgan@example.com",
    role: "editor",
  },
  {
    id: "demo-author",
    name: "Jordan Author",
    email: "jordan@example.com",
    role: "author",
  },
];

export function UserManagement() {
  return (
    <Card className="border-border/70 bg-card/80 shadow-sm">
      <CardHeader>
        <CardTitle>User management</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="rounded-2xl border border-dashed border-border/70 bg-muted/15 px-5 py-4 text-sm text-muted-foreground">
          User management requires the users API. Coming in a future update.
        </div>

        <div className="overflow-hidden rounded-2xl border border-border/70">
          <div className="grid grid-cols-[1fr_1.2fr_140px] gap-4 border-b border-border/70 bg-muted/35 px-4 py-3 text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
            <span>Name</span>
            <span>Email</span>
            <span>Role</span>
          </div>
          <div className="divide-y divide-border/70">
            {placeholderUsers.map((user) => (
              <div key={user.id} className="grid grid-cols-[1fr_1.2fr_140px] gap-4 px-4 py-4 text-sm">
                <div className="font-medium text-foreground">{user.name}</div>
                <div className="text-muted-foreground">{user.email}</div>
                <div>
                  <Badge variant="secondary">{user.role}</Badge>
                </div>
              </div>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
