"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import { collectHiddenFieldNames } from "@nexpress/core";
import type { NpCollectionConfig, NpFieldConfig } from "@nexpress/core";
import { CalendarClock, ChevronRight, Eye, FileText, Loader2, Save, Trash2 } from "lucide-react";
import { useForm } from "react-hook-form";
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

const buildDefaultValues = (fields: NpFieldConfig[], source: Record<string, unknown>): Record<string, unknown> => {
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

    const effectiveRequired =
      field.required && !hiddenByCondition.has(field.name);
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
  const condition = field.admin?.condition;
  if (!condition) return true;
  try {
    return condition(formValues, formValues);
  } catch {
    // A buggy condition shouldn't crash the editor — fall back
    // to showing the field so the operator can still author.
    return true;
  }
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
  children,
}: {
  name: string;
  storageKey: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState<boolean>(true);
  // Hydrate from localStorage on mount. Two-stage default so SSR
  // and first paint stay consistent (open) regardless of what
  // the operator previously stored — the snap-to-stored happens
  // post-mount and Radix animates the collapse if needed.
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const stored = window.localStorage.getItem(storageKey);
      if (stored === "closed") setOpen(false);
    } catch {
      // see other localStorage call sites
    }
  }, [storageKey]);
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(storageKey, open ? "open" : "closed");
    } catch {
      // see above
    }
  }, [storageKey, open]);

  return (
    <Collapsible open={open} onOpenChange={setOpen} asChild>
      <Card>
        <CollapsibleTrigger asChild>
          <CardHeader
            className="cursor-pointer select-none flex flex-row items-center justify-between"
            role="button"
            tabIndex={0}
            aria-expanded={open}
            aria-controls={`np-sidebar-group-${storageKey}`}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                setOpen((v) => !v);
              }
            }}
          >
            <CardTitle>{name}</CardTitle>
            <ChevronRight
              aria-hidden="true"
              className={cn(
                "size-4 text-muted-foreground transition-transform",
                open && "rotate-90",
              )}
            />
          </CardHeader>
        </CollapsibleTrigger>
        <CollapsibleContent id={`np-sidebar-group-${storageKey}`}>
          <CardContent className="space-y-6">{children}</CardContent>
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

