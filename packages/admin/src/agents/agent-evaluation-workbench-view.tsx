"use client";

import * as React from "react";
import {
  npAgentEvaluationReportRecipesV1,
  npRequireAgentModeratorSegmentedEvaluationResultV2,
  type NpAgentEvaluationReportRecipeV1,
  type NpAgentEvaluationWorkbenchResultV1,
  type NpAgentEvaluationWorkbenchCaseV1,
  type NpAgentEvaluationWorkbenchOutcomeV1,
} from "@nexpress/core/agent-contract";
import { AgentStudioFrame } from "./agent-studio-frame.js";
import { AgentEvaluationHistoryPanel } from "./agent-evaluation-history-panel.js";
import { AgentEvaluationReportPanel } from "./agent-evaluation-report-panel.js";
import { AgentStudioApiError } from "./agent-studio-api.js";
import { useAgentRetryBlocked } from "./agent-recovery.js";
import {
  EvaluationWorkbenchRequests,
  downloadEvaluationArtifact,
  evaluationFileFields as fileFields,
  evaluationFileLabels as fileLabels,
  evaluationRecipeLabels as recipeLabels,
  evaluationReviewDraft,
  evaluationWorkbenchLabels,
  processAgentEvaluationWorkbench,
  readEvaluationArtifact,
  type EvaluationFileField as FileField,
  type EvaluationReviewDraft,
} from "./agent-evaluation-workbench-api.js";
import { Button } from "../ui/button.js";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card.js";
import { Input } from "../ui/input.js";
import { Label } from "../ui/label.js";
import { Textarea } from "../ui/textarea.js";

type ImportedFile = Awaited<ReturnType<typeof readEvaluationArtifact>>;
type ImportedFiles = Record<FileField, ImportedFile | null>;
const emptyFiles = (): ImportedFiles => ({
  evaluation: null,
  review: null,
  baseline: null,
  baselineReview: null,
});
const caseKey = (entry: NpAgentEvaluationWorkbenchCaseV1) => `${entry.caseId}@${entry.caseVersion}`;
function segmentedAssessment(predictionJson: string) {
  const prediction: unknown = JSON.parse(predictionJson);
  if (!prediction || typeof prediction !== "object" || !("segmentedAssessment" in prediction))
    return null;
  try {
    return npRequireAgentModeratorSegmentedEvaluationResultV2(prediction.segmentedAssessment);
  } catch {
    return null;
  }
}
const emptyDraft = (): EvaluationReviewDraft => ({
  outcome: "",
  reviewer: "",
  notes: "",
  editedProposal: "null",
});
const jsonPanelClass =
  "max-h-72 overflow-auto rounded-md bg-neutral-50 p-3 text-xs whitespace-pre-wrap break-all dark:bg-neutral-900";

