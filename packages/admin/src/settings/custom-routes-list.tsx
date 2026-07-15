"use client";

import { useEffect, useMemo, useState } from "react";
import { npRequireCustomRoutesResponse, type NpCustomRoute } from "@nexpress/core/routes";
import {
  CircleUser,
  ExternalLink,
  Loader2,
  LogIn,
  MessagesSquare,
  Newspaper,
  Route,
  Search,
  SquarePen,
  UserPlus,
  type LucideIcon,
} from "lucide-react";

import { Badge } from "../ui/badge.js";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card.js";

const ICON_MAP: Record<string, LucideIcon> = {
  newspaper: Newspaper,
  search: Search,
  "messages-square": MessagesSquare,
  "square-pen": SquarePen,
  "log-in": LogIn,
  "user-plus": UserPlus,
  "circle-user": CircleUser,
};

function resolveIcon(name?: string): LucideIcon {
  if (!name) return Route;
  return ICON_MAP[name] ?? Route;
}

/**
 * Settings → Routes tab. Read-only list of every developer-declared
 * custom route declared in `src/lib/custom-routes.ts`. Mirrors what
 * the navigation editor's URL autocomplete pulls
 * from — operators get one place to see every hand-coded surface
 * the framework knows about.
 *
 * No write operations: routes are code-owned by definition. To add
 * one, the developer updates `npCustomRoutes` and redeploys.
 */
export function CustomRoutesList() {
  const [state, setState] = useState<
    | { kind: "loading" }
    | { kind: "ready"; routes: readonly NpCustomRoute[] }
    | { kind: "error"; message: string }
  >({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch("/api/admin/custom-routes");
        const payload = (await response.json().catch(() => null)) as unknown;
        if (cancelled) return;
        if (!response.ok) {
          setState({
            kind: "error",
            message: getErrorMessage(payload, "Unable to load custom routes."),
          });
          return;
        }
        const responseBody = npRequireCustomRoutesResponse(payload);
        setState({ kind: "ready", routes: responseBody.routes });
      } catch {
        if (!cancelled) {
          setState({ kind: "error", message: "Unable to load custom routes." });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const grouped = useMemo(() => {
    if (state.kind !== "ready") return [] as Array<{ group: string; routes: NpCustomRoute[] }>;
    const buckets = new Map<string, NpCustomRoute[]>();
    for (const route of state.routes) {
      const key = route.group?.trim() || "general";
      const list = buckets.get(key) ?? [];
      list.push(route);
      buckets.set(key, list);
    }
    return Array.from(buckets.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([group, routes]) => ({
        group,
        routes: routes.sort((a, b) => a.path.localeCompare(b.path)),
      }));
  }, [state]);

  return (
    <Card className="min-w-0">
      <CardHeader className="space-y-2">
        <CardTitle className="break-words">Custom routes</CardTitle>
        <p className="break-words text-sm text-muted-foreground">
          Hand-coded Next.js routes registered by the app at boot. To add or remove one, edit the{" "}
          <code className="break-all rounded bg-muted px-1.5 py-0.5 text-xs">npCustomRoutes</code>{" "}
          catalog and redeploy. The navigation editor autocompletes URLs from this list.
        </p>
      </CardHeader>
      <CardContent className="min-w-0 space-y-6">
        {state.kind === "loading" ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading routes…
          </div>
        ) : null}

        {state.kind === "error" ? (
          <div className="break-words rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
            {state.message}
          </div>
        ) : null}

        {state.kind === "ready" && state.routes.length === 0 ? (
          <div className="break-words rounded-xl border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
            No custom routes registered yet. Add definitions to{" "}
            <code className="break-all rounded bg-muted px-1.5 py-0.5 text-xs">npCustomRoutes</code>{" "}
            in{" "}
            <code className="break-all rounded bg-muted px-1.5 py-0.5 text-xs">
              src/lib/custom-routes.ts
            </code>
            .
          </div>
        ) : null}

        {state.kind === "ready" && state.routes.length > 0 ? (
          <div className="space-y-6">
            {grouped.map(({ group, routes }) => (
              <div key={group} className="min-w-0 space-y-3">
                <h3 className="break-words text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {group}
                </h3>
                <ul className="min-w-0 divide-y rounded-xl border">
                  {routes.map((route) => {
                    const Icon = resolveIcon(route.icon);
                    const dyn = route.kind === "dynamic";
                    return (
                      <li
                        key={route.path}
                        className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] gap-3 px-4 py-3 sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:items-start"
                      >
                        <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                          <Icon className="h-4 w-4" />
                        </span>
                        <div className="min-w-0 flex-1 space-y-1">
                          <div className="flex min-w-0 flex-wrap items-center gap-2">
                            <span className="min-w-0 break-words font-medium">{route.label}</span>
                            <code className="break-all rounded bg-muted px-1.5 py-0.5 text-xs">
                              {route.path}
                            </code>
                            {dyn ? (
                              <Badge variant="secondary" className="text-[10px]">
                                dynamic
                              </Badge>
                            ) : null}
                            <Badge variant="outline" className="max-w-full break-all text-[10px]">
                              {route.source}
                            </Badge>
                          </div>
                          {route.description ? (
                            <p className="break-words text-sm text-muted-foreground">
                              {route.description}
                            </p>
                          ) : null}
                        </div>
                        {dyn ? null : (
                          <a
                            href={route.path}
                            target="_blank"
                            rel="noreferrer"
                            className="col-start-2 inline-flex w-fit items-center gap-1 text-xs text-muted-foreground hover:text-foreground sm:col-start-auto"
                          >
                            Open
                            <ExternalLink className="h-3 w-3" />
                          </a>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function getErrorMessage(payload: unknown, fallback: string): string {
  if (isRecord(payload) && isRecord(payload.error)) {
    const msg = payload.error.message;
    if (typeof msg === "string" && msg.length > 0) return msg;
  }
  return fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
