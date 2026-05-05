"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Activity,
  FileText,
  Flag,
  Globe2,
  History,
  Image,
  Inbox,
  LayoutDashboard,
  PanelLeft,
  Puzzle,
  Settings,
  Timer,
  Users,
} from "lucide-react";
import type { NpAuthUser } from "@nexpress/core";

import { AdminTopbar } from "./admin-topbar.js";
import { NpMark } from "./np-mark.js";
import { Button } from "../ui/button.js";
import { ScrollArea } from "../ui/scroll-area.js";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "../ui/tooltip.js";
import { cn } from "../ui/utils.js";

/**
 * Capability flags resolved on the server (where `can(user, ...)`
 * lives) and passed down so this client component never duplicates
 * the role-set logic (#343).
 */
export interface AdminShellCapabilities {
  canManageAdmin: boolean;
  canPublish: boolean;
  canModerate: boolean;
}

/** Serializable collection metadata for the sidebar. */
export interface AdminShellCollection {
  slug: string;
  labels: { plural: string };
  admin?: {
    group?: string;
    hidden?: boolean;
  };
}

export interface AdminShellProps {
  user: NpAuthUser;
  collections: AdminShellCollection[];
  caps: AdminShellCapabilities;
  children: React.ReactNode;
}

type NavItem = {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
};

type NavGroup = {
  eyebrow: string;
  items: NavItem[];
};

function isActive(pathname: string, href: string) {
  return href === "/admin" ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);
}

function NavLink({
  collapsed,
  href,
  icon: Icon,
  label,
  pathname,
}: {
  collapsed: boolean;
  href: string;
  icon: NavItem["icon"];
  label: string;
  pathname: string;
}) {
  const active = isActive(pathname, href);

  const content = (
    <Link
      href={href}
      className={cn(
        "group relative flex items-center gap-2.5 rounded-lg px-3 py-1.5 text-[13.5px] font-normal transition-colors",
        active
          ? "bg-neutral-950/[0.045] text-neutral-950 font-medium dark:bg-white/[0.06] dark:text-neutral-50"
          : "text-neutral-700 hover:bg-neutral-950/[0.035] hover:text-neutral-950 dark:text-neutral-400 dark:hover:bg-white/[0.04] dark:hover:text-neutral-50",
        collapsed && "justify-center px-2",
      )}
    >
      {active ? (
        <span
          aria-hidden
          className={cn(
            "absolute top-2 bottom-2 w-0.5 rounded-sm bg-[var(--np-color-brand)]",
            collapsed ? "-left-1" : "-left-2",
          )}
        />
      ) : null}
      <Icon
        className={cn(
          "size-[15px] shrink-0",
          active
            ? "text-[var(--np-color-brand)]"
            : "text-neutral-500 dark:text-neutral-400",
        )}
      />
      {!collapsed ? <span className="truncate">{label}</span> : null}
    </Link>
  );

  if (!collapsed) {
    return content;
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>{content}</TooltipTrigger>
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  );
}