export function AgentEvaluationWorkbenchView({
  historyAvailable = false,
}: { historyAvailable?: boolean } = {}) {
  const [recipe, setRecipe] = React.useState<NpAgentEvaluationReportRecipeV1>("moderator-proposal");
  const [files, setFiles] = React.useState<ImportedFiles>(emptyFiles);
  const [fileKey, setFileKey] = React.useState(0);
  const [reportKey, setReportKey] = React.useState(0);
  const [reading, setReading] = React.useState<FileField[]>([]);
  const [invalidFiles, setInvalidFiles] = React.useState<FileField[]>([]);
  const [result, setResult] = React.useState<NpAgentEvaluationWorkbenchResultV1 | null>(null);
  const [workingLabels, setWorkingLabels] = React.useState<unknown[] | null>(null);
  const [selected, setSelected] = React.useState("");
  const [draft, setDraft] = React.useState<EvaluationReviewDraft>(emptyDraft);
  const [dirty, setDirty] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [failure, setFailure] = React.useState<unknown>();
  const [error, setError] = React.useState<string | null>(null);
  const [status, setStatus] = React.useState("Choose local JSON artifacts, then validate them.");
  const requests = React.useRef(new EvaluationWorkbenchRequests());
  const reads = React.useRef<Record<FileField, number>>({
    evaluation: 0,
    review: 0,
    baseline: 0,
    baselineReview: 0,
  });
  const urls = React.useRef(new Set<string>());
  const fileInputs = React.useRef<Record<FileField, HTMLInputElement | null>>({
    evaluation: null,
    review: null,
    baseline: null,
    baselineReview: null,
  });
  const retryBlocked = useAgentRetryBlocked(failure);
  const entry = result?.cases.find((item) => caseKey(item) === selected) ?? null;
  const segments = entry ? segmentedAssessment(entry.predictionJson) : null;

  React.useEffect(() => {
    const requestOwner = requests.current;
    const readOwner = reads.current;
    const downloadUrls = urls.current;
    return () => {
      requestOwner.cancel();
      for (const field of fileFields) readOwner[field]++;
      for (const url of downloadUrls) URL.revokeObjectURL(url);
      downloadUrls.clear();
    };
  }, []);

  const invalidate = (clearLabels = true) => {
    if (clearLabels) setWorkingLabels(null);
    requests.current.cancel();
    setBusy(false);
    setResult(null);
    setSelected("");
    setDraft(emptyDraft());
    setDirty(false);
    setError(null);
    setStatus("Inputs changed. Validate again before reviewing or exporting.");
  };
  const resetFiles = () => {
    for (const field of fileFields) reads.current[field]++;
    setReading([]);
    setInvalidFiles([]);
    setFiles(emptyFiles());
    setWorkingLabels(null);
    setFileKey((value) => value + 1);
  };
  const clearOnAccessLoss = (failure?: AgentStudioApiError) => {
    invalidate();
    resetFiles();
    setReportKey((value) => value + 1);
    if (failure) setFailure(failure);
    setStatus("Access lost. Imported files and review drafts were cleared.");
    setError(
      failure?.code === "RECENT_REAUTHENTICATION_REQUIRED"
        ? "Complete staff reauthentication, reload this page, then import your files again."
        : "Restore access and reload this page before importing evaluation evidence again.",
    );
  };
  const importFile = async (field: FileField, file: File | undefined) => {
    invalidate(field === "evaluation" || field === "review");
    const generation = ++reads.current[field];
    setFiles((current) => ({ ...current, [field]: null }));
    setInvalidFiles((current) => current.filter((value) => value !== field));
    if (!file) {
      setReading((current) => current.filter((value) => value !== field));
      return;
    }
    setReading((current) => [...current.filter((value) => value !== field), field]);
    try {
      const imported = await readEvaluationArtifact(file);
      if (reads.current[field] !== generation) return;
      setFiles((current) => ({ ...current, [field]: imported }));
      setStatus("Files loaded locally. Validate imports to inspect the evaluation.");
    } catch {
      if (reads.current[field] !== generation) return;
      setInvalidFiles((current) => [...current.filter((value) => value !== field), field]);
      setError(`${fileLabels[field]} could not be read. Select valid JSON within the 4 MiB limit.`);
    } finally {
      if (reads.current[field] === generation)
        setReading((current) => current.filter((value) => value !== field));
    }
  };

  const process = async (labels: unknown[] | null) => {
    if (!files.evaluation || busy || reading.length || invalidFiles.length || retryBlocked) return;
    const previousResult = result;
    const controller = requests.current.begin();
    setBusy(true);
    setError(null);
    // A failed recomputation must not leave previously validated exports available.
    setResult(null);
    try {
      const value = await processAgentEvaluationWorkbench(
        {
          schemaVersion: "np.agent-eval-workbench-request.v1",
          recipe,
          evaluation: files.evaluation.value,
          review: files.review?.value ?? null,
          baseline: files.baseline?.value ?? null,
          baselineReview: files.baselineReview?.value ?? null,
          labels: labels ?? workingLabels,
        },
        controller.signal,
      );
      if (!requests.current.current(controller)) return;
      const next = value.cases.find((item) => caseKey(item) === selected) ?? value.cases[0];
      setResult(value);
      const normalizedLabels: unknown =
        value.labelsJson === null ? null : JSON.parse(value.labelsJson);
      setWorkingLabels(Array.isArray(normalizedLabels) ? normalizedLabels : null);
      setSelected(caseKey(next));
      setDraft(evaluationReviewDraft(next));
      setDirty(false);
      setFailure(undefined);
      setStatus("Validated. Review labels remain self-reported and grant no authority.");
    } catch (caught) {
      if (!requests.current.current(controller)) return;
      setFailure(caught);
      if (caught instanceof AgentStudioApiError && [401, 403].includes(caught.status)) {
        clearOnAccessLoss(caught);
      } else {
        setResult(previousResult);
        setError(
          caught instanceof AgentStudioApiError
            ? `${caught.message} (${caught.code})`
            : "Validation failed. Check the artifact types, exact source bindings, edit JSON and combined 4 MiB limit.",
        );
        setStatus(
          previousResult
            ? "Previous validated labels are retained. Correct or discard this draft before exporting."
            : "No exports are available until validation succeeds. Imported files are retained for correction.",
        );
      }
    } finally {
      if (requests.current.current(controller)) setBusy(false);
    }
  };
  const apply = (remove = false) => {
    if (!result || !entry) return;
    try {
      const labels = evaluationWorkbenchLabels(result, entry, remove ? null : draft);
      void process(labels);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Review labels could not be prepared.");
    }
  };
  const changeDraft = (patch: Partial<EvaluationReviewDraft>) => {
    setDraft((current) => ({ ...current, ...patch }));
    setDirty(true);
    setError(null);
  };
  const download = (kind: "labels" | "review" | "report", content: string | null) => {
    if (!content || !result || dirty || busy || error || reading.length) return;
    downloadEvaluationArtifact(`${recipe}-${kind}.json`, content, urls.current);
  };

  return (
    <AgentStudioFrame active="overview" recovery={failure} busy={busy || reading.length > 0}>
      <div className="space-y-2">
        <h2 className="text-lg font-semibold">Evaluation review workspace</h2>
        <p className="max-w-[85ch] text-sm text-neutral-500">
          Inspect imported evaluation evidence, compare a baseline and record self-reported reviews.
          Fixture conformance does not establish production quality or model usefulness. Reviews
          never approve or execute capabilities. Files remain in memory unless you explicitly save a
          current authenticated decision below.
        </p>
      </div>
      <AgentEvaluationReportPanel key={reportKey} onAccessLost={clearOnAccessLoss} />
      <Card>
        <CardHeader>
          <CardTitle className="text-[15px]">Import evaluation artifacts</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-2">
            <Label htmlFor="eval-recipe">Recipe</Label>
            <select
              id="eval-recipe"
              value={recipe}
              className="w-full min-w-0 rounded-md border bg-transparent p-2 text-sm"
              onChange={(event) => {
                const value = npAgentEvaluationReportRecipesV1.find(
                  (item) => item === event.target.value,
                );
                if (!value) return;
                invalidate();
                resetFiles();
                setRecipe(value);
              }}
            >
              {npAgentEvaluationReportRecipesV1.map((value) => (
                <option key={value} value={value}>
                  {recipeLabels[value]}
                </option>
              ))}
            </select>
            <p className="text-xs text-neutral-500">
              Operator plan requires operator-plan.v1. Detector replay and Moderator proposals are
              separate datasets.
              {recipe === "moderator-assessment"
                ? " Import moderator-assessment.v1 for content assessment, moderator-assessment.v2 for segmented coverage and classification, or moderator-member-report.v1 for synthetic Member report and response review."
                : ""}
              {recipe === "guardian"
                ? " Guardian requires guardian.v1. This synthetic reference does not establish production rule replay, production precision, model usefulness, live approval or enablement. Review support concerns only the synthetic prediction."
                : ""}
            </p>
          </div>
          <div className="grid gap-4 md:grid-cols-2" key={fileKey}>
            {fileFields.map((field) => (
              <div key={field} className="min-w-0 space-y-2">
                <Label htmlFor={`eval-file-${field}`}>{fileLabels[field]}</Label>
                <Input
                  ref={(node) => {
                    fileInputs.current[field] = node;
                  }}
                  id={`eval-file-${field}`}
                  type="file"
                  accept=".json,application/json"
                  onChange={(event) => void importFile(field, event.target.files?.[0])}
                />
                {files[field] || invalidFiles.includes(field) ? (
                  <div className="flex items-center gap-2 text-xs">
                    <span className="break-all">
                      {files[field]?.name ?? "Invalid file: clear or replace it"}
                    </span>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        const input = fileInputs.current[field];
                        if (input) input.value = "";
                        reads.current[field]++;
                        invalidate(field === "evaluation" || field === "review");
                        setFiles((current) => ({ ...current, [field]: null }));
                        setReading((current) => current.filter((value) => value !== field));
                        setInvalidFiles((current) => current.filter((value) => value !== field));
                      }}
                    >
                      Clear {field}
                    </Button>
                  </div>
                ) : null}
              </div>
            ))}
          </div>
          <p className="text-xs text-neutral-500">
            All files and replacement labels together must fit within 4 MiB. A baseline review
            requires its baseline evaluation.
          </p>
          <Button
            disabled={
              !files.evaluation ||
              busy ||
              reading.length > 0 ||
              invalidFiles.length > 0 ||
              retryBlocked ||
              result !== null
            }
            onClick={() => void process(null)}
          >
            {busy ? "Validating…" : "Validate imports"}
          </Button>
        </CardContent>
      </Card>
      <p role="status" aria-live="polite" className="text-sm">
        {reading.length ? "Reading local JSON files…" : status}
      </p>
      {error ? (
        <p
          role="alert"
          className="rounded-lg border border-red-300 p-3 text-sm text-red-700 dark:text-red-300"
        >
          {error}
        </p>
      ) : null}
      <AgentEvaluationHistoryPanel
        enabled={historyAvailable}
        evaluation={files.evaluation?.value ?? null}
        result={result}
        entry={entry}
        draft={draft}
        disabled={busy || reading.length > 0 || invalidFiles.length > 0 || retryBlocked}
        onLoad={(saved) => {
          invalidate();
          resetFiles();
          setRecipe(saved.source.recipe);
          setFiles({
            ...emptyFiles(),
            evaluation: {
              name: `saved-${saved.source.id}.json`,
              value: JSON.parse(saved.evaluationJson) as unknown,
            },
          });
          setFailure(undefined);
          setStatus(
            "Saved evaluation loaded. Validate it before inspecting cases or recording another decision.",
          );
        }}
        onAccessLost={clearOnAccessLoss}
      />
      {result ? (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="text-[15px]">Evaluation and baseline comparison</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm">
                Fixture gate: {result.fixtureGate} · Mode: {result.mode} ·{" "}
                {result.cases.filter((item) => item.labelJson !== null).length} /{" "}
                {result.cases.filter((item) => item.eligible).length} eligible cases reviewed
              </p>
              <pre className={jsonPanelClass}>{result.summaryText}</pre>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-[15px]">Case evidence and review</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <Label htmlFor="eval-case">Case</Label>
              <select
                id="eval-case"
                className="w-full rounded-md border bg-transparent p-2 text-sm"
                value={selected}
                disabled={dirty || busy}
                onChange={(event) => {
                  const next = result.cases.find((item) => caseKey(item) === event.target.value);
                  if (!next) return;
                  setSelected(caseKey(next));
                  setDraft(evaluationReviewDraft(next));
                  setError(null);
                }}
              >
                {result.cases.map((item) => (
                  <option key={caseKey(item)} value={caseKey(item)}>
                    {caseKey(item)} ·{" "}
                    {item.eligible ? (item.labelJson ? "Reviewed" : "Unreviewed") : "Ineligible"}
                  </option>
                ))}
              </select>
              {entry ? (
                <>
                  <details>
                    <summary className="cursor-pointer text-sm">
                      Exact source and case bindings
                    </summary>
                    <pre className={jsonPanelClass}>
                      {JSON.stringify(
                        {
                          caseId: entry.caseId,
                          caseVersion: entry.caseVersion,
                          caseHash: entry.caseHash,
                          predictionHash: entry.predictionHash,
                          sourceHash: entry.sourceHash,
                        },
                        null,
                        2,
                      )}
                    </pre>
                  </details>
                  {segments ? (
                    <dl className="grid gap-3 rounded-md border p-3 text-sm sm:grid-cols-2">
                      <div>
                        <dt className="font-medium">Evidence coverage</dt>
                        <dd>
                          {segments.coverage.verifiedSegments} / {segments.coverage.segmentCount}{" "}
                          segments
                          {" · "}
                          {segments.coverage.verifiedTargets} / {segments.coverage.targetCount}{" "}
                          targets
                          {" · "}
                          {segments.coverage.complete ? "Complete" : "Incomplete"}
                        </dd>
                      </div>
                      <div>
                        <dt className="font-medium">Advisory classification</dt>
                        <dd>
                          {segments.label ??
                            (segments.state === "invalid-segments"
                              ? "Withheld · invalid segment evidence"
                              : "Withheld · awaiting segments")}
                        </dd>
                      </div>
                    </dl>
                  ) : null}
                  <div className="grid min-w-0 gap-3 xl:grid-cols-3">
                    {[
                      ["Evidence", entry.evidenceJson],
                      ["Prediction", entry.predictionJson],
                      ["Score", entry.scoreJson],
                    ].map(([title, json]) => (
                      <div key={title} className="min-w-0 space-y-2">
                        <h3 className="text-sm font-medium">{title}</h3>
                        <pre className={jsonPanelClass}>
                          {JSON.stringify(JSON.parse(json), null, 2)}
                        </pre>
                      </div>
                    ))}
                  </div>
                  {!entry.eligible ? (
                    <p className="text-sm">
                      This case is ineligible for review. Its evidence remains read only.
                    </p>
                  ) : (
                    <fieldset className="space-y-3" disabled={busy || retryBlocked}>
                      <legend className="text-sm font-medium">Self-reported review</legend>
                      <div className="grid gap-3 md:grid-cols-2">
                        <div className="space-y-2">
                          <Label htmlFor="eval-outcome">Outcome</Label>
                          <select
                            id="eval-outcome"
                            value={draft.outcome}
                            className="w-full rounded-md border bg-transparent p-2 text-sm"
                            onChange={(event) => {
                              const value: NpAgentEvaluationWorkbenchOutcomeV1 | "" =
                                entry.allowedOutcomes.find((item) => item === event.target.value) ??
                                "";
                              changeDraft({ outcome: value });
                            }}
                          >
                            <option value="">Choose outcome</option>
                            {entry.allowedOutcomes.map((value) => (
                              <option key={value} value={value}>
                                {recipe === "guardian"
                                  ? value === "accept"
                                    ? "Supported synthetic prediction"
                                    : "Unsupported synthetic prediction"
                                  : value}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="eval-reviewer">Reviewer (self-reported)</Label>
                          <Input
                            id="eval-reviewer"
                            value={draft.reviewer}
                            maxLength={128}
                            onChange={(event) => changeDraft({ reviewer: event.target.value })}
                          />
                        </div>
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="eval-notes">Review notes</Label>
                        <Textarea
                          id="eval-notes"
                          value={draft.notes}
                          maxLength={2000}
                          onChange={(event) => changeDraft({ notes: event.target.value })}
                        />
                      </div>
                      {draft.outcome === "edit" ? (
                        <div className="space-y-2">
                          <Label htmlFor="eval-edit">
                            {recipe === "moderator-assessment" || recipe === "publisher-selection"
                              ? "Edited structured result JSON"
                              : "Edited proposal JSON"}
                          </Label>
                          <Textarea
                            id="eval-edit"
                            className="min-h-56 font-mono text-xs"
                            value={draft.editedProposal}
                            maxLength={500_000}
                            onChange={(event) =>
                              changeDraft({ editedProposal: event.target.value })
                            }
                          />
                          <p className="text-xs text-neutral-500">
                            Edits must remain grounded in the imported evidence and change the
                            proposed action or completion; prose-only changes may be rejected.
                          </p>
                        </div>
                      ) : null}
                      {dirty ? (
                        <p className="text-sm">
                          Unapplied review changes. Apply or discard them before changing cases or
                          exporting.
                        </p>
                      ) : null}
                      <div className="flex flex-wrap gap-2">
                        <Button
                          disabled={!dirty || !draft.outcome || !draft.reviewer.trim()}
                          onClick={() => apply()}
                        >
                          Apply and recompute
                        </Button>
                        <Button
                          variant="outline"
                          disabled={!dirty && !error}
                          onClick={() => {
                            setDraft(evaluationReviewDraft(entry));
                            setDirty(false);
                            setError(null);
                          }}
                        >
                          Discard draft
                        </Button>
                        <Button
                          variant="outline"
                          disabled={entry.labelJson === null}
                          onClick={() => apply(true)}
                        >
                          Remove review label
                        </Button>
                      </div>
                    </fieldset>
                  )}
                </>
              ) : null}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-[15px]">Export validated artifacts</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                disabled={dirty || busy || !!error || result.labelsJson === null}
                onClick={() => download("labels", result.labelsJson)}
              >
                Download labels JSON
              </Button>
              <Button
                variant="outline"
                disabled={dirty || busy || !!error || result.reviewArtifactJson === null}
                onClick={() => download("review", result.reviewArtifactJson)}
              >
                Download review JSON
              </Button>
              <Button
                variant="outline"
                disabled={dirty || busy || !!error}
                onClick={() => download("report", result.reportArtifactJson)}
              >
                Download report JSON
              </Button>
            </CardContent>
          </Card>
        </>
      ) : null}
    </AgentStudioFrame>
  );
}
