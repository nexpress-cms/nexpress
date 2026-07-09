import { npFetch } from "./api-client.js";

export type NpPluginActionResultKind = "action" | "metric" | "status" | "table";

export interface NpPluginMetricResult {
  value: string | number;
  delta?: string;
}

export interface NpPluginStatusResult {
  level: "ok" | "warn" | "error";
  message: string;
}

export interface NpPluginTableResult {
  rows: Array<Record<string, unknown>>;
  total: number;
}

interface NpPluginActionDataByKind {
  action: unknown;
  metric: NpPluginMetricResult;
  status: NpPluginStatusResult;
  table: NpPluginTableResult;
}

export type NpPluginActionDispatchResult<TKind extends NpPluginActionResultKind> =
  { ok: true; data: NpPluginActionDataByKind[TKind] } | { ok: false; error: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function malformed(message: string): { ok: false; error: string } {
  return { ok: false, error: `Malformed plugin action result: ${message}` };
}

function decodeMetric(data: unknown): NpPluginActionDispatchResult<"metric"> {
  if (!isRecord(data)) return malformed("metric data must be an object.");
  if (typeof data.value !== "string" && typeof data.value !== "number") {
    return malformed("metric data.value must be a string or number.");
  }
  if (typeof data.value === "number" && !Number.isFinite(data.value)) {
    return malformed("metric data.value must be finite.");
  }
  if (data.delta !== undefined && typeof data.delta !== "string") {
    return malformed("metric data.delta must be a string when provided.");
  }
  return {
    ok: true,
    data: {
      value: data.value,
      ...(data.delta === undefined ? {} : { delta: data.delta }),
    },
  };
}

function decodeStatus(data: unknown): NpPluginActionDispatchResult<"status"> {
  if (!isRecord(data)) return malformed("status data must be an object.");
  if (data.level !== "ok" && data.level !== "warn" && data.level !== "error") {
    return malformed('status data.level must be "ok", "warn", or "error".');
  }
  if (typeof data.message !== "string") {
    return malformed("status data.message must be a string.");
  }
  return { ok: true, data: { level: data.level, message: data.message } };
}

function decodeTable(data: unknown): NpPluginActionDispatchResult<"table"> {
  if (!isRecord(data)) return malformed("table data must be an object.");
  if (!Array.isArray(data.rows)) {
    return malformed("table data.rows must be an array.");
  }
  if (!data.rows.every(isRecord)) {
    return malformed("every table row must be an object.");
  }
  if (typeof data.total !== "number" || !Number.isFinite(data.total)) {
    return malformed("table data.total must be a finite number.");
  }
  return { ok: true, data: { rows: data.rows, total: data.total } };
}

/**
 * Strictly decodes the wire result returned by a plugin action. This remains
 * client-side defense in depth even when the host validates registered action
 * kinds: legacy hosts and raw API responses can still return malformed JSON.
 */
export function npDecodePluginActionResult<TKind extends NpPluginActionResultKind>(
  value: unknown,
  expectedKind: TKind,
): NpPluginActionDispatchResult<TKind> {
  if (!isRecord(value)) return malformed("the response envelope must be an object.");
  if (typeof value.ok !== "boolean") {
    return malformed('the response envelope must contain a boolean "ok" field.');
  }
  if (value.error !== undefined && typeof value.error !== "string") {
    return malformed('the response envelope "error" field must be a string when provided.');
  }
  if (!value.ok) {
    return {
      ok: false,
      error:
        typeof value.error === "string" && value.error.length > 0
          ? value.error
          : "Plugin action failed without an error message.",
    };
  }

  if (expectedKind === "action") {
    return { ok: true, data: value.data } as NpPluginActionDispatchResult<TKind>;
  }
  if (expectedKind === "metric") {
    return decodeMetric(value.data) as NpPluginActionDispatchResult<TKind>;
  }
  if (expectedKind === "status") {
    return decodeStatus(value.data) as NpPluginActionDispatchResult<TKind>;
  }
  return decodeTable(value.data) as NpPluginActionDispatchResult<TKind>;
}

async function readHttpError(response: Response): Promise<string> {
  const body = (await response.json().catch(() => null)) as unknown;
  if (isRecord(body) && isRecord(body.error) && typeof body.error.message === "string") {
    return body.error.message;
  }
  return `Plugin action request failed with HTTP ${response.status.toString()}.`;
}

export async function npDispatchPluginAction<TKind extends NpPluginActionResultKind>(
  pluginId: string,
  actionId: string,
  expectedKind: TKind,
  payload?: unknown,
): Promise<NpPluginActionDispatchResult<TKind>> {
  if (actionId === "." || actionId === "..") {
    return {
      ok: false,
      error: `Plugin action id "${actionId}" cannot be dispatched through an Admin URL.`,
    };
  }
  try {
    const response = await npFetch(
      `/api/plugins/${encodeURIComponent(pluginId)}/actions/${encodeURIComponent(actionId)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: payload === undefined ? "" : JSON.stringify(payload),
      },
    );
    if (!response.ok) {
      return { ok: false, error: await readHttpError(response) };
    }
    const body = (await response.json().catch(() => null)) as unknown;
    return npDecodePluginActionResult(body, expectedKind);
  } catch (error) {
    return {
      ok: false,
      error: `Plugin action request failed: ${
        error instanceof Error ? error.message : "Unknown network error"
      }`,
    };
  }
}
