"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Activity,
  FileStack,
  FileText,
  Flag,
  FolderTree,
  Globe2,
  History,
  Image,
  Inbox,
  LayoutDashboard,
  type LucideIcon,
  MessageSquare,
  Newspaper,
  PanelLeft,
  Puzzle,
  Settings,
  Tag,
  Timer,
  Users,
  X,
} from "lucide-react";
import type { NpAuthUser } from "@nexpress/core";

import { AdminTopbar } from "./admin-topbar.js";
import { NpMark } from "./np-mark.js";
import { Button } from "../ui/button.js";
import { ScrollArea } from "../ui/scroll-area.js";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "../ui/tooltip.js";
import { cn } from "../ui/utils.js";

/**
 * Lucide-name → component map for `admin.icon` resolution. Add
 * here when a collection wants a non-default icon. Unknown names
 * fall back to the generic `FileText` so a typo can't break the
 * sidebar render. Kept small on purpose — the bundle pulls only
 * the icons the shell actually mounts.
 */
const COLLECTION_ICONS: Record<string, LucideIcon> = {
  FileStack,
  FileText,
  FolderTree,
  Image,
  MessageSquare,
  Newspaper,
  Tag,
};

function resolveCollectionIcon(name: string | undefined): LucideIcon {
  if (!name) return FileText;
  return COLLECTION_ICONS[name] ?? FileText;
}

/**
 * Capability flags resolved on the server (where `can(user, ...)`
 * lives) and passed down so this client component never duplicates
 * the role-set logic (#343).
 */
export interface AdminShellCapabilities {
  canManageAdmin: boolean;
  canManageSites?: boolean;
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
    /** Lucide icon name; resolved against COLLECTION_ICONS at render time. */
    icon?: string;
    /**
     * Per-kind nav entries (universal-content-model #748). When a
     * collection's `kind` select is themed-extended (e.g. `posts`
     * gaining `kind: "doc"` from theme-docs), each kind contributes
     * its own sidebar entry under the same group. The collection's
     * top-level entry stays — operators can still see "All posts"
     * with the kinds filter cleared.
     *
     * Keyed by the discriminator value the theme registered. The
     * label / icon flow through to the rendered nav item; clicking
     * routes to `/admin/collections/<slug>?kind=<kind>`.
     */
    kinds?: Record<
      string,
      {
        labelPlural: string;
        icon?: string;
      }
    >;
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
  return href === "/admin"
    ? pathname === href
    : pathname === href || pathname.startsWith(`${href}/`);
}

