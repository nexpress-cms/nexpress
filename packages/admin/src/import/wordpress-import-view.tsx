"use client";

import { type ReactNode, useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  DatabaseZap,
  Eye,
  FileUp,
  Loader2,
  Play,
  RefreshCw,
} from "lucide-react";

import { PageHeader } from "../layout/page-header.js";
import { npFetch } from "../lib/api-client.js";
import { Badge } from "../ui/badge.js";
import { Button } from "../ui/button.js";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../ui/card.js";
import { Input } from "../ui/input.js";
import { Label } from "../ui/label.js";
import { Switch } from "../ui/switch.js";
import { cn } from "../ui/utils.js";

type ImportMode = "preview" | "apply";

interface ListResult<T> {
  total: number;
  items: T[];
  truncated: boolean;
}

interface AppliedRow {
  wpId: number;
  wpType: string;
  collection: string;
  slug: string;
  title: string;
}

interface SkippedRow {
  wpId: number;
  wpType: string;
  slug: string;
  reason: string;
}

interface ErrorRow {
  wpId: number;
  slug: string;
  message: string;
}

interface ImportResponse {
  mode: ImportMode;
  dryRun: boolean;
  sourceName: string;
  site: {
    title: string;
    link: string;
    language: string | null;
  };
  options: {
    update: boolean;
    strict: boolean;
    createAuthors: boolean;
    includeMedia: boolean;
  };
  counts: {
    records: number;
    authors: number;
    terms: number;
    comments: number;
    inlineMediaRefs: number;
    featuredImages: number;
    recordsByType: Record<string, number>;
    termsByTaxonomy: Record<string, number>;
    statuses: Record<string, number>;
  };
  report: {
    applied: ListResult<AppliedRow>;
    skipped: ListResult<SkippedRow>;
    errors: ListResult<ErrorRow>;
    notes: ListResult<string>;
    logs: ListResult<string>;
    attachments: { byId: number; byUrl: number };
    media: {
      status: "not-run" | "completed";
      uploaded: number;
      reused: number;
      skipped: number;
      resolvedUrls: number;
      resolvedAttachments: number;
      errors: ListResult<{ url: string; reason: string }>;
    };
    taxonomies: {
      status: "not-run" | "completed";
      resolved: number;
      skipped: ListResult<{ taxonomy: string; slug: string; name: string }>;
      errors: ListResult<{
        key: { taxonomy: string; slug: string; name: string };
        reason: string;
      }>;
    };
    comments: {
      status: "not-run" | "completed";
      applied: number;
      skippedUnapproved: number;
      skippedNoMember: number;
      skippedByResume: number;
      errors: ListResult<{ wpCommentId: number; reason: string }>;
    };
    authors: {
      status: "not-run" | "completed";
      resolved: number;
      skipped: ListResult<string>;
      errors: ListResult<{ login: string; reason: string }>;
    };
  };
}

interface OptionsState {
  update: boolean;
  strict: boolean;
  createAuthors: boolean;
  includeMedia: boolean;
}

const DEFAULT_OPTIONS: OptionsState = {
  update: false,
  strict: false,
  createAuthors: true,
  includeMedia: true,
};

