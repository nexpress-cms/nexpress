"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentType,
  type ReactElement,
  type ReactNode,
} from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
// Client-safe subpath — the root `@nexpress/core` import dragged
// `pg` / `argon2` / `sharp` into the admin's client bundle via
// the auth re-exports, breaking the Next build (#776). `fields`
// re-exports just the pure predicate / walker helpers we need.
import { collectHiddenFieldNames, evaluateFieldCondition } from "@nexpress/core/fields";
import type { NpCollectionConfig, NpFieldConfig } from "@nexpress/core";
import {
  BookOpen,
  Briefcase,
  Calendar,
  CalendarClock,
  ChevronRight,
  Eye,
  FileText,
  FolderTree,
  Layout,
  Loader2,
  Newspaper,
  Save,
  Search,
  Tag,
  Trash2,
  User,
  type LucideIcon,
} from "lucide-react";
import { useForm, useFormState, useWatch } from "react-hook-form";
import { z } from "zod";

import { CollectionTabs, type CollectionTabDescriptor } from "./collection-tabs.js";
import { FieldRenderer } from "./field-renderer.js";
import { NavMembershipPanel } from "./nav-membership-panel.js";
import { RevisionsPanel } from "./revisions-panel.js";
import { ScheduleDialog } from "./schedule-dialog.js";
import { TranslationTabs } from "./translation-tabs.js";
import { SaveEventsProvider, useSaveEmitter } from "../blocks/shared/save-events.js";
import { Button } from "../ui/button.js";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card.js";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "../ui/collapsible.js";
import { Form } from "../ui/form.js";
import { StatusBadge } from "../ui/status-badge.js";
import { Switch } from "../ui/switch.js";
import { cn } from "../ui/utils.js";
import { npFetch } from "../lib/api-client.js";

interface CollectionEditViewProps {
  config: NpCollectionConfig;
  // Narrow the well-known fields that the view stringifies into URLs
  // and log lines. The pipeline always emits `id` and `publishedAt` as
  // strings (UUIDs / ISO timestamps); typing them here avoids a chain
  // of `String(...)` casts and the matching no-base-to-string lint
  // errors on `${doc.id}` interpolations.
  doc?: Record<string, unknown> & { id?: string; publishedAt?: string };
  collectionSlug: string;
  collectionTabs?: CollectionTabDescriptor[];
}

type ToastState = {
  type: "success" | "error";
  message: string;
} | null;

type AutosaveStatusState =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "saved"; at: number }
  | { kind: "error"; message: string };

interface AutosavePayload {
  documentId: string;
  snapshot: Record<string, unknown>;
  snapshotKey: string;
}

const UNSAVED_NAVIGATION_MESSAGE = "You have unsaved changes. Leave without saving?";

const namedSidebarFields = new Set(["status", "publishedAt", "slug"]);

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const buildInputDateValue = (value: unknown, includeTime: boolean): string => {
  if (typeof value === "string") {
    return includeTime ? value.slice(0, 16) : value.slice(0, 10);
  }

  if (value instanceof Date) {
    const iso = value.toISOString();
    return includeTime ? iso.slice(0, 16) : iso.slice(0, 10);
  }

  return "";
};

const getDefaultValue = (field: NpFieldConfig, source: Record<string, unknown>): unknown => {
  if (field.type === "row" || field.type === "collapsible") {
    return undefined;
  }

  const currentValue = source[field.name];

  if (currentValue !== undefined) {
    if (field.type === "date") {
      return buildInputDateValue(currentValue, Boolean(field.pickerOptions?.includeTime));
    }

    return currentValue;
  }

  if (field.defaultValue !== undefined) {
    return field.defaultValue;
  }

  switch (field.type) {
    case "checkbox":
      return false;
    case "array":
      return [];
    case "group":
      return {};
    case "json":
      return {};
    case "select":
      return field.hasMany ? [] : "";
    case "relationship":
      return field.hasMany ? [] : "";
    default:
      return "";
  }
};

const buildDefaultValues = (
  fields: NpFieldConfig[],
  source: Record<string, unknown>,
): Record<string, unknown> => {
  const result: Record<string, unknown> = {};

  for (const field of fields) {
    if (field.type === "row" || field.type === "collapsible") {
      Object.assign(result, buildDefaultValues(field.fields, source));
      continue;
    }

    if (field.type === "group") {
      const groupValue = source[field.name];
      result[field.name] = buildDefaultValues(field.fields, isObject(groupValue) ? groupValue : {});
      continue;
    }

    result[field.name] = getDefaultValue(field, source);
  }

  return result;
};

const buildFieldSchema = (field: NpFieldConfig): z.ZodType<unknown> => {
  switch (field.type) {
    case "text":
    case "textarea":
    case "email":
    case "upload":
    case "radio":
      return z.string();
    case "number":
      return z.coerce.number();
    case "checkbox":
      return z.boolean();
    case "richText":
    case "blocks":
    case "json":
      return z.unknown();
    case "date":
      return z.coerce.date();
    case "relationship":
      return field.hasMany ? z.array(z.string()) : z.string();
    case "select":
      return field.hasMany ? z.array(z.string()) : z.string();
    case "array":
      return z.array(z.object(buildSchemaShape(field.fields)));
    case "group":
      return z.object(buildSchemaShape(field.fields));
    case "row":
    case "collapsible":
      return z.object(buildSchemaShape(field.fields));
    default:
      return z.unknown();
  }
};

const buildSchemaShape = (
  fields: NpFieldConfig[],
  /**
   * Names of fields whose `admin.condition` evaluated to false
   * against the current form data — `required` is dropped for
   * these so a hidden field can never block submit with an
   * invisible validation error.
   */
  hiddenByCondition: ReadonlySet<string> = new Set(),
): Record<string, z.ZodType<unknown>> => {
  const shape: Record<string, z.ZodType<unknown>> = {};

  for (const field of fields) {
    if (field.type === "row" || field.type === "collapsible") {
      Object.assign(shape, buildSchemaShape(field.fields, hiddenByCondition));
      continue;
    }

    let schema = buildFieldSchema(field);

    const effectiveRequired = field.required && !hiddenByCondition.has(field.name);
    if (!effectiveRequired) {
      schema = schema.optional();
    }

    shape[field.name] = schema;
  }

  return shape;
};

const generateZodSchema = (
  fields: NpFieldConfig[],
  hiddenByCondition: ReadonlySet<string> = new Set(),
) => z.object(buildSchemaShape(fields, hiddenByCondition));

/**
 * Walk fields (recursing into row / collapsible containers) and
 * collect names whose `admin.condition` evaluates falsy against
 * `data`. The result feeds `generateZodSchema` so hidden fields
 * never block submission with a required-but-missing error the
 * operator can't see or correct.
 *
 * Implementation lives in `@nexpress/core` so the pipeline's
 * server-side validation evaluates the same set of conditions
 * the admin client honored. Single source of truth.
 */

