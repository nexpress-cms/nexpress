import { describe, expect, it } from "vitest";

import {
  npAnalyzePluginScheduledTasks,
  npValidatePluginCronExpression,
  npValidatePluginScheduledTaskDefinition,
  npValidatePluginScheduledTaskId,
  npValidatePluginScheduledTaskResult,
} from "./scheduled-task-contract.js";

const validTask = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: "daily-rollup",
  cron: "5 0 * * *",
  description: "Roll up yesterday's events.",
  handler: () => undefined,
  ...overrides,
});

describe("plugin scheduled task contract", () => {
  it("accepts the supported five-field cron and definition shape", () => {
    expect(npValidatePluginScheduledTaskDefinition(validTask())).toEqual({ ok: true });
    expect(npValidatePluginCronExpression("H/15 0-6 * jan mon-fri")).toEqual({ ok: true });
    expect(npValidatePluginScheduledTaskId("daily.Rollup_2")).toEqual({ ok: true });
  });

  it.each([
    [validTask({ extra: true }), /contain only id, cron, handler, and description/],
    [validTask({ id: "../unsafe" }), /scheduled task\.id/],
    [validTask({ id: "." }), /dot segments/],
    [validTask({ cron: "0 0 * *" }), /exactly five fields/],
    [validTask({ cron: "0  0 * * *" }), /single spaces/],
    [validTask({ cron: "61 0 * * *" }), /cron is invalid/],
    [validTask({ handler: "./handler.js" }), /handler must be a function/],
    [validTask({ description: "" }), /description must be a non-empty string/],
  ])("rejects malformed definitions %#", (definition, message) => {
    const result = npValidatePluginScheduledTaskDefinition(definition);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(message);
  });

  it("reports invalid registries and duplicate ids separately", () => {
    expect(npAnalyzePluginScheduledTasks({})).toEqual([
      { code: "invalid-list", message: "scheduled must be an array." },
    ]);
    expect(
      npAnalyzePluginScheduledTasks([
        validTask(),
        validTask({ handler: "bad" }),
        validTask({ id: "other", cron: "bad" }),
      ]),
    ).toEqual([
      expect.objectContaining({ code: "invalid-definition", index: 1 }),
      {
        code: "duplicate-id",
        index: 1,
        taskId: "daily-rollup",
        message: 'duplicate scheduled task id "daily-rollup".',
      },
      expect.objectContaining({ code: "invalid-definition", index: 2 }),
    ]);
  });

  it("accepts only void handler results", () => {
    expect(npValidatePluginScheduledTaskResult(undefined)).toEqual({ ok: true });
    expect(npValidatePluginScheduledTaskResult(null)).toEqual({
      ok: false,
      message: "scheduled task handlers must return void.",
    });
    expect(npValidatePluginScheduledTaskResult({ ok: true }).ok).toBe(false);
  });
});
