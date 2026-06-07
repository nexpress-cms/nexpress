"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  File,
  FolderOpen,
  Grid,
  Image as ImageIcon,
  List,
  MoreVertical,
  Search,
  Trash2,
  Upload,
} from "lucide-react";

import { npFetch } from "../lib/api-client.js";
import { Button } from "../ui/button.js";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card.js";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "../ui/dialog.js";
import { Input } from "../ui/input.js";
import { ScrollArea } from "../ui/scroll-area.js";
import { cn } from "../ui/utils.js";
import { MediaUploadZone } from "./media-upload-zone.js";

type ViewMode = "grid" | "list";

type MediaItem = {
  id: string;
  filename: string;
  type: string;
  size: number;
  createdAt: string;
  url?: string;
  thumbnailUrl?: string;
  folderId?: string;
  /**
   * Resolved uploader info (Phase 9.7k). Server-side `listMedia`
   * LEFT JOINs `np_users` and `np_members` so we don't have to do
   * a follow-up lookup per row. `null` for system / plugin
   * uploads where neither column was set.
   */
  uploader?: MediaUploader | null;
};

type MediaUploader =
  | { kind: "staff"; name: string | null; email: string | null }
  | { kind: "member"; handle: string; displayName: string | null };

type UploaderFilter = "all" | "staff" | "member";

type MediaFolder = {
  id: string;
  name: string;
  parentId?: string;
};