export function WordPressImportView() {
  const [file, setFile] = useState<File | null>(null);
  const [options, setOptions] = useState<OptionsState>(DEFAULT_OPTIONS);
  const [result, setResult] = useState<ImportResponse | null>(null);
  const [previewKey, setPreviewKey] = useState<string | null>(null);
  const [loading, setLoading] = useState<ImportMode | null>(null);
  const [error, setError] = useState<string | null>(null);

  const currentKey = file ? `${fileKey(file)}:${optionsKey(options)}` : null;
  const canPreview = !!file && loading === null;
  const canApply = !!file && loading === null && previewKey === currentKey;
  const statusTone: "destructive" | "brand" | "secondary" = result?.report.errors.total
    ? "destructive"
    : result
      ? "brand"
      : "secondary";

  const visibleApplied = useMemo(() => result?.report.applied.items ?? [], [result]);
  const visibleSkipped = useMemo(() => result?.report.skipped.items ?? [], [result]);

  async function submit(mode: ImportMode) {
    if (!file) {
      setError("Choose a WXR file first.");
      return;
    }
    if (mode === "apply" && previewKey !== currentKey) {
      setError("Preview this file and option set before applying it.");
      return;
    }
    if (mode === "apply" && !window.confirm("Apply this WordPress import now?")) {
      return;
    }

    setLoading(mode);
    setError(null);
    try {
      const formData = new FormData();
      formData.set("file", file);
      formData.set("mode", mode);
      formData.set("update", String(options.update));
      formData.set("strict", String(options.strict));
      formData.set("createAuthors", String(options.createAuthors));
      formData.set("includeMedia", String(options.includeMedia));

      const response = await npFetch("/api/admin/import/wordpress", {
        method: "POST",
        body: formData,
      });
      const body = (await response.json().catch(() => null)) as
        ImportResponse | { error?: { message?: string } } | null;

      if (!response.ok) {
        setError(
          (body as { error?: { message?: string } } | null)?.error?.message ??
            "WordPress import failed.",
        );
        return;
      }

      const nextResult = body as ImportResponse;
      setResult(nextResult);
      if (mode === "preview") {
        setPreviewKey(currentKey);
      } else {
        setPreviewKey(null);
      }
    } catch {
      setError("WordPress import failed.");
    } finally {
      setLoading(null);
    }
  }

  function updateOption<K extends keyof OptionsState>(key: K, value: OptionsState[K]) {
    setOptions((current) => ({ ...current, [key]: value }));
    setPreviewKey(null);
    setResult(null);
    setError(null);
  }

  return (
    <div className="flex min-w-0 flex-col gap-5">
      <PageHeader
        title="WordPress import"
        description="Preview WXR exports and apply them into NexPress content."
        actions={
          result ? (
            <Badge variant={statusTone}>
              {result.mode === "preview" ? "Preview" : "Applied"} · {result.report.errors.total}{" "}
              errors
            </Badge>
          ) : null
        }
      />

      <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.35fr)]">
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <FileUp className="size-4 text-[var(--np-color-brand)]" />
              <CardTitle>Source</CardTitle>
            </div>
            <CardDescription>WXR XML from Tools - Export in WordPress.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="grid gap-2">
              <Label htmlFor="wp-import-file">WXR file</Label>
              <Input
                id="wp-import-file"
                type="file"
                accept=".xml,.wxr,text/xml,application/xml"
                onChange={(event) => {
                  const nextFile = event.currentTarget.files?.[0] ?? null;
                  setFile(nextFile);
                  setPreviewKey(null);
                  setResult(null);
                  setError(null);
                }}
              />
              {file ? (
                <p className="truncate text-[12px] text-neutral-500 dark:text-neutral-400">
                  {file.name} · {formatBytes(file.size)}
                </p>
              ) : null}
            </div>

            <div className="grid gap-2">
              <OptionSwitch
                checked={options.update}
                label="Update existing slugs"
                onCheckedChange={(checked) => updateOption("update", checked)}
              />
              <OptionSwitch
                checked={options.strict}
                label="Strict failures"
                onCheckedChange={(checked) => updateOption("strict", checked)}
              />
              <OptionSwitch
                checked={options.createAuthors}
                label="Create imported authors"
                onCheckedChange={(checked) => updateOption("createAuthors", checked)}
              />
              <OptionSwitch
                checked={options.includeMedia}
                label="Include media pipeline"
                onCheckedChange={(checked) => updateOption("includeMedia", checked)}
              />
            </div>

            {error ? (
              <div className="flex gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[12.5px] text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                <span>{error}</span>
              </div>
            ) : null}

            <div className="flex flex-col gap-2 sm:flex-row">
              <Button
                type="button"
                variant="brand"
                className="w-full sm:w-auto"
                disabled={!canPreview}
                onClick={() => void submit("preview")}
              >
                {loading === "preview" ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Eye className="size-3.5" />
                )}
                Preview
              </Button>
              <Button
                type="button"
                className="w-full sm:w-auto"
                disabled={!canApply}
                onClick={() => void submit("apply")}
              >
                {loading === "apply" ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Play className="size-3.5" />
                )}
                Apply
              </Button>
              <Button
                type="button"
                variant="outline"
                size="icon"
                disabled={loading !== null}
                onClick={() => {
                  setOptions(DEFAULT_OPTIONS);
                  setResult(null);
                  setPreviewKey(null);
                  setError(null);
                }}
                aria-label="Reset import state"
              >
                <RefreshCw className="size-3.5" />
              </Button>
            </div>
          </CardContent>
        </Card>

        <ReportCard
          result={result}
          visibleApplied={visibleApplied}
          visibleSkipped={visibleSkipped}
        />
      </div>
    </div>
  );
}

