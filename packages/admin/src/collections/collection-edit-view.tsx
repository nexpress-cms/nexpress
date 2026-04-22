"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import type { NxCollectionConfig, NxFieldConfig } from "@nexpress/core";
import { Eye, FileText, Loader2, Save, Trash2 } from "lucide-react";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { FieldRenderer } from "./field-renderer.js";
import { Button } from "../ui/button.js";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card.js";
import { Form } from "../ui/form.js";
import { nxFetch } from "../lib/api-client.js";

interface CollectionEditViewProps {
  config: NxCollectionConfig;
  doc?: Record<string, unknown>;
  collectionSlug: string;
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

type SaveStatus = "draft" | "published";

export function CollectionEditView({ config, doc, collectionSlug }: CollectionEditViewProps) {
  const router = useRouter();
  const [toast, setToast] = useState<ToastState>(null);
  const [savingAs, setSavingAs] = useState<SaveStatus | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const schema = useMemo(() => generateZodSchema(config.fields), [config.fields]);
  const defaultValues = useMemo(() => buildDefaultValues(config.fields, doc ?? {}), [config.fields, doc]);

  const form = useForm<Record<string, unknown>>({
    resolver: zodResolver(schema),
    defaultValues,
  });

  const slugValue = form.watch("slug");
  const previewSlug = typeof slugValue === "string" ? slugValue : typeof doc?.slug === "string" ? doc.slug : "";
  const currentStatus = typeof doc?.status === "string" ? doc.status : null;

  const visibleFields = config.fields.filter(isVisibleField);
  const sidebarFields = visibleFields.filter(isSidebarField);
  const mainFields = visibleFields.filter((field) => !isSidebarField(field));

  const submitWithStatus = (status: SaveStatus) =>
    form.handleSubmit(async (values) => {
      setSavingAs(status);
      setToast(null);

      try {
        const method = doc?.id ? "PATCH" : "POST";
        const endpoint = doc?.id
          ? `/api/collections/${collectionSlug}/${String(doc.id)}`
          : `/api/collections/${collectionSlug}`;

        const response = await nxFetch(endpoint, {
          method,
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ ...values, _status: status }),
        });

        if (!response.ok) {
          throw new Error(`Failed to ${doc?.id ? "update" : "create"} document.`);
        }

        const payload = (await response.json()) as { doc?: Record<string, unknown> };
        const nextId = payload.doc?.id ?? doc?.id;

        setToast({
          type: "success",
          message:
            status === "published"
              ? `${config.labels.singular} published.`
              : `${config.labels.singular} saved as draft.`,
        });

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
  const isSaving = savingAs !== null;

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
      <form onSubmit={handlePublish} className="space-y-6">
        {toast ? (
          <div
            className={
              toast.type === "success"
                ? "rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700"
                : "rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700"
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
                      ? "inline-flex items-center rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-medium text-emerald-800"
                      : currentStatus === "draft"
                        ? "inline-flex items-center rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-800"
                        : "inline-flex items-center rounded-full bg-slate-200 px-2.5 py-0.5 text-xs font-medium text-slate-700"
                  }
                >
                  {currentStatus}
                </span>
              ) : null}
            </div>
            <p className="mt-2 text-sm text-muted-foreground">Shape content, metadata, and publishing details in one pass.</p>
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
              <Button type="button" variant="outline" className="text-rose-600" onClick={handleDelete} disabled={isDeleting}>
                {isDeleting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Trash2 className="mr-2 h-4 w-4" />}
                Delete
              </Button>
            ) : null}

            <Button type="button" variant="outline" onClick={handleSaveDraft} disabled={isSaving}>
              {savingAs === "draft" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FileText className="mr-2 h-4 w-4" />}
              Save as Draft
            </Button>

            <Button type="submit" disabled={isSaving}>
              {savingAs === "published" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
              Publish
            </Button>
          </div>
        </div>

        <div className="grid gap-6 xl:grid-cols-12">
          <div className="space-y-6 xl:col-span-8">
            {mainFields.map((field, index) => (
              <Card key={field.type === "row" || field.type === "collapsible" ? `${field.type}-${index}` : field.name}>
                <CardContent className="pt-6">
                  <FieldRenderer field={field} control={form.control} />
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
                    />
                  ))
                ) : (
                  <p className="text-sm text-muted-foreground">No sidebar fields configured for this collection.</p>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </form>
    </Form>
  );
}