export function MediaLibrary() {
  const [viewMode, setViewMode] = useState<ViewMode>("grid");
  const [currentFolder, setCurrentFolder] = useState<string | undefined>();
  const [searchQuery, setSearchQuery] = useState("");
  const [uploaderFilter, setUploaderFilter] = useState<UploaderFilter>("all");
  const [selectedItems, setSelectedItems] = useState<string[]>([]);
  const [media, setMedia] = useState<MediaItem[]>([]);
  const [folders, setFolders] = useState<MediaFolder[]>([]);
  const [loadingMedia, setLoadingMedia] = useState(true);
  const [loadingFolders, setLoadingFolders] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false);

  const breadcrumbs = useMemo(() => {
    if (!currentFolder) {
      return [];
    }

    const chain: MediaFolder[] = [];
    let cursor = folders.find((folder) => folder.id === currentFolder);

    while (cursor) {
      chain.unshift(cursor);
      cursor = cursor.parentId
        ? folders.find((folder) => folder.id === cursor?.parentId)
        : undefined;
    }

    return chain;
  }, [currentFolder, folders]);

  const fetchFolders = useCallback(async () => {
    setLoadingFolders(true);

    try {
      const response = await fetch("/api/media/folders");
      const payload = (await response.json().catch(() => null)) as unknown;

      if (!response.ok) {
        setError(getErrorMessage(payload, "Unable to load folders."));
        return;
      }

      setFolders(normalizeFolders(payload));
    } catch {
      setError("Unable to load folders.");
    } finally {
      setLoadingFolders(false);
    }
  }, []);

  const fetchMedia = useCallback(async () => {
    setLoadingMedia(true);
    setError(null);

    try {
      const params = new URLSearchParams({ page: "1", limit: "24" });

      if (currentFolder) {
        params.set("folderId", currentFolder);
      }

      if (searchQuery.trim()) {
        params.set("search", searchQuery.trim());
      }

      if (uploaderFilter !== "all") {
        params.set("uploaderKind", uploaderFilter);
      }

      const response = await fetch(`/api/media?${params.toString()}`);
      const payload = (await response.json().catch(() => null)) as unknown;

      if (!response.ok) {
        setError(getErrorMessage(payload, "Unable to load media."));
        return;
      }

      setMedia(normalizeMedia(payload));
      setSelectedItems([]);
    } catch {
      setError("Unable to load media.");
    } finally {
      setLoadingMedia(false);
    }
  }, [currentFolder, searchQuery, uploaderFilter]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      void fetchFolders();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [fetchFolders]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      void fetchMedia();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [fetchMedia]);

  async function handleBulkDelete() {
    if (selectedItems.length === 0) {
      return;
    }

    try {
      const results = await Promise.all(
        selectedItems.map((id) => npFetch(`/api/media/${id}`, { method: "DELETE" })),
      );

      if (results.some((response) => !response.ok)) {
        setError("Some items could not be deleted.");
      }

      await fetchMedia();
      setConfirmBulkDelete(false);
    } catch {
      setError("Unable to delete selected media.");
    }
  }

  function toggleSelected(id: string) {
    setSelectedItems((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id],
    );
  }

  const rootFolders = useMemo(() => folders.filter((folder) => !folder.parentId), [folders]);

  return (
    <div className="grid min-w-0 gap-6 lg:grid-cols-[minmax(0,260px)_minmax(0,1fr)]">
      <Card className="h-fit min-w-0">
        <CardHeader>
          <CardTitle className="flex min-w-0 items-center gap-2">
            <FolderOpen className="h-4 w-4 shrink-0" />
            <span className="min-w-0 break-words">Folders</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="min-w-0">
          <ScrollArea className="h-auto max-h-64 pr-4 lg:h-[540px] lg:max-h-none">
            <div className="space-y-2">
              <SidebarButton
                active={!currentFolder}
                label="All media"
                onClick={() => setCurrentFolder(undefined)}
              />
              {loadingFolders
                ? Array.from({ length: 6 }).map((_, index) => (
                    <div
                      key={`folder-skeleton-${index}`}
                      className="h-9 animate-pulse rounded-lg bg-muted"
                    />
                  ))
                : rootFolders.map((folder) => (
                    <FolderTree
                      key={folder.id}
                      activeId={currentFolder}
                      folders={folders}
                      folder={folder}
                      onSelect={setCurrentFolder}
                    />
                  ))}
            </div>
          </ScrollArea>
        </CardContent>
      </Card>

      <div className="min-w-0 space-y-6">
        <Card className="min-w-0">
          <CardContent className="flex min-w-0 flex-col gap-4 p-6">
            <div className="flex min-w-0 flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
              <div className="min-w-0 space-y-2">
                <div className="flex min-w-0 flex-wrap items-center gap-2 text-sm text-muted-foreground">
                  <button
                    type="button"
                    className="min-h-10 break-words transition-colors hover:text-foreground lg:min-h-0"
                    onClick={() => setCurrentFolder(undefined)}
                  >
                    Media
                  </button>
                  {breadcrumbs.map((folder) => (
                    <div key={folder.id} className="flex min-w-0 items-center gap-2">
                      <span className="shrink-0">/</span>
                      <button
                        type="button"
                        className="min-h-10 min-w-0 break-all transition-colors hover:text-foreground lg:min-h-0"
                        onClick={() => setCurrentFolder(folder.id)}
                      >
                        {folder.name}
                      </button>
                    </div>
                  ))}
                </div>
                <div>
                  <h1 className="break-words text-[22px] font-semibold tracking-[-0.02em] text-neutral-950 dark:text-neutral-50">
                    Media
                  </h1>
                  <p className="mt-1 break-words text-[13.5px] text-neutral-500 dark:text-neutral-400">
                    Browse assets, search across files, and manage folders without leaving the
                    admin.
                  </p>
                </div>
              </div>

              <div className="grid min-w-0 gap-3 sm:grid-cols-[minmax(0,1fr)_auto] xl:flex xl:flex-wrap xl:items-center">
                <div className="relative min-w-0 xl:w-[280px] xl:flex-none">
                  <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-neutral-400" />
                  <Input
                    value={searchQuery}
                    onChange={(event) => setSearchQuery(event.target.value)}
                    placeholder="Search media"
                    className="pl-8"
                  />
                </div>

                {/*
                  Phase 9.7k uploader filter. Three-state segmented
                  control instead of a select to keep it inline with
                  the existing view-mode toggle below.
                */}
                <div className="flex min-w-0 w-full items-center rounded-lg border border-border/70 bg-background p-1 text-sm sm:w-auto">
                  {(
                    [
                      { value: "all", label: "All" },
                      { value: "staff", label: "Staff" },
                      { value: "member", label: "Members" },
                    ] as const
                  ).map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      className={cn(
                        "min-h-10 min-w-0 flex-1 rounded-md px-3 py-2.5 transition-colors sm:min-h-0 sm:flex-none sm:py-2",
                        uploaderFilter === option.value
                          ? "bg-foreground text-background"
                          : "text-muted-foreground hover:text-foreground",
                      )}
                      onClick={() => setUploaderFilter(option.value)}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>

                <div className="flex min-w-0 w-full items-center rounded-lg border border-border/70 bg-background p-1 sm:w-auto">
                  <button
                    type="button"
                    aria-label="Grid view"
                    aria-pressed={viewMode === "grid"}
                    className={cn(
                      "min-h-10 flex-1 rounded-md px-3 py-2.5 text-sm transition-colors sm:min-h-0 sm:flex-none sm:py-2",
                      viewMode === "grid"
                        ? "bg-foreground text-background"
                        : "text-muted-foreground",
                    )}
                    onClick={() => setViewMode("grid")}
                  >
                    <Grid className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    aria-label="List view"
                    aria-pressed={viewMode === "list"}
                    className={cn(
                      "min-h-10 flex-1 rounded-md px-3 py-2.5 text-sm transition-colors sm:min-h-0 sm:flex-none sm:py-2",
                      viewMode === "list"
                        ? "bg-foreground text-background"
                        : "text-muted-foreground",
                    )}
                    onClick={() => setViewMode("list")}
                  >
                    <List className="h-4 w-4" />
                  </button>
                </div>

                <Dialog open={uploadOpen} onOpenChange={setUploadOpen}>
                  <DialogTrigger asChild>
                    <Button className="w-full sm:w-auto">
                      <Upload className="size-3.5" />
                      Upload
                    </Button>
                  </DialogTrigger>
                  <DialogContent data-np-media-upload-dialog className="min-w-0 max-w-3xl">
                    <DialogHeader>
                      <DialogTitle className="break-words">Upload media</DialogTitle>
                      <DialogDescription className="break-words">
                        Add images, videos, or documents to the current media folder.
                      </DialogDescription>
                    </DialogHeader>
                    <MediaUploadZone
                      folderId={currentFolder}
                      onUploadComplete={() => {
                        void fetchMedia();
                        setUploadOpen(false);
                      }}
                      onClose={() => setUploadOpen(false)}
                    />
                  </DialogContent>
                </Dialog>
              </div>
            </div>

            <div className="grid min-w-0 gap-3 rounded-xl border border-border/70 bg-muted/20 px-4 py-3 text-sm sm:flex sm:items-center sm:justify-between">
              <div className="min-w-0 break-words text-muted-foreground">
                {selectedItems.length > 0
                  ? `${selectedItems.length} item${selectedItems.length === 1 ? "" : "s"} selected`
                  : `${media.length} item${media.length === 1 ? "" : "s"} shown`}
              </div>
              <Button
                variant="outline"
                className="w-full sm:w-auto"
                onClick={() => setConfirmBulkDelete(true)}
                disabled={selectedItems.length === 0}
              >
                <Trash2 className="size-3.5" />
                Delete selected
              </Button>
            </div>

            {error ? (
              <div className="break-words rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
                {error}
              </div>
            ) : null}

            {viewMode === "grid" ? (
              <GridView
                items={media}
                loading={loadingMedia}
                selectedItems={selectedItems}
                onToggle={toggleSelected}
              />
            ) : (
              <ListView
                items={media}
                loading={loadingMedia}
                selectedItems={selectedItems}
                onToggle={toggleSelected}
              />
            )}
          </CardContent>
        </Card>
      </div>

      <Dialog open={confirmBulkDelete} onOpenChange={setConfirmBulkDelete}>
        <DialogContent data-np-media-delete-dialog className="min-w-0">
          <DialogHeader>
            <DialogTitle className="break-words">
              Delete {selectedItems.length} media item{selectedItems.length === 1 ? "" : "s"}?
            </DialogTitle>
            <DialogDescription className="break-words">
              This permanently removes the selected files from the media library.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button
              type="button"
              variant="outline"
              className="w-full sm:w-auto"
              onClick={() => setConfirmBulkDelete(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="outline"
              className="w-full text-rose-600 dark:text-rose-300 sm:w-auto"
              onClick={() => void handleBulkDelete()}
              disabled={selectedItems.length === 0}
            >
              <Trash2 className="size-3.5" />
              Delete {selectedItems.length}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function GridView({
  items,
  loading,
  selectedItems,
  onToggle,
}: {
  items: MediaItem[];
  loading: boolean;
  selectedItems: string[];
  onToggle: (id: string) => void;
}) {
  if (loading) {
    return (
      <div className="grid min-w-0 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 8 }).map((_, index) => (
          <div
            key={`media-grid-skeleton-${index}`}
            className="overflow-hidden rounded-xl border border-border/70"
          >
            <div className="aspect-square animate-pulse bg-muted" />
            <div className="space-y-2 p-4">
              <div className="h-4 animate-pulse rounded bg-muted" />
              <div className="h-3 w-2/3 animate-pulse rounded bg-muted" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (items.length === 0) {
    return <EmptyState message="No media files matched your current filters." />;
  }

  return (
    <div className="grid min-w-0 gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {items.map((item) => {
        const checked = selectedItems.includes(item.id);

        return (
          <article
            key={item.id}
            data-np-media-grid-card
            className={cn(
              "group block min-w-0 overflow-hidden rounded-xl border bg-background/80 transition-all",
              checked
                ? "border-primary shadow-[0_0_0_1px_rgba(0,0,0,0.04)]"
                : "border-border/70 hover:border-border",
            )}
          >
            <div className="relative aspect-square overflow-hidden bg-muted/40">
              <label
                data-np-media-select-target
                className="absolute left-2 top-2 z-10 inline-flex size-10 cursor-pointer items-center justify-center rounded-lg bg-background/85 shadow-sm ring-1 ring-border/70"
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => onToggle(item.id)}
                  aria-label={`Select ${item.filename}`}
                  className="size-5 cursor-pointer rounded border-border accent-primary"
                />
              </label>
              <div className="absolute right-3 top-3 z-10 rounded-full border border-border/70 bg-background/80 p-1 text-muted-foreground">
                <MoreVertical className="h-4 w-4" />
              </div>
              <MediaThumb item={item} />
            </div>
            <div className="min-w-0 space-y-1 p-4">
              <p className="break-words font-medium text-foreground">{item.filename}</p>
              <p className="break-words text-sm text-muted-foreground">{formatBytes(item.size)}</p>
              {item.uploader ? <UploaderBadge uploader={item.uploader} /> : null}
            </div>
          </article>
        );
      })}
    </div>
  );
}

function UploaderBadge({ uploader }: { uploader: MediaUploader }) {
  if (uploader.kind === "member") {
    return (
      <p className="text-xs text-muted-foreground">
        <span className="inline-block max-w-full break-all rounded-full bg-amber-500/15 px-2 py-0.5 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200">
          @{uploader.handle}
        </span>
      </p>
    );
  }
  return (
    <p className="text-xs text-muted-foreground">
      <span className="inline-block max-w-full break-all rounded-full bg-muted px-2 py-0.5">
        {uploader.name ?? uploader.email ?? "staff"}
      </span>
    </p>
  );
}

function ListView({
  items,
  loading,
  selectedItems,
  onToggle,
}: {
  items: MediaItem[];
  loading: boolean;
  selectedItems: string[];
  onToggle: (id: string) => void;
}) {
  if (loading) {
    return (
      <>
        <div className="space-y-3 md:hidden">
          {Array.from({ length: 4 }).map((_, index) => (
            <div
              key={`media-list-card-skeleton-${index}`}
              className="h-24 animate-pulse rounded-xl border border-border/70 bg-muted/20"
            />
          ))}
        </div>

        <div className="hidden overflow-x-auto rounded-xl border border-border/70 md:block">
          {Array.from({ length: 6 }).map((_, index) => (
            <div
              key={`media-list-skeleton-${index}`}
              className="grid min-w-[760px] grid-cols-[36px_72px_1.3fr_0.8fr_0.8fr_1fr_0.9fr] gap-4 border-b border-border/70 px-4 py-4 last:border-b-0"
            >
              {Array.from({ length: 7 }).map((__, cellIndex) => (
                <div
                  key={`media-list-skeleton-${index}-${cellIndex}`}
                  className="h-4 animate-pulse rounded bg-muted"
                />
              ))}
            </div>
          ))}
        </div>
      </>
    );
  }

  if (items.length === 0) {
    return <EmptyState message="No media files matched your current filters." />;
  }

  return (
    <>
      <div className="space-y-3 md:hidden">
        {items.map((item) => (
          <article
            key={item.id}
            data-np-media-list-card
            className={cn(
              "grid min-w-0 grid-cols-[auto_56px_minmax(0,1fr)] gap-3 rounded-xl border bg-background/80 p-3 transition-all",
              selectedItems.includes(item.id)
                ? "border-primary shadow-[0_0_0_1px_rgba(0,0,0,0.04)]"
                : "border-border/70",
            )}
          >
            <label
              data-np-media-select-target
              className="-ml-2 -mt-2 inline-flex size-10 cursor-pointer items-center justify-center"
            >
              <input
                type="checkbox"
                checked={selectedItems.includes(item.id)}
                onChange={() => onToggle(item.id)}
                aria-label={`Select ${item.filename}`}
                className="size-5 cursor-pointer rounded border-border accent-primary"
              />
            </label>
            <div className="h-14 w-14 overflow-hidden rounded-xl bg-muted/40">
              <MediaThumb item={item} compact />
            </div>
            <div className="min-w-0 space-y-1">
              <p className="break-words font-medium text-foreground">{item.filename}</p>
              <p className="break-all text-xs text-muted-foreground">
                {item.type || "file"} / {formatBytes(item.size)}
              </p>
              <div className="flex min-w-0 flex-wrap items-center gap-2 text-xs text-muted-foreground">
                {item.uploader ? (
                  <UploaderBadge uploader={item.uploader} />
                ) : (
                  <span className="italic">system</span>
                )}
                <span className="break-words">{formatDate(item.createdAt)}</span>
              </div>
            </div>
          </article>
        ))}
      </div>

      <DesktopListTable items={items} selectedItems={selectedItems} onToggle={onToggle} />
    </>
  );
}

function DesktopListTable({
  items,
  selectedItems,
  onToggle,
}: {
  items: MediaItem[];
  selectedItems: string[];
  onToggle: (id: string) => void;
}) {
  return (
    <div className="hidden overflow-x-auto rounded-xl border border-border/70 md:block">
      <div className="grid min-w-[760px] grid-cols-[36px_72px_1.3fr_0.8fr_0.8fr_1fr_0.9fr] gap-4 border-b border-border/70 bg-muted/35 px-4 py-3 text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
        <span />
        <span>Thumbnail</span>
        <span>Filename</span>
        <span>Type</span>
        <span>Size</span>
        <span>Uploader</span>
        <span>Date</span>
      </div>
      <div className="divide-y divide-border/70">
        {items.map((item) => (
          <div
            key={item.id}
            className="grid min-w-[760px] grid-cols-[36px_72px_1.3fr_0.8fr_0.8fr_1fr_0.9fr] gap-4 px-4 py-4 text-sm"
          >
            <div className="flex items-center">
              <input
                type="checkbox"
                checked={selectedItems.includes(item.id)}
                onChange={() => onToggle(item.id)}
                className="h-4 w-4 rounded border-border"
              />
            </div>
            <div className="flex items-center">
              <div className="h-12 w-12 overflow-hidden rounded-xl bg-muted/40">
                <MediaThumb item={item} compact />
              </div>
            </div>
            <div className="flex min-w-0 items-center font-medium text-foreground">
              <span className="break-words">{item.filename}</span>
            </div>
            <div className="flex min-w-0 items-center break-all text-muted-foreground">
              {item.type || "file"}
            </div>
            <div className="flex min-w-0 items-center break-words text-muted-foreground">
              {formatBytes(item.size)}
            </div>
            <div className="flex min-w-0 items-center text-muted-foreground">
              {item.uploader ? (
                <UploaderBadge uploader={item.uploader} />
              ) : (
                <span className="text-xs italic">system</span>
              )}
            </div>
            <div className="flex min-w-0 items-center break-words text-muted-foreground">
              {formatDate(item.createdAt)}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function MediaThumb({ item, compact = false }: { item: MediaItem; compact?: boolean }) {
  const source = item.thumbnailUrl ?? item.url;
  const isImage = item.type.toLowerCase().startsWith("image");

  if (source && isImage) {
    return (
      <img
        src={source}
        alt={item.filename}
        className={cn(
          "h-full w-full object-cover",
          compact ? "" : "transition-transform duration-200 group-hover:scale-[1.03]",
        )}
      />
    );
  }

  return (
    <div className="flex h-full w-full items-center justify-center text-muted-foreground">
      {isImage ? <ImageIcon className="h-8 w-8" /> : <File className="h-8 w-8" />}
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="break-words rounded-xl border border-dashed border-border/70 px-6 py-12 text-center text-sm text-muted-foreground">
      {message}
    </div>
  );
}

function SidebarButton({
  active,
  label,
  onClick,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={cn(
        "flex min-h-10 min-w-0 w-full items-center gap-2 rounded-lg px-3 py-2.5 text-left text-sm transition-colors sm:min-h-0 sm:py-2",
        active
          ? "bg-foreground text-background"
          : "text-muted-foreground hover:bg-muted hover:text-foreground",
      )}
      onClick={onClick}
    >
      <FolderOpen className="h-4 w-4 shrink-0" />
      <span className="min-w-0 break-words">{label}</span>
    </button>
  );
}

function FolderTree({
  activeId,
  folders,
  folder,
  onSelect,
  depth = 0,
}: {
  activeId?: string;
  folders: MediaFolder[];
  folder: MediaFolder;
  onSelect: (id: string) => void;
  depth?: number;
}) {
  const children = folders.filter((item) => item.parentId === folder.id);

  return (
    <div className="min-w-0 space-y-1">
      <button
        type="button"
        className={cn(
          "flex min-h-10 min-w-0 w-full items-center gap-2 rounded-lg px-3 py-2.5 text-left text-sm transition-colors sm:min-h-0 sm:py-2",
          activeId === folder.id
            ? "bg-foreground text-background"
            : "text-muted-foreground hover:bg-muted hover:text-foreground",
        )}
        style={{ paddingLeft: `${depth * 14 + 12}px` }}
        onClick={() => onSelect(folder.id)}
      >
        <FolderOpen className="h-4 w-4 shrink-0" />
        <span className="min-w-0 break-words">{folder.name}</span>
      </button>
      {children.length > 0 ? (
        <div className="space-y-1">
          {children.map((child) => (
            <FolderTree
              key={child.id}
              activeId={activeId}
              folders={folders}
              folder={child}
              onSelect={onSelect}
              depth={depth + 1}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function normalizeMedia(payload: unknown): MediaItem[] {
  const source = getArrayFromPayload(payload, ["docs", "items", "media"]);
  return source.map((entry, index) => normalizeMediaItem(entry, index));
}

function normalizeFolders(payload: unknown): MediaFolder[] {
  const source = getArrayFromPayload(payload, ["docs", "items", "folders"]);
  return source.map((entry, index) => {
    const record = isRecord(entry) ? entry : {};
    return {
      id: getString(record, "id", getString(record, "_id", `folder-${index}`)),
      name: getString(record, "name", getString(record, "label", "Untitled folder")),
      parentId: getOptionalString(record, "parentId"),
    };
  });
}

function normalizeMediaItem(entry: unknown, index: number): MediaItem {
  const record = isRecord(entry) ? entry : {};
  const type = getString(record, "mimeType", getString(record, "type", "file"));

  return {
    id: getString(record, "id", getString(record, "_id", `media-${index}`)),
    filename: getString(record, "filename", getString(record, "name", "Untitled file")),
    type,
    size: getNumber(record, "size", 0),
    createdAt: getString(record, "createdAt", getString(record, "date", new Date().toISOString())),
    url: getOptionalString(record, "url") ?? getOptionalString(record, "src"),
    thumbnailUrl:
      getOptionalString(record, "thumbnailUrl") ??
      getOptionalString(record, "thumbnail") ??
      getOptionalString(record, "url"),
    folderId: getOptionalString(record, "folderId"),
    uploader: normalizeUploader(record.uploader),
  };
}

function normalizeUploader(value: unknown): MediaUploader | null {
  if (!isRecord(value)) return null;
  const kind = getOptionalString(value, "kind");
  if (kind === "staff") {
    return {
      kind: "staff",
      name: getOptionalString(value, "name") ?? null,
      email: getOptionalString(value, "email") ?? null,
    };
  }
  if (kind === "member") {
    const handle = getOptionalString(value, "handle");
    if (!handle) return null;
    return {
      kind: "member",
      handle,
      displayName: getOptionalString(value, "displayName") ?? null,
    };
  }
  return null;
}

function getArrayFromPayload(payload: unknown, keys: string[]) {
  if (Array.isArray(payload)) {
    return payload;
  }

  if (!isRecord(payload)) {
    return [];
  }

  for (const key of keys) {
    const value = payload[key];

    if (Array.isArray(value)) {
      return value;
    }
  }

  return [];
}

function getErrorMessage(payload: unknown, fallback: string) {
  if (isRecord(payload) && typeof payload.error === "string") {
    return payload.error;
  }

  return fallback;
}

function getString(record: Record<string, unknown>, key: string, fallback = "") {
  const value = record[key];
  return typeof value === "string" ? value : fallback;
}

function getOptionalString(record: Record<string, unknown>, key: string) {
  const value = record[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function getNumber(record: Record<string, unknown>, key: string, fallback = 0) {
  const value = record[key];
  return typeof value === "number" ? value : fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function formatBytes(size: number) {
  if (size <= 0) {
    return "0 B";
  }

  const units = ["B", "KB", "MB", "GB"];
  const unitIndex = Math.min(Math.floor(Math.log(size) / Math.log(1024)), units.length - 1);
  const value = size / 1024 ** unitIndex;

  return `${value.toFixed(value >= 10 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

function formatDate(value: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("en", { dateStyle: "medium" }).format(date);
}