function ReportCard({
  result,
  visibleApplied,
  visibleSkipped,
}: {
  result: ImportResponse | null;
  visibleApplied: AppliedRow[];
  visibleSkipped: SkippedRow[];
}) {
  if (!result) {
    return (
      <Card className="min-h-[360px]">
        <CardHeader>
          <div className="flex items-center gap-2">
            <DatabaseZap className="size-4 text-neutral-500" />
            <CardTitle>Report</CardTitle>
          </div>
          <CardDescription>No import report yet.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 sm:grid-cols-2">
            {["Records", "Writes", "Skipped", "Errors"].map((label) => (
              <Metric key={label} label={label} value="-" />
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="flex items-center gap-2">
              {result.report.errors.total > 0 ? (
                <AlertTriangle className="size-4 text-red-500" />
              ) : (
                <CheckCircle2 className="size-4 text-emerald-500" />
              )}
              <CardTitle>{result.sourceName}</CardTitle>
            </div>
            <CardDescription>
              {result.site.title || "(untitled WordPress site)"}
              {result.site.link ? ` · ${result.site.link}` : ""}
            </CardDescription>
          </div>
          <Badge variant={result.dryRun ? "secondary" : "brand"}>
            {result.dryRun ? "Dry run" : "Database written"}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="flex min-w-0 flex-col gap-4">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Metric label="Records" value={result.counts.records} />
          <Metric
            label={result.dryRun ? "Would write" : "Written"}
            value={result.report.applied.total}
          />
          <Metric label="Skipped" value={result.report.skipped.total} />
          <Metric label="Errors" value={result.report.errors.total} tone="danger" />
        </div>

        <ChipGroup title="Record types" values={result.counts.recordsByType} />
        <ChipGroup title="Statuses" values={result.counts.statuses} />

        <div className="grid min-w-0 gap-4 xl:grid-cols-2">
          <RowsSection title={result.dryRun ? "Planned writes" : "Written rows"}>
            {visibleApplied.length > 0 ? (
              visibleApplied.map((row) => (
                <RowLine
                  key={`${row.collection}:${row.slug}:${row.wpId}`}
                  primary={`${row.collection}/${row.slug}`}
                  secondary={`${row.wpType} #${row.wpId} · ${row.title || "(untitled)"}`}
                />
              ))
            ) : (
              <EmptyLine>No rows.</EmptyLine>
            )}
          </RowsSection>

          <RowsSection title="Skipped">
            {visibleSkipped.length > 0 ? (
              visibleSkipped.map((row) => (
                <RowLine
                  key={`${row.wpType}:${row.slug}:${row.wpId}:${row.reason}`}
                  primary={row.slug || `(wp ${row.wpType} #${row.wpId})`}
                  secondary={row.reason}
                />
              ))
            ) : (
              <EmptyLine>No skips.</EmptyLine>
            )}
          </RowsSection>
        </div>

        {result.report.errors.total > 0 ? (
          <RowsSection title="Errors" tone="danger">
            {result.report.errors.items.map((row) => (
              <RowLine
                key={`${row.wpId}:${row.slug}:${row.message}`}
                primary={row.slug || `wp #${row.wpId}`}
                secondary={row.message}
              />
            ))}
          </RowsSection>
        ) : null}

        <PipelineSummary result={result} />

        {result.report.notes.total > 0 ? (
          <RowsSection title="Notes">
            {result.report.notes.items.map((note) => (
              <RowLine key={note} primary={note} />
            ))}
          </RowsSection>
        ) : null}

        {result.report.logs.total > 0 ? (
          <div className="min-w-0 rounded-lg border border-neutral-200/70 bg-neutral-950 px-3 py-2 text-[11.5px] text-neutral-200 dark:border-neutral-800">
            <pre className="max-h-52 overflow-auto whitespace-pre-wrap break-words font-mono">
              {result.report.logs.items.join("\n")}
            </pre>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function PipelineSummary({ result }: { result: ImportResponse }) {
  const rows = [
    {
      label: "Media",
      value:
        result.report.media.status === "completed"
          ? `${result.report.media.uploaded} uploaded, ${result.report.media.reused} reused, ${result.report.media.skipped} skipped`
          : "Not run",
      errorCount: result.report.media.errors.total,
    },
    {
      label: "Taxonomies",
      value:
        result.report.taxonomies.status === "completed"
          ? `${result.report.taxonomies.resolved} resolved`
          : "Not run",
      errorCount: result.report.taxonomies.errors.total,
    },
    {
      label: "Comments",
      value:
        result.report.comments.status === "completed"
          ? `${result.report.comments.applied} imported`
          : "Not run",
      errorCount: result.report.comments.errors.total,
    },
    {
      label: "Authors",
      value:
        result.report.authors.status === "completed"
          ? `${result.report.authors.resolved} resolved`
          : "Not run",
      errorCount: result.report.authors.errors.total,
    },
  ];

  return (
    <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
      {rows.map((row) => (
        <div
          key={row.label}
          className="min-w-0 rounded-lg border border-neutral-200/70 px-3 py-2 dark:border-neutral-800"
        >
          <div className="flex items-center justify-between gap-2">
            <p className="text-[12px] font-medium text-neutral-700 dark:text-neutral-300">
              {row.label}
            </p>
            {row.errorCount > 0 ? (
              <Badge variant="destructive">{row.errorCount}</Badge>
            ) : (
              <Badge variant="secondary">OK</Badge>
            )}
          </div>
          <p className="mt-1 truncate text-[12px] text-neutral-500 dark:text-neutral-400">
            {row.value}
          </p>
        </div>
      ))}
    </div>
  );
}

function OptionSwitch({
  checked,
  label,
  onCheckedChange,
}: {
  checked: boolean;
  label: string;
  onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex min-h-10 items-center justify-between gap-3 rounded-lg border border-neutral-200/70 px-3 py-2 dark:border-neutral-800">
      <Label className="min-w-0 text-[13px] text-neutral-700 dark:text-neutral-300">{label}</Label>
      <Switch checked={checked} onCheckedChange={onCheckedChange} />
    </div>
  );
}

function Metric({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: string | number;
  tone?: "default" | "danger";
}) {
  return (
    <div className="min-w-0 rounded-lg border border-neutral-200/70 px-3 py-2 dark:border-neutral-800">
      <p className="text-[11.5px] text-neutral-500 dark:text-neutral-400">{label}</p>
      <p
        className={cn(
          "mt-1 truncate text-[22px] font-semibold leading-none tracking-[-0.02em]",
          tone === "danger" && Number(value) > 0
            ? "text-red-600 dark:text-red-300"
            : "text-neutral-950 dark:text-neutral-50",
        )}
      >
        {value}
      </p>
    </div>
  );
}

function ChipGroup({ title, values }: { title: string; values: Record<string, number> }) {
  const entries = Object.entries(values);
  if (entries.length === 0) return null;
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-2">
      <span className="text-[12px] font-medium text-neutral-500 dark:text-neutral-400">
        {title}
      </span>
      {entries.map(([key, count]) => (
        <Badge key={key} variant="secondary">
          {key} {count}
        </Badge>
      ))}
    </div>
  );
}

function RowsSection({
  title,
  tone = "default",
  children,
}: {
  title: string;
  tone?: "default" | "danger";
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        "min-w-0 rounded-lg border border-neutral-200/70 dark:border-neutral-800",
        tone === "danger" &&
          "border-red-200 bg-red-50/50 dark:border-red-500/30 dark:bg-red-500/10",
      )}
    >
      <div className="border-b border-neutral-200/70 px-3 py-2 dark:border-neutral-800">
        <p className="text-[12px] font-medium text-neutral-700 dark:text-neutral-300">{title}</p>
      </div>
      <div className="max-h-64 overflow-auto">{children}</div>
    </div>
  );
}

function RowLine({ primary, secondary }: { primary: string; secondary?: string }) {
  return (
    <div className="min-w-0 border-b border-neutral-100 px-3 py-2 last:border-b-0 dark:border-neutral-900">
      <p className="truncate text-[12.5px] font-medium text-neutral-900 dark:text-neutral-100">
        {primary}
      </p>
      {secondary ? (
        <p className="mt-0.5 break-words text-[12px] text-neutral-500 dark:text-neutral-400">
          {secondary}
        </p>
      ) : null}
    </div>
  );
}

function EmptyLine({ children }: { children: ReactNode }) {
  return <p className="px-3 py-3 text-[12px] text-neutral-500 dark:text-neutral-400">{children}</p>;
}

function fileKey(file: File): string {
  return `${file.name}:${file.size}:${file.lastModified}`;
}

function optionsKey(options: OptionsState): string {
  return [
    options.update ? "update" : "no-update",
    options.strict ? "strict" : "soft",
    options.createAuthors ? "authors" : "no-authors",
    options.includeMedia ? "media" : "no-media",
  ].join(":");
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