/**
 * Adds an implicit `slug` text input to the form when the
 * collection declares `slugField` but doesn't list `slug` in its
 * `fields`. The pages collection (and most page-shaped configs)
 * leans on the auto-derive behavior — slug is computed from the
 * title at save time — but operators with non-Latin titles need a
 * way to override the slug at create time. `namedSidebarFields`
 * already routes `slug` into the sidebar, so the synthetic field
 * lands there without further wiring.
 *
 * Skipped when the collection author already declared a slug
 * field explicitly — they get whatever shape they want.
 */
function withImplicitSlugField(
  fields: NpFieldConfig[],
  slugField: NpCollectionConfig["slugField"],
): NpFieldConfig[] {
  if (!slugField) return fields;
  if (fields.some((f) => f.type !== "row" && f.type !== "collapsible" && f.name === "slug")) {
    return fields;
  }
  const synthetic: NpFieldConfig = {
    type: "text",
    name: "slug",
    admin: {
      description:
        "URL slug. Leave blank to auto-derive from the title; override here for a custom path.",
    },
  };
  return [...fields, synthetic];
}

const isSidebarField = (field: NpFieldConfig): boolean => {
  if (field.type === "row" || field.type === "collapsible") {
    return false;
  }

  if (field.admin?.position === "sidebar") return true;
  if (field.admin?.position === "main") return false;

  return field.type === "date" || Boolean(field.admin?.width) || namedSidebarFields.has(field.name);
};

// Title-kind fields render outside the Card stack at the top of
// the left column as a large borderless headline that flows
// directly into the editor canvas underneath. Matches the
// design's "document title above the writing surface" pattern.
const isTitleField = (field: NpFieldConfig): boolean => {
  if (field.type === "row" || field.type === "collapsible") return false;
  return field.admin?.kind === "title";
};

// Writing-surface fields (blocks editor, rich-text editor, title)
// don't need a Card wrapper — they ship their own bordered canvas
// and stacking another card on top reads as nested chrome. Naked
// rendering lets title → body flow as one continuous editing
// composition.
const isUnwrappedField = (field: NpFieldConfig): boolean => {
  if (field.type === "row" || field.type === "collapsible") return false;
  return field.type === "blocks" || field.type === "richText" || isTitleField(field);
};

const isVisibleField = (field: NpFieldConfig): boolean => {
  if (field.type === "row" || field.type === "collapsible") {
    return true;
  }

  return !field.hidden;
};

const DEFAULT_SIDEBAR_GROUP = "Publish";

/**
 * Lucide-name → component map for `admin.groupMeta.<group>.icon`
 * resolution. Mirrors the same pattern as `admin.icon` in
 * admin-shell. Small on purpose — the bundle pulls only the
 * icons the editor actually mounts. Add an entry when a theme
 * declares a new group icon.
 */
const GROUP_ICONS: Record<string, LucideIcon> = {
  BookOpen,
  Briefcase,
  Calendar,
  FileText,
  FolderTree,
  Layout,
  Newspaper,
  Search,
  Tag,
  User,
};

function resolveGroupIcon(name: string | undefined): LucideIcon | undefined {
  if (!name) return undefined;
  return GROUP_ICONS[name];
}

/**
 * Resolve a sidebar field's group label. Containers (row,
 * collapsible) and unnamed structural fields don't get grouped —
 * they keep their authored shape inside the default group.
 */
const fieldGroup = (field: NpFieldConfig): string => {
  if (field.type === "row" || field.type === "collapsible") {
    return DEFAULT_SIDEBAR_GROUP;
  }
  return field.admin?.group ?? DEFAULT_SIDEBAR_GROUP;
};

/**
 * Apply `admin.condition` against the live form values. Returns
 * true when the field has no condition, or the condition returns
 * true, or the operator has "Show all fields" toggled on.
 * Containers always pass — their members handle their own gating.
 */
const passesCondition = (
  field: NpFieldConfig,
  formValues: Record<string, unknown>,
  showAll: boolean,
): boolean => {
  if (showAll) return true;
  if (field.type === "row" || field.type === "collapsible") return true;
  // `evaluateFieldCondition` handles both the legacy function
  // form (server-only — stripped by `toClientCollectionConfig`
  // before reaching here, so it'd be undefined client-side) and
  // the serializable expression form (`{ when, equals, ... }`)
  // which survives the RSC boundary. Same evaluator as the
  // server pipeline → no behavioral divergence (#763).
  return evaluateFieldCondition(field.admin?.condition, formValues);
};

/**
 * Recursively strip conditional fields that don't pass the
 * current form values out of `row` / `collapsible` containers.
 * Returns the field unchanged when it isn't a container or has
 * no nested fields to filter. Used in the main + sidebar render
 * walks so a container's children honor their own
 * `admin.condition` — without this, nested conditional fields
 * always show, even when the framework's `collectHiddenFieldNames`
 * already marked them for required-drop on the server.
 */
const filterContainerChildren = (
  field: NpFieldConfig,
  formValues: Record<string, unknown>,
  showAll: boolean,
): NpFieldConfig => {
  if (field.type !== "row" && field.type !== "collapsible") return field;
  const filtered = field.fields
    .filter((child) => passesCondition(child, formValues, showAll))
    .map((child) => filterContainerChildren(child, formValues, showAll));
  return { ...field, fields: filtered };
};

/**
 * Walk a field tree and return true when any leaf field has a
 * current validation error. Used by the sidebar group's
 * `forceOpen` decision so a group containing a container with
 * a nested-error field still gets force-opened on save failure.
 */
const fieldTreeHasError = (fields: NpFieldConfig[], errors: Record<string, unknown>): boolean => {
  for (const f of fields) {
    if (f.type === "row" || f.type === "collapsible") {
      if (fieldTreeHasError(f.fields, errors)) return true;
      continue;
    }
    if ("name" in f && Boolean(errors[f.name])) return true;
  }
  return false;
};

type SaveStatus = "draft" | "published" | "scheduled" | "unschedule";

/**
 * Collapsible sidebar group Card. Each group renders as a normal
 * Card with a chevron in the header; clicking the header toggles
 * the content area. State is per-collection per-group via
 * localStorage so the operator's "I always collapse Hierarchy"
 * preference survives reloads.
 *
 * Default: all groups expanded. Pre-collapsing essential groups
 * (Publish, Lead) would hide common editing targets behind a
 * click, which trades the visual decluttering for an extra
 * interaction per session. Operators can collapse what they
 * personally don't use; the framework doesn't second-guess.
 */
