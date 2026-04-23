"use client";

import { useEffect, useMemo, useState } from "react";
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
};

type MediaFolder = {
  id: string;
  name: string;
  parentId?: string;
};

export function MediaLibrary() {
  const [viewMode, setViewMode] = useState<ViewMode>("grid");
  const [currentFolder, setCurrentFolder] = useState<string | undefined>();
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedItems, setSelectedItems] = useState<string[]>([]);
  const [media, setMedia] = useState<MediaItem[]>([]);
  const [folders, setFolders] = useState<MediaFolder[]>([]);
  const [loadingMedia, setLoadingMedia] = useState(true);
  const [loadingFolders, setLoadingFolders] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);

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

  useEffect(() => {
    void fetchFolders();
  }, []);

  useEffect(() => {
    void fetchMedia();
  }, [currentFolder, searchQuery]);

  async function fetchFolders() {
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
  }

  async function fetchMedia() {
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
  }

  async function handleBulkDelete() {
    if (selectedItems.length === 0) {
      return;
    }

    try {
      const results = await Promise.all(
        selectedItems.map((id) => nxFetch(`/api/media/${id}`, { method: "DELETE" })),
      );

      if (results.some((response) => !response.ok)) {
        setError("Some items could not be deleted.");
      }

      await fetchMedia();
    } catch {
      setError("Unable to delete selected media.");
    }
  }

  function toggleSelected(id: string) {
    setSelectedItems((current) =>
      current.includes(id)
        ? current.filter((item) => item !== id)
        : [...current, id],
    );
  }

  const rootFolders = useMemo(
    () => folders.filter((folder) => !folder.parentId),
    [folders],
  );

  return (
    <div className="grid gap-6 lg:grid-cols-[260px_minmax(0,1fr)]">
      <Card className="h-fit border-border/70 bg-card/80 shadow-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FolderOpen className="h-4 w-4" />
            Folders
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ScrollArea className="h-[540px] pr-4">
            <div className="space-y-2">
              <SidebarButton
                active={!currentFolder}
                label="All media"
                onClick={() => setCurrentFolder(undefined)}
              />
              {loadingFolders ? (
                Array.from({ length: 6 }).map((_, index) => (
                  <div
                    key={`folder-skeleton-${index}`}
                    className="h-9 animate-pulse rounded-lg bg-muted"
                  />
                ))
              ) : (
                rootFolders.map((folder) => (
                  <FolderTree
                    key={folder.id}
                    activeId={currentFolder}
                    folders={folders}
                    folder={folder}
                    onSelect={setCurrentFolder}
                  />
                ))
              )}
            </div>
          </ScrollArea>
        </CardContent>
      </Card>

      <div className="space-y-6">
        <Card className="border-border/70 bg-card/80 shadow-sm">
          <CardContent className="flex flex-col gap-4 p-6">
            <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
              <div className="space-y-2">
                <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                  <button
                    type="button"
                    className="transition-colors hover:text-foreground"
                    onClick={() => setCurrentFolder(undefined)}
                  >
                    Media
                  </button>
                  {breadcrumbs.map((folder) => (
                    <div key={folder.id} className="flex items-center gap-2">
                      <span>/</span>
                      <button
                        type="button"
                        className="transition-colors hover:text-foreground"
                        onClick={() => setCurrentFolder(folder.id)}
                      >
                        {folder.name}
                      </button>
                    </div>
                  ))}
                </div>
                <div>
                  <h1 className="text-2xl font-semibold tracking-tight text-foreground">
                    Media Library
                  </h1>
                  <p className="text-sm text-muted-foreground">
                    Browse assets, search across files, and manage folders without leaving the admin.
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <div className="relative min-w-[220px] flex-1 xl:w-[280px] xl:flex-none">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={searchQuery}
                    onChange={(event) => setSearchQuery(event.target.value)}
                    placeholder="Search media"
                    className="pl-9"
                  />
                </div>

                <div className="flex items-center rounded-lg border border-border/70 bg-background p-1">
                  <button
                    type="button"
                    className={cn(
                      "rounded-md px-3 py-2 text-sm transition-colors",
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
                    className={cn(
                      "rounded-md px-3 py-2 text-sm transition-colors",
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
                    <Button>
                      <Upload className="mr-2 h-4 w-4" />
                      Upload
                    </Button>
                  </DialogTrigger>
                  <DialogContent className="max-w-3xl">
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

            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border/70 bg-muted/20 px-4 py-3 text-sm">
              <div className="text-muted-foreground">
                {selectedItems.length > 0
                  ? `${selectedItems.length} item${selectedItems.length === 1 ? "" : "s"} selected`
                  : `${media.length} item${media.length === 1 ? "" : "s"} shown`}
              </div>
              <Button
                variant="outline"
                onClick={() => void handleBulkDelete()}
                disabled={selectedItems.length === 0}
              >
                <Trash2 className="mr-2 h-4 w-4" />
                Delete selected
              </Button>
            </div>

            {error ? (
              <div className="rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
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
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 8 }).map((_, index) => (
          <div
            key={`media-grid-skeleton-${index}`}
            className="overflow-hidden rounded-2xl border border-border/70"
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
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {items.map((item) => {
        const checked = selectedItems.includes(item.id);

        return (
          <label
            key={item.id}
            className={cn(
              "group block cursor-pointer overflow-hidden rounded-2xl border bg-background/80 transition-all",
              checked
                ? "border-primary shadow-[0_0_0_1px_rgba(0,0,0,0.04)]"
                : "border-border/70 hover:border-border",
            )}
          >
            <div className="relative aspect-square overflow-hidden bg-muted/40">
              <input
                type="checkbox"
                checked={checked}
                onChange={() => onToggle(item.id)}
                className="absolute left-3 top-3 z-10 h-4 w-4 rounded border-border"
              />
              <div className="absolute right-3 top-3 z-10 rounded-full border border-border/70 bg-background/80 p-1 text-muted-foreground">
                <MoreVertical className="h-4 w-4" />
              </div>
              <MediaThumb item={item} />
            </div>
            <div className="space-y-1 p-4">
              <p className="truncate font-medium text-foreground">{item.filename}</p>
              <p className="text-sm text-muted-foreground">{formatBytes(item.size)}</p>
            </div>
          </label>
        );
      })}
    </div>
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
      <div className="overflow-hidden rounded-2xl border border-border/70">
        {Array.from({ length: 6 }).map((_, index) => (
          <div
            key={`media-list-skeleton-${index}`}
            className="grid grid-cols-[36px_72px_1.3fr_0.8fr_0.8fr_0.9fr] gap-4 border-b border-border/70 px-4 py-4 last:border-b-0"
          >
            {Array.from({ length: 6 }).map((__, cellIndex) => (
              <div
                key={`media-list-skeleton-${index}-${cellIndex}`}
                className="h-4 animate-pulse rounded bg-muted"
              />
            ))}
          </div>
        ))}
      </div>
    );
  }

  if (items.length === 0) {
    return <EmptyState message="No media files matched your current filters." />;
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-border/70">
      <div className="grid grid-cols-[36px_72px_1.3fr_0.8fr_0.8fr_0.9fr] gap-4 border-b border-border/70 bg-muted/35 px-4 py-3 text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
        <span />
        <span>Thumbnail</span>
        <span>Filename</span>
        <span>Type</span>
        <span>Size</span>
        <span>Date</span>
      </div>
      <div className="divide-y divide-border/70">
        {items.map((item) => (
          <div
            key={item.id}
            className="grid grid-cols-[36px_72px_1.3fr_0.8fr_0.8fr_0.9fr] gap-4 px-4 py-4 text-sm"
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
              <span className="truncate">{item.filename}</span>
            </div>
            <div className="flex items-center text-muted-foreground">{item.type || "file"}</div>
            <div className="flex items-center text-muted-foreground">{formatBytes(item.size)}</div>
            <div className="flex items-center text-muted-foreground">
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
    <div className="rounded-2xl border border-dashed border-border/70 px-6 py-12 text-center text-sm text-muted-foreground">
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
        "flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm transition-colors",
        active
          ? "bg-foreground text-background"
          : "text-muted-foreground hover:bg-muted hover:text-foreground",
      )}
      onClick={onClick}
    >
      <FolderOpen className="h-4 w-4" />
      <span className="truncate">{label}</span>
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
    <div className="space-y-1">
      <button
        type="button"
        className={cn(
          "flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm transition-colors",
          activeId === folder.id
            ? "bg-foreground text-background"
            : "text-muted-foreground hover:bg-muted hover:text-foreground",
        )}
        style={{ paddingLeft: `${depth * 14 + 12}px` }}
        onClick={() => onSelect(folder.id)}
      >
        <FolderOpen className="h-4 w-4" />
        <span className="truncate">{folder.name}</span>
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
    createdAt: getString(
      record,
      "createdAt",
      getString(record, "date", new Date().toISOString()),
    ),
    url: getOptionalString(record, "url") ?? getOptionalString(record, "src"),
    thumbnailUrl:
      getOptionalString(record, "thumbnailUrl") ??
      getOptionalString(record, "thumbnail") ??
      getOptionalString(record, "url"),
    folderId: getOptionalString(record, "folderId"),
  };
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
