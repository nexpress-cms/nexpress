"use client";

import { useEffect, useState } from "react";
import { ExternalLink, Loader2, Plus, X } from "lucide-react";

import { nxFetch } from "../lib/api-client.js";
import { Button } from "../ui/button.js";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card.js";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select.js";

interface NavMembershipPanelProps {
  pageId: string;
  pageTitle?: string;
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

export function NavMembershipPanel({ pageId, pageTitle }: NavMembershipPanelProps) {
  const [memberships, setMemberships] = useState<Membership[]>([]);
  const [locations, setLocations] = useState<LocationOption[]>(FALLBACK_LOCATIONS);
  const [loading, setLoading] = useState(true);
  const [busyLocation, setBusyLocation] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [addLocation, setAddLocation] = useState<string>(FALLBACK_LOCATIONS[0].value);

  useEffect(() => {
    void loadMemberships();
    void loadLocations();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageId]);

  async function loadLocations() {
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
  }

  async function loadMemberships() {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/navigation/membership?pageId=${encodeURIComponent(pageId)}`,
      );
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
  }

  // Read-modify-write the target location's nav row. The editor's
  // existing PUT /api/navigation accepts a full items array; we
  // append a new page-typed item with a generated id and the
  // page's title as its label (the operator can rename it later
  // in Settings → Navigation).
  async function addToLocation(location: string) {
    setBusyLocation(location);
    setError(null);
    try {
      const fetchResponse = await fetch(
        `/api/navigation?location=${encodeURIComponent(location)}`,
      );
      const payload = (await fetchResponse.json().catch(() => null)) as unknown;
      if (!fetchResponse.ok) {
        setError(extractErrorMessage(payload, "Unable to read nav."));
        return;
      }
      const existingItems = extractItems(payload);
      const nextItems: NavItem[] = [
        ...existingItems,
        {
          id: createId(),
          label: pageTitle?.trim() || "Untitled page",
          type: "page",
          pageId,
        },
      ];
      await saveLocation(location, nextItems);
      await loadMemberships();
    } catch {
      setError("Unable to add to navigation.");
    } finally {
      setBusyLocation(null);
    }
  }

  async function removeFromLocation(location: string, itemId: string) {
    setBusyLocation(location);
    setError(null);
    try {
      const fetchResponse = await fetch(
        `/api/navigation?location=${encodeURIComponent(location)}`,
      );
      const payload = (await fetchResponse.json().catch(() => null)) as unknown;
      if (!fetchResponse.ok) {
        setError(extractErrorMessage(payload, "Unable to read nav."));
        return;
      }
      const existingItems = extractItems(payload);
      const nextItems = removeItemById(existingItems, itemId);
      await saveLocation(location, nextItems);
      await loadMemberships();
    } catch {
      setError("Unable to remove from navigation.");
    } finally {
      setBusyLocation(null);
    }
  }

  async function saveLocation(location: string, items: NavItem[]) {
    const response = await nxFetch("/api/navigation", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ location, items }),
    });
    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as unknown;
      throw new Error(extractErrorMessage(payload, "Unable to save navigation."));
    }
  }

  const presentLocations = new Set(memberships.map((m) => m.location));
  const addableLocations = locations.filter((loc) => !presentLocations.has(loc.value));
  const labelFor = (value: string) =>
    locations.find((l) => l.value === value)?.label ?? value;
  const effectiveAddLocation = addableLocations.find((l) => l.value === addLocation)
    ? addLocation
    : addableLocations[0]?.value ?? "";

  return (
    <Card className="border-border/60 shadow-sm">
      <CardHeader>
        <CardTitle className="text-sm font-medium">In navigation</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        {error ? (
          <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
            {error}
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
                className="flex items-center justify-between gap-2 rounded-lg border border-border/60 bg-background/70 px-3 py-2"
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
            <div className="flex items-center gap-2">
              <Select
                value={effectiveAddLocation}
                onValueChange={(value) => setAddLocation(value)}
              >
                <SelectTrigger className="h-9 flex-1">
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
  // The success-wrapped GET response shape is { data: { items, ... } }
  // depending on the helper. Walk one level down if needed.
  if (isRecord(payload.data) && Array.isArray(payload.data.items)) {
    return payload.data.items.filter(isNavItem);
  }
  return [];
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
  return (
    isRecord(value) &&
    typeof value.value === "string" &&
    typeof value.label === "string"
  );
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