function SidebarGroupCard({
  name,
  storageKey,
  forceOpen,
  icon,
  description,
  children,
}: {
  name: string;
  storageKey: string;
  /**
   * Override the user's collapse preference for this render
   * cycle. Used to force-open a group when validation fails on
   * a field inside it — operator can't fix what they can't
   * see. The override is ephemeral: when the parent stops
   * forcing (errors cleared / submit succeeds), the user's
   * preference takes over again.
   *
   * User clicks during force-open update the local preference
   * silently; once force lifts, the new preference applies.
   */
  forceOpen?: boolean;
  /**
   * Optional Lucide icon component rendered before the group
   * title. Resolved by the parent against the collection's
   * `admin.groupMeta` map; unknown names fall back to no icon
   * (silent — same fallback pattern as `admin.icon`).
   */
  icon?: ComponentType<{ className?: string }>;
  /**
   * Optional one-line hint shown beneath the title when the
   * group is open. Truncated visually if long.
   */
  description?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState<boolean>(() => {
    if (typeof window === "undefined") return true;
    try {
      const stored = window.localStorage.getItem(storageKey);
      return stored !== "closed";
    } catch {
      // see other localStorage call sites
      return true;
    }
  });
  useEffect(() => {
    if (typeof window === "undefined") return;
    let frame: number | null = null;
    try {
      const stored = window.localStorage.getItem(storageKey);
      frame = window.requestAnimationFrame(() => {
        setOpen(stored !== "closed");
      });
    } catch {
      // see other localStorage call sites
    }
    return () => {
      if (frame !== null) window.cancelAnimationFrame(frame);
    };
  }, [storageKey]);
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(storageKey, open ? "open" : "closed");
    } catch {
      // see above
    }
  }, [storageKey, open]);

  // Stable, selector-friendly id for ARIA wiring + the animation
  // CSS hook. `storageKey` contains dots; HTML id attributes
  // accept them but CSS attribute / id selectors choke on the
  // unescaped dot, and dev-tools navigation is friendlier with
  // hyphens.
  const contentId = `np-sidebar-group-${storageKey.replace(/\./g, "-")}`;

  // `forceOpen` short-circuits the user's collapse preference for
  // this render. The local `open` state still tracks intent — so
  // when the force lifts, the card reverts to whatever the
  // operator had set.
  const effectiveOpen = forceOpen ? true : open;

  return (
    <Collapsible open={effectiveOpen} onOpenChange={setOpen} asChild>
      <Card className="min-w-0">
        <CollapsibleTrigger asChild>
          <CardHeader
            className="flex min-h-12 cursor-pointer select-none flex-row items-center justify-between gap-2 rounded-t-xl outline-none focus-visible:ring-[3px] focus-visible:ring-[var(--np-color-brand-ring)]"
            role="button"
            tabIndex={0}
            aria-expanded={effectiveOpen}
            aria-controls={contentId}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                setOpen((v) => !v);
              }
            }}
          >
            <div className="flex min-w-0 flex-1 items-center gap-2">
              {icon ? (
                <span
                  aria-hidden="true"
                  className="flex size-5 shrink-0 items-center justify-center text-neutral-500 dark:text-neutral-400"
                >
                  {(() => {
                    const Icon = icon;
                    return <Icon className="size-3.5" />;
                  })()}
                </span>
              ) : null}
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <CardTitle className="break-words">{name}</CardTitle>
                {description && effectiveOpen ? (
                  <p className="break-words text-[11.5px] font-normal text-neutral-500 dark:text-neutral-400">
                    {description}
                  </p>
                ) : null}
              </div>
            </div>
            <ChevronRight
              aria-hidden="true"
              className={cn(
                "size-4 shrink-0 text-muted-foreground transition-transform",
                effectiveOpen && "rotate-90",
              )}
            />
          </CardHeader>
        </CollapsibleTrigger>
        <CollapsibleContent id={contentId} className="np-sidebar-group-content">
          <CardContent className="min-w-0 space-y-6">{children}</CardContent>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );
}

function formatRelative(timestamp: number): string {
  const seconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000));
  if (seconds < 5) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  return `${hours}h ago`;
}

export function CollectionEditView(props: CollectionEditViewProps) {
  // Wrap in `SaveEventsProvider` so block-editor orchestrators
  // mounted inside the form (via `BlocksFieldRender`) can subscribe
  // to save lifecycle events and flip their autosave indicator.
  // The actual view body lives in `CollectionEditViewInner` so its
  // `useSaveEmitter()` call sits inside the provider's tree.
  return (
    <SaveEventsProvider>
      <CollectionEditViewInner {...props} />
    </SaveEventsProvider>
  );
}

