"use client";

import type { NpAgentRecipeSettingsV1 } from "@nexpress/core/agent-contract";
import { RuntimeNumber } from "./agent-runtime-fields.js";
import { RuntimeStringList } from "./agent-policy-fields.js";

/** Initial draft values have no authority; availability and activation remain server decisions. */
export function runtimeRecipeDraft(
  id: NpAgentRecipeSettingsV1["recipeId"],
): NpAgentRecipeSettingsV1 {
  switch (id) {
    case "publisher.stale-content":
      return {
        recipeId: id,
        recipeVersion: 1,
        collectionSlugs: [],
        staleAfterDays: 30,
        candidateLimit: 1,
        batchSize: 1,
      };
    case "moderator.repeated-link-spam":
      return {
        recipeId: id,
        recipeVersion: 1,
        collectionSlugs: [],
        windowSeconds: 3600,
        minIndependentAccounts: 3,
        minItems: 3,
        automaticConfidenceBasisPoints: 10000,
      };
    case "operator.worker-not-draining":
      return {
        recipeId: id,
        recipeVersion: 1,
        staleAfterSeconds: 300,
        minimumPendingJobs: 1,
        checkIds: [],
      };
    case "guardian.credential-stuffing":
      return {
        recipeId: id,
        recipeVersion: 1,
        audiences: ["staff"],
        windowSeconds: 300,
        minimumFailures: 10,
        minimumDistinctAccountBuckets: 3,
        actorLimitTtlSeconds: 60,
      };
    case "guardian.agent-abuse":
      return {
        recipeId: id,
        recipeVersion: 1,
        windowSeconds: 300,
        deniedScopeThreshold: 10,
        repeatedProposalThreshold: 10,
        costVelocityMicros: 0,
        actionThreshold: 10,
      };
  }
}

const labels: Record<string, string> = {
  staleAfterDays: "Stale after (days)",
  candidateLimit: "Candidate limit",
  batchSize: "Batch size",
  windowSeconds: "Observation window (seconds)",
  minIndependentAccounts: "Minimum independent accounts",
  minItems: "Minimum items",
  automaticConfidenceBasisPoints: "Automatic confidence (basis points)",
  staleAfterSeconds: "Stale after (seconds)",
  minimumPendingJobs: "Minimum pending jobs",
  minimumFailures: "Minimum failures",
  minimumDistinctAccountBuckets: "Minimum distinct account buckets",
  actorLimitTtlSeconds: "Actor limit TTL (seconds)",
  deniedScopeThreshold: "Denied scope threshold",
  repeatedProposalThreshold: "Repeated proposal threshold",
  costVelocityMicros: "Cost velocity (USD micros)",
  actionThreshold: "Action threshold",
};
const bounds: Record<string, readonly [number, number]> = {
  staleAfterDays: [30, 3650],
  candidateLimit: [1, 50],
  batchSize: [1, 5],
  windowSeconds: [60, 86400],
  minIndependentAccounts: [1, 100000],
  minItems: [1, 100000],
  automaticConfidenceBasisPoints: [0, 10000],
  staleAfterSeconds: [60, 86400],
  minimumPendingJobs: [1, 100000],
  minimumFailures: [1, 100000],
  minimumDistinctAccountBuckets: [1, 100000],
  actorLimitTtlSeconds: [60, 3600],
  deniedScopeThreshold: [1, 100000],
  repeatedProposalThreshold: [1, 100000],
  costVelocityMicros: [0, Number.MAX_SAFE_INTEGER],
  actionThreshold: [1, 100000],
};

export function RuntimeRecipeFields({
  value,
  onChange,
}: {
  value: NpAgentRecipeSettingsV1;
  onChange: (value: NpAgentRecipeSettingsV1) => void;
}) {
  return (
    <fieldset className="space-y-3">
      <legend className="font-medium">{value.recipeId}</legend>
      {"collectionSlugs" in value ? (
        <RuntimeStringList
          label="Collection slugs"
          value={value.collectionSlugs}
          onChange={(next) => onChange({ ...value, collectionSlugs: next ?? [] })}
        />
      ) : null}
      {"checkIds" in value ? (
        <RuntimeStringList
          label="Registered check IDs"
          value={value.checkIds}
          onChange={(next) => onChange({ ...value, checkIds: next ?? [] })}
        />
      ) : null}
      {"audiences" in value ? (
        <fieldset className="space-y-2">
          <legend>Login audiences</legend>
          {(["member", "staff"] as const).map((audience) => (
            <label key={audience} className="flex gap-2 text-sm">
              <input
                type="checkbox"
                checked={value.audiences.includes(audience)}
                onChange={(event) =>
                  onChange({
                    ...value,
                    audiences: [
                      ...value.audiences.filter((entry) => entry !== audience),
                      ...(event.target.checked ? [audience] : []),
                    ].sort(),
                  })
                }
              />
              {audience}
            </label>
          ))}
        </fieldset>
      ) : null}
      <div className="grid gap-4 sm:grid-cols-2">
        {Object.entries(value)
          .filter(([key, entry]) => key !== "recipeVersion" && typeof entry === "number")
          .map(([key, entry]) => (
            <RuntimeNumber
              key={key}
              label={labels[key] ?? key}
              value={Number(entry)}
              min={bounds[key]?.[0] ?? 0}
              max={bounds[key]?.[1] ?? Number.MAX_SAFE_INTEGER}
              onChange={(next) => onChange({ ...value, [key]: next ?? bounds[key]?.[0] ?? 0 })}
            />
          ))}
      </div>
    </fieldset>
  );
}
