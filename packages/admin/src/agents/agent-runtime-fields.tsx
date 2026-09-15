"use client";

import * as React from "react";
import type { NpAgentBudgetV1 } from "@nexpress/core/agent-contract";
import { Input } from "../ui/input.js";
import { Label } from "../ui/label.js";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select.js";

export function RuntimeSelect<T extends string>({
  label,
  value,
  options,
  onChange,
  disabled,
}: {
  label: string;
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (value: T) => void;
  disabled?: boolean;
}) {
  const id = React.useId();
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Select
        value={value}
        disabled={disabled}
        onValueChange={(next) => {
          const option = options.find((entry) => entry.value === next);
          if (option) onChange(option.value);
        }}
      >
        <SelectTrigger id={id}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

export function RuntimeNumber({
  label,
  value,
  onChange,
  min = 0,
  max = Number.MAX_SAFE_INTEGER,
  disabled,
  hint,
}: {
  label: string;
  value: number | null;
  onChange: (value: number | null) => void;
  min?: number;
  max?: number;
  disabled?: boolean;
  hint?: string;
}) {
  const id = React.useId();
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        type="number"
        min={min}
        max={max}
        step={1}
        value={value ?? ""}
        disabled={disabled}
        placeholder="Inherit"
        aria-describedby={hint ? `${id}-hint` : undefined}
        onChange={(event) => {
          const next = event.target.value;
          onChange(next === "" ? null : Number(next));
        }}
      />
      {hint ? (
        <p className="text-xs text-neutral-500" id={`${id}-hint`}>
          {hint}
        </p>
      ) : null}
    </div>
  );
}

type BudgetKey = Exclude<keyof NpAgentBudgetV1, "schemaVersion" | "costCurrency">;
export const runtimeBudgetLabels: Record<BudgetKey, string> = {
  maxConcurrentRuns: "Concurrent runs",
  maxConcurrentProviderCalls: "Concurrent provider calls",
  runsPerHour: "Runs per rolling hour",
  providerCallsPerHour: "Provider calls per rolling hour",
  providerCallsPerRun: "Provider calls per run",
  inputTokensPerRun: "Input tokens per run",
  outputTokensPerRun: "Output tokens per run",
  inputTokensPerDay: "Input tokens per UTC day",
  outputTokensPerDay: "Output tokens per UTC day",
  inputTokensPerMonth: "Input tokens per UTC month",
  outputTokensPerMonth: "Output tokens per UTC month",
  costMicrosPerDay: "USD micros per UTC day",
  costMicrosPerMonth: "USD micros per UTC month",
  attemptsPerRun: "Attempts per run",
  capabilityCallsPerRun: "Capability calls per run",
  incidentAnalysesPerFingerprintPerDay: "Incident analyses per fingerprint per day",
  incidentAnalysisCooldownSeconds: "Incident analysis cooldown (seconds)",
  directActionsPerHour: "Direct actions per rolling hour",
  directActionsPerSubjectPerHour: "Direct actions per subject per hour",
  warningBasisPoints: "Warning threshold (basis points)",
};

export function RuntimeBudgetFields({
  value,
  ceiling,
  onChange,
  disabled,
}: {
  value: NpAgentBudgetV1;
  ceiling?: NpAgentBudgetV1;
  onChange: (value: NpAgentBudgetV1) => void;
  disabled?: boolean;
}) {
  return (
    <fieldset disabled={disabled} className="space-y-3">
      <legend className="font-medium">Budget and limits</legend>
      <p className="text-sm text-neutral-500">
        Empty values inherit the stricter deployment/site ceiling. Costs are USD micros (1,000,000 =
        $1). Cooldown is a minimum delay; other limits are maxima.
      </p>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {(Object.keys(runtimeBudgetLabels) as BudgetKey[]).map((key) => (
          <RuntimeNumber
            key={key}
            label={runtimeBudgetLabels[key]}
            value={value[key]}
            disabled={disabled}
            min={
              key === "warningBasisPoints"
                ? 0
                : key === "incidentAnalysisCooldownSeconds"
                  ? (ceiling?.[key] ?? 0)
                  : 0
            }
            max={
              key === "warningBasisPoints"
                ? (ceiling?.[key] ?? 10_000)
                : key === "incidentAnalysisCooldownSeconds"
                  ? 86_400
                  : Math.min(
                      ceiling?.[key] ?? Number.MAX_SAFE_INTEGER,
                      key === "costMicrosPerDay" || key === "costMicrosPerMonth"
                        ? Number.MAX_SAFE_INTEGER
                        : 2_147_483_647,
                    )
            }
            hint={
              ceiling
                ? `Inherited ${key === "incidentAnalysisCooldownSeconds" ? "minimum" : "ceiling"}: ${ceiling[key] ?? "not configured"}`
                : undefined
            }
            onChange={(next) =>
              onChange({ ...value, [key]: key === "warningBasisPoints" ? (next ?? 0) : next })
            }
          />
        ))}
      </div>
    </fieldset>
  );
}
