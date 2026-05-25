"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, ExternalLink, Loader2, Plus, X } from "lucide-react";

import { npFetch } from "../lib/api-client.js";
import { Button } from "../ui/button.js";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card.js";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select.js";

interface NavMembershipPanelProps {
  pageId: string;
  pageTitle?: string;
  /**
   * Source collection of the doc — passed through to the
   * membership endpoint and stamped onto new nav items as
   * `collectionSlug` so the resolver knows which collection to
   * walk through `seo.urlPath`. Defaults to `"pages"` for
   * back-compat with callers that haven't been updated yet.
   */
  collectionSlug?: string;
}

interface Membership {
  location: string;
  itemId: string;
  label: string;
}

interface NavItem {
  id: string;
  label: string;
  type: "link" | "page" | "collection";
  url?: string;
  pageId?: string;
  collection?: string;
  collectionSlug?: string;
  children?: NavItem[];
}

interface LocationOption {
  value: string;
  label: string;
}

// Baked-in fallbacks shown until the locations endpoint responds,
// so the panel renders something useful during the loading flicker.
// The endpoint always returns these plus any custom locations the
// operator has added.
const FALLBACK_LOCATIONS: LocationOption[] = [
  { value: "header", label: "Header" },
  { value: "footer", label: "Footer" },
  { value: "main", label: "Main" },
];

export function NavMembershipPanel({
  pageId,
  pageTitle,
  collectionSlug = "pages",
}: NavMembershipPanelProps) {
  const [memberships, setMemberships] = useState<Membership[]>([]);
  const [locations, setLocations] = useState<LocationOption[]>(FALLBACK_LOCATIONS);
  const [loading, setLoading] = useState(true);
  const [busyLocation, setBusyLocation] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [addLocation, setAddLocation] = useState<string>(FALLBACK_LOCATIONS[0].value);

  const loadLocations = useCallback(async () => {
    try {
      const response = await fetch("/api/navigation/locations");
      const payload = (await response.json().catch(() => null)) as unknown;
      if (!response.ok) return; // soft fail — fallback list still renders
      if (isRecord(payload) && Array.isArray(payload.locations)) {
        const next = payload.locations.filter(isLocationOption);
        if (next.length > 0) setLocations(next);
      }
    } catch {
      // ignore — fallback list keeps the panel functional
    }
  }, []);

  const loadMemberships = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ pageId, collection: collectionSlug });
      const response = await fetch(`/api/navigation/membership?${params.toString()}`);
      const payload = (await response.json().catch(() => null)) as unknown;
      if (!response.ok) {
        setError(extractErrorMessage(payload, "Unable to load nav membership."));
        return;
      }
      if (isRecord(payload) && Array.isArray(payload.memberships)) {
        setMemberships(payload.memberships.filter(isMembership));
      }
    } catch {
      setError("Unable to load nav membership.");
    } finally {
      setLoading(false);
    }
  }, [pageId, collectionSlug]);

  useEffect(() => {
    void loadMemberships();
    void loadLocations();
  }, [loadMemberships, loadLocations]);

  // Auto-dismiss the success flash after a beat so it doesn't
  // linger across subsequent edits.
  useEffect(() => {
    if (!success) return;
    const t = setTimeout(() => setSuccess(null), 2500);
    return () => clearTimeout(t);
  }, [success]);

  // Read-modify-write the target location's nav row. The editor's
  // existing PUT /api/navigation accepts a full items array; we
  // append a new page-typed item with a generated id and the
  // page's title as its label (the operator can rename it later
  // in Settings → Navigation).
  async function addToLocation(location: string) {
    setBusyLocation(location);
    setError(null);
    setSuccess(null);
    try {
      const fetchResponse = await fetch(`/api/navigation?location=${encodeURIComponent(location)}`);
      const payload = (await fetchResponse.json().catch(() => null)) as unknown;
      if (!fetchResponse.ok) {
        setError(extractErrorMessage(payload, "Unable to read nav."));
        return;
      }
      const existingItems = extractItems(payload);
      const expectedUpdatedAt = extractUpdatedAt(payload);
      const locationLabel = locations.find((l) => l.value === location)?.label ?? location;
      const nextItems: NavItem[] = [
        ...existingItems,
        {
          id: createId(),
          label: pageTitle?.trim() || "Untitled page",
          type: "page",
          pageId,
          // Only stamp the field when the source is a non-default
          // collection — keeps the wire format minimal for the
          // common `pages` case so existing rows don't grow a
          // redundant `"collectionSlug": "pages"` on every save.
          ...(collectionSlug !== "pages" ? { collectionSlug } : {}),
        },
      ];
      await saveLocation(location, nextItems, expectedUpdatedAt);
      await loadMemberships();
      setSuccess(`Added to ${locationLabel}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to add to navigation.");
    } finally {
      setBusyLocation(null);
    }
  }

  async function removeFromLocation(location: string, itemId: string) {
    setBusyLocation(location);
    setError(null);
    setSuccess(null);
    try {
      const fetchResponse = await fetch(`/api/navigation?location=${encodeURIComponent(location)}`);
      const payload = (await fetchResponse.json().catch(() => null)) as unknown;
      if (!fetchResponse.ok) {
        setError(extractErrorMessage(payload, "Unable to read nav."));
        return;
      }
      const existingItems = extractItems(payload);
      const expectedUpdatedAt = extractUpdatedAt(payload);
      const nextItems = removeItemById(existingItems, itemId);
      const locationLabel = locations.find((l) => l.value === location)?.label ?? location;
      await saveLocation(location, nextItems, expectedUpdatedAt);
      await loadMemberships();
      setSuccess(`Removed from ${locationLabel}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to remove from navigation.");
    } finally {
      setBusyLocation(null);
    }
  }

  async function saveLocation(
    location: string,
    items: NavItem[],
    expectedUpdatedAt: string | null,
  ) {
    const response = await npFetch("/api/navigation", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        location,
        items,
        ...(expectedUpdatedAt ? { expectedUpdatedAt } : {}),
      }),
    });
    if (!response.ok) {
      if (response.status === 409) {
        // Surface the conflict explicitly so the operator knows to
        // refresh and retry rather than seeing a generic
        // "Unable to save" message.
        throw new Error(
          "Someone else changed this navigation while you were editing. Try again — the panel will fetch the latest version.",
        );
      }
      const payload = (await response.json().catch(() => null)) as unknown;
      throw new Error(extractErrorMessage(payload, "Unable to save navigation."));
    }
  }

  const presentLocations = new Set(memberships.map((m) => m.location));
  const addableLocations = locations.filter((loc) => !presentLocations.has(loc.value));
  const labelFor = (value: string) => locations.find((l) => l.value === value)?.label ?? value;
  const effectiveAddLocation = addableLocations.find((l) => l.value === addLocation)
    ? addLocation
    : (addableLocations[0]?.value ?? "");

  return (
    <Card>
      <CardHeader>
        <CardTitle>In navigation</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        {error ? (
          <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
            {error}
          </div>
        ) : null}

        {success ? (
          <div
            role="status"
            aria-live="polite"
            className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-700 dark:text-emerald-300"
          >
            <Check className="h-3.5 w-3.5" />
            <span className="min-w-0 break-words">{success}</span>
          </div>
        ) : null}

        {loading ? (
          <div className="flex items-center gap-2 text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Loading membership…
          </div>
        ) : memberships.length === 0 ? (
          <p className="text-muted-foreground">This page isn’t in any navigation menu yet.</p>
        ) : (
          <ul className="space-y-1.5">
            {memberships.map((m) => (
              <li
                key={`${m.location}-${m.itemId}`}
                className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 rounded-lg border border-border/60 bg-background/70 px-3 py-2"
              >
                <div className="min-w-0">
                  <p className="truncate text-foreground">{labelFor(m.location)}</p>
                  <p className="truncate text-xs text-muted-foreground">linked as “{m.label}”</p>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`Remove from ${labelFor(m.location)}`}
                  disabled={busyLocation === m.location}
                  onClick={() => void removeFromLocation(m.location, m.itemId)}
                >
                  {busyLocation === m.location ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <X className="h-3.5 w-3.5" />
                  )}
                </Button>
              </li>
            ))}
          </ul>
        )}

        {addableLocations.length > 0 ? (
          <div className="space-y-2">
            <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Add to</p>
            <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
              <Select value={effectiveAddLocation} onValueChange={(value) => setAddLocation(value)}>
                <SelectTrigger className="h-9 w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {addableLocations.map((loc) => (
                    <SelectItem key={loc.value} value={loc.value}>
                      {loc.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                variant="outline"
                size="sm"
                className="w-full sm:w-auto"
                disabled={!effectiveAddLocation || busyLocation === effectiveAddLocation}
                onClick={() => void addToLocation(effectiveAddLocation)}
              >
                {busyLocation === effectiveAddLocation ? (
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Plus className="mr-1.5 h-3.5 w-3.5" />
                )}
                Add
              </Button>
            </div>
          </div>
        ) : null}

        <a
          href="/admin/settings/navigation"
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          Open Navigation editor
          <ExternalLink className="h-3 w-3" />
        </a>
      </CardContent>
    </Card>
  );
}

