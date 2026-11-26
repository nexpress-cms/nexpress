"use client";
import * as React from "react";
import {
  npAgentEvaluationHistorySourceMaxCharactersV1,
  npRequireAgentEvaluationHistorySaveV1,
} from "@nexpress/core/agent-contract";
import type {
  NpAgentEvaluationWorkbenchResultV1,
  NpAgentEvaluationWorkbenchCaseV1,
  NpAgentEvaluationHistorySourceV1,
  NpAgentEvaluationHistoryCaseV1,
  NpAgentEvaluationHistorySaveV1,
  NpAgentEvaluationHistoryDetailV1,
} from "@nexpress/core/agent-contract";
import {
  listAgentEvaluationHistory,
  loadAgentEvaluationHistory,
  readAgentEvaluationCaseHistory,
  saveAgentEvaluationHistory,
  findAgentEvaluationHistory,
} from "./agent-evaluation-history-api.js";
import type { EvaluationReviewDraft } from "./agent-evaluation-workbench-api.js";
import { AgentStudioApiError } from "./agent-studio-api.js";
import { Button } from "../ui/button.js";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card.js";
interface Props {
  enabled: boolean;
  evaluation: unknown;
  result: NpAgentEvaluationWorkbenchResultV1 | null;
  entry: NpAgentEvaluationWorkbenchCaseV1 | null;
  draft: EvaluationReviewDraft;
  disabled: boolean;
  onLoad: (value: NpAgentEvaluationHistoryDetailV1) => void;
  onAccessLost: () => void;
}
/** Authenticated decisions are separate from every imported self-reported reviewer label. */
export function AgentEvaluationHistoryPanel({
  enabled,
  evaluation,
  result,
  entry,
  draft,
  disabled,
  onLoad,
  onAccessLost,
}: Props) {
  const [sources, setSources] = React.useState<NpAgentEvaluationHistorySourceV1[]>([]);
  const [cursor, setCursor] = React.useState<string | null>(null);
  const [current, setCurrent] = React.useState<NpAgentEvaluationHistorySourceV1 | null>(null);
  const [history, setHistory] = React.useState<NpAgentEvaluationHistoryCaseV1 | null>(null);
  const [checkedBinding, setCheckedBinding] = React.useState<string | null>(null);
  const [historyBefore, setHistoryBefore] = React.useState<number | null>(null);
  const [busy, setBusy] = React.useState(false),
    [message, setMessage] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState<NpAgentEvaluationHistorySaveV1 | null>(null);
  const generation = React.useRef(0),
    controller = React.useRef<AbortController | null>(null);
  const sourceTooLarge = React.useMemo(
    () => (JSON.stringify(evaluation)?.length ?? 0) > npAgentEvaluationHistorySourceMaxCharactersV1,
    [evaluation],
  );
  const sourceHash = result?.sourceHash,
    caseId = entry?.caseId,
    caseVersion = entry?.caseVersion;
  React.useEffect(
    () => () => {
      generation.current++;
      controller.current?.abort();
    },
    [],
  );
  const begin = () => {
    controller.current?.abort();
    const c = new AbortController();
    controller.current = c;
    const g = ++generation.current;
    setBusy(true);
    setMessage(null);
    return { c, g };
  };
  const active = (g: number) => g === generation.current;
  const error = (caught: unknown, g: number) => {
    if (!active(g) || controller.current?.signal.aborted) return;
    if (caught instanceof AgentStudioApiError && [401, 403].includes(caught.status)) {
      setSources([]);
      setCurrent(null);
      setHistory(null);
      setCheckedBinding(null);
      setPending(null);
      onAccessLost();
    }
    setMessage(caught instanceof Error ? caught.message : "Evaluation history is unavailable.");
  };
  React.useEffect(() => {
    generation.current++;
    controller.current?.abort();
    setBusy(false);
    setCurrent(null);
    setHistory(null);
    setCheckedBinding(null);
    setMessage(null);
  }, [sourceHash, caseId, caseVersion]);
  const list = async (next = false) => {
    const { c, g } = begin();
    try {
      const v = await listAgentEvaluationHistory(next ? cursor : null, c.signal);
      if (!active(g)) return;
      setSources(v.sources);
      setCursor(v.nextCursor);
      if (!v.sources.length) setMessage("No saved evaluations on this page.");
    } catch (e) {
      error(e, g);
    } finally {
      if (active(g)) setBusy(false);
    }
  };
  const load = async (id: string) => {
    const { c, g } = begin();
    try {
      const v = await loadAgentEvaluationHistory(id, c.signal);
      if (!active(g)) return;
      setCurrent(v.source);
      setHistory(null);
      onLoad(v);
    } catch (e) {
      error(e, g);
    } finally {
      if (active(g)) setBusy(false);
    }
  };
  const refresh = async (before: number | null = null) => {
    if (!result || !entry) return;
    const { c, g } = begin();
    try {
      const found = await findAgentEvaluationHistory(result.recipe, result.sourceHash, c.signal);
      if (!active(g)) return;
      const source = found.sources[0] ?? null;
      setCheckedBinding(result.sourceHash);
      setHistoryBefore(before);
      setCurrent(source);
      if (!source) {
        setHistory(null);
        setMessage(
          "No authenticated decisions are stored for this source. Saving will persist this evaluation.",
        );
        return;
      }
      const h = await readAgentEvaluationCaseHistory(
        source.id,
        entry.caseId,
        entry.caseVersion,
        before,
        c.signal,
      );
      if (!active(g)) return;
      setHistory(h);
      setCurrent(h.source);
    } catch (e) {
      error(e, g);
    } finally {
      if (active(g)) setBusy(false);
    }
  };
  const save = async (clear = false, retry = false) => {
    if (!retry && (!result || !entry || !entry.eligible || !entry.predictionHash)) return;
    let command = pending;
    if (!retry) {
      if (pending) {
        setMessage("Retry the unresolved save before recording another decision.");
        return;
      }
      if (
        !result ||
        !entry ||
        !entry.predictionHash ||
        sourceTooLarge ||
        (!clear && !draft.outcome)
      )
        return;
      command = {
        schemaVersion: "np.agent-evaluation-history-save.v1",
        recipe: result.recipe,
        evaluationJson: JSON.stringify(evaluation),
        sourceHash: result.sourceHash,
        expectedVersion: current?.sourceHash === result.sourceHash ? current.version : 0,
        caseId: entry.caseId,
        caseVersion: entry.caseVersion,
        caseHash: entry.caseHash,
        predictionHash: entry.predictionHash,
        decision: clear
          ? null
          : {
              outcome: draft.outcome as Exclude<EvaluationReviewDraft["outcome"], "">,
              notes: draft.notes,
              editedProposalJson: draft.outcome === "edit" ? draft.editedProposal : null,
            },
        idempotencyKey: crypto.randomUUID(),
      };
    }
    if (!command) return;
    try {
      command = npRequireAgentEvaluationHistorySaveV1(command);
    } catch {
      setMessage(
        "This decision exceeds the history limits or contains invalid edit JSON. Offline review remains available.",
      );
      return;
    }
    const { c, g } = begin();
    setPending(command);
    try {
      await saveAgentEvaluationHistory(command, c.signal);
      if (!active(g)) return;
      setPending(null);
      if (
        !result ||
        !entry ||
        command.sourceHash !== result.sourceHash ||
        command.caseId !== entry.caseId ||
        command.caseVersion !== entry.caseVersion
      ) {
        setMessage("The original authenticated decision was saved.");
        return;
      }
      setCheckedBinding(result.sourceHash);
      setHistoryBefore(null);
      const found = await findAgentEvaluationHistory(result.recipe, result.sourceHash, c.signal);
      if (!active(g)) return;
      const source = found.sources[0] ?? null;
      setCurrent(source);
      if (source) {
        const h = await readAgentEvaluationCaseHistory(
          source.id,
          entry.caseId,
          entry.caseVersion,
          null,
          c.signal,
        );
        if (!active(g)) return;
        setHistory(h);
        setCurrent(h.source);
      }
      setMessage(
        "Your authenticated decision was saved. Imported review attribution and offline exports are unchanged.",
      );
    } catch (e) {
      if (!active(g) || c.signal.aborted) return;
      if (e instanceof AgentStudioApiError && e.status < 500) {
        setPending(null);
        if (e.status === 409) {
          setCurrent(null);
          setHistory(null);
          setCheckedBinding(null);
          setHistoryBefore(null);
        }
      }
      error(e, g);
    } finally {
      if (active(g)) setBusy(false);
    }
  };
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-[15px]">Authenticated review history</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-neutral-500">
          An explicit save records your signed-in staff decision and this evaluation on the server
          (up to 2,000,000 JSON characters). Imported reviewer names remain self-reported. Stored
          reviews never approve capabilities or establish full R6 acceptance.
        </p>
        {!enabled ? (
          <p className="text-sm">
            History storage is disabled until the host installs the evaluation history service.
          </p>
        ) : (
          <>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" disabled={busy || disabled} onClick={() => void list()}>
                Browse saved evaluations
              </Button>
              {cursor ? (
                <Button
                  variant="outline"
                  disabled={busy || disabled}
                  onClick={() => void list(true)}
                >
                  Next saved evaluations
                </Button>
              ) : null}
            </div>
            {sources.length ? (
              <ul className="space-y-2">
                {sources.map((s) => (
                  <li key={s.id} className="flex min-w-0 flex-wrap items-center gap-2 text-sm">
                    <span className="min-w-0 break-all">
                      {s.recipe} · {s.createdAt} · {s.caseCount} cases · {s.sourceHash}
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={busy || disabled || pending !== null}
                      onClick={() => void load(s.id)}
                    >
                      Load evaluation
                    </Button>
                  </li>
                ))}
              </ul>
            ) : null}
            {sourceTooLarge ? (
              <p className="text-sm">
                This evaluation exceeds the history limit of 2,000,000 JSON characters. Offline
                review and exports remain available.
              </p>
            ) : null}
            {result && entry ? (
              <>
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="outline"
                    disabled={busy || disabled}
                    onClick={() => void refresh()}
                  >
                    Load current case history
                  </Button>
                  <Button
                    disabled={
                      busy ||
                      disabled ||
                      !entry.eligible ||
                      !draft.outcome ||
                      pending !== null ||
                      sourceTooLarge ||
                      checkedBinding !== result.sourceHash
                    }
                    onClick={() => void save()}
                  >
                    Save my decision
                  </Button>
                  <Button
                    variant="outline"
                    disabled={
                      busy ||
                      disabled ||
                      !history?.revisions[0]?.labelJson ||
                      pending !== null ||
                      historyBefore !== null
                    }
                    onClick={() => void save(true)}
                  >
                    Clear stored case decision
                  </Button>
                </div>
                <p className="text-xs text-neutral-500">
                  Saving uses the selected outcome, notes and edit. The reviewer name field is
                  excluded; your account and the server time provide provenance. Load current
                  history before replacing an existing decision.
                </p>
                {history ? (
                  <>
                    <p className="text-sm">
                      Case {history.caseId}@{history.caseVersion} · evaluation revision{" "}
                      {history.source.version}
                    </p>
                    <ol className="space-y-3">
                      {history.revisions.map((r) => (
                        <li key={r.id} className="min-w-0 rounded-md border p-3 text-sm">
                          <p className="break-all">
                            Revision {r.version} · {r.recordedAt} ·{" "}
                            {r.actorDeleted ? "Deleted staff account" : r.actorFingerprint}
                          </p>
                          <pre className="max-h-64 overflow-auto text-xs whitespace-pre-wrap break-all">
                            {r.labelJson
                              ? JSON.stringify(JSON.parse(r.labelJson), null, 2)
                              : "Stored decision cleared."}
                          </pre>
                        </li>
                      ))}
                    </ol>
                    {history.nextBefore ? (
                      <Button
                        variant="outline"
                        disabled={busy || disabled}
                        onClick={() => void refresh(history.nextBefore)}
                      >
                        Older case decisions
                      </Button>
                    ) : null}
                  </>
                ) : null}
              </>
            ) : null}
            {pending ? (
              <Button
                variant="outline"
                disabled={busy || disabled}
                onClick={() => void save(false, true)}
              >
                Retry same unresolved save
              </Button>
            ) : null}
            {message ? (
              <p role="status" className="text-sm">
                {message}
              </p>
            ) : null}
          </>
        )}
      </CardContent>
    </Card>
  );
}
