"use client";

import * as React from "react";
import {
  npAgentActorRestrictionScopes,
  npAgentIncidentCategories,
  npAgentIncidentSeverities,
  npAgentProviderDataClasses,
  npAgentInstalledCapabilityDescriptorsV1,
  type NpAgentCapabilityModeV1,
  type NpAgentPolicyRulesV1,
} from "@nexpress/core/agent-contract";
import { Button } from "../ui/button.js";
import { Input } from "../ui/input.js";
import { Label } from "../ui/label.js";
import { RuntimeNumber, RuntimeSelect } from "./agent-runtime-fields.js";

const options = <T extends string>(values: readonly T[]) =>
  values.map((value) => ({ value, label: value }));
export function RuntimeStringList({
  label,
  value,
  onChange,
  nullable = false,
  commitOnChange = true,
}: {
  label: string;
  value: string[] | null;
  onChange: (value: string[] | null) => void;
  nullable?: boolean;
  /** Numeric trigger filters normalize only after a complete value is entered. */
  commitOnChange?: boolean;
}) {
  const id = React.useId();
  const [draft, setDraft] = React.useState({ source: value, text: value?.join(", ") ?? "" });
  const sameSource =
    draft.source === value ||
    (draft.source !== null &&
      value !== null &&
      draft.source.length === value.length &&
      draft.source.every((item, index) => item === value[index]));
  const text = sameSource ? draft.text : (value?.join(", ") ?? "");
  const commit = (text: string) => {
    const next = [
      ...new Set(
        text
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean),
      ),
    ].sort();
    const changed =
      value === null ||
      next.length !== value.length ||
      next.some((item, index) => item !== value[index]);
    setDraft({ source: changed ? next : value, text });
    if (changed) onChange(next);
  };
  return (
    <div className="min-w-0 space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      {nullable ? (
        <label className="flex gap-2 text-sm">
          <input
            type="checkbox"
            checked={value === null}
            aria-label={`No additional restriction for ${label}`}
            onChange={(event) => onChange(event.target.checked ? null : [])}
          />
          No additional restriction
        </label>
      ) : null}
      <Input
        id={id}
        value={text}
        disabled={value === null}
        placeholder="Comma-separated identifiers"
        aria-describedby={`${id}-hint`}
        onChange={(event) => {
          if (commitOnChange) commit(event.target.value);
          else setDraft({ source: value, text: event.target.value });
        }}
        onBlur={() => {
          if (!commitOnChange) commit(text);
        }}
      />
      <p id={`${id}-hint`} className="text-xs text-neutral-500">
        {value === null
          ? "Inherited rules and item authorization still apply."
          : "An empty list permits no matching resources."}
      </p>
    </div>
  );
}

export function RuntimeCapabilityModes({
  value,
  available,
  onChange,
}: {
  value: NpAgentCapabilityModeV1[];
  available: readonly NpAgentCapabilityModeV1[];
  onChange: (value: NpAgentCapabilityModeV1[]) => void;
}) {
  const ids = [
    ...new Set([
      ...available.map((entry) => entry.capabilityId),
      ...value.map((entry) => entry.capabilityId),
    ]),
  ].sort();
  return (
    <fieldset className="space-y-3">
      <legend className="font-medium">Capability execution modes</legend>
      <p className="text-sm text-neutral-500">
        Only server-offered modes can be selected. Human approval still requires the exact live
        approval; Never removes a capability.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        {ids.map((id) => {
          const current = value.find((entry) => entry.capabilityId === id)?.mode ?? "never";
          const modes = [
            ...new Set(
              available.filter((entry) => entry.capabilityId === id).map((entry) => entry.mode),
            ),
          ];
          const descriptor = Object.values(npAgentInstalledCapabilityDescriptorsV1).find(
            (entry) => entry.id === id,
          );
          if (!descriptor)
            return (
              <p key={id} className="text-sm">
                {id}: {current}. Current descriptor metadata is unavailable.
              </p>
            );
          return (
            <div key={id} className="space-y-2">
              <RuntimeSelect
                label={id}
                value={current}
                options={[
                  { value: "never" as const, label: "Never" },
                  ...modes.map((mode) => ({
                    value: mode,
                    label: (
                      {
                        observe: "Observe only",
                        advise: "Advise",
                        guarded: "Guarded automatic",
                        approved: "Human approval",
                      } as const
                    )[mode],
                  })),
                ]}
                onChange={(mode) =>
                  onChange(
                    [
                      ...value.filter((entry) => entry.capabilityId !== id),
                      ...(mode === "never" ? [] : [{ capabilityId: id, mode }]),
                    ].sort((a, b) => a.capabilityId.localeCompare(b.capabilityId)),
                  )
                }
              />
              <p className="text-xs text-neutral-500">
                Scopes: {descriptor.requiredScopes.join(", ") || "none"}. Risk: {descriptor.risk}.
                Approval: {descriptor.approval}. Effects:{" "}
                {descriptor.effectProfiles.map((profile) => profile.reversibility).join(", ")}.
              </p>
            </div>
          );
        })}
      </div>
    </fieldset>
  );
}