function CollectionEditViewInner({
  config,
  doc,
  collectionSlug,
  collectionTabs,
}: CollectionEditViewProps) {
  const router = useRouter();
  const emitSave = useSaveEmitter();
  const [toast, setToast] = useState<ToastState>(null);
  const [savingAs, setSavingAs] = useState<SaveStatus | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [scheduleOpen, setScheduleOpen] = useState(false);

  // Inject an implicit `slug` field when the collection declares
  // `slugField` but doesn't list `slug` in `fields` (the
  // common case — pages, posts, etc. lean on the auto-derive
  // behavior). Without this the operator can't override the slug
  // at create time, which breaks for non-Latin titles.
  const effectiveFields = useMemo(
    () => withImplicitSlugField(config.fields, config.slugField),
    [config.fields, config.slugField],
  );

  const defaultValues = useMemo(
    () => buildDefaultValues(effectiveFields, doc ?? {}),
    [effectiveFields, doc],
  );

  // Custom resolver that drops `required` for fields hidden by
  // their `admin.condition`. Without this, a required field
  // gated by `kind === "doc"` would block save on an article
  // post with an "invisible" validation error: the operator
  // sees no failing input but the form refuses to submit.
  //
  // Schema is rebuilt per submit (resolver call) rather than
  // memoized — react-hook-form's default `mode: "onSubmit"`
  // means the resolver fires once per save click, so the
  // rebuild cost is trivial relative to the network round-trip
  // it precedes.
  const resolver = useMemo(() => {
    return async (
      values: Record<string, unknown>,
      context: unknown,
      options: Parameters<ReturnType<typeof zodResolver>>[2],
    ) => {
      const hidden = collectHiddenFieldNames(effectiveFields, values);
      const dynamicSchema = generateZodSchema(effectiveFields, hidden);
      return zodResolver(dynamicSchema)(values, context, options);
    };
  }, [effectiveFields]);

  const form = useForm<Record<string, unknown>>({
    resolver,
    defaultValues,
  });
  const { isDirty } = useFormState({ control: form.control });
  const autosaveValues = useWatch({ control: form.control });
  const autosaveValuesKey = useMemo(() => JSON.stringify(autosaveValues ?? {}), [autosaveValues]);
  const autosaveBaselineRef = useRef<string | null>(null);

  // Sync form inputs with server state after saves, revision restores, or any
  // other refresh that swaps the `doc` prop — react-hook-form's defaultValues
  // is consumed only on mount, so the form would otherwise show stale values.
  useEffect(() => {
    form.reset(defaultValues);
    autosaveBaselineRef.current = JSON.stringify(defaultValues);
  }, [defaultValues, form]);

  const slugValue = useWatch({ control: form.control, name: "slug" });
  const previewSlug =
    typeof slugValue === "string" ? slugValue : typeof doc?.slug === "string" ? doc.slug : "";
  const currentStatus = typeof doc?.status === "string" ? doc.status : null;

  // Autosave wiring — enabled only when the collection opts in via
  // versions.drafts.autosave === true. Reads optional autosaveInterval too.
  const autosaveEnabled =
    typeof config.versions?.drafts === "object" && config.versions.drafts.autosave === true;
  const autosaveInterval =
    typeof config.versions?.drafts === "object" &&
    typeof config.versions.drafts.autosaveInterval === "number"
      ? config.versions.drafts.autosaveInterval
      : 5_000;
  const [autosaveStatus, setAutosaveStatus] = useState<AutosaveStatusState>({ kind: "idle" });

  // Hold the pending debounce handle in a ref so each keystroke can clear
  // the previous timer. Without this ref the user's first edit queues a
  // timeout, the second queues another, and so on; after the debounce
  // window every queued timer fires and floods the endpoint. The server
  // dedups, but the network spam is wasteful.
  const autosaveTimer = useRef<number | null>(null);
  const latestAutosavePayloadRef = useRef<AutosavePayload | null>(null);
  // `savingAs` is read inside the timer callback below; capture it via a
  // ref so we don't reschedule autosave every time the manual save state changes.
  const savingAsRef = useRef(savingAs);
  useEffect(() => {
    savingAsRef.current = savingAs;
  }, [savingAs]);

  useEffect(() => {
    latestAutosavePayloadRef.current = null;
    const frame = window.requestAnimationFrame(() => setAutosaveStatus({ kind: "idle" }));
    return () => window.cancelAnimationFrame(frame);
  }, [defaultValues]);

  const runAutosave = useCallback(
    async (payload: AutosavePayload) => {
      if (savingAsRef.current !== null) return;
      latestAutosavePayloadRef.current = payload;
      try {
        setAutosaveStatus({ kind: "saving" });
        const response = await npFetch(
          `/api/collections/${collectionSlug}/${payload.documentId}/autosave`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload.snapshot),
          },
        );
        if (!response.ok) {
          const body = (await response.json().catch(() => null)) as {
            error?: { message?: string };
          } | null;
          throw new Error(body?.error?.message ?? `HTTP ${response.status}`);
        }
        autosaveBaselineRef.current = payload.snapshotKey;
        latestAutosavePayloadRef.current = null;
        setAutosaveStatus({ kind: "saved", at: Date.now() });
      } catch (error) {
        latestAutosavePayloadRef.current = payload;
        setAutosaveStatus({
          kind: "error",
          message: error instanceof Error ? error.message : "Autosave failed",
        });
      }
    },
    [collectionSlug],
  );

  const handleAutosaveRetry = useCallback(() => {
    const payload = latestAutosavePayloadRef.current;
    if (!payload) return;
    void runAutosave(payload);
  }, [runAutosave]);

  useEffect(() => {
    if (!autosaveEnabled || !doc?.id) return;
    if (autosaveBaselineRef.current === null) {
      autosaveBaselineRef.current = autosaveValuesKey;
      return;
    }
    if (autosaveBaselineRef.current === autosaveValuesKey) return;

    const documentId = String(doc.id);
    const snapshot = JSON.parse(autosaveValuesKey) as Record<string, unknown>;

    if (autosaveTimer.current !== null) {
      window.clearTimeout(autosaveTimer.current);
    }
    const runQueuedAutosave = () => {
      autosaveTimer.current = null;
      void runAutosave({ documentId, snapshot, snapshotKey: autosaveValuesKey });
    };
    autosaveTimer.current = window.setTimeout(() => {
      runQueuedAutosave();
    }, autosaveInterval);

    return () => {
      if (autosaveTimer.current !== null) {
        window.clearTimeout(autosaveTimer.current);
        autosaveTimer.current = null;
      }
    };
  }, [autosaveEnabled, autosaveInterval, autosaveValuesKey, doc?.id, runAutosave]);

  const hasUnsavedChanges = isDirty || autosaveStatus.kind === "error" || savingAs !== null;

  useEffect(() => {
    if (!hasUnsavedChanges) return;
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [hasUnsavedChanges]);

  useEffect(() => {
    if (!hasUnsavedChanges) return;
    const handleDocumentClick = (event: MouseEvent) => {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      ) {
        return;
      }

      const target = event.target;
      if (!(target instanceof Element)) return;
      const anchor = target.closest<HTMLAnchorElement>("a[href]");
      if (!anchor || anchor.target === "_blank" || anchor.hasAttribute("download")) return;
      const rawHref = anchor.getAttribute("href");
      if (!rawHref || rawHref.startsWith("mailto:") || rawHref.startsWith("tel:")) return;

      const destination = new URL(anchor.href);
      const current = new URL(window.location.href);
      if (
        destination.origin === current.origin &&
        destination.pathname === current.pathname &&
        destination.search === current.search
      ) {
        return;
      }

      if (!window.confirm(UNSAVED_NAVIGATION_MESSAGE)) {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
      }
    };

    document.addEventListener("click", handleDocumentClick, true);
    return () => document.removeEventListener("click", handleDocumentClick, true);
  }, [hasUnsavedChanges]);

  // Tick once per second so the "saved Xs ago" label refreshes without a re-save.
  const [, setTickNow] = useState(0);
  useEffect(() => {
    if (autosaveStatus.kind !== "saved") return;
    const handle = window.setInterval(() => setTickNow(Date.now()), 1_000);
    return () => window.clearInterval(handle);
  }, [autosaveStatus.kind]);

  // Show-all toggle — when on, condition-hidden fields are
  // revealed (with no other styling change). Persisted per-
  // collection in localStorage so the operator's preference
  // survives page reloads.
  const showAllStorageKey = `np-admin.show-all-fields.${collectionSlug}`;
  const [showAllFields, setShowAllFields] = useState<boolean>(false);
  useEffect(() => {
    if (typeof window === "undefined") return;
    let frame: number | null = null;
    try {
      const stored = window.localStorage.getItem(showAllStorageKey);
      frame = window.requestAnimationFrame(() => {
        setShowAllFields(stored === "1");
      });
    } catch {
      // localStorage access can throw in restricted contexts
      // (private mode, sandboxed iframes). Silent fallback.
    }
    return () => {
      if (frame !== null) window.cancelAnimationFrame(frame);
    };
  }, [showAllStorageKey]);
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(showAllStorageKey, showAllFields ? "1" : "0");
    } catch {
      // see above
    }
  }, [showAllStorageKey, showAllFields]);

  // Live form values for `admin.condition` evaluation. Reuse the
  // React Hook Form subscription that autosave already needs so the
  // condition logic stays centralized.
  const formValues = autosaveValues;
  const currentFormSnapshot = isObject(formValues) ? formValues : {};

  const visibleFields = effectiveFields.filter(isVisibleField);
  const passes = (field: NpFieldConfig): boolean =>
    passesCondition(field, formValues, showAllFields);
  const sidebarFields = visibleFields.filter(isSidebarField).filter(passes);
  const mainCandidates = visibleFields.filter((field) => !isSidebarField(field));
  const mainFields = mainCandidates.filter(passes);
  // Mirror the sidebar's empty-state contract: when every main
  // field is gated out by the current kind, surface the reason +
  // escape hatch rather than leaving the column blank. The check
  // only fires when there *were* candidates to begin with — a
  // collection with no main-position fields stays empty silently.
  const mainHiddenByKind = !showAllFields && mainCandidates.length > 0 && mainFields.length === 0;
  const currentKindValue =
    typeof formValues === "object" &&
    formValues !== null &&
    typeof (formValues as Record<string, unknown>).kind === "string"
      ? (formValues as Record<string, string>).kind
      : null;
  const currentKindLabel = currentKindValue
    ? (config.admin?.kinds?.[currentKindValue]?.label ?? currentKindValue)
    : null;
  const conditionScopeLabel = currentKindLabel ? `"${currentKindLabel}"` : "this kind";

  // Group sidebar fields by `admin.group`, preserving the first-
  // seen order of groups so operators control layout by ordering
  // fields. Default group label = "Publish".
  const sidebarGroups: Array<{ name: string; fields: NpFieldConfig[] }> = [];
  {
    const indexByName = new Map<string, number>();
    for (const field of sidebarFields) {
      const name = fieldGroup(field);
      let idx = indexByName.get(name);
      if (idx === undefined) {
        idx = sidebarGroups.length;
        indexByName.set(name, idx);
        sidebarGroups.push({ name, fields: [] });
      }
      sidebarGroups[idx].fields.push(field);
    }
  }

  // Has the active kind filter actually hidden any field? Used to
  // decide whether to show the "Show all fields" toggle at all —
  // no hidden fields → no point in offering the escape hatch.
  // Delegates to `collectHiddenFieldNames` so container-nested
  // (row / collapsible / group) conditional fields are detected
  // too — a `row` child with a failing condition shouldn't
  // silently hide the escape hatch from the operator.
  const hasHiddenFields =
    !showAllFields && collectHiddenFieldNames(visibleFields, formValues).size > 0;

  const successMessage = (status: SaveStatus, publishedAt?: string): string => {
    if (status === "scheduled" && publishedAt) {
      return `${config.labels.singular} scheduled for ${new Date(publishedAt).toLocaleString()}.`;
    }
    if (status === "published") return `${config.labels.singular} published.`;
    if (status === "unschedule")
      return `${config.labels.singular} schedule cancelled — back to draft.`;
    return `${config.labels.singular} saved as draft.`;
  };

  /**
   * `status` controls the wire payload's `_status` and the toast copy.
   * Scheduling is just `_status: "published"` + a future `publishedAt` —
   * the pipeline coerces that to `status: "scheduled"` server-side.
   */
  /**
   * Build a readable label for a field name. Walks effectiveFields
   * (including row / collapsible / group containers) to find the
   * matching field and prefers `field.label` if set, else
   * `field.name` itself. Containers without an addressable name
   * fall back to the raw name.
   */
  /**
   * Find a named field at the current container level — walks
   * through `row` / `collapsible` containers (which don't have
   * names) but stops at `group` (groups DO have names; the
   * caller decides whether to recurse into them).
   */
  const findNamed = (fields: NpFieldConfig[], name: string): NpFieldConfig | null => {
    for (const f of fields) {
      if (f.type === "row" || f.type === "collapsible") {
        const inner = findNamed(f.fields, name);
        if (inner) return inner;
        continue;
      }
      if ("name" in f && f.name === name) return f;
    }
    return null;
  };

  const fieldLabelByName = (path: string): string => {
    // Path is either a top-level field name (`"title"`) or a
    // dot-separated path into a group (`"seo.metaTitle"`).
    // Walk the field tree by segment so we resolve nested fields
    // even when their `f.name` doesn't equal the full path.
    const segments = path.split(".");
    let cursor: NpFieldConfig[] | undefined = effectiveFields;
    let found: NpFieldConfig | null = null;
    for (let i = 0; i < segments.length; i += 1) {
      const segment = segments[i];
      if (!cursor) break;
      const next = findNamed(cursor, segment);
      if (!next) {
        found = null;
        break;
      }
      if (i === segments.length - 1) {
        found = next;
        break;
      }
      if (next.type === "group") {
        cursor = next.fields;
      } else {
        cursor = undefined;
      }
    }
    if (found && "label" in found && typeof found.label === "string" && found.label.length > 0) {
      return found.label;
    }
    // Fall back to the last segment as a sensible default —
    // `seo.metaTitle` → `metaTitle`. Better than echoing the
    // full dot path which leaks internal structure.
    return segments[segments.length - 1] ?? path;
  };

  /**
   * Flatten react-hook-form's nested errors object into dot-paths
   * to leaf errors. Leaves have `type` (and usually `message`)
   * — anything that lacks `type` is a container of nested
   * errors and gets walked recursively.
   *
   * `{ title: { type, message }, seo: { metaTitle: { type } } }`
   * → `["title", "seo.metaTitle"]`
   */
  const flattenErrorPaths = (errors: Record<string, unknown>, prefix: string[] = []): string[] => {
    const out: string[] = [];
    for (const [key, value] of Object.entries(errors)) {
      if (!value || typeof value !== "object") continue;
      const obj = value as Record<string, unknown>;
      if ("type" in obj && typeof obj.type === "string") {
        out.push([...prefix, key].join("."));
        continue;
      }
      // Container — recurse. Skip RHF's `root` key which holds
      // form-level errors, not field-specific ones.
      if (key === "root") continue;
      out.push(...flattenErrorPaths(obj, [...prefix, key]));
    }
    return out;
  };

  /**
   * Validation-error surfacing on Save. Without this, a required
   * field that fails react-hook-form's validation just leaves
   * `formState.errors` set — no toast, no scroll, and if the
   * field lives in a collapsed sidebar group the operator sees
   * nothing happen on click. The error toast lists the affected
   * field labels; we also scroll the first one into view + focus
   * it so the operator's next interaction targets the right
   * input.
   */
  const handleValidationErrors = (errors: Record<string, unknown>): void => {
    // Flatten nested error paths so a failing `seo.metaTitle`
    // surfaces as `"metaTitle"` (or its label) in the toast,
    // not `"seo"` (which is the group container, not the field
    // the operator needs to fix).
    const paths = flattenErrorPaths(errors);
    if (paths.length === 0) return;
    const labels = paths.map((p) => fieldLabelByName(p));
    setToast({
      type: "error",
      message:
        labels.length === 1
          ? `Please complete the "${labels[0]}" field.`
          : `Please complete ${labels.length.toString()} required fields: ${labels.slice(0, 3).join(", ")}${
              labels.length > 3 ? `, +${(labels.length - 3).toString()} more` : ""
            }.`,
    });
    setSavingAs(null);
    // Defer scroll until after React commits the toast — the
    // error renderers in FieldRenderer also re-render on this
    // tick, so the matching input has its error-state styling
    // applied by the time we scroll.
    if (typeof window !== "undefined") {
      window.requestAnimationFrame(() => {
        const firstPath = paths[0];
        if (!firstPath) return;
        // react-hook-form's `setFocus` accepts dot-paths for
        // nested fields (`"seo.metaTitle"`) and resolves them
        // through its internal registry. Falls back to a
        // manual DOM lookup for fields whose renderer wraps
        // the input atypically (block editors, upload tiles).
        try {
          form.setFocus(firstPath as never);
        } catch {
          const el = document.querySelector<HTMLElement>(
            `[name="${firstPath}"], [data-field-name="${firstPath}"]`,
          );
          el?.scrollIntoView({ behavior: "smooth", block: "center" });
          el?.focus();
        }
      });
    }
  };

  const submitWithStatus = (status: SaveStatus, publishedAtOverride?: string) =>
    form.handleSubmit(async (values) => {
      setSavingAs(status);
      setToast(null);
      emitSave("saving");

      try {
        const method = doc?.id ? "PATCH" : "POST";
        const endpoint = doc?.id
          ? `/api/collections/${collectionSlug}/${String(doc.id)}`
          : `/api/collections/${collectionSlug}`;

        const wireStatus =
          status === "scheduled" ? "published" : status === "unschedule" ? "draft" : status;
        const body: Record<string, unknown> = { ...values, _status: wireStatus };
        if (status === "scheduled" && publishedAtOverride) {
          body.publishedAt = publishedAtOverride;
        }
        if (status === "unschedule") {
          // Clear the future timestamp so the doc returns to plain draft.
          body.publishedAt = null;
        }

        const response = await npFetch(endpoint, {
          method,
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(body),
        });

        if (!response.ok) {
          const body = (await response.json().catch(() => null)) as {
            error?: { message?: string };
          } | null;
          throw new Error(
            body?.error?.message ?? `Failed to ${doc?.id ? "update" : "create"} document.`,
          );
        }

        const payload = (await response.json()) as {
          doc?: Record<string, unknown> & { id?: string };
        };
        const nextId = payload.doc?.id ?? doc?.id;

        if (doc?.id) {
          const savedValues = buildDefaultValues(effectiveFields, payload.doc ?? values);
          form.reset(savedValues);
          autosaveBaselineRef.current = JSON.stringify(savedValues);
          latestAutosavePayloadRef.current = null;
          setAutosaveStatus({ kind: "idle" });
        }

        setToast({
          type: "success",
          message: successMessage(status, publishedAtOverride),
        });
        emitSave("saved");
        if (status === "scheduled" || status === "unschedule") {
          setScheduleOpen(false);
        }

        if (!doc?.id && nextId !== undefined && nextId !== null) {
          router.push(`/admin/collections/${collectionSlug}/${String(nextId)}`);
          return;
        }

        router.refresh();
      } catch (error) {
        emitSave("error");
        setToast({
          type: "error",
          message: error instanceof Error ? error.message : "Something went wrong while saving.",
        });
      } finally {
        setSavingAs(null);
      }
    }, handleValidationErrors);

  const handleSaveDraft = () => {
    void submitWithStatus("draft")();
  };
  const handleSchedule = (publishedAtIso: string) => {
    void submitWithStatus("scheduled", publishedAtIso)();
  };
  const handleCancelSchedule = () => {
    void submitWithStatus("unschedule")();
  };
  const isSaving = savingAs !== null;
  const isScheduled = currentStatus === "scheduled";
  const scheduleLabel = isScheduled ? "Reschedule" : "Schedule";
  const publishLabel = isScheduled ? "Publish now" : "Publish";
  const authoringStatusLabel =
    savingAs === "draft"
      ? "Saving draft..."
      : savingAs === "published"
        ? "Publishing..."
        : savingAs === "scheduled"
          ? "Scheduling..."
          : savingAs === "unschedule"
            ? "Cancelling schedule..."
            : autosaveStatus.kind === "error"
              ? "Autosave failed"
              : isDirty
                ? "Unsaved changes"
                : null;
  const authoringStatusClass =
    autosaveStatus.kind === "error"
      ? "text-rose-600 dark:text-rose-300"
      : isDirty
        ? "text-amber-700 dark:text-amber-300"
        : "text-muted-foreground";

  const handleDelete = async () => {
    if (!doc?.id) {
      return;
    }

    setIsDeleting(true);
    setToast(null);

    try {
      const response = await npFetch(`/api/collections/${collectionSlug}/${String(doc.id)}`, {
        method: "DELETE",
      });

      if (!response.ok) {
        throw new Error(`Failed to delete ${config.labels.singular.toLowerCase()}.`);
      }

      setToast({ type: "success", message: `${config.labels.singular} deleted successfully.` });
      router.push(`/admin/collections/${collectionSlug}`);
    } catch (error) {
      setToast({
        type: "error",
        message: error instanceof Error ? error.message : "Something went wrong while deleting.",
      });
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <Form {...form}>
      <form
        onSubmit={(e) => {
          void submitWithStatus("published")(e);
        }}
        className="min-w-0 space-y-6 pb-28 md:pb-0"
      >
        {toast ? (
          <div
            className={
              toast.type === "success"
                ? "break-words rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-700 dark:text-emerald-200"
                : "break-words rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-700 dark:text-rose-200"
            }
          >
            {toast.message}
          </div>
        ) : null}

        <div className="flex min-w-0 flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0">
            <div className="flex min-w-0 flex-wrap items-center gap-3">
              <h1 className="min-w-0 break-words text-[22px] font-semibold tracking-[-0.02em] text-neutral-950 dark:text-neutral-50">
                {doc?.id ? `Edit ${config.labels.singular}` : `Create ${config.labels.singular}`}
              </h1>
              {currentStatus ? (
                <StatusBadge
                  status={currentStatus}
                  override={
                    currentStatus === "scheduled" && doc?.publishedAt
                      ? {
                          label: `Scheduled · ${new Date(String(doc.publishedAt)).toLocaleString()}`,
                        }
                      : undefined
                  }
                />
              ) : null}
            </div>
            <p className="mt-2 break-words text-sm text-muted-foreground">
              Shape content, metadata, and publishing details in one pass.
            </p>
            {authoringStatusLabel ? (
              <p
                className={cn("mt-1 break-words text-xs font-medium", authoringStatusClass)}
                data-np-authoring-status
                aria-live="polite"
              >
                {authoringStatusLabel}
              </p>
            ) : null}
            {autosaveEnabled && doc?.id ? (
              <div
                className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 break-words text-xs text-muted-foreground"
                aria-live="polite"
              >
                {autosaveStatus.kind === "saving" ? (
                  "Autosaving..."
                ) : autosaveStatus.kind === "saved" ? (
                  `Autosaved ${formatRelative(autosaveStatus.at)}`
                ) : autosaveStatus.kind === "error" ? (
                  <>
                    <span className="break-words text-rose-600 dark:text-rose-300">
                      Autosave error: {autosaveStatus.message}
                    </span>
                    <Button
                      type="button"
                      variant="link"
                      size="sm"
                      className="h-auto px-0 py-0 text-xs"
                      onClick={handleAutosaveRetry}
                      disabled={isSaving}
                    >
                      Retry
                    </Button>
                  </>
                ) : (
                  "Autosave on"
                )}
              </div>
            ) : null}
          </div>

          <div className="grid min-w-0 grid-cols-1 gap-2 min-[420px]:grid-cols-2 sm:flex sm:flex-wrap sm:items-center sm:justify-end">
            {previewSlug ? (
              <Button type="button" variant="outline" className="w-full sm:w-auto" asChild>
                <Link href={`/api/preview?path=/${collectionSlug}/${previewSlug}`} target="_blank">
                  <Eye className="size-3.5" />
                  Preview
                </Link>
              </Button>
            ) : null}

            {doc?.id ? (
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  void handleDelete();
                }}
                disabled={isDeleting}
                className="w-full text-rose-600 dark:text-rose-300 sm:w-auto"
              >
                {isDeleting ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Trash2 className="size-3.5" />
                )}
                Delete
              </Button>
            ) : null}

            <div className="hidden md:contents">
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  void handleSaveDraft();
                }}
                disabled={isSaving}
                className="w-full sm:w-auto"
              >
                {savingAs === "draft" ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <FileText className="size-3.5" />
                )}
                Save as Draft
              </Button>

              <Button
                type="button"
                variant="outline"
                onClick={() => setScheduleOpen(true)}
                disabled={isSaving}
                className="w-full sm:w-auto"
              >
                {savingAs === "scheduled" || savingAs === "unschedule" ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <CalendarClock className="size-3.5" />
                )}
                {scheduleLabel}
              </Button>

              <Button type="submit" disabled={isSaving} className="w-full sm:w-auto">
                {savingAs === "published" ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Save className="size-3.5" />
                )}
                {publishLabel}
              </Button>
            </div>
          </div>
        </div>

        <ScheduleDialog
          open={scheduleOpen}
          onOpenChange={setScheduleOpen}
          initialPublishedAt={typeof doc?.publishedAt === "string" ? doc.publishedAt : undefined}
          busy={savingAs === "scheduled" || savingAs === "unschedule"}
          onSchedule={handleSchedule}
          onCancelSchedule={isScheduled ? handleCancelSchedule : undefined}
        />

        <div
          data-np-mobile-editor-actions
          className="fixed inset-x-0 bottom-0 z-30 border-t border-neutral-200/80 bg-background/95 px-3 py-3 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] shadow-[0_-10px_28px_rgba(15,23,42,0.12)] backdrop-blur md:hidden dark:border-neutral-800 dark:bg-neutral-950/95"
        >
          <div className="mx-auto grid max-w-screen-sm min-w-0 grid-cols-3 gap-2">
            <Button
              type="button"
              variant="outline"
              aria-label="Save as Draft"
              onClick={() => {
                void handleSaveDraft();
              }}
              disabled={isSaving}
              className="min-w-0 px-2"
            >
              {savingAs === "draft" ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <FileText className="size-3.5" />
              )}
              <span className="min-w-0 truncate">Draft</span>
            </Button>

            <Button
              type="button"
              variant="outline"
              aria-label={scheduleLabel}
              onClick={() => setScheduleOpen(true)}
              disabled={isSaving}
              className="min-w-0 px-2"
            >
              {savingAs === "scheduled" || savingAs === "unschedule" ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <CalendarClock className="size-3.5" />
              )}
              <span className="min-w-0 truncate">{scheduleLabel}</span>
            </Button>

            <Button
              type="submit"
              aria-label={publishLabel}
              disabled={isSaving}
              className="min-w-0 px-2"
            >
              {savingAs === "published" ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Save className="size-3.5" />
              )}
              <span className="min-w-0 truncate">{publishLabel}</span>
            </Button>
          </div>
        </div>

        <div className="grid min-w-0 gap-6 xl:grid-cols-12">
          <div className="min-w-0 space-y-4 xl:col-span-8">
            {config.i18n && doc?.id ? (
              <TranslationTabs collectionSlug={collectionSlug} documentId={String(doc.id)} />
            ) : null}
            {/* Main column render. Mirrors the sidebar's grouping
                semantics for consumer symmetry — fields tagged
                with `admin.group` cluster into a single titled
                Card; ungrouped wrapped fields keep their own
                Card; unwrapped fields (title / richText / blocks)
                render naked so the editor canvas flows seamlessly.
                Walk in field-array order so operators control
                the layout by ordering.
                For built-in `posts` there's nothing in main with
                a group (title + content are unwrapped); the
                infrastructure exists so custom collections with
                multiple main-position fields (e.g. a products
                collection with name + sku + dimensions) can group
                them naturally. */}
            {mainHiddenByKind ? (
              <Card className="min-w-0">
                <CardContent className="flex min-w-0 flex-col items-start gap-3 px-4 py-5">
                  <p className="break-words text-[13px] text-muted-foreground">
                    Every editor field is hidden for {conditionScopeLabel}. Toggle{" "}
                    <button
                      type="button"
                      onClick={() => setShowAllFields(true)}
                      className="font-medium text-[var(--np-color-brand)] underline-offset-[3px] hover:underline"
                    >
                      Show all fields
                    </button>{" "}
                    on the right to surface them.
                  </p>
                </CardContent>
              </Card>
            ) : null}
            {(() => {
              const out: ReactElement[] = [];
              let pending: { name: string; fields: NpFieldConfig[]; startIdx: number } | null =
                null;
              const flush = (): void => {
                if (!pending) return;
                const meta = config.admin?.groupMeta?.[pending.name];
                const Icon = resolveGroupIcon(meta?.icon);
                out.push(
                  <Card
                    key={`group-${pending.startIdx.toString()}-${pending.name}`}
                    className="min-w-0"
                  >
                    <CardHeader className="flex flex-row items-center gap-2">
                      {Icon ? (
                        <span
                          aria-hidden="true"
                          className="flex size-5 shrink-0 items-center justify-center text-neutral-500 dark:text-neutral-400"
                        >
                          <Icon className="size-3.5" />
                        </span>
                      ) : null}
                      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                        <CardTitle className="break-words">{pending.name}</CardTitle>
                        {meta?.description ? (
                          <p className="break-words text-[11.5px] font-normal text-neutral-500 dark:text-neutral-400">
                            {meta.description}
                          </p>
                        ) : null}
                      </div>
                    </CardHeader>
                    <CardContent className="min-w-0 space-y-6">
                      {pending.fields.map((field, i) => (
                        <FieldRenderer
                          key={
                            field.type === "row" || field.type === "collapsible"
                              ? `${field.type}-${i.toString()}`
                              : field.name
                          }
                          field={filterContainerChildren(field, formValues, showAllFields)}
                          control={form.control}
                          collectionSlug={collectionSlug}
                        />
                      ))}
                    </CardContent>
                  </Card>,
                );
                pending = null;
              };
              mainFields.forEach((field, index) => {
                const key =
                  field.type === "row" || field.type === "collapsible"
                    ? `${field.type}-${index.toString()}`
                    : field.name;
                if (isUnwrappedField(field)) {
                  flush();
                  out.push(
                    <FieldRenderer
                      key={key}
                      field={filterContainerChildren(field, formValues, showAllFields)}
                      control={form.control}
                      collectionSlug={collectionSlug}
                    />,
                  );
                  return;
                }
                const groupName =
                  field.type === "row" || field.type === "collapsible"
                    ? null
                    : (field.admin?.group ?? null);
                if (!groupName) {
                  flush();
                  out.push(
                    <Card key={key} className="min-w-0">
                      <CardContent className="min-w-0">
                        <FieldRenderer
                          field={filterContainerChildren(field, formValues, showAllFields)}
                          control={form.control}
                          collectionSlug={collectionSlug}
                        />
                      </CardContent>
                    </Card>,
                  );
                  return;
                }
                if (pending && pending.name === groupName) {
                  pending.fields.push(field);
                } else {
                  flush();
                  pending = { name: groupName, fields: [field], startIdx: index };
                }
              });
              flush();
              return out;
            })()}
          </div>

          <div className="min-w-0 xl:col-span-4">
            <div className="space-y-6 xl:sticky xl:top-20">
              {/* Show-all toggle — only rendered when some field
                  has an `admin.condition` that's currently hiding
                  it. Operators on collections without conditional
                  fields don't see a useless control. The label
                  is wired to the Switch via a stable id so a
                  screen reader announces the relationship; the
                  Switch primitive supplies its own aria-checked. */}
              {hasHiddenFields || showAllFields ? (
                <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-md border border-dashed border-neutral-200 bg-neutral-50/50 px-3 py-2 text-xs dark:border-neutral-800 dark:bg-neutral-900/40">
                  <label
                    htmlFor="np-show-all-fields-toggle"
                    className="cursor-pointer select-none break-words text-muted-foreground"
                  >
                    {showAllFields
                      ? "Showing all fields"
                      : `Showing fields relevant to ${conditionScopeLabel}`}
                  </label>
                  <Switch
                    id="np-show-all-fields-toggle"
                    checked={showAllFields}
                    onCheckedChange={setShowAllFields}
                    aria-label={`Show all fields, including ones hidden by ${conditionScopeLabel}`}
                  />
                </div>
              ) : null}

              {sidebarGroups.length > 0 ? (
                sidebarGroups.map((group) => {
                  // Force-open this group when a field inside it
                  // has a current validation error. PR 6 already
                  // surfaces the error toast + focuses the
                  // failing input; without this the field can
                  // still be inside a collapsed Card, defeating
                  // the focus + scroll. Force lifts as soon as
                  // the operator fixes the field (errors clear).
                  // Recursive check: errors inside `row` /
                  // `collapsible` containers count too. Without
                  // this, a required nested field that fails
                  // validation wouldn't force its parent group
                  // open, defeating the focus + scroll from PR 6.
                  const hasError = fieldTreeHasError(group.fields, form.formState.errors);
                  const meta = config.admin?.groupMeta?.[group.name];
                  return (
                    <SidebarGroupCard
                      key={group.name}
                      name={group.name}
                      storageKey={`np-admin.sidebar-group.${collectionSlug}.${group.name}`}
                      forceOpen={hasError}
                      icon={resolveGroupIcon(meta?.icon)}
                      {...(meta?.description ? { description: meta.description } : {})}
                    >
                      {group.fields.map((field, index) => (
                        <FieldRenderer
                          key={
                            field.type === "row" || field.type === "collapsible"
                              ? `${field.type}-${index}`
                              : field.name
                          }
                          field={filterContainerChildren(field, formValues, showAllFields)}
                          control={form.control}
                          collectionSlug={collectionSlug}
                        />
                      ))}
                    </SidebarGroupCard>
                  );
                })
              ) : hasHiddenFields ? (
                /* Every sidebar field is hidden by `admin.condition`
                   against the current kind. Distinct from "no
                   sidebar fields configured" — operator might
                   wonder if the editor is broken when their
                   familiar Publish / Author / Taxonomy cards
                   disappear after kind change. Surface the
                   reason + escape hatch. */
                <Card className="min-w-0">
                  <CardContent className="flex min-w-0 flex-col items-start gap-3 px-4 py-5">
                    <p className="break-words text-[13px] text-muted-foreground">
                      Every sidebar field is hidden for {conditionScopeLabel}. Toggle{" "}
                      <button
                        type="button"
                        onClick={() => setShowAllFields(true)}
                        className="font-medium text-[var(--np-color-brand)] underline-offset-[3px] hover:underline"
                      >
                        Show all fields
                      </button>{" "}
                      above to surface them.
                    </p>
                  </CardContent>
                </Card>
              ) : (
                <Card className="min-w-0">
                  <CardHeader>
                    <CardTitle className="break-words">Publishing</CardTitle>
                  </CardHeader>
                  <CardContent className="min-w-0">
                    <p className="break-words text-sm text-muted-foreground">
                      No sidebar fields configured for this collection.
                    </p>
                  </CardContent>
                </Card>
              )}

              {doc?.id && config.admin?.navMembership ? (
                <NavMembershipPanel
                  pageId={String(doc.id)}
                  pageTitle={typeof doc.title === "string" ? doc.title : undefined}
                  collectionSlug={collectionSlug}
                />
              ) : null}

              {/* Block-editor aside mount. The in-page block
                  editor portals its Outline + Container-warnings
                  panels here so they stack with the form's
                  Publishing card — matches the design's
                  `editor-aside` (Status / Slug / Page tree /
                  Warnings in a single right column). The div is
                  always present even on collections without a
                  blocks field; it's empty in that case. */}
              <div id="np-block-editor-aside" />

              {doc?.id && config.versions ? (
                <RevisionsPanel
                  collectionSlug={collectionSlug}
                  documentId={String(doc.id)}
                  currentSnapshot={currentFormSnapshot}
                  hasUnsavedChanges={hasUnsavedChanges}
                />
              ) : null}

              {doc?.id && collectionTabs && collectionTabs.length > 0 ? (
                <CollectionTabs
                  tabs={collectionTabs}
                  collection={collectionSlug}
                  documentId={String(doc.id)}
                />
              ) : null}
            </div>
          </div>
        </div>
      </form>
    </Form>
  );
}
