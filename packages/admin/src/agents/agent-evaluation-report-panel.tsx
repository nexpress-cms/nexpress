import * as React from "react";
import {
  npAgentEvaluationReportMaxEntriesV2,
  npAgentEvaluationReportRecipesV1,
  npAgentEvaluationWorkbenchRequestMaxBytesV1,
  npReadAgentEvaluationReportDatasetV2,
  type NpAgentEvaluationReportInputV1,
  type NpAgentEvaluationReportRecipeV1,
  type NpAgentEvaluationWorkbenchReportV2,
} from "@nexpress/core/agent-contract";
import { Button } from "../ui/button.js";
import { Input } from "../ui/input.js";
import { Label } from "../ui/label.js";
import { AgentRecoveryBoundary, useAgentRetryBlocked } from "./agent-recovery.js";
import { AgentStudioApiError } from "./agent-studio-api.js";
import {
  downloadEvaluationArtifact,
  evaluationFileFields,
  evaluationFileLabels,
  evaluationRecipeLabels,
  EvaluationWorkbenchRequests,
  generateAgentEvaluationReport,
  readEvaluationArtifact,
  type EvaluationFileField,
} from "./agent-evaluation-workbench-api.js";

type ReportFile =
  | { state: "reading"; bytes: number }
  | { state: "invalid"; message: string }
  | { state: "ready"; bytes: number; name: string; value: unknown }
  | null;

interface Dataset {
  id: number;
  recipe: NpAgentEvaluationReportRecipeV1;
  files: Record<EvaluationFileField, ReportFile>;
}

type ReportEntry = NpAgentEvaluationReportInputV1["entries"][number];
export interface EvaluationReportPanelActions {
  addValidatedEvaluation: (entry: ReportEntry) => void;
  cancelTransfer: () => void;
}

const initialDataset = (id: number): Dataset => ({
  id,
  recipe: "moderator-assessment",
  files: { evaluation: null, review: null, baseline: null, baselineReview: null },
});
const artifact = (file: ReportFile) => (file?.state === "ready" ? file.value : null);
const fileBytes = (file: ReportFile | undefined) => (file && "bytes" in file ? file.bytes : 0);
const datasetBytes = (dataset: Dataset) =>
  Object.values(dataset.files).reduce((total, file) => total + fileBytes(file), 0);
const fromWorkbench = (name: string, value: unknown): ReportFile =>
  value === null || value === undefined
    ? null
    : {
        state: "ready",
        name,
        value,
        bytes: new TextEncoder().encode(JSON.stringify(value)).length,
      };
const focusCancelButton = (button: HTMLButtonElement | null) => button?.focus();

function ReportFileField({
  field,
  id,
  file,
  onImport,
}: {
  field: EvaluationFileField;
  id: string;
  file: ReportFile;
  onImport: (file: File | undefined) => void;
}) {
  const input = React.useRef<HTMLInputElement>(null);
  return (
    <div className="min-w-0 space-y-2">
      <Label htmlFor={id}>Dataset {evaluationFileLabels[field].toLowerCase()}</Label>
      <Input
        ref={input}
        id={id}
        type="file"
        accept=".json,application/json"
        aria-invalid={file?.state === "invalid" || undefined}
        aria-describedby={file?.state === "invalid" ? `${id}-error` : undefined}
        onChange={(event) => onImport(event.target.files?.[0])}
      />
      {file ? (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          {file.state === "ready" ? <span className="break-all">{file.name}</span> : null}
          {file.state === "invalid" ? (
            <span id={`${id}-error`} role="alert">
              {file.message}
            </span>
          ) : null}
          <Button
            size="sm"
            variant="ghost"
            aria-label={`Clear ${evaluationFileLabels[field]}`}
            onClick={() => {
              if (input.current) {
                input.current.value = "";
                input.current.focus();
              }
              onImport(undefined);
            }}
          >
            Clear file
          </Button>
        </div>
      ) : null}
    </div>
  );
}

