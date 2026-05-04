"use client";

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import type { NxNavItem } from "@nexpress/core";
import {
  CornerDownRight,
  GripVertical,
  Plus,
  Save,
  Trash2,
} from "lucide-react";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

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

const NO_PARENT = "__top__";

type EditableNavItem = Pick<NxNavItem, "id" | "label" | "url" | "pageId" | "collection"> & {
  type: Extract<NxNavItem["type"], "link" | "page" | "collection">;
  // Optional `id` of another (top-level) item this one is nested
  // under. Editor enforces a single level of nesting — children
  // can't themselves be parents — so the saved tree never grows
  // deeper than `children: NxNavItem[]` of length N.
  parentId?: string;
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

interface LocationOption {
  value: string;
  label: string;
}

// Baked-in fallbacks shown until the locations endpoint responds.
// The endpoint always returns these plus any custom locations the
// operator has added.
const FALLBACK_LOCATIONS: LocationOption[] = [
  { value: "header", label: "Header" },
  { value: "footer", label: "Footer" },
  { value: "main", label: "Main" },
];

// Magic value the location select uses to open the create-new
// dialog. Picked to be unlikely to collide with a real slug.
const NEW_LOCATION_SENTINEL = "__nx_new_location__";

type NavLocation = string;

export function NavigationEditor() {
  const [location, setLocation] = useState<NavLocation>("header");
  const [locations, setLocations] = useState<LocationOption[]>(FALLBACK_LOCATIONS);
  const [newLocationInput, setNewLocationInput] = useState("");
  const [newLocationDialogOpen, setNewLocationDialogOpen] = useState(false);
  const [creatingLocation, setCreatingLocation] = useState(false);
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
  const [pages, setPages] = useState<PageOption[]>([]);
  const [pagesLoading, setPagesLoading] = useState(false);
  const [pagesError, setPagesError] = useState<string | null>(null);
  const [collections, setCollections] = useState<CollectionOption[]>([]);
  const [collectionsLoading, setCollectionsLoading] = useState(false);
  const [collectionsError, setCollectionsError] = useState<string | null>(null);
  const [pendingLocation, setPendingLocation] = useState<NavLocation | null>(null);
  // Live drag-over state — populated by handleDragOver, cleared on
  // drag end / cancel. The visible affordance (highlighted target,
  // "nest" badge) reads from this; handleDragEnd's logic still
  // computes its own intent from event.delta so the preview and
  // the apply path can never disagree.
  const [dragOverInfo, setDragOverInfo] = useState<{
    activeId: string;
    overId: string;
    willNest: boolean;
  } | null>(null);

  const dirty = useMemo(() => JSON.stringify(items) !== savedSnapshot, [items, savedSnapshot]);

  // Drag-and-drop sensors. PointerSensor covers mouse/touch with a
  // small activation distance so casual clicks on label inputs don't
  // start a drag. KeyboardSensor adds Tab + Space + Arrow access for
  // sortable nav items — accessibility fallback for the "click and
  // drag" affordance the GripVertical handle implies.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  // Top-level item ids (parentId is null/undefined). Available as
  // parent options for any other item — but with `id !== self`
  // applied per-row so an item can't parent itself.
  const topLevelOptions = useMemo(
    () =>
      items
        .filter((item) => !item.parentId)
        .map((item) => ({ id: item.id, label: item.label || "(untitled)" })),
    [items],
  );

  useEffect(() => {
    void loadNavigation(location);
  }, [location]);

  // Locations are fetched once on mount and refreshed whenever the
  // operator creates a new one via the dialog. Soft-fails — the
  // FALLBACK_LOCATIONS keep the editor functional even if the
  // endpoint is unreachable.
  useEffect(() => {
    void loadLocations();
  }, []);

  async function loadLocations() {
    try {
      const response = await fetch("/api/navigation/locations");
      const payload = (await response.json().catch(() => null)) as unknown;
      if (!response.ok) return;
      if (isRecord(payload) && Array.isArray(payload.locations)) {
        const next = payload.locations.filter(isLocationOption);
        if (next.length > 0) setLocations(next);
      }
    } catch {
      // ignore — fallback list keeps the editor functional
    }
  }

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

  async function ensurePagesLoaded() {
    if (pages.length > 0 || pagesLoading) return;
    setPagesLoading(true);
    setPagesError(null);
    try {
      // 100 is the API's hard cap on `limit` (`parsePositiveInt`
      // throws Invalid query parameters above that).
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
          items: buildNavTree(items),
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

  async function createLocation(rawSlug: string) {
    const slug = rawSlug.trim().toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
    if (!slug) {
      setError("Location name must be lowercase letters, numbers, or hyphens.");
      return;
    }
    if (locations.some((l) => l.value === slug)) {
      setError(`Location "${slug}" already exists.`);
      return;
    }
    setCreatingLocation(true);
    setError(null);
    try {
      // Save an empty nav at the new location — that's what
      // creates the row in `nx_navigation`. The locations endpoint
      // will return it on the next fetch.
      const response = await nxFetch("/api/navigation", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ location: slug, items: [] }),
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as unknown;
        setError(getErrorMessage(payload, "Unable to create location."));
        return;
      }
      await loadLocations();
      setNewLocationInput("");
      setNewLocationDialogOpen(false);
      // Route through the same path the dropdown uses so unsaved
      // edits in the current location surface the discard dialog
      // instead of getting silently overwritten by the empty
      // newly-created nav.
      requestLocationChange(slug);
    } catch {
      setError("Unable to create location.");
    } finally {
      setCreatingLocation(false);
    }
  }

  function requestLocationChange(next: NavLocation) {
    if (next === NEW_LOCATION_SENTINEL) {
      setNewLocationDialogOpen(true);
      return;
    }
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

  function changeParent(id: string, parentSelectValue: string) {
    const nextParent = parentSelectValue === NO_PARENT ? undefined : parentSelectValue;
    setItems((current) => {
      const orphaned = nextParent
        ? current.map((c) => (c.parentId === id ? { ...c, parentId: undefined } : c))
        : current;
      return orphaned.map((c) => (c.id === id ? { ...c, parentId: nextParent } : c));
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
    setItems((current) => current.filter((item) => item.id !== id && item.parentId !== id));
  }

  function changeType(id: string, nextType: EditableNavItem["type"]) {
    if (nextType === "page") void ensurePagesLoaded();
    if (nextType === "collection") void ensureCollectionsLoaded();
    setItems((current) =>
      current.map((item) => {
        if (item.id !== id) return item;
        const base = { id: item.id, label: item.label, parentId: item.parentId };
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

  // Flat render order: top-level items in `items` array order, with
  // each parent's children inlined immediately after their parent.
  // Drives both the visible list and the SortableContext id array
  // (so dnd-kit treats children + top-level as one flat sortable —
  // required for cross-scope drags and the drag-to-nest pattern).
  const renderOrder = useMemo(() => {
    const result: { id: string; isChild: boolean }[] = [];
    const seen = new Set<string>();
    for (const item of items) {
      if (item.parentId) continue;
      result.push({ id: item.id, isChild: false });
      seen.add(item.id);
      for (const child of items) {
        if (child.parentId === item.id) {
          result.push({ id: child.id, isChild: true });
          seen.add(child.id);
        }
      }
    }
    // Orphans (parentId points at a deleted item) — render at the
    // end as top-level so they're not lost.
    for (const item of items) {
      if (!seen.has(item.id)) result.push({ id: item.id, isChild: false });
    }
    return result;
  }, [items]);

  // Indent threshold: dragging right by this many CSS px past the
  // item's original X promotes "drop here" intent from "reorder
  // alongside target" to "nest under target." Matches the visual
  // child-indent (`ml-8` = 32px) so the gesture lines up with the
  // resulting depth.
  const NEST_THRESHOLD_X = 24;

  function handleDragStart(_event: DragStartEvent) {
    setDragOverInfo(null);
  }

  function handleDragCancel() {
    setDragOverInfo(null);
  }

  // Mirror handleDragEnd's intent calculation so the preview matches
  // exactly what would happen if the operator released right now.
  // Same `wantsNest` rule, same 1-level guards. Update the state
  // only when something changed to avoid re-renders on every
  // pointer move.
  function handleDragOver(event: DragOverEvent) {
    const { active, over, delta } = event;
    if (!over) {
      if (dragOverInfo !== null) setDragOverInfo(null);
      return;
    }
    const activeId = String(active.id);
    const overId = String(over.id);
    if (activeId === overId) {
      if (dragOverInfo !== null) setDragOverInfo(null);
      return;
    }
    const activeItem = items.find((it) => it.id === activeId);
    const overItem = items.find((it) => it.id === overId);
    if (!activeItem || !overItem) return;
    const activeHasChildren = items.some((c) => c.parentId === activeId);
    const willNest =
      delta.x > NEST_THRESHOLD_X && !overItem.parentId && !activeHasChildren;
    if (
      dragOverInfo?.activeId === activeId &&
      dragOverInfo.overId === overId &&
      dragOverInfo.willNest === willNest
    ) {
      return;
    }
    setDragOverInfo({ activeId, overId, willNest });
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over, delta } = event;
    if (!over || active.id === over.id) return;
    const activeId = String(active.id);
    const overId = String(over.id);

    const activeItem = items.find((it) => it.id === activeId);
    const overItem = items.find((it) => it.id === overId);
    if (!activeItem || !overItem) return;

    const activeHasChildren = items.some((c) => c.parentId === activeId);
    const wantsNest = delta.x > NEST_THRESHOLD_X;

    // Decide the active item's NEW parentId after the drop.
    //
    //   - drag-right onto an item → become that item's child, but
    //     only if the target is top-level and the active item has
    //     no children of its own (1-level depth limit). Failed
    //     nest falls through to sibling reorder semantics.
    //   - normal drop → match the target's parentId (sibling).
    //
    // The orphan-children-on-demote rule (matches changeParent's
    // behavior) keeps the saved tree at most one level deep even
    // when the operator demotes a parent that already has kids.
    let nextParentId: string | undefined;
    if (wantsNest && !overItem.parentId && !activeHasChildren) {
      nextParentId = overId;
    } else {
      nextParentId = overItem.parentId;
    }

    // Self-loop guard: when active is dragged onto one of its own
    // children, `overItem.parentId === activeId`. Without this fix
    // the next-parent path would set active.parentId to itself and
    // `buildNavTree` would silently drop active from the saved
    // shape (it lives only in `childrenByParent[active]`, which is
    // never read for top-level emission). Promote active back to
    // top-level so the structure stays valid; the drag still
    // visibly reorders.
    if (nextParentId === activeId) {
      nextParentId = undefined;
    }

    const isNestDrop = wantsNest && nextParentId === overId;

    setItems((current) => {
      // 1) Patch active's parentId; orphan its existing children up
      //    to top-level if active itself is being demoted (matches
      //    the `changeParent` rule — the saved tree never grows
      //    deeper than one level).
      const updated = current.map((c) => {
        if (c.id === activeId) return { ...c, parentId: nextParentId };
        if (nextParentId && c.parentId === activeId) return { ...c, parentId: undefined };
        return c;
      });

      const oldIndex = updated.findIndex((it) => it.id === activeId);
      const targetIndex = updated.findIndex((it) => it.id === overId);
      if (oldIndex < 0 || targetIndex < 0) return current;

      if (isNestDrop) {
        // Nest: active becomes target's first child — visually the
        // row immediately after target. Splice rather than
        // arrayMove so the position is independent of drag
        // direction (active should always land *after* its new
        // parent, even when dragged upward).
        const without = updated.filter((it) => it.id !== activeId);
        const overInWithout = without.findIndex((it) => it.id === overId);
        const nextActive = updated[oldIndex];
        return [
          ...without.slice(0, overInWithout + 1),
          nextActive,
          ...without.slice(overInWithout + 1),
        ];
      }

      // Reorder: arrayMove preserves direction (active lands after
      // target on drag-down, before on drag-up) — the standard
      // sortable behavior the operator expects.
      return arrayMove(updated, oldIndex, targetIndex);
    });
    setDragOverInfo(null);
  }

  return (
    <>
      <Card className="border-border/70 bg-card/80 shadow-sm">
        <CardHeader className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-1">
            <CardTitle>Navigation structure</CardTitle>
            <p className="text-sm text-muted-foreground">
              Drag the grip handle to reorder, or drag right onto another item to nest as its
              sub-menu (one level deep). The Parent select still works for keyboard-driven changes.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2">
              <Label className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
                Location
              </Label>
              <Select
                value={location}
                onValueChange={(value) => requestLocationChange(value)}
              >
                <SelectTrigger className="w-40">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {locations.map((loc) => (
                    <SelectItem key={loc.value} value={loc.value}>
                      {loc.label}
                    </SelectItem>
                  ))}
                  <SelectItem value={NEW_LOCATION_SENTINEL} className="text-primary">
                    + New location…
                  </SelectItem>
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
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragStart={handleDragStart}
              onDragOver={handleDragOver}
              onDragEnd={handleDragEnd}
              onDragCancel={handleDragCancel}
            >
              <SortableContext
                items={renderOrder.map((entry) => entry.id)}
                strategy={verticalListSortingStrategy}
              >
                <div className="space-y-3">
                  {renderOrder.map(({ id, isChild }) => {
                    const item = items.find((i) => i.id === id);
                    if (!item) return null;
                    const isOver = dragOverInfo?.overId === item.id;
                    const isActive = dragOverInfo?.activeId === item.id;
                    return (
                      <SortableRow
                        key={item.id}
                        item={item}
                        isChild={isChild}
                        items={items}
                        topLevelOptions={topLevelOptions}
                        pages={pages}
                        pagesLoading={pagesLoading}
                        collections={collections}
                        collectionsLoading={collectionsLoading}
                        // Visual cue for the live drag preview. The
                        // over row gets a primary-tinted ring; if
                        // releasing now would nest, the ring slides
                        // into a "you're nesting" tone — see
                        // SortableRow's classes.
                        previewIntent={
                          isActive
                            ? "active"
                            : isOver
                              ? dragOverInfo?.willNest
                                ? "will-nest"
                                : "will-reorder"
                              : "idle"
                        }
                        onUpdate={updateItem}
                        onChangeType={changeType}
                        onChangeParent={changeParent}
                        onRemove={removeItem}
                      />
                    );
                  })}
                </div>
              </SortableContext>
            </DndContext>
          )}
        </CardContent>
      </Card>

      <Dialog
        open={pendingLocation !== null}
        onOpenChange={(open) => !open && setPendingLocation(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Discard unsaved changes?</DialogTitle>
            <DialogDescription>
              You have unsaved edits in <strong>{labelFor(location, locations)}</strong>.
              Switching to{" "}
              <strong>
                {pendingLocation ? labelFor(pendingLocation, locations) : ""}
              </strong>{" "}
              will discard them.
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

      <Dialog
        open={newLocationDialogOpen}
        onOpenChange={(open) => {
          if (!open) {
            setNewLocationDialogOpen(false);
            setNewLocationInput("");
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New navigation location</DialogTitle>
            <DialogDescription>
              Add a custom slot for theme code or templates to render
              (e.g. <code>sidebar</code>, <code>announcement-bar</code>). Themes consume locations
              by name via <code>getCachedNavigation(&quot;your-slug&quot;)</code>.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="new-location-slug">Location slug</Label>
            <Input
              id="new-location-slug"
              value={newLocationInput}
              onChange={(event) => setNewLocationInput(event.target.value)}
              placeholder="sidebar"
              autoFocus
            />
            <p className="text-xs text-muted-foreground">
              Lowercase letters, numbers, and hyphens.
            </p>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setNewLocationDialogOpen(false);
                setNewLocationInput("");
              }}
              disabled={creatingLocation}
            >
              Cancel
            </Button>
            <Button
              onClick={() => void createLocation(newLocationInput)}
              disabled={creatingLocation || !newLocationInput.trim()}
            >
              {creatingLocation ? "Creating…" : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

type RowPreviewIntent = "idle" | "active" | "will-reorder" | "will-nest";

interface SortableRowProps {
  item: EditableNavItem;
  isChild: boolean;
  items: EditableNavItem[];
  topLevelOptions: { id: string; label: string }[];
  pages: PageOption[];
  pagesLoading: boolean;
  collections: CollectionOption[];
  collectionsLoading: boolean;
  previewIntent: RowPreviewIntent;
  onUpdate: (id: string, patch: Partial<EditableNavItem>) => void;
  onChangeType: (id: string, nextType: EditableNavItem["type"]) => void;
  onChangeParent: (id: string, value: string) => void;
  onRemove: (id: string) => void;
}

function SortableRow({
  item,
  isChild,
  items,
  topLevelOptions,
  pages,
  pagesLoading,
  collections,
  collectionsLoading,
  previewIntent,
  onUpdate,
  onChangeType,
  onChangeParent,
  onRemove,
}: SortableRowProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: item.id,
  });

  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  // Parent options exclude self (can't parent yourself) and items
  // that already have children (1-level limit).
  const hasChildren = items.some((c) => c.parentId === item.id);
  const parentChoices = topLevelOptions.filter((opt) => opt.id !== item.id);

  // Live drag preview classes:
  //  - `will-nest` adds a primary-tinted left border + ring so the
  //    operator sees that releasing here would make this row a
  //    parent. The 4px left bar matches the ml-8 indent the new
  //    child would take, so the cue is visually anchored to where
  //    the change will land.
  //  - `will-reorder` adds a subtle ring on the over row only,
  //    confirming "drop here" without implying nesting.
  //  - `active` mutes the dragged item while it's in flight.
  const previewClass =
    previewIntent === "will-nest"
      ? "ring-2 ring-primary/60 border-l-4 border-l-primary"
      : previewIntent === "will-reorder"
        ? "ring-2 ring-primary/30"
        : previewIntent === "active"
          ? ""
          : "";

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`grid gap-4 rounded-2xl border border-border/70 bg-background/70 p-4 lg:grid-cols-[auto_1.1fr_1.4fr_180px_180px_auto] lg:items-end ${
        isChild ? "ml-8 border-l-4 border-l-primary/40" : ""
      } ${isDragging ? "shadow-lg" : ""} ${previewClass} transition-shadow`}
    >
      <button
        type="button"
        className="flex h-10 w-10 cursor-grab items-center justify-center rounded-md text-muted-foreground hover:bg-muted/40 active:cursor-grabbing"
        aria-label="Drag to reorder"
        {...attributes}
        {...listeners}
      >
        {isChild ? <CornerDownRight className="h-4 w-4" /> : <GripVertical className="h-4 w-4" />}
      </button>

      <div className="space-y-2">
        <Label htmlFor={`nav-label-${item.id}`}>Label</Label>
        <Input
          id={`nav-label-${item.id}`}
          value={item.label}
          onChange={(event) => onUpdate(item.id, { label: event.target.value })}
        />
      </div>

      <div className="space-y-2">
        {item.type === "page" ? (
          <>
            <Label htmlFor={`nav-page-${item.id}`}>Page</Label>
            <Select
              value={item.pageId ?? ""}
              onValueChange={(value) => onUpdate(item.id, { pageId: value })}
            >
              <SelectTrigger id={`nav-page-${item.id}`}>
                <SelectValue placeholder={pagesLoading ? "Loading…" : "Select a page"} />
              </SelectTrigger>
              <SelectContent>
                {pages.length === 0 && !pagesLoading ? (
                  <div className="px-3 py-2 text-xs text-muted-foreground">No pages yet.</div>
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
              onValueChange={(value) => onUpdate(item.id, { collection: value })}
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
              onChange={(event) => onUpdate(item.id, { url: event.target.value })}
            />
          </>
        )}
      </div>

      <div className="space-y-2">
        <Label>Type</Label>
        <Select
          value={item.type}
          onValueChange={(value) => onChangeType(item.id, value as EditableNavItem["type"])}
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

      <div className="space-y-2">
        <Label>Parent</Label>
        <Select
          value={item.parentId ?? NO_PARENT}
          onValueChange={(value) => onChangeParent(item.id, value)}
          disabled={hasChildren}
        >
          <SelectTrigger>
            <SelectValue placeholder="Top level" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NO_PARENT}>Top level</SelectItem>
            {parentChoices.map((opt) => (
              <SelectItem key={opt.id} value={opt.id}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex justify-end">
        <Button variant="outline" size="icon" onClick={() => onRemove(item.id)}>
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>

    </div>
  );
}

function buildNavTree(items: EditableNavItem[]): NxNavItem[] {
  const idSet = new Set(items.map((item) => item.id));
  const top: NxNavItem[] = [];
  const childrenByParent = new Map<string, NxNavItem[]>();

  for (const item of items) {
    const node = toNavItem(item);
    const parentId = item.parentId && idSet.has(item.parentId) ? item.parentId : undefined;
    if (!parentId) {
      top.push(node);
    } else {
      const list = childrenByParent.get(parentId) ?? [];
      list.push(node);
      childrenByParent.set(parentId, list);
    }
  }

  for (const node of top) {
    const kids = childrenByParent.get(node.id);
    if (kids && kids.length > 0) node.children = kids;
  }

  return top;
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
      : [];

  const result: EditableNavItem[] = [];
  source.filter(isRecord).forEach((item, index) => {
    const top = toEditableNavItem(item, index, undefined);
    result.push(top);
    if (Array.isArray(item.children)) {
      item.children.filter(isRecord).forEach((child, childIndex) => {
        result.push(toEditableNavItem(child, index * 1000 + childIndex, top.id));
      });
    }
  });
  return result;
}

function toEditableNavItem(
  item: Record<string, unknown>,
  index: number,
  parentId: string | undefined,
): EditableNavItem {
  const id = typeof item.id === "string" ? item.id : `nav-${index}`;
  const label = typeof item.label === "string" ? item.label : "";
  if (item.type === "page") {
    return {
      id,
      label,
      type: "page" as const,
      pageId: typeof item.pageId === "string" ? item.pageId : undefined,
      parentId,
    };
  }
  if (item.type === "collection") {
    return {
      id,
      label,
      type: "collection" as const,
      collection: typeof item.collection === "string" ? item.collection : undefined,
      parentId,
    };
  }
  return {
    id,
    label,
    type: "link" as const,
    url: typeof item.url === "string" ? item.url : "/",
    parentId,
  };
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

function labelFor(location: NavLocation, locations: LocationOption[]): string {
  return locations.find((loc) => loc.value === location)?.label ?? location;
}

function isLocationOption(value: unknown): value is LocationOption {
  return (
    isRecord(value) && typeof value.value === "string" && typeof value.label === "string"
  );
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
