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
  } | null>(null);
  const [revision, setRevision] = React.useState(0);
  React.useEffect(() => {
    const controller = new AbortController();
    let current = true;
    void runtimeRequest(path, parse, { signal: controller.signal })
      .then((value) => {
        if (current) setResult({ path, revision, value, error: null });
      })
      .catch((error: unknown) => {
        if (current) setResult({ path, revision, value: null, error: runtimeErrorMessage(error) });
      });
    return () => {
      current = false;
      controller.abort();
    };
  }, [path, parse, revision]);
  return {
    value: result?.path === path && result.revision === revision ? result.value : null,
    error: result?.path === path && result.revision === revision ? result.error : null,
    loading: result?.path !== path || result.revision !== revision,
    reload: React.useCallback(() => setRevision((value) => value + 1), []),
    clear: React.useCallback(
      (message: string) => setResult({ path, revision, value: null, error: message }),
      [path, revision],
    ),
  };
}
