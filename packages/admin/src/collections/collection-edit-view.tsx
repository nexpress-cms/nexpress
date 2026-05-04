"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import type { NxCollectionConfig, NxFieldConfig } from "@nexpress/core";
import { CalendarClock, Eye, FileText, Loader2, Save, Trash2 } from "lucide-react";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { CollectionTabs, type CollectionTabDescriptor } from "./collection-tabs.js";
import { FieldRenderer } from "./field-renderer.js";
import { NavMembershipPanel } from "./nav-membership-panel.js";
import { RevisionsPanel } from "./revisions-panel.js";
import { ScheduleDialog } from "./schedule-dialog.js";
import { TranslationTabs } from "./translation-tabs.js";
import { Button } from "../ui/button.js";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card.js";
import { Form } from "../ui/form.js";
import { nxFetch } from "../lib/api-client.js";

interface CollectionEditViewProps {
  config: NxCollectionConfig;
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

const getDefaultValue = (field: NxFieldConfig, source: Record<string, unknown>): unknown => {
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

const buildDefaultValues = (fields: NxFieldConfig[], source: Record<string, unknown>): Record<string, unknown> => {
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

const buildFieldSchema = (field: NxFieldConfig): z.ZodType<unknown> => {
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

const buildSchemaShape = (fields: NxFieldConfig[]): Record<string, z.ZodType<unknown>> => {
  const shape: Record<string, z.ZodType<unknown>> = {};

  for (const field of fields) {
    if (field.type === "row" || field.type === "collapsible") {
      Object.assign(shape, buildSchemaShape(field.fields));
      continue;
    }

    let schema = buildFieldSchema(field);

    if (!field.required) {
      schema = schema.optional();
    }

    shape[field.name] = schema;
  }

  return shape;
};

const generateZodSchema = (fields: NxFieldConfig[]) => z.object(buildSchemaShape(fields));

const isSidebarField = (field: NxFieldConfig): boolean => {
  if (field.type === "row" || field.type === "collapsible") {
    return false;
  }

  return field.type === "date" || Boolean(field.admin?.width) || namedSidebarFields.has(field.name);
};

const isVisibleField = (field: NxFieldConfig): boolean => {
  if (field.type === "row" || field.type === "collapsible") {
    return true;
  }

  return !field.hidden;
};

type SaveStatus = "draft" | "published" | "scheduled" | "unschedule";

function formatRelative(timestamp: number): string {
  const seconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000));
  if (seconds < 5) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  return `${hours}h ago`;
}

export function CollectionEditView({ config, doc, collectionSlug, collectionTabs }: CollectionEditViewProps) {
  const router = useRouter();
  const [toast, setToast] = useState<ToastState>(null);
  const [savingAs, setSavingAs] = useState<SaveStatus | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [scheduleOpen, setScheduleOpen] = useState(false);

  const schema = useMemo(() => generateZodSchema(config.fields), [config.fields]);
  const defaultValues = useMemo(() => buildDefaultValues(config.fields, doc ?? {}), [config.fields, doc]);

  const form = useForm<Record<string, unknown>>({
    resolver: zodResolver(schema),
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
          const response = await nxFetch(
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

  const visibleFields = config.fields.filter(isVisibleField);
  const sidebarFields = visibleFields.filter(isSidebarField);
  const mainFields = visibleFields.filter((field) => !isSidebarField(field));

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

        const response = await nxFetch(endpoint, {
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
        if (status === "scheduled" || status === "unschedule") {
          setScheduleOpen(false);
        }

        if (!doc?.id && nextId !== undefined && nextId !== null) {
          router.push(`/admin/collections/${collectionSlug}/${String(nextId)}`);
          return;
        }

        router.refresh();
      } catch (error) {
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
      const response = await nxFetch(`/api/collections/${collectionSlug}/${String(doc.id)}`, {
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
              <h1 className="text-3xl font-semibold tracking-tight">
                {doc?.id ? `Edit ${config.labels.singular}` : `Create ${config.labels.singular}`}
              </h1>
              {currentStatus ? (
                <span
                  className={
                    currentStatus === "published"
                      ? "inline-flex items-center rounded-full bg-emerald-500/15 px-2.5 py-0.5 text-xs font-medium text-emerald-800 dark:text-emerald-300"
                      : currentStatus === "draft"
                        ? "inline-flex items-center rounded-full bg-amber-500/15 px-2.5 py-0.5 text-xs font-medium text-amber-800 dark:text-amber-300"
                        : currentStatus === "scheduled"
                          ? "inline-flex items-center rounded-full bg-sky-100 px-2.5 py-0.5 text-xs font-medium text-sky-800 dark:bg-sky-900/40 dark:text-sky-200"
                          : "inline-flex items-center rounded-full bg-slate-200 px-2.5 py-0.5 text-xs font-medium text-slate-700 dark:bg-slate-800 dark:text-slate-200"
                  }
                >
                  {currentStatus === "scheduled" && doc?.publishedAt
                    ? `scheduled · ${new Date(String(doc.publishedAt)).toLocaleString()}`
                    : currentStatus}
                </span>
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
                  <Eye className="mr-2 h-4 w-4" />
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
                {isDeleting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Trash2 className="mr-2 h-4 w-4" />}
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
              {savingAs === "draft" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FileText className="mr-2 h-4 w-4" />}
              Save as Draft
            </Button>

            <Button
              type="button"
              variant="outline"
              onClick={() => setScheduleOpen(true)}
              disabled={isSaving}
            >
              {savingAs === "scheduled" || savingAs === "unschedule" ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <CalendarClock className="mr-2 h-4 w-4" />
              )}
              {isScheduled ? "Reschedule" : "Schedule"}
            </Button>

            <Button type="submit" disabled={isSaving}>
              {savingAs === "published" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
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
          <div className="space-y-6 xl:col-span-8">
            {config.i18n && doc?.id ? (
              <TranslationTabs
                collectionSlug={collectionSlug}
                documentId={String(doc.id)}
              />
            ) : null}
            {mainFields.map((field, index) => (
              <Card key={field.type === "row" || field.type === "collapsible" ? `${field.type}-${index}` : field.name}>
                <CardContent className="pt-6">
                  <FieldRenderer field={field} control={form.control} collectionSlug={collectionSlug} />
                </CardContent>
              </Card>
            ))}
          </div>

          <div className="space-y-6 xl:col-span-4">
            <Card className="sticky top-6 border-border/60 shadow-sm">
              <CardHeader>
                <CardTitle>Publishing</CardTitle>
              </CardHeader>
              <CardContent className="space-y-6">
                {sidebarFields.length > 0 ? (
                  sidebarFields.map((field, index) => (
                    <FieldRenderer
                      key={field.type === "row" || field.type === "collapsible" ? `${field.type}-${index}` : field.name}
                      field={field}
                      control={form.control}
                      collectionSlug={collectionSlug}
                    />
                  ))
                ) : (
                  <p className="text-sm text-muted-foreground">No sidebar fields configured for this collection.</p>
                )}
              </CardContent>
            </Card>

            {doc?.id && config.admin?.navMembership ? (
              <NavMembershipPanel
                pageId={String(doc.id)}
                pageTitle={typeof doc.title === "string" ? doc.title : undefined}
                collectionSlug={collectionSlug}
              />
            ) : null}

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
      </form>
    </Form>
  );
}
