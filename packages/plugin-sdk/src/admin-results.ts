import type {
  NpActionResult,
  NpAdminMetricResult,
  NpAdminStatusLevel,
  NpAdminStatusResult,
  NpAdminTableResult,
} from "./types.js";

export function npAdminMetric(
  value: string | number,
  delta?: string,
): NpActionResult<NpAdminMetricResult> {
  return { ok: true, data: delta === undefined ? { value } : { value, delta } };
}

export function npAdminStatus(
  level: NpAdminStatusLevel,
  message: string,
): NpActionResult<NpAdminStatusResult> {
  return { ok: true, data: { level, message } };
}

export function npAdminTable<TRow extends Record<string, unknown>>(
  rows: TRow[],
  total = rows.length,
): NpActionResult<NpAdminTableResult<TRow>> {
  return { ok: true, data: { rows, total } };
}

export function npAdminActionError(error: string): NpActionResult<never> {
  return { ok: false, error };
}