function CollectionEditViewInner({ config, doc, collectionSlug, collectionTabs }: CollectionEditViewProps) {
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

  // Sync form inputs with server state after saves, revision restores, or any
  // other refresh that swaps the `doc` prop — react-hook-form's defaultValues
  // is consumed only on mount, so the form would otherwise show stale values.
  useEffect(() => {
    form.reset(defaultValues);
  }, [defaultValues, form]);

  const slugValue = form.watch("slug");
  const previewSlug = typeof slugValue === "string" ? slugValue : typeof doc?.slug === "string" ? doc.slug : "";
  const currentStatus = typeof doc?.status === "string" ? doc.status : null;

  // Autosave wiring — enabled only when the collection opts in via
  // versions.drafts.autosave === true. Reads optional autosaveInterval too.
  const autosaveEnabled =
    typeof config.versions?.drafts === "object" && config.versions.drafts.autosave === true;
  const autosaveInterval =
    typeof config.versions?.drafts === "object" && typeof config.versions.drafts.autosaveInterval === "number"
      ? config.versions.drafts.autosaveInterval
      : 5_000;
  const [autosaveStatus, setAutosaveStatus] = useState<
    | { kind: "idle" }
    | { kind: "saving" }
    | { kind: "saved"; at: number }
    | { kind: "error"; message: string }
  >({ kind: "idle" });

  // Hold the pending debounce handle in a ref so each keystroke can clear
  // the previous timer — react-hook-form's `watch` callback ignores any
  // value its subscriber returns, so a `return () => clearTimeout(...)`
  // inside the callback would be silently dropped. Without this ref the
  // user's first edit queues a timeout, the second queues another, and so
  // on; after the debounce window every queued timer fires and floods the
  // endpoint. The server dedups, but the network spam is wasteful.
  const autosaveTimer = useRef<number | null>(null);
  // `savingAs` is read inside the timer callback below; capture it via a
  // ref so we don't have to re-subscribe form.watch every time it changes.
  const savingAsRef = useRef(savingAs);
  useEffect(() => {
    savingAsRef.current = savingAs;
  }, [savingAs]);

  useEffect(() => {
    if (!autosaveEnabled || !doc?.id) return;

    const subscription = form.watch((values, { type }) => {
      // Only react to user edits — `reset()` after a real save would
      // otherwise re-trigger autosave with the same data we just persisted.
      if (type !== "change") return;
      const documentId = String(doc.id);
      const snapshot = JSON.parse(JSON.stringify(values)) as Record<string, unknown>;

      if (autosaveTimer.current !== null) {
        window.clearTimeout(autosaveTimer.current);
      }
      const runAutosave = async () => {
        autosaveTimer.current = null;
        // Skip when a manual Draft/Publish/Schedule save is in flight —
        // they'll write a real revision themselves.
        if (savingAsRef.current !== null) return;
        try {
          setAutosaveStatus({ kind: "saving" });
          const response = await npFetch(
            `/api/collections/${collectionSlug}/${documentId}/autosave`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(snapshot),
            },
          );
          if (!response.ok) {
            const body = (await response.json().catch(() => null)) as
              | { error?: { message?: string } }
              | null;
            throw new Error(body?.error?.message ?? `HTTP ${response.status}`);
          }
          setAutosaveStatus({ kind: "saved", at: Date.now() });
        } catch (error) {
          setAutosaveStatus({
            kind: "error",
            message: error instanceof Error ? error.message : "Autosave failed",
          });
        }
      };
      autosaveTimer.current = window.setTimeout(() => {
        void runAutosave();
      }, autosaveInterval);
    });

    return () => {
      subscription.unsubscribe();
      if (autosaveTimer.current !== null) {
        window.clearTimeout(autosaveTimer.current);
        autosaveTimer.current = null;
      }
    };
  }, [autosaveEnabled, autosaveInterval, collectionSlug, doc?.id, form]);

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
    try {
      const stored = window.localStorage.getItem(showAllStorageKey);
      if (stored === "1") setShowAllFields(true);
    } catch {
      // localStorage access can throw in restricted contexts
      // (private mode, sandboxed iframes). Silent fallback.
    }
  }, [showAllStorageKey]);
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(showAllStorageKey, showAllFields ? "1" : "0");
    } catch {
      // see above
    }
  }, [showAllStorageKey, showAllFields]);

  // Live form values for `admin.condition` evaluation. `form.watch()`
  // returns the current snapshot and resubscribes on render —
  // expensive on big forms, but the form values are small JSON
  // and the alternative (per-field subscriptions) would scatter
  // the condition logic across renderers.
  const formValues = form.watch();

  const visibleFields = effectiveFields.filter(isVisibleField);
  const passes = (field: NpFieldConfig): boolean =>
    passesCondition(field, formValues, showAllFields);
  const sidebarFields = visibleFields.filter(isSidebarField).filter(passes);
  const mainFields = visibleFields
    .filter((field) => !isSidebarField(field))
    .filter(passes);

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
      sidebarGroups[idx]!.fields.push(field);
    }
  }

  // Has the active kind filter actually hidden any field? Used to
  // decide whether to show the "Show all fields" toggle at all —
  // no hidden fields → no point in offering the escape hatch.
  const hasHiddenFields = !showAllFields && visibleFields.some((field) => {
    if (field.type === "row" || field.type === "collapsible") return false;
    return field.admin?.condition !== undefined && !passesCondition(field, formValues, false);
  });

  const successMessage = (status: SaveStatus, publishedAt?: string): string => {
    if (status === "scheduled" && publishedAt) {
      return `${config.labels.singular} scheduled for ${new Date(publishedAt).toLocaleString()}.`;
    }
    if (status === "published") return `${config.labels.singular} published.`;
    if (status === "unschedule") return `${config.labels.singular} schedule cancelled — back to draft.`;
    return `${config.labels.singular} saved as draft.`;
  };

  /**
   * `status` controls the wire payload's `_status` and the toast copy.
   * Scheduling is just `_status: "published"` + a future `publishedAt` —
   * the pipeline coerces that to `status: "scheduled"` server-side.
   */
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

        const wireStatus = status === "scheduled" ? "published" : status === "unschedule" ? "draft" : status;
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
          throw new Error(`Failed to ${doc?.id ? "update" : "create"} document.`);
        }

        const payload = (await response.json()) as {
          doc?: Record<string, unknown> & { id?: string };
        };
        const nextId = payload.doc?.id ?? doc?.id;

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
    });

  const handleSaveDraft = submitWithStatus("draft");
  const handlePublish = submitWithStatus("published");
  const handleSchedule = (publishedAtIso: string) => {
    void submitWithStatus("scheduled", publishedAtIso)();
  };
  const handleCancelSchedule = () => {
    void submitWithStatus("unschedule")();
  };
  const isSaving = savingAs !== null;
  const isScheduled = currentStatus === "scheduled";

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
          void handlePublish(e);
        }}
        className="space-y-6"
      >
        {toast ? (
          <div
            className={
              toast.type === "success"
                ? "rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-700 dark:text-emerald-200"
                : "rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-700 dark:text-rose-200"
            }
          >
            {toast.message}
          </div>
        ) : null}

        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-[22px] font-semibold tracking-[-0.02em] text-neutral-950 dark:text-neutral-50">
                {doc?.id ? `Edit ${config.labels.singular}` : `Create ${config.labels.singular}`}
              </h1>
              {currentStatus ? (
                <StatusBadge
                  status={currentStatus}
                  override={
                    currentStatus === "scheduled" && doc?.publishedAt
                      ? { label: `Scheduled · ${new Date(String(doc.publishedAt)).toLocaleString()}` }
                      : undefined
                  }
                />
              ) : null}
            </div>
            <p className="mt-2 text-sm text-muted-foreground">Shape content, metadata, and publishing details in one pass.</p>
            {autosaveEnabled && doc?.id ? (
              <p className="mt-1 text-xs text-muted-foreground" aria-live="polite">
                {autosaveStatus.kind === "saving"
                  ? "Autosaving…"
                  : autosaveStatus.kind === "saved"
                    ? `Autosaved ${formatRelative(autosaveStatus.at)}`
                    : autosaveStatus.kind === "error"
                      ? <span className="text-rose-600 dark:text-rose-300">Autosave error: {autosaveStatus.message}</span>
                      : "Autosave on"}
              </p>
            ) : null}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {previewSlug ? (
              <Button type="button" variant="outline" asChild>
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
                className="text-rose-600 dark:text-rose-300"
                onClick={() => {
                  void handleDelete();
                }}
                disabled={isDeleting}
              >
                {isDeleting ? <Loader2 className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />}
                Delete
              </Button>
            ) : null}

            <Button
              type="button"
              variant="outline"
              onClick={() => {
                void handleSaveDraft();
              }}
              disabled={isSaving}
            >
              {savingAs === "draft" ? <Loader2 className="size-3.5 animate-spin" /> : <FileText className="size-3.5" />}
              Save as Draft
            </Button>

            <Button
              type="button"
              variant="outline"
              onClick={() => setScheduleOpen(true)}
              disabled={isSaving}
            >
              {savingAs === "scheduled" || savingAs === "unschedule" ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <CalendarClock className="size-3.5" />
              )}
              {isScheduled ? "Reschedule" : "Schedule"}
            </Button>

            <Button type="submit" disabled={isSaving}>
              {savingAs === "published" ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}
              {isScheduled ? "Publish now" : "Publish"}
            </Button>
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

        <div className="grid gap-6 xl:grid-cols-12">
          <div className="space-y-4 xl:col-span-8">
            {config.i18n && doc?.id ? (
              <TranslationTabs
                collectionSlug={collectionSlug}
                documentId={String(doc.id)}
              />
            ) : null}
            {mainFields.map((field, index) => {
              const key =
                field.type === "row" || field.type === "collapsible"
                  ? `${field.type}-${index}`
                  : field.name;
              // Title + blocks render naked so they form a single
              // editing composition: large title flows into the
              // editor canvas with no Card seam between them.
              if (isUnwrappedField(field)) {
                return (
                  <FieldRenderer
                    key={key}
                    field={field}
                    control={form.control}
                    collectionSlug={collectionSlug}
                  />
                );
              }
              return (
                <Card key={key}>
                  <CardContent>
                    <FieldRenderer field={field} control={form.control} collectionSlug={collectionSlug} />
                  </CardContent>
                </Card>
              );
            })}
          </div>

          <div className="xl:col-span-4">
            <div className="sticky top-20 space-y-6">
              {/* Show-all toggle — only rendered when some field
                  has an `admin.condition` that's currently hiding
                  it. Operators on collections without conditional
                  fields don't see a useless control. */}
              {(hasHiddenFields || showAllFields) ? (
                <div className="flex items-center justify-between rounded-md border border-dashed border-neutral-200 bg-neutral-50/50 px-3 py-2 text-xs dark:border-neutral-800 dark:bg-neutral-900/40">
                  <span className="text-muted-foreground">
                    {showAllFields ? "Showing all fields" : "Showing fields relevant to this kind"}
                  </span>
                  <Switch
                    checked={showAllFields}
                    onCheckedChange={setShowAllFields}
                    aria-label="Show all fields, including ones hidden by the current kind"
                  />
                </div>
              ) : null}

              {sidebarGroups.length > 0 ? (
                sidebarGroups.map((group) => (
                  <SidebarGroupCard
                    key={group.name}
                    name={group.name}
                    storageKey={`np-admin.sidebar-group.${collectionSlug}.${group.name}`}
                  >
                    {group.fields.map((field, index) => (
                      <FieldRenderer
                        key={
                          field.type === "row" || field.type === "collapsible"
                            ? `${field.type}-${index}`
                            : field.name
                        }
                        field={field}
                        control={form.control}
                        collectionSlug={collectionSlug}
                      />
                    ))}
                  </SidebarGroupCard>
                ))
              ) : (
                <Card>
                  <CardHeader>
                    <CardTitle>Publishing</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-sm text-muted-foreground">
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
