"use client";

import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  Eye,
  FileUp,
  Languages,
  Loader2,
} from "lucide-react";
import {
  npRequireI18nConfigResponse,
  npRequireTranslationProgressResponse,
  type NpI18nConfigResponse,
} from "@nexpress/core/i18n-contract";

import { npFetch } from "../lib/api-client.js";
import { Badge } from "../ui/badge.js";
import { Button } from "../ui/button.js";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card.js";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog.js";
import { Input } from "../ui/input.js";
import { Label } from "../ui/label.js";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select.js";

type InterchangeFormat = "gettext" | "xliff";
type ImportMode = "preview" | "apply";

interface ImportApplied {
  collection: string;
  docId: string;
  locale: string;
  operation: "create" | "update";
  unitCount: number;
}

interface ImportSkipped {
  reason: string;
  collection?: string;
  groupId?: string;
  locale?: string;
}

interface InterchangeResponse {
  mode: ImportMode;
  format: InterchangeFormat;
  sourceName: string;
  sourceSize: number;
  catalog: {
    documentCount: number;
    unitCount: number;
    sourceLocale: string;
    targetLocale: string;
  };
  result: {
    applied: ImportApplied[];
    skipped: ImportSkipped[];
    wrote: boolean;
  };
}

const ADMIN_LIMIT_COPY = "Admin handles up to 4 MiB, 100 documents, and 2,500 units per file.";

