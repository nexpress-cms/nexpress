"use client";

import Link from "next/link";
import { ExternalLink, LogOut, User } from "lucide-react";
import type { NxAuthUser } from "@nexpress/core";

import { Badge } from "../ui/badge.js";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu.js";

export interface AdminTopbarProps {
  user: NxAuthUser;
}

function AdminTopbar({ user }: AdminTopbarProps) {
  return (
    <header className="sticky top-0 z-20 flex h-20 items-center justify-between border-b border-neutral-200/80 bg-white/90 px-6 backdrop-blur-xl dark:border-neutral-800/80 dark:bg-neutral-950/90">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.22em] text-neutral-500">Admin</p>
        <h1 className="text-lg font-semibold tracking-tight text-neutral-950 dark:text-neutral-50">Welcome back, {user.name}</h1>
      </div>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="flex items-center gap-3 rounded-2xl border border-neutral-200/80 bg-white/90 px-4 py-2 text-left shadow-sm transition-colors hover:bg-neutral-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-950/10 dark:border-neutral-800/80 dark:bg-neutral-950/90 dark:hover:bg-neutral-900 dark:focus-visible:ring-white/10"
          >
            <div className="flex size-10 items-center justify-center rounded-2xl bg-neutral-950 text-white dark:bg-white dark:text-neutral-950">
              <User className="size-4" />
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-neutral-950 dark:text-neutral-50">{user.name}</p>
              <p className="truncate text-xs text-neutral-500 dark:text-neutral-400">{user.email}</p>
            </div>
            <Badge variant="secondary" className="capitalize">
              {user.role}
            </Badge>
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-60">
          <DropdownMenuLabel>
            <div className="space-y-1">
              <p className="text-sm font-medium text-neutral-950 dark:text-neutral-50">{user.name}</p>
              <p className="text-xs font-normal text-neutral-500 dark:text-neutral-400">{user.email}</p>
            </div>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem asChild>
            <Link href="/admin/profile" className="flex w-full items-center gap-2">
              <User className="size-4" />
              Profile
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <a href="/" target="_blank" rel="noreferrer" className="flex w-full items-center gap-2">
              <ExternalLink className="size-4" />
              View Site
            </a>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <form action="/api/auth/logout" method="post">
            <DropdownMenuItem asChild>
              <button type="submit" className="flex w-full items-center gap-2 text-red-600 dark:text-red-400">
                <LogOut className="size-4" />
                Logout
              </button>
            </DropdownMenuItem>
          </form>
        </DropdownMenuContent>
      </DropdownMenu>
    </header>
  );
}

export { AdminTopbar };
