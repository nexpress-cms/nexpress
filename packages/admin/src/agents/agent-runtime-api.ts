"use client";

import * as React from "react";
import { npFetch } from "../lib/api-client.js";
import { AgentStudioApiError, responseError } from "./agent-studio-api.js";

export async function runtimeRequest<T>(
  path: string,
  parse: (value: unknown) => T,
  init?: RequestInit,
): Promise<T> {
  const response = await npFetch(path, { cache: "no-store", ...init });
  if (!response.ok) throw await responseError(response);
  try {
    return parse(await response.json());
  } catch {
    throw new AgentStudioApiError(
      "The Runtime response could not be validated.",
      502,
      "RUNTIME_CONTRACT_ERROR",
    );
  }
}

export function runtimeErrorMessage(error: unknown): string {
  if (error instanceof AgentStudioApiError) {
    if (error.code === "RUNTIME_MANUAL_INPUT_INVALID")
      return "Check the goal and recipe input fields. Input must match the supported schema and fit the size limit.";
    if (error.code === "RUNTIME_MANUAL_INPUT_POLICY_DENIED")
      return "Structured input requires sensitive-approved provider data permission. Review the Agent, site policy and connection before running.";
    if (error.code === "RECENT_REAUTHENTICATION_REQUIRED")
      return "Recent staff-primary reauthentication is required. Reauthenticate and reload.";
    if ([401, 403, 404].includes(error.status))
      return "This Runtime resource is unavailable or you no longer have access.";
    if (error.status === 409)
      return "This resource changed. Reload, review the current version and start the action again. Your unsaved form remains available for comparison.";
    return error.message;
  }
  return "The request could not be completed. If the outcome is unknown, retry the same unchanged action.";
}

export function useRuntimeResource<T>(path: string, parse: (value: unknown) => T) {
  const [result, setResult] = React.useState<{
    path: string;
    revision: number;
    value: T | null;
    error: string | null;
    observedAt: number | undefined;
  } | null>(null);
  const request = React.useRef<{ path: string; controller: AbortController } | null>(null);
  const [revision, setRevision] = React.useState(0);
  const generation = React.useRef(0);
  React.useEffect(() => {
    const controller = new AbortController();
    request.current = { path, controller };
    let current = true;
    void runtimeRequest(path, parse, { signal: controller.signal })
      .then((value) => {
        if (current && !controller.signal.aborted)
          setResult({ path, revision, value, error: null, observedAt: Date.now() });
      })
      .catch((error: unknown) => {
        if (current && !controller.signal.aborted)
          setResult({
            path,
            revision,
            value: null,
            error: runtimeErrorMessage(error),
            observedAt: undefined,
          });
      });
    return () => {
      current = false;
      controller.abort();
    };
  }, [path, parse, revision]);
  return {
    value: result?.path === path ? result.value : null,
    observedAt: result?.path === path ? result.observedAt : undefined,
    refreshing: result?.path === path && result.value !== null && result.revision !== revision,
    error: result?.path === path && result.revision === revision ? result.error : null,
    loading: result?.path !== path || result.revision !== revision,
    generation: revision,
    reload: React.useCallback(() => setRevision(++generation.current), []),
    clear: React.useCallback(
      (message: string) => {
        if (request.current?.path !== path) return;
        request.current.controller.abort();
        setResult({
          path,
          revision: generation.current,
          value: null,
          error: message,
          observedAt: undefined,
        });
      },
      [path],
    ),
  };
}
