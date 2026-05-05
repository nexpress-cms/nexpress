"use client";

import { useEffect, useState } from "react";
import { Check, ChevronsUpDown, Globe2, Loader2 } from "lucide-react";

import { npFetch } from "../lib/api-client.js";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu.js";

/**
 * Phase 15.6 — site-picker dropdown for the admin topbar.
 *
 * Shown only when the user has access to more than one site
 * (super-admins always see it; non-super users see it only
 * when they hold memberships on multiple sites). On
 * single-tenant deployments the component renders nothing —
 * there's no decision to surface.
 *
 * Selecting a site POSTs `/api/admin/sites/active`, which
 * sets the `nx-admin-site` cookie. The component reloads the
 * page after a successful switch so server components re-
 * resolve the active site context from the new cookie.
 */
interface AccessibleSite {
  id: string;
  name: string;
  hostname: string | null;
  isDefault: boolean;
}

interface AccessiblePayload {
  docs?: AccessibleSite[];
  isSuperAdmin?: boolean;
  currentId?: string;
}

export function SitePicker() {
  const [sites, setSites] = useState<AccessibleSite[] | null>(null);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    void load();
  }, []);

  async function load() {
    try {
      const res = await npFetch("/api/admin/sites/accessible");
      if (!res.ok) {
        setSites([]);
        return;
      }
      const body = (await res.json().catch(() => null)) as
        | AccessiblePayload
        | null;
      setSites(body?.docs ?? []);
      // The cookie is HttpOnly so we can't read it client-
      // side. The endpoint surfaces the resolver's current
      // site id explicitly so the picker can highlight the
      // active entry without leaking the cookie to JS.
      setCurrentId(body?.currentId ?? null);
    } catch {
      setSites([]);
    }
  }

  async function handleSelect(id: string) {
    setBusyId(id);
    try {
      const res = await npFetch("/api/admin/sites/active", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      if (!res.ok) {
        setBusyId(null);
        return;
      }
      // Hard reload: server components re-evaluate
      // `getCurrentSiteId()` from the new cookie. router.refresh
      // alone wouldn't pick up the new resolver value reliably
      // because some chunks were cached at the previous site
      // context.
      window.location.reload();
    } catch {
      setBusyId(null);
    }
  }

  // Hide entirely when there's only one site (the dropdown
  // would just show a single disabled item — useless noise on
  // single-tenant deployments).
  if (!sites || sites.length <= 1) {
    return null;
  }

  const current = sites.find((s) => s.id === currentId) ?? null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="inline-flex h-7 items-center gap-1.5 rounded-md border border-neutral-200/80 bg-white px-2.5 text-[12.5px] font-medium text-neutral-700 transition-colors hover:bg-neutral-50 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[var(--np-color-brand-ring)] dark:border-neutral-800/80 dark:bg-neutral-950 dark:text-neutral-300 dark:hover:bg-neutral-900"
          title="Switch site"
        >
          <Globe2 className="size-3.5 text-neutral-400" />
          <span className="text-neutral-950 dark:text-neutral-50">
            {current?.name ?? "Site"}
          </span>
          <ChevronsUpDown className="size-3 text-neutral-400" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72">
        <DropdownMenuLabel>Switch site</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {sites.map((site) => {
          const active = site.id === currentId;
          return (
            <DropdownMenuItem
              key={site.id}
              onSelect={(event) => {
                event.preventDefault();
                if (busyId !== null || active) return;
                void handleSelect(site.id);
              }}
              disabled={busyId !== null}
            >
              <div className="flex w-full items-center justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-medium text-neutral-950 dark:text-neutral-50">
                    {site.name}
                  </p>
                  <p className="truncate font-mono text-[11.5px] text-neutral-500 dark:text-neutral-400">
                    {site.hostname ? site.hostname : "Default tenant"}
                  </p>
                </div>
                {active ? (
                  <Check className="size-3.5 text-[var(--np-color-brand)]" />
                ) : busyId === site.id ? (
                  <Loader2 className="size-3.5 animate-spin text-neutral-400" />
                ) : null}
              </div>
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