function NavLink({
  collapsed,
  href,
  icon: Icon,
  label,
  onNavigate,
  pathname,
}: {
  collapsed: boolean;
  href: string;
  icon: NavItem["icon"];
  label: string;
  onNavigate?: () => void;
  pathname: string;
}) {
  const active = isActive(pathname, href);

  const content = (
    <Link
      href={href}
      onClick={onNavigate}
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
          active ? "text-[var(--np-color-brand)]" : "text-neutral-500 dark:text-neutral-400",
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
  const [mobileOpen, setMobileOpen] = React.useState(false);

  React.useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      setMobileOpen(false);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [pathname]);

  React.useEffect(() => {
    if (!mobileOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMobileOpen(false);
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [mobileOpen]);

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

    /**
     * Expand one collection into its nav entries. The collection's
     * top-level entry always renders; any registered kinds get
     * their own siblings below. Universal-content-model #748 —
     * docs theme contributes `kinds.doc` on posts, which renders
     * as a "Documentation" entry pointing at
     * `/admin/collections/posts?kind=doc`.
     */
    const navEntriesFor = (collection: AdminShellCollection): NavItem[] => {
      const items: NavItem[] = [
        {
          href: `/admin/collections/${collection.slug}`,
          label: collection.labels.plural,
          icon: resolveCollectionIcon(collection.admin?.icon),
        },
      ];
      const kinds = collection.admin?.kinds;
      if (kinds) {
        for (const [kindValue, meta] of Object.entries(kinds)) {
          items.push({
            href: `/admin/collections/${collection.slug}?kind=${encodeURIComponent(kindValue)}`,
            label: meta.labelPlural,
            icon: resolveCollectionIcon(meta.icon),
          });
        }
      }
      return items;
    };

    const collectionEntries = Object.entries(collectionGroups);
    if (collectionEntries.length > 0) {
      const [firstGroup, ...rest] = collectionEntries;
      const [firstName, firstItems] = firstGroup;
      result.push({
        eyebrow: firstName,
        items: [
          ...firstItems.flatMap((collection) => navEntriesFor(collection)),
          { href: "/admin/media", label: "Media", icon: Image },
        ],
      });
      for (const [groupName, items] of rest) {
        result.push({
          eyebrow: groupName,
          items: items.flatMap((collection) => navEntriesFor(collection)),
        });
      }
    } else {
      result.push({
        eyebrow: "Content",
        items: [{ href: "/admin/media", label: "Media", icon: Image }],
      });
    }

    const multiSiteItems: NavItem[] = [];
    const canManageSites = caps.canManageSites ?? caps.canManageAdmin;
    if (canManageSites) {
      multiSiteItems.push({ href: "/admin/sites", label: "Sites", icon: Globe2 });
    }
    if (caps.canManageAdmin) {
      multiSiteItems.push({ href: "/admin/users", label: "Users", icon: Users });
    }
    if (multiSiteItems.length > 0) {
      result.push({
        eyebrow: "Multi-site",
        items: multiSiteItems,
      });
    }

    const communityItems: NavItem[] = [];
    if (caps.canPublish) {
      communityItems.push({ href: "/admin/members", label: "Members", icon: Users });
    }
    if (caps.canModerate) {
      communityItems.push({
        href: "/admin/community/pending",
        label: "Pending review",
        icon: Inbox,
      });
      communityItems.push({ href: "/admin/community/reports", label: "Reports", icon: Flag });
      communityItems.push({ href: "/admin/community/audit", label: "Audit log", icon: History });
      communityItems.push({
        href: "/admin/community/settings",
        label: "Community settings",
        icon: Settings,
      });
    }
    if (communityItems.length > 0) {
      const existing = result.find((g) => g.eyebrow === "Community");
      if (existing) {
        existing.items = [...existing.items, ...communityItems];
      } else {
        result.push({ eyebrow: "Community", items: communityItems });
      }
    }

    const systemItems: NavItem[] = [{ href: "/admin/plugins", label: "Plugins", icon: Puzzle }];
    if (caps.canManageAdmin) {
      systemItems.push({ href: "/admin/jobs", label: "Jobs", icon: Timer });
      systemItems.push({ href: "/admin/health", label: "Health", icon: Activity });
    }
    systemItems.push({ href: "/admin/settings", label: "Settings", icon: Settings });
    result.push({ eyebrow: "System", items: systemItems });

    return result;
  }, [
    caps.canManageAdmin,
    caps.canManageSites,
    caps.canModerate,
    caps.canPublish,
    collectionGroups,
  ]);

  return (
    <TooltipProvider delayDuration={120}>
      <div className="flex min-h-screen overflow-x-hidden bg-[#f8f8f7] text-neutral-950 dark:bg-neutral-950 dark:text-neutral-50">
        {mobileOpen ? (
          <button
            type="button"
            aria-label="Close navigation"
            className="fixed inset-0 z-30 bg-neutral-950/35 backdrop-blur-[1px] lg:hidden"
            onClick={() => setMobileOpen(false)}
          />
        ) : null}

        <aside
          data-np-admin-sidebar
          data-open={mobileOpen ? "true" : "false"}
          className={cn(
            "fixed inset-y-0 left-0 z-40 flex h-dvh w-[min(18rem,calc(100vw-3rem))] max-w-[calc(100vw-3rem)] flex-col border-r border-neutral-200/70 bg-[#fbfbfa] shadow-2xl transition-transform duration-300 dark:border-neutral-800/70 dark:bg-neutral-950/95 lg:sticky lg:top-0 lg:z-auto lg:h-screen lg:shrink-0 lg:translate-x-0 lg:shadow-none lg:transition-[width]",
            mobileOpen ? "translate-x-0" : "-translate-x-full",
            collapsed ? "lg:w-16" : "lg:w-60",
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
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="lg:hidden"
              onClick={() => setMobileOpen(false)}
              aria-label="Close navigation"
            >
              <X className="size-3.5" />
            </Button>
            {!collapsed ? (
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="hidden lg:inline-flex"
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
                        onNavigate={() => setMobileOpen(false)}
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
                className="ml-auto hidden lg:inline-flex"
                onClick={() => setCollapsed(false)}
                aria-label="Expand sidebar"
              >
                <PanelLeft className="size-3.5 rotate-180" />
              </Button>
            ) : null}
          </div>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <AdminTopbar
            user={user}
            onOpenNavigation={() => {
              setCollapsed(false);
              setMobileOpen(true);
            }}
          />
          <main className="min-w-0 flex-1 px-3 py-5 min-[380px]:px-4 sm:px-5 md:px-8 md:py-7">
            <div className="mx-auto flex min-w-0 w-full max-w-[1180px] flex-col gap-6">
              {children}
            </div>
          </main>
        </div>
      </div>
    </TooltipProvider>
  );
}

export { AdminShell };