export function TranslationsTab() {
  const [config, setConfig] = useState<NpI18nConfigResponse | null>(null);
  const [collections, setCollections] = useState<string[]>([]);
  const [collection, setCollection] = useState("");
  const [sourceLocale, setSourceLocale] = useState("");
  const [targetLocale, setTargetLocale] = useState("");
  const [exportFormat, setExportFormat] = useState<InterchangeFormat>("xliff");
  const [importFormat, setImportFormat] = useState<InterchangeFormat>("xliff");
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<InterchangeResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState<ImportMode | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load(): Promise<void> {
      try {
        const [configResponse, progressResponse] = await Promise.all([
          npFetch("/api/admin/i18n"),
          npFetch("/api/admin/i18n/progress"),
        ]);
        const rawConfig = (await configResponse.json().catch(() => null)) as unknown;
        const rawProgress = (await progressResponse.json().catch(() => null)) as unknown;
        if (!configResponse.ok) {
          throw new Error("Unable to load i18n configuration.");
        }
        const configBody = npRequireI18nConfigResponse(rawConfig);
        const progressBody = progressResponse.ok
          ? npRequireTranslationProgressResponse(rawProgress)
          : null;
        if (cancelled) return;
        const locales = configBody.enabled ? configBody.locales : [];
        const source = configBody.enabled ? configBody.defaultLocale : "";
        const target = locales.find((locale) => locale !== source) ?? "";
        const collectionNames = progressResponse.ok
          ? (progressBody?.collections.map((entry) => entry.collection) ?? [])
          : [];
        setConfig(configBody);
        setCollections(collectionNames);
        setCollection(collectionNames[0] ?? "");
        setSourceLocale(source);
        setTargetLocale(target);
      } catch (loadError) {
        if (!cancelled) setError((loadError as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const targetLocales = useMemo(
    () => (config?.enabled ? config.locales : []).filter((locale) => locale !== sourceLocale),
    [config, sourceLocale],
  );

  function changeSourceLocale(value: string): void {
    setSourceLocale(value);
    if (value === targetLocale) {
      setTargetLocale(
        (config?.enabled ? config.locales : []).find((locale) => locale !== value) ?? "",
      );
    }
  }

  function changeFile(nextFile: File | null): void {
    setFile(nextFile);
    setResult(null);
    setError(null);
    if (nextFile) {
      const inferred = inferFormat(nextFile.name);
      if (inferred) setImportFormat(inferred);
    }
  }

  async function downloadCatalog(): Promise<void> {
    if (!collection || !sourceLocale || !targetLocale) return;
    setExporting(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        collection,
        sourceLocale,
        targetLocale,
        format: exportFormat,
      });
      const response = await npFetch(`/api/admin/i18n/interchange?${params.toString()}`);
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as unknown;
        throw new Error(errorMessage(payload, "Unable to export translations."));
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download =
        responseFilename(response) ?? `${collection}.${exportFormat === "xliff" ? "xliff" : "po"}`;
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } catch (downloadError) {
      setError((downloadError as Error).message);
    } finally {
      setExporting(false);
    }
  }

  async function submitImport(mode: ImportMode): Promise<void> {
    if (!file) return;
    setImporting(mode);
    setError(null);
    try {
      const formData = new FormData();
      formData.set("file", file);
      formData.set("format", importFormat);
      formData.set("mode", mode);
      const response = await npFetch("/api/admin/i18n/interchange", {
        method: "POST",
        body: formData,
      });
      const payload = (await response.json().catch(() => null)) as unknown;
      if (!response.ok || !isInterchangeResponse(payload)) {
        throw new Error(errorMessage(payload, "Unable to process the translation file."));
      }
      setResult(payload);
      if (mode === "apply") setConfirmOpen(false);
    } catch (importError) {
      setError((importError as Error).message);
    } finally {
      setImporting(null);
    }
  }

  if (loading) {
    return (
      <Card className="min-w-0">
        <CardContent className="space-y-3">
          <div className="h-6 w-48 animate-pulse rounded bg-muted" />
          <div className="h-28 animate-pulse rounded bg-muted/50" />
        </CardContent>
      </Card>
    );
  }

  if (!config?.enabled) {
    return (
      <Card className="min-w-0">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Languages className="h-4 w-4" /> Translation interchange
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          Configure i18n and enable at least one collection before exchanging translations.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="min-w-0 space-y-6">
      {error ? (
        <div
          role="alert"
          className="break-words rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive"
        >
          {error}
        </div>
      ) : null}

      <div className="grid min-w-0 gap-6 xl:grid-cols-2">
        <Card className="min-w-0">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Download className="h-4 w-4" /> Export catalog
            </CardTitle>
            <p className="text-sm text-muted-foreground">
              Download published source content for one collection and locale pair.
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="translation-collection">Collection</Label>
              <Select value={collection} onValueChange={setCollection}>
                <SelectTrigger id="translation-collection">
                  <SelectValue placeholder="Choose a collection" />
                </SelectTrigger>
                <SelectContent>
                  {collections.map((value) => (
                    <SelectItem key={value} value={value}>
                      {value}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <LocaleSelect
                id="translation-source-locale"
                label="Source locale"
                value={sourceLocale}
                locales={config.locales}
                onChange={changeSourceLocale}
              />
              <LocaleSelect
                id="translation-target-locale"
                label="Target locale"
                value={targetLocale}
                locales={targetLocales}
                onChange={setTargetLocale}
              />
            </div>
            <FormatSelect
              value={exportFormat}
              onChange={setExportFormat}
              id="translation-export-format"
            />
            <Button
              className="w-full sm:w-auto"
              disabled={exporting || !collection || !targetLocale}
              onClick={() => void downloadCatalog()}
            >
              {exporting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Download className="h-4 w-4" />
              )}
              {exporting ? "Preparing..." : "Download catalog"}
            </Button>
          </CardContent>
        </Card>

        <Card className="min-w-0">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileUp className="h-4 w-4" /> Import catalog
            </CardTitle>
            <p className="text-sm text-muted-foreground">
              Preview every create, update, and skip before applying the file.
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="translation-file">Translation file</Label>
              <Input
                id="translation-file"
                type="file"
                accept=".po,.xlf,.xliff,application/xliff+xml,text/x-gettext-translation"
                onChange={(event) => changeFile(event.currentTarget.files?.[0] ?? null)}
              />
              <p className="text-xs text-muted-foreground">
                {ADMIN_LIMIT_COPY} Use <code>pnpm xliff</code> or <code>pnpm gettext</code> for
                larger catalogs.
              </p>
            </div>
            <FormatSelect
              value={importFormat}
              onChange={(value) => {
                setImportFormat(value);
                setResult(null);
              }}
              id="translation-import-format"
            />
            <Button
              className="w-full sm:w-auto"
              disabled={!file || importing !== null}
              onClick={() => void submitImport("preview")}
            >
              {importing === "preview" ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Eye className="h-4 w-4" />
              )}
              {importing === "preview" ? "Validating..." : "Preview import"}
            </Button>
          </CardContent>
        </Card>
      </div>

      {result ? (
        <ImportReport
          response={result}
          onApply={() => setConfirmOpen(true)}
          busy={importing !== null}
        />
      ) : null}

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Apply this translation catalog?</DialogTitle>
            <DialogDescription>
              NexPress will parse the file again and revalidate every source value against the live
              site. Empty, stale, or incompatible units remain skipped.
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-lg border border-border/70 bg-muted/40 p-3 text-sm">
            {result
              ? `${result.result.applied.length} document operations and ${result.result.skipped.length} skips were found in the preview.`
              : "Preview the file before applying it."}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setConfirmOpen(false)}
              disabled={importing !== null}
            >
              Cancel
            </Button>
            <Button
              onClick={() => void submitImport("apply")}
              disabled={!file || importing !== null}
            >
              {importing === "apply" ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <CheckCircle2 className="h-4 w-4" />
              )}
              {importing === "apply" ? "Applying..." : "Confirm and apply"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function LocaleSelect(props: {
  id: string;
  label: string;
  value: string;
  locales: readonly string[];
  onChange: (value: string) => void;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={props.id}>{props.label}</Label>
      <Select value={props.value} onValueChange={props.onChange}>
        <SelectTrigger id={props.id}>
          <SelectValue placeholder="Choose locale" />
        </SelectTrigger>
        <SelectContent>
          {props.locales.map((locale) => (
            <SelectItem key={locale} value={locale}>
              {locale}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function FormatSelect(props: {
  id: string;
  value: InterchangeFormat;
  onChange: (value: InterchangeFormat) => void;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={props.id}>Format</Label>
      <Select
        value={props.value}
        onValueChange={(value) => props.onChange(value as InterchangeFormat)}
      >
        <SelectTrigger id={props.id}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="xliff">XLIFF 1.2</SelectItem>
          <SelectItem value="gettext">Gettext PO</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}

function ImportReport(props: {
  response: InterchangeResponse;
  busy: boolean;
  onApply: () => void;
}) {
  const { response } = props;
  const creates = response.result.applied.filter((entry) => entry.operation === "create").length;
  const updates = response.result.applied.length - creates;
  return (
    <Card className="min-w-0">
      <CardHeader className="gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 space-y-1">
          <CardTitle className="flex items-center gap-2">
            {response.mode === "apply" ? (
              <CheckCircle2 className="h-4 w-4 text-emerald-600" />
            ) : (
              <Eye className="h-4 w-4" />
            )}
            {response.mode === "apply" ? "Import applied" : "Import preview"}
          </CardTitle>
          <p className="break-all text-sm text-muted-foreground">{response.sourceName}</p>
        </div>
        {response.mode === "preview" ? (
          <Button
            onClick={props.onApply}
            disabled={props.busy || response.result.applied.length === 0}
          >
            Apply translations
          </Button>
        ) : null}
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <Summary label="Documents" value={response.catalog.documentCount} />
          <Summary label="Units" value={response.catalog.unitCount} />
          <Summary label="Creates" value={creates} />
          <Summary label="Updates" value={updates} />
          <Summary
            label="Skipped"
            value={response.result.skipped.length}
            tone={response.result.skipped.length > 0 ? "warning" : "default"}
          />
        </div>
        <p className="text-sm text-muted-foreground">
          {response.catalog.sourceLocale} → {response.catalog.targetLocale} ·{" "}
          {response.format === "xliff" ? "XLIFF 1.2" : "Gettext PO"}
        </p>
        {response.result.applied.length > 0 ? (
          <div className="min-w-0 space-y-2">
            <h3 className="text-sm font-medium">Document operations</h3>
            <div className="overflow-x-auto rounded-lg border border-border/70">
              <table className="w-full min-w-[620px] text-left text-sm">
                <thead className="bg-muted/40 text-xs text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2">Collection</th>
                    <th className="px-3 py-2">Locale</th>
                    <th className="px-3 py-2">Operation</th>
                    <th className="px-3 py-2">Units</th>
                    <th className="px-3 py-2">Document</th>
                  </tr>
                </thead>
                <tbody>
                  {response.result.applied.map((entry, index) => (
                    <tr
                      key={`${entry.collection}:${entry.docId}:${index}`}
                      className="border-t border-border/60"
                    >
                      <td className="px-3 py-2 font-medium">{entry.collection}</td>
                      <td className="px-3 py-2">{entry.locale}</td>
                      <td className="px-3 py-2">
                        <Badge variant="outline">{entry.operation}</Badge>
                      </td>
                      <td className="px-3 py-2 tabular-nums">{entry.unitCount}</td>
                      <td className="max-w-64 break-all px-3 py-2 font-mono text-xs">
                        {entry.docId}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}
        {response.result.skipped.length > 0 ? (
          <div className="min-w-0 space-y-2">
            <h3 className="flex items-center gap-2 text-sm font-medium">
              <AlertTriangle className="h-4 w-4 text-amber-600" /> Skipped checks
            </h3>
            <ul className="space-y-2">
              {response.result.skipped.map((entry, index) => (
                <li
                  key={`${entry.reason}:${index}`}
                  className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-sm"
                >
                  <p className="break-words">{entry.reason}</p>
                  {entry.collection || entry.locale || entry.groupId ? (
                    <p className="mt-1 break-all font-mono text-xs text-muted-foreground">
                      {[entry.collection, entry.groupId, entry.locale].filter(Boolean).join(" · ")}
                    </p>
                  ) : null}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {response.result.applied.length === 0 && response.result.skipped.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No non-empty translation targets were found.
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}

function Summary(props: { label: string; value: number; tone?: "default" | "warning" }) {
  return (
    <div
      className={
        props.tone === "warning"
          ? "rounded-lg border border-amber-500/30 bg-amber-500/5 p-3"
          : "rounded-lg border border-border/70 bg-muted/30 p-3"
      }
    >
      <p className="text-xs text-muted-foreground">{props.label}</p>
      <p className="mt-1 text-xl font-semibold tabular-nums">{props.value}</p>
    </div>
  );
}

function inferFormat(name: string): InterchangeFormat | null {
  const lower = name.toLowerCase();
  if (lower.endsWith(".po")) return "gettext";
  if (lower.endsWith(".xlf") || lower.endsWith(".xliff")) return "xliff";
  return null;
}

function responseFilename(response: Response): string | null {
  const disposition = response.headers.get("content-disposition");
  const match = disposition?.match(/filename="([^"]+)"/);
  return match?.[1] ?? null;
}

function errorMessage(payload: unknown, fallback: string): string {
  if (!isRecord(payload)) return fallback;
  if (typeof payload.error === "string") return payload.error;
  if (isRecord(payload.error)) {
    if (Array.isArray(payload.error.details)) {
      const first = payload.error.details.find(
        (detail): detail is { message: string } =>
          isRecord(detail) && typeof detail.message === "string",
      );
      if (first) return first.message;
    }
    if (typeof payload.error.message === "string") return payload.error.message;
  }
  return fallback;
}

function isInterchangeResponse(value: unknown): value is InterchangeResponse {
  return (
    isRecord(value) &&
    (value.mode === "preview" || value.mode === "apply") &&
    (value.format === "xliff" || value.format === "gettext") &&
    isRecord(value.catalog) &&
    isRecord(value.result) &&
    Array.isArray(value.result.applied) &&
    Array.isArray(value.result.skipped)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