export function AgentEvaluationReportPanel({
  onAccessLost,
  ref,
}: {
  onAccessLost: (error: AgentStudioApiError) => void;
  ref?: React.Ref<EvaluationReportPanelActions>;
}) {
  const [datasets, setDatasets] = React.useState(() => [initialDataset(1)]);
  const [replacement, setReplacement] = React.useState<{
    targetId: number;
    dataset: Dataset;
    description: string;
  } | null>(null);
  const [transferStatus, setTransferStatus] = React.useState("");
  const nextId = React.useRef(2);
  const focusDataset = React.useRef<number>(null);
  const details = React.useRef<HTMLDetailsElement>(null);
  const [result, setResult] = React.useState<NpAgentEvaluationWorkbenchReportV2 | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [failure, setFailure] = React.useState<unknown>();
  const [error, setError] = React.useState<string | null>(null);
  const requests = React.useRef(new EvaluationWorkbenchRequests());
  const urls = React.useRef(new Set<string>());
  const prefix = React.useId();
  const retryBlocked = useAgentRetryBlocked(failure);
  const reading = datasets.some(({ files }) =>
    evaluationFileFields.some((field) => files[field]?.state === "reading"),
  );
  const complete = datasets.every(
    ({ files }) =>
      files.evaluation?.state === "ready" &&
      (!files.baselineReview || files.baseline?.state === "ready") &&
      evaluationFileFields.every((field) => !files[field] || files[field]?.state === "ready"),
  );

  React.useEffect(() => {
    const requestOwner = requests.current;
    const downloadUrls = urls.current;
    return () => {
      requestOwner.cancel();
      for (const url of downloadUrls) URL.revokeObjectURL(url);
      downloadUrls.clear();
    };
  }, []);

  function invalidate() {
    requests.current.cancel();
    setBusy(false);
    setResult(null);
    setError(null);
    setReplacement(null);
    setTransferStatus("");
  }

  function placeDataset(dataset: Dataset, targetId: number | undefined, message: string) {
    invalidate();
    focusDataset.current = dataset.id;
    setDatasets((current) =>
      targetId === undefined
        ? [...current, dataset]
        : current.map((entry) => (entry.id === targetId ? dataset : entry)),
    );
    setTransferStatus(message);
  }

  function addValidatedEvaluation(entry: ReportEntry) {
    if (details.current) details.current.open = true;
    setReplacement(null);
    setError(null);
    setTransferStatus("");
    const identity = npReadAgentEvaluationReportDatasetV2(entry.current.evaluation);
    if (!identity) {
      setError("The validated dataset identity could not be read.");
      return;
    }
    const matches = datasets.filter(({ recipe, files }) => {
      if (recipe !== entry.recipe) return false;
      const existing = npReadAgentEvaluationReportDatasetV2(artifact(files.evaluation));
      return existing?.id === identity.id && existing.version === identity.version;
    });
    if (matches.length > 1) {
      setError("Remove duplicate entries for this dataset before adding the validated evaluation.");
      return;
    }
    const target =
      matches[0] ??
      datasets.find(({ files }) => Object.values(files).every((file) => file === null));
    if (!target && datasets.length >= npAgentEvaluationReportMaxEntriesV2) {
      setError("Remove a dataset to make room for this evaluation.");
      return;
    }
    const dataset: Dataset = {
      id: nextId.current++,
      recipe: entry.recipe,
      files: {
        evaluation: fromWorkbench("Validated evaluation", entry.current.evaluation),
        review: fromWorkbench("Validated current review", entry.current.review),
        baseline: fromWorkbench("Validated baseline evaluation", entry.baseline?.evaluation),
        baselineReview: fromWorkbench("Validated baseline review", entry.baseline?.review),
      },
    };
    const bytes = datasets.reduce(
      (total, item) => total + (item.id === target?.id ? 0 : datasetBytes(item)),
      datasetBytes(dataset),
    );
    if (bytes > npAgentEvaluationWorkbenchRequestMaxBytesV1) {
      setError("All files and evaluations together must fit within 4 MiB.");
      return;
    }
    if (matches[0]) {
      setReplacement({
        targetId: matches[0].id,
        dataset,
        description: `${identity.id}, version ${identity.version}`,
      });
      return;
    }
    placeDataset(dataset, target?.id, "Validated evaluation added.");
  }

  React.useImperativeHandle(ref, () => ({
    addValidatedEvaluation,
    cancelTransfer: () => setReplacement(null),
  }));

  async function importFile(id: number, field: EvaluationFileField, file: File | undefined) {
    invalidate();
    let pending: ReportFile = null;
    if (file) {
      const bytes = datasets.reduce(
        (total, dataset) =>
          total + datasetBytes(dataset) - (dataset.id === id ? fileBytes(dataset.files[field]) : 0),
        file.size,
      );
      pending =
        bytes > npAgentEvaluationWorkbenchRequestMaxBytesV1
          ? { state: "invalid", message: "All files together must fit within 4 MiB." }
          : { state: "reading", bytes: file.size };
    }
    setDatasets((current) =>
      current.map((dataset) =>
        dataset.id === id ? { ...dataset, files: { ...dataset.files, [field]: pending } } : dataset,
      ),
    );
    if (!file || pending?.state !== "reading") return;
    let loaded: ReportFile;
    try {
      loaded = { state: "ready", bytes: pending.bytes, ...(await readEvaluationArtifact(file)) };
    } catch {
      loaded = { state: "invalid", message: "Select valid artifact JSON or clear this file." };
    }
    // A replacement, removal or clear invalidates this file read.
    setDatasets((current) =>
      current.map((dataset) =>
        dataset.id === id && dataset.files[field] === pending
          ? { ...dataset, files: { ...dataset.files, [field]: loaded } }
          : dataset,
      ),
    );
  }

  async function generate() {
    if (!complete || busy || retryBlocked || replacement) return;
    const controller = requests.current.begin();
    setBusy(true);
    setError(null);
    try {
      const report = await generateAgentEvaluationReport(
        {
          schemaVersion: "np.agent-eval-report-input.v2",
          entries: datasets.map(({ recipe, files }) => ({
            recipe,
            current: { evaluation: artifact(files.evaluation), review: artifact(files.review) },
            baseline: files.baseline
              ? { evaluation: artifact(files.baseline), review: artifact(files.baselineReview) }
              : null,
          })),
        },
        controller.signal,
      );
      if (!requests.current.current(controller)) return;
      setResult(report);
      setFailure(undefined);
    } catch (caught) {
      if (!requests.current.current(controller)) return;
      if (caught instanceof AgentStudioApiError && [401, 403].includes(caught.status)) {
        onAccessLost(caught);
        return;
      }
      setFailure(caught);
      setError(
        caught instanceof AgentStudioApiError && caught.status !== 400
          ? `${caught.message} (${caught.code})`
          : "Check for duplicate datasets, compatible files and exact review bindings within the combined 4 MiB limit.",
      );
    } finally {
      if (requests.current.current(controller)) setBusy(false);
    }
  }

  return (
    <details ref={details} className="rounded-xl border">
      <summary className="cursor-pointer rounded-xl p-4 text-sm font-semibold focus-visible:ring-2 focus-visible:ring-[var(--np-color-brand-ring)]">
        Build a multi-dataset report
      </summary>
      <div className="space-y-3 px-4 pb-4">
        <p className="text-sm text-neutral-500">
          Add one evaluation per dataset and version, with its own optional review and baseline. All
          files together must fit within 4 MiB. A baseline review requires its baseline evaluation.
        </p>
        <AgentRecoveryBoundary
          error={
            failure instanceof AgentStudioApiError && failure.status === 429 ? failure : undefined
          }
        >
          {replacement ? (
            <div className="space-y-2 rounded-lg border p-3 text-sm">
              <p id={`${prefix}-replacement`}>
                {replacement.description} is already in the report. Replace its evaluation, review
                and baseline with the validated result?
              </p>
              <div className="flex flex-wrap gap-2">
                <Button
                  ref={focusCancelButton}
                  variant="outline"
                  aria-describedby={`${prefix}-replacement`}
                  onClick={() => {
                    focusDataset.current = replacement.targetId;
                    setReplacement(null);
                  }}
                >
                  Keep existing dataset
                </Button>
                <Button
                  aria-describedby={`${prefix}-replacement`}
                  onClick={() =>
                    placeDataset(
                      replacement.dataset,
                      replacement.targetId,
                      "Dataset replaced with the validated evaluation.",
                    )
                  }
                >
                  Replace dataset
                </Button>
              </div>
            </div>
          ) : null}
          {datasets.map((dataset, index) => (
            <fieldset
              key={dataset.id}
              ref={(node) => {
                if (node && focusDataset.current === dataset.id) {
                  node.focus();
                  focusDataset.current = null;
                }
              }}
              tabIndex={-1}
              className="min-w-0 space-y-3 rounded-lg border px-3 pb-3"
            >
              <legend className="px-1 text-sm font-medium">Dataset {index + 1}</legend>
              <div className="space-y-2">
                <Label htmlFor={`${prefix}-${dataset.id}-recipe`}>Dataset recipe</Label>
                <select
                  id={`${prefix}-${dataset.id}-recipe`}
                  value={dataset.recipe}
                  className="w-full min-w-0 rounded-md border bg-transparent p-2 text-sm"
                  onChange={(event) => {
                    const recipe = npAgentEvaluationReportRecipesV1.find(
                      (value) => value === event.target.value,
                    );
                    if (!recipe) return;
                    invalidate();
                    setDatasets((current) =>
                      current.map((entry) =>
                        entry.id === dataset.id ? { ...entry, recipe } : entry,
                      ),
                    );
                  }}
                >
                  {npAgentEvaluationReportRecipesV1.map((recipe) => (
                    <option key={recipe} value={recipe}>
                      {evaluationRecipeLabels[recipe]}
                    </option>
                  ))}
                </select>
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                {evaluationFileFields.map((field) => (
                  <ReportFileField
                    key={field}
                    id={`${prefix}-${dataset.id}-${field}`}
                    field={field}
                    file={dataset.files[field]}
                    onImport={(file) => void importFile(dataset.id, field, file)}
                  />
                ))}
              </div>
              {datasets.length > 1 ? (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    invalidate();
                    focusDataset.current = (datasets[index + 1] ?? datasets[index - 1]).id;
                    setDatasets((current) => current.filter((entry) => entry.id !== dataset.id));
                  }}
                >
                  Remove dataset {index + 1}
                </Button>
              ) : null}
            </fieldset>
          ))}
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              disabled={datasets.length >= npAgentEvaluationReportMaxEntriesV2}
              onClick={() => {
                invalidate();
                const dataset = initialDataset(nextId.current++);
                focusDataset.current = dataset.id;
                setDatasets((current) => [...current, dataset]);
              }}
            >
              Add dataset
            </Button>
            <Button
              disabled={
                !complete || busy || retryBlocked || result !== null || replacement !== null
              }
              onClick={() => void generate()}
            >
              Generate V2 report
            </Button>
            {result ? (
              <Button
                variant="outline"
                onClick={() =>
                  downloadEvaluationArtifact(
                    "evaluation-report-v2.json",
                    result.reportArtifactJson,
                    urls.current,
                  )
                }
              >
                Download V2 report JSON
              </Button>
            ) : null}
          </div>
        </AgentRecoveryBoundary>
        <p role="status" className="text-sm">
          {busy
            ? "Generating report…"
            : reading
              ? "Reading files…"
              : result
                ? "V2 report ready to download."
                : transferStatus}
        </p>
        {error ? (
          <p role="alert" className="text-sm text-red-700 dark:text-red-300">
            {error}
          </p>
        ) : null}
        {result ? (
          <pre
            tabIndex={0}
            aria-label="Report summary"
            className="max-h-96 overflow-auto rounded-md bg-neutral-50 p-3 text-xs whitespace-pre-wrap break-all dark:bg-neutral-900"
          >
            {result.summaryText}
          </pre>
        ) : null}
      </div>
    </details>
  );
}
