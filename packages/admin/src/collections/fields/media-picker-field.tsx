import { useEffect, useMemo, useState } from "react";
import { isNpMediaApiItem, type NpMediaApiItem } from "@nexpress/core/media-contract";

import { Button } from "../../ui/button.js";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../ui/dialog.js";

interface MediaPickerFieldProps {
  value: string;
  onChange: (value: string) => void;
  relationTo: string;
}

const getMediaLabel = (doc: NpMediaApiItem): string => doc.filename || doc.alt || doc.id;

export function MediaPickerField({ value, onChange, relationTo }: MediaPickerFieldProps) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<NpMediaApiItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }

    const fetchMedia = async () => {
      setIsLoading(true);
      setError(null);

      try {
        const response = await fetch("/api/media?limit=20");

        if (!response.ok) {
          throw new Error("Failed to load media.");
        }

        const payload = (await response.json()) as unknown;
        if (
          typeof payload !== "object" ||
          payload === null ||
          !("docs" in payload) ||
          !Array.isArray(payload.docs) ||
          !payload.docs.every(isNpMediaApiItem)
        ) {
          throw new Error("Media API returned an invalid contract.");
        }
        setItems(payload.docs);
      } catch (fetchError) {
        setError(fetchError instanceof Error ? fetchError.message : "Failed to load media.");
      } finally {
        setIsLoading(false);
      }
    };

    void fetchMedia();
  }, [open]);

  const selectedItem = useMemo(() => items.find((item) => item.id === value), [items, value]);

  return (
    <div
      className="min-w-0 space-y-3 rounded-xl border border-border/60 p-3 sm:p-4"
      data-np-media-picker-field={relationTo}
    >
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-foreground">
            {selectedItem ? getMediaLabel(selectedItem) : "No media selected"}
          </p>
          <p className="break-all text-xs text-muted-foreground">Source: {relationTo}</p>
        </div>
        <Button
          type="button"
          variant="outline"
          className="w-full sm:w-auto"
          onClick={() => setOpen(true)}
        >
          Select
        </Button>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="min-w-0 max-w-3xl" data-np-media-picker-dialog>
          <DialogHeader className="min-w-0">
            <DialogTitle className="break-words">Select media</DialogTitle>
            <DialogDescription className="break-words">
              Choose an uploaded asset to attach to this field.
            </DialogDescription>
          </DialogHeader>

          {isLoading ? <p className="text-sm text-muted-foreground">Loading media…</p> : null}
          {error ? <p className="text-sm text-rose-600 dark:text-rose-300">{error}</p> : null}

          <div className="grid min-w-0 max-h-[min(28rem,48dvh)] grid-cols-1 gap-3 overflow-y-auto pr-1 sm:grid-cols-2 lg:grid-cols-3">
            {items.map((item) => (
              <button
                key={item.id}
                type="button"
                className="min-w-0 rounded-xl border border-border/60 p-3 text-left transition-colors hover:bg-muted/40 sm:p-4"
                onClick={() => {
                  onChange(item.id);
                  setOpen(false);
                }}
              >
                <p className="break-words font-medium text-foreground">{getMediaLabel(item)}</p>
                <p className="mt-2 break-all text-xs text-muted-foreground">ID: {item.id}</p>
              </button>
            ))}
          </div>

          <DialogFooter className="min-w-0 gap-2">
            <Button
              type="button"
              variant="outline"
              className="w-full sm:w-auto"
              onClick={() => onChange("")}
            >
              Clear
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