export function RuntimePolicyFields({
  value,
  availableModes,
  onChange,
}: {
  value: NpAgentPolicyRulesV1;
  availableModes: readonly NpAgentCapabilityModeV1[];
  onChange: (value: NpAgentPolicyRulesV1) => void;
}) {
  return (
    <div className="space-y-6">
      <RuntimeCapabilityModes
        value={value.capabilityModes}
        available={availableModes}
        onChange={(capabilityModes) => onChange({ ...value, capabilityModes })}
      />
      <fieldset className="space-y-3">
        <legend className="font-medium">Resource allowlists</legend>
        <div className="grid gap-4 sm:grid-cols-2">
          {(["collections", "navigationLocations", "themeIds", "settingKeys"] as const).map(
            (key) => (
              <RuntimeStringList
                key={key}
                label={key}
                nullable
                value={value.resources[key]}
                onChange={(next) =>
                  onChange({ ...value, resources: { ...value.resources, [key]: next } })
                }
              />
            ),
          )}
          {(["incidentCategories", "actorRestrictionScopes"] as const).map((key) => (
            <fieldset className="space-y-2" key={key}>
              <legend>{key}</legend>
              <label className="flex gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={value.resources[key] === null}
                  aria-label={`No additional restriction for ${key}`}
                  onChange={(event) =>
                    onChange({
                      ...value,
                      resources: { ...value.resources, [key]: event.target.checked ? null : [] },
                    })
                  }
                />
                No additional restriction
              </label>
              {(key === "incidentCategories"
                ? npAgentIncidentCategories
                : npAgentActorRestrictionScopes
              ).map((item) => (
                <label className="flex gap-2 text-sm" key={item}>
                  <input
                    type="checkbox"
                    disabled={value.resources[key] === null}
                    checked={(value.resources[key] as string[] | null)?.includes(item) ?? false}
                    onChange={(event) => {
                      const next = [
                        ...new Set([
                          ...(value.resources[key] ?? []).filter((entry) => entry !== item),
                          ...(event.target.checked ? [item] : []),
                        ]),
                      ].sort();
                      if (key === "incidentCategories")
                        onChange({
                          ...value,
                          resources: {
                            ...value.resources,
                            incidentCategories: next.filter(
                              (entry): entry is (typeof npAgentIncidentCategories)[number] =>
                                npAgentIncidentCategories.some((candidate) => candidate === entry),
                            ),
                          },
                        });
                      else
                        onChange({
                          ...value,
                          resources: {
                            ...value.resources,
                            actorRestrictionScopes: next.filter(
                              (entry): entry is (typeof npAgentActorRestrictionScopes)[number] =>
                                npAgentActorRestrictionScopes.some(
                                  (candidate) => candidate === entry,
                                ),
                            ),
                          },
                        });
                    }}
                  />
                  {item}
                </label>
              ))}
            </fieldset>
          ))}
        </div>
      </fieldset>
      <fieldset className="space-y-3">
        <legend className="font-medium">Risk and data handling</legend>
        <div className="grid gap-4 sm:grid-cols-2">
          <RuntimeSelect
            label="Maximum automatic action risk"
            value={value.risk.automaticActionMaximum}
            options={options(["read", "reversible"] as const)}
            onChange={(automaticActionMaximum) =>
              onChange({ ...value, risk: { ...value.risk, automaticActionMaximum } })
            }
          />
          {(["requirePreviewAtOrAbove", "requireRecentAuthAtOrAbove"] as const).map((key) => (
            <RuntimeSelect
              key={key}
              label={
                key === "requirePreviewAtOrAbove"
                  ? "Require preview at or above"
                  : "Require recent authentication at or above"
              }
              value={value.risk[key] ?? "none"}
              options={options(["none", "reversible", "sensitive", "destructive"] as const)}
              onChange={(next) =>
                onChange({
                  ...value,
                  risk: { ...value.risk, [key]: next === "none" ? null : next },
                })
              }
            />
          ))}
          <RuntimeSelect
            label="Maximum provider data class"
            value={value.providerDataMaximum}
            options={options(npAgentProviderDataClasses)}
            onChange={(providerDataMaximum) => onChange({ ...value, providerDataMaximum })}
          />
        </div>
      </fieldset>
      <fieldset className="space-y-3">
        <legend className="font-medium">Automation thresholds</legend>
        <div className="grid gap-4 sm:grid-cols-2">
          <RuntimeNumber
            label="Moderation automatic quarantine confidence (basis points)"
            value={value.automation.moderationAutoQuarantineMinBasisPoints}
            max={10000}
            onChange={(next) =>
              onChange({
                ...value,
                automation: { ...value.automation, moderationAutoQuarantineMinBasisPoints: next },
              })
            }
          />
          <RuntimeNumber
            label="Moderation targets per run"
            value={value.automation.moderationTargetsPerRun}
            onChange={(next) =>
              onChange({
                ...value,
                automation: { ...value.automation, moderationTargetsPerRun: next ?? 0 },
              })
            }
          />
          <RuntimeSelect
            label="Guardian minimum severity"
            value={value.automation.guardianLimitActorMinSeverity ?? "none"}
            options={options(["none", "high", "critical"] as const)}
            onChange={(next) =>
              onChange({
                ...value,
                automation: {
                  ...value.automation,
                  guardianLimitActorMinSeverity: next === "none" ? null : next,
                },
              })
            }
          />
          <RuntimeNumber
            label="Guardian restriction TTL (seconds)"
            value={value.automation.guardianRestrictionTtlSeconds}
            min={60}
            max={3600}
            onChange={(next) =>
              onChange({
                ...value,
                automation: { ...value.automation, guardianRestrictionTtlSeconds: next ?? 60 },
              })
            }
          />
        </div>
        <p className="text-sm text-neutral-500">
          Guardian complements existing security controls; it does not replace WAF, IDS or SIEM.
        </p>
        <h4 className="text-sm font-medium">Quiet hours (UTC minutes, 0–1440)</h4>
        {value.automation.quietHoursUtc.map((range, index) => (
          <div key={index} className="grid gap-3 sm:grid-cols-3">
            <RuntimeNumber
              label={`Quiet period ${index + 1} start minute`}
              value={range.startMinute}
              max={1439}
              onChange={(next) =>
                onChange({
                  ...value,
                  automation: {
                    ...value.automation,
                    quietHoursUtc: value.automation.quietHoursUtc.map((entry, i) =>
                      i === index ? { ...entry, startMinute: next ?? 0 } : entry,
                    ),
                  },
                })
              }
            />
            <RuntimeNumber
              label={`Quiet period ${index + 1} end minute`}
              value={range.endMinute}
              min={1}
              max={1440}
              onChange={(next) =>
                onChange({
                  ...value,
                  automation: {
                    ...value.automation,
                    quietHoursUtc: value.automation.quietHoursUtc.map((entry, i) =>
                      i === index ? { ...entry, endMinute: next ?? 1 } : entry,
                    ),
                  },
                })
              }
            />
            <Button
              type="button"
              variant="outline"
              onClick={() =>
                onChange({
                  ...value,
                  automation: {
                    ...value.automation,
                    quietHoursUtc: value.automation.quietHoursUtc.filter((_, i) => i !== index),
                  },
                })
              }
            >
              Remove quiet period {index + 1}
            </Button>
          </div>
        ))}
        <Button
          type="button"
          variant="outline"
          disabled={value.automation.quietHoursUtc.length >= 32}
          onClick={() =>
            onChange({
              ...value,
              automation: {
                ...value.automation,
                quietHoursUtc: [
                  ...value.automation.quietHoursUtc,
                  { startMinute: 0, endMinute: 60 },
                ],
              },
            })
          }
        >
          Add quiet period
        </Button>
      </fieldset>
      <fieldset className="space-y-3">
        <legend className="font-medium">Escalation and retention</legend>
        <RuntimeSelect
          label="Minimum escalation severity"
          value={value.escalation.minimumSeverity}
          options={options(npAgentIncidentSeverities)}
          onChange={(minimumSeverity) =>
            onChange({ ...value, escalation: { ...value.escalation, minimumSeverity } })
          }
        />
        <div className="flex flex-wrap gap-4">
          {(["admin", "email", "siem", "slack", "webhook"] as const).map((channel) => (
            <label className="flex gap-2 text-sm" key={channel}>
              <input
                type="checkbox"
                checked={value.escalation.channels.includes(channel)}
                onChange={(event) =>
                  onChange({
                    ...value,
                    escalation: {
                      ...value.escalation,
                      channels: [
                        ...value.escalation.channels.filter((entry) => entry !== channel),
                        ...(event.target.checked ? [channel] : []),
                      ].sort(),
                    },
                  })
                }
              />
              {channel}
            </label>
          ))}
        </div>
        <p className="text-xs text-neutral-500">
          Selecting a channel does not install an adapter or send a notification.
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          {(
            Object.keys(value.retentionDays) as Extract<
              keyof NpAgentPolicyRulesV1["retentionDays"],
              string
            >[]
          ).map((key) => (
            <RuntimeNumber
              key={key}
              label={`${key} retention (days)`}
              min={1}
              value={value.retentionDays[key]}
              onChange={(next) =>
                onChange({ ...value, retentionDays: { ...value.retentionDays, [key]: next ?? 1 } })
              }
            />
          ))}
        </div>
      </fieldset>
    </div>
  );
}
