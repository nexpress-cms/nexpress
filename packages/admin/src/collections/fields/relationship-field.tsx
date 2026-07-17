import { useEffect, useMemo, useState } from "react";
import type { NpFindResult } from "@nexpress/core";

import { Badge } from "../../ui/badge.js";
import { Button } from "../../ui/button.js";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../ui/dialog.js";

interface RelatedDocument extends Record<string, unknown> {
  id: string;
}

interface RelationshipFieldProps {
  relationTo: string | string[];
  hasMany?: boolean;
  value: string | string[];
  onChange: (value: string | string[]) => void;
}

const getRelationSlug = (relationTo: string | string[]): string =>
  Array.isArray(relationTo) ? (relationTo[0] ?? "") : relationTo;

const SYSTEM_ENDPOINTS: Record<string, string> = {
  users: "/api/users",
  media: "/api/media",
};

const getRelationEndpoint = (slug: string, limit: number): string => {
  const base = SYSTEM_ENDPOINTS[slug] ?? `/api/collections/${slug}`;
  return `${base}?limit=${limit}`;
};

const getDocumentLabel = (doc: Record<string, unknown> & { id?: string }): string => {
  const label =
    doc.title ?? doc.name ?? doc.label ?? doc.slug ?? doc.email ?? doc.filename ?? doc.id;
  return typeof label === "string" ? label : (doc.id ?? "Untitled item");
};

export function RelationshipField({
  relationTo,
  hasMany,
  value,
  onChange,
}: RelationshipFieldProps) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<RelatedDocument[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const relationSlug = getRelationSlug(relationTo);
  const selectedValues = useMemo(
    () => (Array.isArray(value) ? value : value ? [value] : []),
    [value],
  );

  useEffect(() => {
    if (!open || !relationSlug) {
      return;
    }

    const fetchItems = async () => {
      setIsLoading(true);
      setError(null);

      try {
        const response = await fetch(getRelationEndpoint(relationSlug, 20), {
          credentials: "same-origin",
        });

        if (!response.ok) {
          throw new Error("Failed to load related items.");
        }

        const payload = (await response.json()) as
          NpFindResult<RelatedDocument> | { docs?: RelatedDocument[]; items?: RelatedDocument[] };
        const docs = Array.isArray((payload as NpFindResult<RelatedDocument>).docs)
          ? (payload as NpFindResult<RelatedDocument>).docs
          : Array.isArray((payload as { items?: RelatedDocument[] }).items)
            ? (payload as { items: RelatedDocument[] }).items
            : [];
        setItems(docs);
      } catch (fetchError) {
        setError(
          fetchError instanceof Error ? fetchError.message : "Failed to load related items.",
        );
      } finally {
        setIsLoading(false);
      }
    };

    void fetchItems();
  }, [open, relationSlug]);

  const selectedItems = useMemo(
    () => items.filter((item) => selectedValues.includes(item.id)),
    [items, selectedValues],
  );

  return (
    <div
      className="min-w-0 space-y-3 rounded-xl border border-border/60 p-3 sm:p-4"
      data-np-relationship-field={relationSlug}
    >
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
          {selectedItems.length > 0 ? (
            selectedItems.map((item) => (
              <Badge key={item.id} className="max-w-full min-w-0 truncate">
                {getDocumentLabel(item)}
              </Badge>
            ))
          ) : (
            <p className="min-w-0 break-words text-sm text-muted-foreground">
              No related item selected.
            </p>
          )}
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
        <DialogContent className="min-w-0 max-w-3xl" data-np-relationship-dialog>
          <DialogHeader className="min-w-0">
            <DialogTitle className="break-words">Select relation</DialogTitle>
            <DialogDescription className="break-words">
              Browse the first 20 items from {relationSlug}.
            </DialogDescription>
          </DialogHeader>

          {isLoading ? <p className="text-sm text-muted-foreground">Loading items…</p> : null}
          {error ? <p className="text-sm text-rose-600 dark:text-rose-300">{error}</p> : null}

          <div className="grid min-w-0 max-h-[min(28rem,48dvh)] grid-cols-1 gap-3 overflow-y-auto pr-1 sm:grid-cols-2">
            {items.map((item) => {
              const isSelected = selectedValues.includes(item.id);

              return (
                <button
                  key={item.id}
                  type="button"
                  className={
                    isSelected
                      ? "min-w-0 rounded-xl border border-foreground bg-muted/50 p-3 text-left sm:p-4"
                      : "min-w-0 rounded-xl border border-border/60 p-3 text-left transition-colors hover:bg-muted/40 sm:p-4"
                  }
                  onClick={() => {
                    if (hasMany) {
                      const nextValues = isSelected
                        ? selectedValues.filter((selected) => selected !== item.id)
                        : [...selectedValues, item.id];
                      onChange(nextValues);
                      return;
                    }

                    onChange(item.id);
                    setOpen(false);
                  }}
                >
                  <p className="break-words font-medium text-foreground">
                    {getDocumentLabel(item)}
                  </p>
                  <p className="mt-2 break-all text-xs text-muted-foreground">ID: {item.id}</p>
                </button>
              );
            })}
          </div>

          <DialogFooter className="min-w-0 gap-2">
            <Button
              type="button"
              variant="outline"
              className="w-full sm:w-auto"
              onClick={() => onChange(hasMany ? [] : "")}
            >
              Clear
            </Button>
            {hasMany ? (
              <Button type="button" className="w-full sm:w-auto" onClick={() => setOpen(false)}>
                Done
              </Button>
            ) : null}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
