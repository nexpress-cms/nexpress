import { useEffect, useMemo, useState } from "react";
import type { NxFindResult } from "@nexpress/core";

import { Badge } from "../../ui/badge.js";
import { Button } from "../../ui/button.js";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../../ui/dialog.js";

interface RelatedDocument extends Record<string, unknown> {
  id: string;
}

interface RelationshipFieldProps {
  relationTo: string | string[];
  hasMany?: boolean;
  value: string | string[];
  onChange: (value: string | string[]) => void;
}

const getRelationSlug = (relationTo: string | string[]): string => (Array.isArray(relationTo) ? relationTo[0] ?? "" : relationTo);

const SYSTEM_ENDPOINTS: Record<string, string> = {
  users: "/api/users",
  media: "/api/media",
};

const getRelationEndpoint = (slug: string, limit: number): string => {
  const base = SYSTEM_ENDPOINTS[slug] ?? `/api/collections/${slug}`;
  return `${base}?limit=${limit}`;
};

const getDocumentLabel = (doc: Record<string, unknown>): string => {
  const label = doc.title ?? doc.name ?? doc.label ?? doc.slug ?? doc.email ?? doc.filename ?? doc.id;
  return typeof label === "string" ? label : String(doc.id ?? "Untitled item");
};

export function RelationshipField({ relationTo, hasMany, value, onChange }: RelationshipFieldProps) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<RelatedDocument[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const relationSlug = getRelationSlug(relationTo);
  const selectedValues = useMemo(() => (Array.isArray(value) ? value : value ? [value] : []), [value]);

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
          | NxFindResult<RelatedDocument>
          | { docs?: RelatedDocument[]; items?: RelatedDocument[] };
        const docs = Array.isArray((payload as NxFindResult<RelatedDocument>).docs)
          ? (payload as NxFindResult<RelatedDocument>).docs
          : Array.isArray((payload as { items?: RelatedDocument[] }).items)
            ? (payload as { items: RelatedDocument[] }).items
            : [];
        setItems(docs);
      } catch (fetchError) {
        setError(fetchError instanceof Error ? fetchError.message : "Failed to load related items.");
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
    <div className="space-y-3 rounded-2xl border border-border/60 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          {selectedItems.length > 0 ? (
            selectedItems.map((item) => <Badge key={item.id}>{getDocumentLabel(item)}</Badge>)
          ) : (
            <p className="text-sm text-muted-foreground">No related item selected.</p>
          )}
        </div>

        <Button type="button" variant="outline" onClick={() => setOpen(true)}>
          Select
        </Button>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Select relation</DialogTitle>
            <DialogDescription>Browse the first 20 items from {relationSlug}.</DialogDescription>
          </DialogHeader>

          {isLoading ? <p className="text-sm text-muted-foreground">Loading items…</p> : null}
          {error ? <p className="text-sm text-rose-600">{error}</p> : null}

          <div className="grid max-h-[28rem] grid-cols-1 gap-3 overflow-y-auto pr-1 sm:grid-cols-2">
            {items.map((item) => {
              const isSelected = selectedValues.includes(item.id);

              return (
                <button
                  key={item.id}
                  type="button"
                  className={
                    isSelected
                      ? "rounded-2xl border border-foreground bg-muted/50 p-4 text-left"
                      : "rounded-2xl border border-border/60 p-4 text-left transition-colors hover:bg-muted/40"
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
                  <p className="font-medium text-foreground">{getDocumentLabel(item)}</p>
                  <p className="mt-2 text-xs text-muted-foreground">ID: {item.id}</p>
                </button>
              );
            })}
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onChange(hasMany ? [] : "")}
            >
              Clear
            </Button>
            {hasMany ? (
              <Button type="button" onClick={() => setOpen(false)}>
                Done
              </Button>
            ) : null}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
