import { useEffect, useMemo, useState } from "react";
import type { NxFindResult } from "@nexpress/core";

import { Button } from "../../ui/button.js";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../../ui/dialog.js";

interface MediaDocument extends Record<string, unknown> {
  id: string;
}

interface MediaPickerFieldProps {
  value: string;
  onChange: (value: string) => void;
  relationTo: string;
}

const getMediaLabel = (doc: Record<string, unknown> & { id?: string }): string => {
  const label = doc.filename ?? doc.alt ?? doc.title ?? doc.id;
  return typeof label === "string" ? label : (doc.id ?? "Untitled media");
};

export function MediaPickerField({ value, onChange, relationTo }: MediaPickerFieldProps) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<MediaDocument[]>([]);
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

        const payload = (await response.json()) as NxFindResult<MediaDocument>;
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
    <div className="space-y-3 rounded-xl border border-border/60 p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-foreground">{selectedItem ? getMediaLabel(selectedItem) : "No media selected"}</p>
          <p className="text-xs text-muted-foreground">Source: {relationTo}</p>
        </div>
        <Button type="button" variant="outline" onClick={() => setOpen(true)}>
          Select
        </Button>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Select media</DialogTitle>
            <DialogDescription>Choose an uploaded asset to attach to this field.</DialogDescription>
          </DialogHeader>

          {isLoading ? <p className="text-sm text-muted-foreground">Loading media…</p> : null}
          {error ? <p className="text-sm text-rose-600 dark:text-rose-300">{error}</p> : null}

          <div className="grid max-h-[28rem] grid-cols-1 gap-3 overflow-y-auto pr-1 sm:grid-cols-2 lg:grid-cols-3">
            {items.map((item) => (
              <button
                key={item.id}
                type="button"
                className="rounded-xl border border-border/60 p-4 text-left transition-colors hover:bg-muted/40"
                onClick={() => {
                  onChange(item.id);
                  setOpen(false);
                }}
              >
                <p className="font-medium text-foreground">{getMediaLabel(item)}</p>
                <p className="mt-2 text-xs text-muted-foreground">ID: {item.id}</p>
              </button>
            ))}
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onChange("")}>Clear</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
