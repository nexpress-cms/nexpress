"use client";

import { useState } from "react";
import type { NpFieldConfig } from "@nexpress/core";
import { npFetch } from "../lib/api-client.js";

export function getPluginConfigDefaultValues(
  fields: NpFieldConfig[],
  initialConfig: Record<string, unknown>,
): Record<string, unknown> {
  const values = { ...initialConfig };
  for (const field of fields) {
    if (field.type === "row" || field.type === "collapsible") continue;
    if (values[field.name] === undefined && field.defaultValue !== undefined) {
      values[field.name] = field.defaultValue;
    }
  }
  return values;
}

export async function savePluginConfig(
  pluginId: string,
  value: Record<string, unknown>,
  failureMessage: string,
): Promise<void> {
  const response = await npFetch(`/api/admin/plugins/${encodeURIComponent(pluginId)}/config`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ value }),
  });
  if (response.ok) return;

  const payload: unknown = await response.json().catch(() => null);
  if (payload && typeof payload === "object" && "error" in payload) {
    const error = payload.error;
    if (error && typeof error === "object" && "message" in error) {
      if (typeof error.message === "string") throw new Error(error.message);
    }
  }
  throw new Error(failureMessage);
}

export function usePluginConfigSave(pluginId: string, failureMessage: string) {
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function save(value: Record<string, unknown>): Promise<boolean> {
    setSaving(true);
    setSaved(false);
    setErrorMessage(null);
    try {
      await savePluginConfig(pluginId, value, failureMessage);
      setSaved(true);
      return true;
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : failureMessage);
      return false;
    } finally {
      setSaving(false);
    }
  }

  return { saving, saved, errorMessage, save };
}
