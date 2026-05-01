"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ChevronLeft,
  ChevronRight,
  FileText,
  Flag,
  Globe2,
  History,
  Image,
  Inbox,
  LayoutDashboard,
  Puzzle,
  Settings,
  Timer,
  Users,
} from "lucide-react";
import type { NxAuthUser, NxCollectionConfig } from "@nexpress/core";

import { AdminTopbar } from "./admin-topbar.js";
import { Button } from "../ui/button.js";
import { ScrollArea } from "../ui/scroll-area.js";
import { Separator } from "../ui/separator.js";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "../ui/tooltip.js";
import { cn } from "../ui/utils.js";

/**
 * Capability flags resolved on the server (where `can(user, ...)`
 * lives) and passed down so this client component never duplicates
 * the role-set logic (#343). The flags name the *behavior*, not
 * the role hierarchy, mirroring the `can()` capability vocabulary.
 *
 *   - `canManageAdmin`   — admin-only surfaces (Sites, Jobs).
 *   - `canPublish`       — editor-or-admin (Members directory).
 *   - `canModerate`      — community-mod (Pending review, Reports,
 *                          Audit log, Community settings).
 */
export interface AdminShellCapabilities {
  canManageAdmin: boolean;
  canPublish: boolean;
  canModerate: boolean;
}

export interface AdminShellProps {
  user: NxAuthUser;
  collections: NxCollectionConfig[];
  caps: AdminShellCapabilities;
  children: React.ReactNode;
}

type NavItem = {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
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
        "group flex items-center gap-3 rounded-2xl px-3 py-2.5 text-sm font-medium transition-all duration-200",
        active
          ? "bg-neutral-950 text-white shadow-sm dark:bg-white dark:text-neutral-950"
          : "text-neutral-600 hover:bg-neutral-100 hover:text-neutral-950 dark:text-neutral-400 dark:hover:bg-neutral-900 dark:hover:text-neutral-50",
        collapsed && "justify-center px-2",
      )}
    >
      <Icon className="size-4 shrink-0" />
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
      .reduce<Record<string, NxCollectionConfig[]>>((groups, collection) => {
        const group = collection.admin?.group ?? "Content";
        groups[group] ??= [];
        groups[group].push(collection);
        return groups;
      }, {});
  }, [collections]);

  const systemItems: NavItem[] = [
    { href: "/admin/media", label: "Media", icon: Image },
    { href: "/admin/plugins", label: "Plugins", icon: Puzzle },
    ...(caps.canManageAdmin
      ? [
          { href: "/admin/jobs", label: "Jobs", icon: Timer },
          { href: "/admin/sites", label: "Sites", icon: Globe2 },
        ]
      : []),
    { href: "/admin/settings", label: "Settings", icon: Settings },
  ];

  const communityItems = React.useMemo<NavItem[]>(() => {
    const items: NavItem[] = [];
    if (caps.canPublish) {
      items.push({ href: "/admin/members", label: "Members", icon: Users });
    }
    if (caps.canModerate) {
      items.push({ href: "/admin/community/pending", label: "Pending review", icon: Inbox });
      items.push({ href: "/admin/community/reports", label: "Reports", icon: Flag });
      items.push({ href: "/admin/community/audit", label: "Audit log", icon: History });
      items.push({ href: "/admin/community/settings", label: "Community settings", icon: Settings });
    }
    return items;
  }, [caps.canPublish, caps.canModerate]);

  return (
    <TooltipProvider delayDuration={120}>
      <div className="flex min-h-screen bg-neutral-100 text-neutral-950 dark:bg-neutral-950 dark:text-neutral-50">
        <aside
          className={cn(
            "flex h-screen shrink-0 flex-col border-r border-neutral-200/80 bg-white/95 backdrop-blur-xl transition-all duration-300 dark:border-neutral-800/80 dark:bg-neutral-950/95",
            collapsed ? "w-20" : "w-72",
          )}
        >
          <div className="flex h-20 items-center justify-between px-4">
            <div className={cn("min-w-0", collapsed && "sr-only")}>
              <p className="text-xs font-semibold uppercase tracking-[0.3em] text-neutral-500">NexPress</p>
              <p className="text-sm text-neutral-600 dark:text-neutral-400">Editorial control center</p>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="shrink-0 rounded-2xl"
              onClick={() => setCollapsed((value) => !value)}
              aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            >
              {collapsed ? <ChevronRight className="size-4" /> : <ChevronLeft className="size-4" />}
            </Button>
          </div>

          <Separator />

          <ScrollArea className="flex-1 px-3 py-4">
            <nav className="space-y-6">
              <div className="space-y-2">
                {!collapsed ? (
                  <p className="px-3 text-xs font-semibold uppercase tracking-[0.22em] text-neutral-500">Overview</p>
                ) : null}
                <NavLink
                  collapsed={collapsed}
                  href="/admin"
                  icon={LayoutDashboard}
                  label="Dashboard"
                  pathname={pathname}
                />
              </div>

              {Object.entries(collectionGroups).map(([group, items]) => (
                <div key={group} className="space-y-2">
                  {!collapsed ? (
                    <p className="px-3 text-xs font-semibold uppercase tracking-[0.22em] text-neutral-500">{group}</p>
                  ) : null}
                  <div className="space-y-1">
                    {items.map((collection) => (
                      <NavLink
                        key={collection.slug}
                        collapsed={collapsed}
                        href={`/admin/collections/${collection.slug}`}
                        icon={FileText}
                        label={collection.labels.plural}
                        pathname={pathname}
                      />
                    ))}
                  </div>
                </div>
              ))}

              {communityItems.length > 0 ? (
                <div className="space-y-2">
                  {!collapsed ? (
                    <p className="px-3 text-xs font-semibold uppercase tracking-[0.22em] text-neutral-500">Community</p>
                  ) : null}
                  <div className="space-y-1">
                    {communityItems.map((item) => (
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
              ) : null}

              <div className="space-y-2">
                {!collapsed ? (
                  <p className="px-3 text-xs font-semibold uppercase tracking-[0.22em] text-neutral-500">System</p>
                ) : null}
                <div className="space-y-1">
                  {systemItems.map((item) => (
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
            </nav>
          </ScrollArea>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <AdminTopbar user={user} />
          <main className="flex-1 p-6 md:p-8">
            <div className="mx-auto flex w-full max-w-7xl flex-col gap-6">{children}</div>
          </main>
        </div>
      </div>
    </TooltipProvider>
  );
}

export { AdminShell };