function AdminShell({ user, collections, caps, children }: AdminShellProps) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = React.useState(false);

  const collectionGroups = React.useMemo(() => {
    return collections
      .filter((collection) => !collection.admin?.hidden)
      .reduce<Record<string, AdminShellCollection[]>>((groups, collection) => {
        const group = collection.admin?.group ?? "Content";
        groups[group] ??= [];
        groups[group].push(collection);
        return groups;
      }, {});
  }, [collections]);

  const groups = React.useMemo<NavGroup[]>(() => {
    const result: NavGroup[] = [
      {
        eyebrow: "Workspace",
        items: [{ href: "/admin", label: "Dashboard", icon: LayoutDashboard }],
      },
    ];

    const collectionEntries = Object.entries(collectionGroups);
    if (collectionEntries.length > 0) {
      const [firstGroup, ...rest] = collectionEntries;
      const [firstName, firstItems] = firstGroup;
      result.push({
        eyebrow: firstName,
        items: [
          ...firstItems.map((collection) => ({
            href: `/admin/collections/${collection.slug}`,
            label: collection.labels.plural,
            icon: collection.slug.includes("media") ? Image : FileText,
          })),
          { href: "/admin/media", label: "Media", icon: Image },
        ],
      });
      for (const [groupName, items] of rest) {
        result.push({
          eyebrow: groupName,
          items: items.map((collection) => ({
            href: `/admin/collections/${collection.slug}`,
            label: collection.labels.plural,
            icon: FileText,
          })),
        });
      }
    } else {
      result.push({
        eyebrow: "Content",
        items: [{ href: "/admin/media", label: "Media", icon: Image }],
      });
    }

    if (caps.canManageAdmin) {
      result.push({
        eyebrow: "Multi-site",
        items: [
          { href: "/admin/sites", label: "Sites", icon: Globe2 },
          { href: "/admin/users", label: "Users", icon: Users },
        ],
      });
    }

    const communityItems: NavItem[] = [];
    if (caps.canPublish) {
      communityItems.push({ href: "/admin/members", label: "Members", icon: Users });
    }
    if (caps.canModerate) {
      communityItems.push({ href: "/admin/community/pending", label: "Pending review", icon: Inbox });
      communityItems.push({ href: "/admin/community/reports", label: "Reports", icon: Flag });
      communityItems.push({ href: "/admin/community/audit", label: "Audit log", icon: History });
      communityItems.push({
        href: "/admin/community/settings",
        label: "Community settings",
        icon: Settings,
      });
    }
    if (communityItems.length > 0) {
      result.push({ eyebrow: "Community", items: communityItems });
    }

    const systemItems: NavItem[] = [
      { href: "/admin/plugins", label: "Plugins", icon: Puzzle },
    ];
    if (caps.canManageAdmin) {
      systemItems.push({ href: "/admin/jobs", label: "Jobs", icon: Timer });
      systemItems.push({ href: "/admin/health", label: "Health", icon: Activity });
    }
    systemItems.push({ href: "/admin/settings", label: "Settings", icon: Settings });
    result.push({ eyebrow: "System", items: systemItems });

    return result;
  }, [caps.canManageAdmin, caps.canModerate, caps.canPublish, collectionGroups]);

  return (
    <TooltipProvider delayDuration={120}>
      <div className="flex min-h-screen bg-[#f8f8f7] text-neutral-950 dark:bg-neutral-950 dark:text-neutral-50">
        <aside
          className={cn(
            "sticky top-0 flex h-screen shrink-0 flex-col border-r border-neutral-200/70 bg-[#fbfbfa] transition-[width] duration-300 dark:border-neutral-800/70 dark:bg-neutral-950/95",
            collapsed ? "w-16" : "w-60",
          )}
        >
          <div className="flex h-14 items-center justify-between px-4">
            <Link
              href="/admin"
              className={cn(
                "flex items-center gap-2.5 text-[13px] font-semibold tracking-tight text-neutral-950 dark:text-neutral-50",
                collapsed && "justify-center",
              )}
              aria-label="NexPress"
            >
              <NpMark size={22} />
              {!collapsed ? <span>NexPress</span> : null}
            </Link>
            {!collapsed ? (
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                onClick={() => setCollapsed(true)}
                aria-label="Collapse sidebar"
              >
                <PanelLeft className="size-3.5" />
              </Button>
            ) : null}
          </div>

          <div className="h-px bg-neutral-200/70 dark:bg-neutral-800/70" />

          <ScrollArea className="flex-1 px-2 py-3">
            <nav className="space-y-4">
              {groups.map((group) => (
                <div key={group.eyebrow} className="space-y-0.5">
                  {!collapsed ? (
                    <p className="px-3 pt-2 pb-1 text-[10.5px] font-medium uppercase tracking-[0.14em] text-neutral-400">
                      {group.eyebrow}
                    </p>
                  ) : null}
                  <div className="space-y-px">
                    {group.items.map((item) => (
                      <NavLink
                        key={item.href}
                        collapsed={collapsed}
                        href={item.href}
                        icon={item.icon}
                        label={item.label}
                        pathname={pathname}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </nav>
          </ScrollArea>

          <div className="h-px bg-neutral-200/70 dark:bg-neutral-800/70" />

          <div className="flex items-center gap-2 px-3 py-2.5 font-mono text-[11px] text-neutral-400">
            <span
              aria-hidden
              className="size-1.5 rounded-full bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.6)]"
            />
            {!collapsed ? <span>v0.1.0 · idle</span> : null}
            {collapsed ? (
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="ml-auto"
                onClick={() => setCollapsed(false)}
                aria-label="Expand sidebar"
              >
                <PanelLeft className="size-3.5 rotate-180" />
              </Button>
            ) : null}
          </div>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <AdminTopbar user={user} />
          <main className="flex-1 px-6 py-7 md:px-8">
            <div className="mx-auto flex w-full max-w-[1180px] flex-col gap-6">{children}</div>
          </main>
        </div>
      </div>
    </TooltipProvider>
  );
}

export { AdminShell };
