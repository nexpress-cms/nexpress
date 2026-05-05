"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bell, ChevronDown, ExternalLink, LogOut, User } from "lucide-react";
import type { NpAuthUser } from "@nexpress/core";

import { SitePicker } from "../sites/site-picker.js";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu.js";
import { Button } from "../ui/button.js";
import { ThemeToggle } from "./theme-toggle.js";

export interface AdminTopbarProps {
  user: NpAuthUser;
}

const SECTION_LABELS: Record<string, string> = {
  admin: "Workspace",
  collections: "Content",
  media: "Content",
  sites: "Multi-site",
  users: "Multi-site",
  members: "Community",
  community: "Community",
  pending: "Pending",
  reports: "Reports",
  audit: "Audit log",
  plugins: "System",
  jobs: "System",
  health: "System",
  settings: "System",
  profile: "Workspace",
};

const LEAF_LABELS: Record<string, string> = {
  admin: "Dashboard",
  media: "Media",
  sites: "Sites",
  users: "Users",
  members: "Members",
  plugins: "Plugins",
  jobs: "Jobs",
  health: "Health",
  settings: "Settings",
  profile: "Profile",
  reports: "Reports",
  pending: "Pending review",
  audit: "Audit log",
  community: "Community",
};

function deriveCrumbs(pathname: string): string[] {
  const segments = pathname.split("/").filter(Boolean);
  if (segments.length === 0 || segments[0] !== "admin") {
    return ["Workspace"];
  }
  if (segments.length === 1) {
    return ["Workspace", "Dashboard"];
  }

  const [, ...rest] = segments;
  const head = rest[0];
  const section = SECTION_LABELS[head] ?? "Workspace";

  if (head === "collections" && rest[1]) {
    const slug = rest[1];
    const pretty = slug.charAt(0).toUpperCase() + slug.slice(1);
    if (rest[2] === "create") {
      return [section, pretty, "New entry"];
    }
    if (rest[2] === "edit" && rest[3]) {
      return [section, pretty, "Edit"];
    }
    return [section, pretty];
  }

  if (head === "community" && rest[1]) {
    const child = LEAF_LABELS[rest[1]] ?? rest[1];
    return [section, child];
  }

  if (head === "sites" && rest[1]) {
    if (rest[1] && rest[2] === "members") return [section, "Sites", "Members"];
    return [section, "Sites", "Detail"];
  }

  const leaf = LEAF_LABELS[head] ?? head.charAt(0).toUpperCase() + head.slice(1);
  return [section, leaf];
}

function AdminTopbar({ user }: AdminTopbarProps) {
  const pathname = usePathname();
  const crumbs = React.useMemo(() => deriveCrumbs(pathname), [pathname]);
  const initials = React.useMemo(() => {
    return (user.name || user.email || "?")
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part.charAt(0).toUpperCase())
      .join("") || "?";
  }, [user.email, user.name]);

  return (
    <header className="sticky top-0 z-20 flex h-[52px] items-center justify-between border-b border-neutral-200/70 bg-[rgb(248_248_247_/_0.8)] px-6 backdrop-blur-md backdrop-saturate-150 dark:border-neutral-800/70 dark:bg-neutral-950/80">
      <nav aria-label="Breadcrumb" className="flex items-center gap-2 text-[13px]">
        {crumbs.map((crumb, i) => {
          const isLast = i === crumbs.length - 1;
          return (
            <React.Fragment key={`${crumb}-${i}`}>
              {i > 0 ? (
                <span aria-hidden className="text-neutral-300 dark:text-neutral-700">
                  /
                </span>
              ) : null}
              <span
                className={
                  isLast
                    ? "font-medium text-neutral-950 dark:text-neutral-50"
                    : "text-neutral-500 dark:text-neutral-400"
                }
              >
                {crumb}
              </span>
            </React.Fragment>
          );
        })}
      </nav>

      <div className="flex items-center gap-1.5">
        <SitePicker />
        <ThemeToggle />
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="Notifications"
          className="rounded-full"
        >
          <Bell className="size-3.5" />
        </Button>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="flex items-center gap-2 rounded-full px-1 py-1 text-left transition-colors hover:bg-neutral-950/[0.035] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nx-color-brand-ring)] dark:hover:bg-white/[0.04]"
            >
              <span className="flex size-7 items-center justify-center rounded-full bg-gradient-to-br from-[#3858E9] to-[#1f2c91] text-[10.5px] font-semibold text-white">
                {initials}
              </span>
              <span className="px-1 text-[13px] font-medium text-neutral-950 dark:text-neutral-50">
                {user.name?.split(" ")[0] ?? user.email}
              </span>
              <ChevronDown className="size-3 text-neutral-400" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-60">
            <DropdownMenuLabel>
              <div className="space-y-1">
                <p className="text-sm font-medium text-neutral-950 dark:text-neutral-50">
                  {user.name}
                </p>
                <p className="text-xs font-normal text-neutral-500 dark:text-neutral-400">
                  {user.email}
                </p>
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
                <button
                  type="submit"
                  className="flex w-full items-center gap-2 text-red-600 dark:text-red-400"
                >
                  <LogOut className="size-4" />
                  Logout
                </button>
              </DropdownMenuItem>
            </form>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}

export { AdminTopbar };
