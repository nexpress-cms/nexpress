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
  const [pages, setPages] = useState<PageOption[]>([]);
  const [pagesLoading, setPagesLoading] = useState(false);
  const [pagesError, setPagesError] = useState<string | null>(null);
  const [collections, setCollections] = useState<CollectionOption[]>([]);
  const [collectionsLoading, setCollectionsLoading] = useState(false);
  const [collectionsError, setCollectionsError] = useState<string | null>(null);
  const [pendingLocation, setPendingLocation] = useState<NavLocation | null>(null);

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

  // Group ids by parent for the nested SortableContexts. Top-level
  // ids appear in `items` array order; each parent's children appear
  // in their array order.
  const grouped = useMemo(() => {
    const topIds: string[] = [];
    const childIdsByParent = new Map<string, string[]>();
    for (const item of items) {
      if (!item.parentId) {
        topIds.push(item.id);
      } else {
        const list = childIdsByParent.get(item.parentId) ?? [];
        list.push(item.id);
        childIdsByParent.set(item.parentId, list);
      }
    }
    return { topIds, childIdsByParent };
  }, [items]);

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const activeId = String(active.id);
    const overId = String(over.id);

    const activeItem = items.find((it) => it.id === activeId);
    const overItem = items.find((it) => it.id === overId);
    if (!activeItem || !overItem) return;

    // Drag is scoped to siblings — both must be top-level OR both
    // must share the same parent. Cross-scope drags are no-ops; the
    // operator changes parent via the `Parent` select, not by drag.
    if ((activeItem.parentId ?? null) !== (overItem.parentId ?? null)) {
      return;
    }

    const siblingIds = activeItem.parentId
      ? grouped.childIdsByParent.get(activeItem.parentId) ?? []
      : grouped.topIds;
    const oldIndex = siblingIds.indexOf(activeId);
    const newIndex = siblingIds.indexOf(overId);
    if (oldIndex < 0 || newIndex < 0) return;
    const reorderedIds = arrayMove(siblingIds, oldIndex, newIndex);

    // Rebuild the flat items array so sibling-group order matches
    // the new sequence. Items that aren't part of this sibling
    // group keep their relative position; we just splice the
    // reordered subset back in their original positions.
    const reorderedSet = new Set(reorderedIds);
    let cursor = 0;
    setItems((current) =>
      current.map((item) => {
        if (reorderedSet.has(item.id)) {
          const nextId = reorderedIds[cursor++];
          return current.find((c) => c.id === nextId) ?? item;
        }
        return item;
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
              Drag the grip handle to reorder within siblings. Set a parent to nest an item as a
              sub-menu (one level deep).
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
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={handleDragEnd}
            >
              <SortableContext items={grouped.topIds} strategy={verticalListSortingStrategy}>
                <div className="space-y-3">
                  {grouped.topIds.map((id) => {
                    const item = items.find((i) => i.id === id);
                    if (!item) return null;
                    const childIds = grouped.childIdsByParent.get(id) ?? [];
                    return (
                      <SortableRow
                        key={item.id}
                        item={item}
                        isChild={false}
                        items={items}
                        topLevelOptions={topLevelOptions}
                        pages={pages}
                        pagesLoading={pagesLoading}
                        collections={collections}
                        collectionsLoading={collectionsLoading}
                        onUpdate={updateItem}
                        onChangeType={changeType}
                        onChangeParent={changeParent}
                        onRemove={removeItem}
                      >
                        {childIds.length > 0 ? (
                          <SortableContext items={childIds} strategy={verticalListSortingStrategy}>
                            <div className="mt-3 space-y-3">
                              {childIds.map((childId) => {
                                const child = items.find((i) => i.id === childId);
                                if (!child) return null;
                                return (
                                  <SortableRow
                                    key={child.id}
                                    item={child}
                                    isChild
                                    items={items}
                                    topLevelOptions={topLevelOptions}
                                    pages={pages}
                                    pagesLoading={pagesLoading}
                                    collections={collections}
                                    collectionsLoading={collectionsLoading}
                                    onUpdate={updateItem}
                                    onChangeType={changeType}
                                    onChangeParent={changeParent}
                                    onRemove={removeItem}
                                  />
                                );
                              })}
                            </div>
                          </SortableContext>
                        ) : null}
                      </SortableRow>
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

interface SortableRowProps {
  item: EditableNavItem;
  isChild: boolean;
  items: EditableNavItem[];
  topLevelOptions: { id: string; label: string }[];
  pages: PageOption[];
  pagesLoading: boolean;
  collections: CollectionOption[];
  collectionsLoading: boolean;
  onUpdate: (id: string, patch: Partial<EditableNavItem>) => void;
  onChangeType: (id: string, nextType: EditableNavItem["type"]) => void;
  onChangeParent: (id: string, value: string) => void;
  onRemove: (id: string) => void;
  children?: React.ReactNode;
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
  onUpdate,
  onChangeType,
  onChangeParent,
  onRemove,
  children,
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

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`grid gap-4 rounded-2xl border border-border/70 bg-background/70 p-4 lg:grid-cols-[auto_1.1fr_1.4fr_180px_180px_auto] lg:items-end ${
        isChild ? "ml-8 border-l-4 border-l-primary/40" : ""
      } ${isDragging ? "shadow-lg" : ""}`}
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

      {children ? <div className="lg:col-span-6">{children}</div> : null}
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
      : isRecord(payload) && Array.isArray(payload.navigation)
        ? payload.navigation
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
