"use client";

import { useEffect, useMemo, useState } from "react";
import type { NxNavItem } from "@nexpress/core";
import {
  ArrowDown,
  ArrowUp,
  GripVertical,
  Plus,
  Save,
  Trash2,
} from "lucide-react";

import { nxFetch } from "../lib/api-client.js";
import { Button } from "../ui/button.js";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "../ui/card.js";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog.js";
import { Input } from "../ui/input.js";
import { Label } from "../ui/label.js";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select.js";

type EditableNavItem = Pick<NxNavItem, "id" | "label" | "url" | "pageId" | "collection"> & {
  type: Extract<NxNavItem["type"], "link" | "page" | "collection">;
};

interface PageOption {
  id: string;
  title: string;
  slug: string;
}

interface CollectionOption {
  slug: string;
  label: string;
}

const NAV_LOCATIONS = [
  { value: "header", label: "Header" },
  { value: "footer", label: "Footer" },
  { value: "main", label: "Main" },
] as const;

type NavLocation = (typeof NAV_LOCATIONS)[number]["value"];

export function NavigationEditor() {
  const [location, setLocation] = useState<NavLocation>("header");
  const [items, setItems] = useState<EditableNavItem[]>([]);
  // Snapshot of items as they were at last load/save. Used to compute
  // `dirty` so the location switcher can prompt before discarding
  // unsaved edits. Comparing serialized JSON is good enough — the
  // EditableNavItem shape is small and flat, and the operator's edits
  // hit setItems with new object identities anyway.
  const [savedSnapshot, setSavedSnapshot] = useState<string>("[]");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  // Page list cache shared across all "page" type items so the
  // picker doesn't refetch per-row. Loaded lazily on first edit
  // that needs it. Empty until the editor or a page item asks.
  const [pages, setPages] = useState<PageOption[]>([]);
  const [pagesLoading, setPagesLoading] = useState(false);
  const [pagesError, setPagesError] = useState<string | null>(null);
  // Collection list — same lazy-load contract as pages, fetched
  // when the operator first picks "collection" type or loads a
  // nav with collection-typed items.
  const [collections, setCollections] = useState<CollectionOption[]>([]);
  const [collectionsLoading, setCollectionsLoading] = useState(false);
  const [collectionsError, setCollectionsError] = useState<string | null>(null);
  // Pending location switch waiting for the unsaved-changes confirm.
  // Null when the dialog is closed.
  const [pendingLocation, setPendingLocation] = useState<NavLocation | null>(null);

  const dirty = useMemo(() => JSON.stringify(items) !== savedSnapshot, [items, savedSnapshot]);

  // Re-fetch nav whenever the operator switches location. Each
  // location is its own (siteId, location) row in nx_navigation.
  useEffect(() => {
    void loadNavigation(location);
  }, [location]);

  async function loadNavigation(loc: NavLocation) {
    setLoading(true);
    setError(null);
    setMessage(null);

    try {
      const response = await fetch(`/api/navigation?location=${encodeURIComponent(loc)}`);
      const payload = (await response.json().catch(() => null)) as unknown;

      if (!response.ok) {
        setError(getErrorMessage(payload, "Unable to load navigation."));
        return;
      }

      const next = normalizeNavItems(payload);
      setItems(next);
      setSavedSnapshot(JSON.stringify(next));
    } catch {
      setError("Unable to load navigation.");
    } finally {
      setLoading(false);
    }
  }

  // Lazy: only hit /api/collections/pages when the editor first
  // needs the page list (operator picks "Page" type, or already
  // has a page-typed item on load).
  async function ensurePagesLoaded() {
    if (pages.length > 0 || pagesLoading) return;
    setPagesLoading(true);
    setPagesError(null);
    try {
      // 100 is the API's hard cap on `limit` (`parsePositiveInt`
      // throws Invalid query parameters above that). Sites with
      // more than 100 pages won't see them all in the picker —
      // search-as-you-type is the proper fix and lives in the
      // follow-up backlog.
      const response = await fetch("/api/collections/pages?limit=100");
      const payload = (await response.json().catch(() => null)) as unknown;
      if (!response.ok) {
        setPagesError(getErrorMessage(payload, "Unable to load pages."));
        return;
      }
      setPages(extractPages(payload));
    } catch {
      setPagesError("Unable to load pages.");
    } finally {
      setPagesLoading(false);
    }
  }

  async function ensureCollectionsLoaded() {
    if (collections.length > 0 || collectionsLoading) return;
    setCollectionsLoading(true);
    setCollectionsError(null);
    try {
      const response = await fetch("/api/meta/collections");
      const payload = (await response.json().catch(() => null)) as unknown;
      if (!response.ok) {
        setCollectionsError(getErrorMessage(payload, "Unable to load collections."));
        return;
      }
      setCollections(extractCollections(payload));
    } catch {
      setCollectionsError("Unable to load collections.");
    } finally {
      setCollectionsLoading(false);
    }
  }

  // Hydrate page / collection lists when the loaded nav already
  // contains items of that type — without this, the typed select
  // shows a placeholder instead of the saved value's label.
  useEffect(() => {
    if (items.some((item) => item.type === "page") && pages.length === 0) {
      void ensurePagesLoaded();
    }
    if (items.some((item) => item.type === "collection") && collections.length === 0) {
      void ensureCollectionsLoaded();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items]);

  async function saveNavigation() {
    setSaving(true);
    setError(null);
    setMessage(null);

    try {
      const response = await nxFetch("/api/navigation", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          location,
          items: items.map(toNavItem),
        }),
      });

      const payload = (await response.json().catch(() => null)) as unknown;

      if (!response.ok) {
        setError(getErrorMessage(payload, "Unable to save navigation."));
        return;
      }

      setSavedSnapshot(JSON.stringify(items));
      setMessage("Navigation saved.");
    } catch {
      setError("Unable to save navigation.");
    } finally {
      setSaving(false);
    }
  }

  function requestLocationChange(next: NavLocation) {
    if (next === location) return;
    if (dirty) {
      setPendingLocation(next);
      return;
    }
    setLocation(next);
  }

  function confirmDiscard() {
    if (pendingLocation) setLocation(pendingLocation);
    setPendingLocation(null);
  }

  function updateItem(id: string, patch: Partial<EditableNavItem>) {
    setItems((current) =>
      current.map((item) => (item.id === id ? { ...item, ...patch } : item)),
    );
  }

  function moveItem(index: number, direction: -1 | 1) {
    setItems((current) => {
      const nextIndex = index + direction;

      if (nextIndex < 0 || nextIndex >= current.length) {
        return current;
      }

      const next = [...current];
      const [item] = next.splice(index, 1);
      next.splice(nextIndex, 0, item);
      return next;
    });
  }

  function addItem() {
    setItems((current) => [
      ...current,
      {
        id: createId(),
        label: "",
        url: "/",
        type: "link",
      },
    ]);
  }

  function removeItem(id: string) {
    setItems((current) => current.filter((item) => item.id !== id));
  }

  function changeType(id: string, nextType: EditableNavItem["type"]) {
    if (nextType === "page") void ensurePagesLoaded();
    if (nextType === "collection") void ensureCollectionsLoaded();
    setItems((current) =>
      current.map((item) => {
        if (item.id !== id) return item;
        // Drop the fields that don't apply to the new type so the
        // saved payload stays consistent. Keep label intact.
        const base = { id: item.id, label: item.label };
        if (nextType === "page") {
          return { ...base, type: nextType, pageId: item.pageId };
        }
        if (nextType === "collection") {
          return { ...base, type: nextType, collection: item.collection };
        }
        return { ...base, type: nextType, url: item.url ?? "/" };
      }),
    );
  }

  return (
    <>
      <Card className="border-border/70 bg-card/80 shadow-sm">
        <CardHeader className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-1">
            <CardTitle>Navigation structure</CardTitle>
            <p className="text-sm text-muted-foreground">
              Fine-tune labels, destinations, and sequence per location.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2">
              <Label className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
                Location
              </Label>
              <Select
                value={location}
                onValueChange={(value) => requestLocationChange(value as NavLocation)}
              >
                <SelectTrigger className="w-32">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {NAV_LOCATIONS.map((loc) => (
                    <SelectItem key={loc.value} value={loc.value}>
                      {loc.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button variant="outline" onClick={addItem}>
              <Plus className="mr-2 h-4 w-4" />
              Add item
            </Button>
            <Button onClick={() => void saveNavigation()} disabled={saving || loading}>
              <Save className="mr-2 h-4 w-4" />
              {saving ? "Saving..." : "Save"}
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {error ? (
            <div className="rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
              {error}
            </div>
          ) : null}

          {pagesError ? (
            <div className="rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
              {pagesError}
            </div>
          ) : null}

          {collectionsError ? (
            <div className="rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
              {collectionsError}
            </div>
          ) : null}

          {message ? (
            <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 px-4 py-3 text-sm text-emerald-600 dark:text-emerald-300">
              {message}
            </div>
          ) : null}

          {loading ? (
            <div className="space-y-3">
              {Array.from({ length: 4 }).map((_, index) => (
                <div
                  key={`navigation-skeleton-${index}`}
                  className="h-28 animate-pulse rounded-2xl border border-border/70 bg-muted/40"
                />
              ))}
            </div>
          ) : items.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-border/70 px-6 py-12 text-center text-sm text-muted-foreground">
              No navigation items in this location yet. Add your first link to get started.
            </div>
          ) : (
            <div className="space-y-3">
              {items.map((item, index) => (
                <div
                  key={item.id}
                  className="grid gap-4 rounded-2xl border border-border/70 bg-background/70 p-4 lg:grid-cols-[auto_1.1fr_1.4fr_180px_auto] lg:items-end"
                >
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <GripVertical className="h-4 w-4" />
                    <div className="flex gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => moveItem(index, -1)}
                        disabled={index === 0}
                      >
                        <ArrowUp className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => moveItem(index, 1)}
                        disabled={index === items.length - 1}
                      >
                        <ArrowDown className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor={`nav-label-${item.id}`}>Label</Label>
                    <Input
                      id={`nav-label-${item.id}`}
                      value={item.label}
                      onChange={(event) => updateItem(item.id, { label: event.target.value })}
                    />
                  </div>

                  <div className="space-y-2">
                    {item.type === "page" ? (
                      <>
                        <Label htmlFor={`nav-page-${item.id}`}>Page</Label>
                        <Select
                          value={item.pageId ?? ""}
                          onValueChange={(value) => updateItem(item.id, { pageId: value })}
                        >
                          <SelectTrigger id={`nav-page-${item.id}`}>
                            <SelectValue placeholder={pagesLoading ? "Loading…" : "Select a page"} />
                          </SelectTrigger>
                          <SelectContent>
                            {pages.length === 0 && !pagesLoading ? (
                              <div className="px-3 py-2 text-xs text-muted-foreground">
                                No pages yet.
                              </div>
                            ) : (
                              pages.map((page) => (
                                <SelectItem key={page.id} value={page.id}>
                                  {page.title || page.slug || page.id}
                                </SelectItem>
                              ))
                            )}
                          </SelectContent>
                        </Select>
                      </>
                    ) : item.type === "collection" ? (
                      <>
                        <Label htmlFor={`nav-collection-${item.id}`}>Collection</Label>
                        <Select
                          value={item.collection ?? ""}
                          onValueChange={(value) => updateItem(item.id, { collection: value })}
                        >
                          <SelectTrigger id={`nav-collection-${item.id}`}>
                            <SelectValue
                              placeholder={collectionsLoading ? "Loading…" : "Select a collection"}
                            />
                          </SelectTrigger>
                          <SelectContent>
                            {collections.length === 0 && !collectionsLoading ? (
                              <div className="px-3 py-2 text-xs text-muted-foreground">
                                No collections registered.
                              </div>
                            ) : (
                              collections.map((collection) => (
                                <SelectItem key={collection.slug} value={collection.slug}>
                                  {collection.label || collection.slug}
                                </SelectItem>
                              ))
                            )}
                          </SelectContent>
                        </Select>
                      </>
                    ) : (
                      <>
                        <Label htmlFor={`nav-url-${item.id}`}>URL</Label>
                        <Input
                          id={`nav-url-${item.id}`}
                          value={item.url ?? ""}
                          onChange={(event) => updateItem(item.id, { url: event.target.value })}
                        />
                      </>
                    )}
                  </div>

                  <div className="space-y-2">
                    <Label>Type</Label>
                    <Select
                      value={item.type}
                      onValueChange={(value) =>
                        changeType(item.id, value as EditableNavItem["type"])
                      }
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select a type" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="link">Link</SelectItem>
                        <SelectItem value="page">Page</SelectItem>
                        <SelectItem value="collection">Collection</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="flex justify-end">
                    <Button variant="outline" size="icon" onClick={() => removeItem(item.id)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={pendingLocation !== null} onOpenChange={(open) => !open && setPendingLocation(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Discard unsaved changes?</DialogTitle>
            <DialogDescription>
              You have unsaved edits in <strong>{labelFor(location)}</strong>. Switching to{" "}
              <strong>{pendingLocation ? labelFor(pendingLocation) : ""}</strong> will discard them.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPendingLocation(null)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={confirmDiscard}>
              Discard and switch
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function toNavItem(item: EditableNavItem): NxNavItem {
  if (item.type === "page") {
    return {
      id: item.id,
      label: item.label,
      type: "page",
      pageId: item.pageId ?? "",
    };
  }
  if (item.type === "collection") {
    return {
      id: item.id,
      label: item.label,
      type: "collection",
      collection: item.collection ?? "",
    };
  }
  return {
    id: item.id,
    label: item.label,
    type: "link",
    url: item.url ?? "",
  };
}

function normalizeNavItems(payload: unknown): EditableNavItem[] {
  const source = Array.isArray(payload)
    ? payload
    : isRecord(payload) && Array.isArray(payload.items)
      ? payload.items
      : isRecord(payload) && Array.isArray(payload.navigation)
        ? payload.navigation
        : [];

  return source.filter(isRecord).map((item, index) => {
    const id = typeof item.id === "string" ? item.id : `nav-${index}`;
    const label = typeof item.label === "string" ? item.label : "";
    if (item.type === "page") {
      return {
        id,
        label,
        type: "page" as const,
        pageId: typeof item.pageId === "string" ? item.pageId : undefined,
      };
    }
    if (item.type === "collection") {
      return {
        id,
        label,
        type: "collection" as const,
        collection: typeof item.collection === "string" ? item.collection : undefined,
      };
    }
    return {
      id,
      label,
      type: "link" as const,
      url: typeof item.url === "string" ? item.url : "/",
    };
  });
}

function extractPages(payload: unknown): PageOption[] {
  const docs = isRecord(payload) && Array.isArray(payload.docs)
    ? payload.docs
    : Array.isArray(payload)
      ? payload
      : [];
  return docs.filter(isRecord).flatMap((doc) => {
    const id = typeof doc.id === "string" ? doc.id : null;
    if (!id) return [];
    const title = typeof doc.title === "string" ? doc.title : "";
    const slug = typeof doc.slug === "string" ? doc.slug : "";
    return [{ id, title, slug }];
  });
}

function extractCollections(payload: unknown): CollectionOption[] {
  const items = isRecord(payload) && Array.isArray(payload.items)
    ? payload.items
    : Array.isArray(payload)
      ? payload
      : [];
  return items.filter(isRecord).flatMap((entry) => {
    const slug = typeof entry.slug === "string" ? entry.slug : null;
    if (!slug) return [];
    const labels = isRecord(entry.labels) ? entry.labels : null;
    const label = labels && typeof labels.plural === "string" ? labels.plural : slug;
    return [{ slug, label }];
  });
}

function labelFor(location: NavLocation): string {
  return NAV_LOCATIONS.find((loc) => loc.value === location)?.label ?? location;
}

function createId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }

  return `nav-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function getErrorMessage(payload: unknown, fallback: string) {
  if (isRecord(payload)) {
    if (typeof payload.error === "string") {
      return payload.error;
    }
    if (isRecord(payload.error) && typeof payload.error.message === "string") {
      return payload.error.message;
    }
  }

  return fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