function removeItemById(items: NavItem[], itemId: string): NavItem[] {
  return items
    .filter((item) => item.id !== itemId)
    .map((item) =>
      item.children ? { ...item, children: removeItemById(item.children, itemId) } : item,
    );
}

function extractItems(payload: unknown): NavItem[] {
  if (!isRecord(payload)) return [];
  if (Array.isArray(payload.items)) return payload.items.filter(isNavItem);
  return [];
}

// Pulls the row's `updatedAt` ISO string from a nav GET response.
// Returns null when the row doesn't exist yet (the API answers
// `{ location, items: [] }` with no `updatedAt`) — callers treat
// null as "skip the optimistic-concurrency check on the next PUT".
function extractUpdatedAt(payload: unknown): string | null {
  if (!isRecord(payload)) return null;
  const v = payload.updatedAt;
  if (typeof v === "string") return v;
  if (v instanceof Date) return v.toISOString();
  return null;
}

function isMembership(value: unknown): value is Membership {
  return (
    isRecord(value) &&
    typeof value.location === "string" &&
    typeof value.itemId === "string" &&
    typeof value.label === "string"
  );
}

function isLocationOption(value: unknown): value is LocationOption {
  return isRecord(value) && typeof value.value === "string" && typeof value.label === "string";
}

function isNavItem(value: unknown): value is NavItem {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === "string" &&
    typeof value.label === "string" &&
    (value.type === "link" || value.type === "page" || value.type === "collection")
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function extractErrorMessage(payload: unknown, fallback: string): string {
  if (isRecord(payload)) {
    if (typeof payload.error === "string") return payload.error;
    if (isRecord(payload.error) && typeof payload.error.message === "string") {
      return payload.error.message;
    }
  }
  return fallback;
}

function createId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `nav-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
