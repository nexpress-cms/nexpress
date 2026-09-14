"use client";

import {
  npAgentEventKinds,
  npAgentTriggerFieldsV1,
  type NpAgentTrigger,
  type NpAgentTriggerFilter,
} from "@nexpress/core/agent-contract";
import { RuntimeNumber, RuntimeSelect } from "./agent-runtime-fields.js";
import { RuntimeStringList } from "./agent-policy-fields.js";
import { Button } from "../ui/button.js";
import { Input } from "../ui/input.js";
import { Label } from "../ui/label.js";
const options = <T extends string>(values: readonly T[]) =>
  values.map((value) => ({ value, label: value }));
const defaultFilter = (): NpAgentTriggerFilter => ({
  op: "eq",
  field: "privacy",
  value: "internal",
});

export function RuntimeEventTriggerFields({
  value,
  onChange,
}: {
  value: Extract<NpAgentTrigger, { type: "event" }>;
  onChange: (value: Extract<NpAgentTrigger, { type: "event" }>) => void;
}) {
  return (
    <div className="space-y-3">
      <RuntimeSelect
        label="Registered event kind"
        value={value.eventKind}
        options={options(npAgentEventKinds)}
        onChange={(eventKind) => onChange({ ...value, eventKind })}
      />
      <RuntimeNumber
        label="Coalescing window (seconds)"
        value={value.coalesceSeconds}
        max={86400}
        onChange={(next) => onChange({ ...value, coalesceSeconds: next ?? 0 })}
      />
      <p className="text-sm text-neutral-500">
        Filters use the closed event envelope fields. The server validates which fields and values
        apply to the selected event kind.
      </p>
      <TriggerFilter
        value={value.filter}
        onChange={(filter) => onChange({ ...value, filter })}
        label="Event filter"
        depth={0}
      />
    </div>
  );
}
function TriggerFilter({
  value,
  onChange,
  label,
  depth,
}: {
  value: NpAgentTriggerFilter;
  onChange: (value: NpAgentTriggerFilter) => void;
  label: string;
  depth: number;
}) {
  return (
    <fieldset className="space-y-3 rounded border p-3">
      <legend className="px-1 text-sm font-medium">{label}</legend>
      <RuntimeSelect
        label={`${label} operator`}
        value={value.op}
        options={options(
          depth < 3
            ? (["eq", "in", "gte", "lte", "all", "any"] as const)
            : (["eq", "in", "gte", "lte"] as const),
        )}
        onChange={(op) =>
          onChange(
            op === "all" || op === "any"
              ? { op, terms: [defaultFilter()] }
              : op === "gte" || op === "lte"
                ? { op, field: "payload.count", value: 0 }
                : op === "in"
                  ? { op, field: "privacy", values: ["internal"] }
                  : defaultFilter(),
          )
        }
      />
      {"terms" in value ? (
        <>
          {value.terms.map((term, index) => (
            <div key={index} className="space-y-2">
              <TriggerFilter
                value={term}
                label={`${label} condition ${index + 1}`}
                depth={depth + 1}
                onChange={(next) =>
                  onChange({
                    ...value,
                    terms: value.terms.map((entry, i) => (i === index ? next : entry)),
                  })
                }
              />
              <Button
                type="button"
                variant="outline"
                disabled={value.terms.length <= 1}
                onClick={() =>
                  onChange({ ...value, terms: value.terms.filter((_, i) => i !== index) })
                }
              >
                Remove condition {index + 1}
              </Button>
            </div>
          ))}
          <Button
            type="button"
            variant="outline"
            disabled={value.terms.length >= 8}
            onClick={() => onChange({ ...value, terms: [...value.terms, defaultFilter()] })}
          >
            Add filter condition
          </Button>
        </>
      ) : (
        <>
          {value.op !== "eq" && value.op !== "in" ? (
            <RuntimeNumber
              label={`${label} count`}
              value={value.value}
              onChange={(next) => onChange({ ...value, value: next ?? 0 })}
            />
          ) : (
            <>
              <RuntimeSelect
                label={`${label} field`}
                value={value.field}
                options={options(npAgentTriggerFieldsV1)}
                onChange={(field) =>
                  onChange(
                    value.op === "in"
                      ? { ...value, field, values: field === "payload.count" ? [0] : [""] }
                      : { ...value, field, value: field === "payload.count" ? 0 : "" },
                  )
                }
              />
              {value.op === "in" ? (
                <RuntimeStringList
                  label={`${label} allowed values`}
                  value={value.values.map(String)}
                  onChange={(next) =>
                    onChange({
                      ...value,
                      values: (next ?? []).map((entry) =>
                        value.field === "payload.count" ? Number(entry) : entry,
                      ),
                    })
                  }
                />
              ) : value.field === "payload.count" ? (
                <RuntimeNumber
                  label={`${label} expected count`}
                  value={Number(value.value)}
                  onChange={(next) => onChange({ ...value, value: next ?? 0 })}
                />
              ) : (
                <Label className="space-y-2">
                  {label} expected value
                  <Input
                    value={String(value.value)}
                    maxLength={128}
                    onChange={(event) => onChange({ ...value, value: event.target.value })}
                  />
                </Label>
              )}
            </>
          )}
        </>
      )}
    </fieldset>
  );
}
