import { CronExpressionParser } from "cron-parser";

export interface NpPluginScheduledTaskDefinition {
  readonly id: string;
  readonly cron: string;
  readonly handler: unknown;
  readonly description?: string;
}

export type NpPluginScheduledTaskValidationResult =
  { readonly ok: true } | { readonly ok: false; readonly message: string };

export type NpPluginScheduledTaskIssueCode = "invalid-list" | "invalid-definition" | "duplicate-id";

export interface NpPluginScheduledTaskIssue {
  readonly code: NpPluginScheduledTaskIssueCode;
  readonly message: string;
  readonly index?: number;
  readonly taskId?: string;
}

const scheduledTaskKeys = ["id", "cron", "handler", "description"] as const;
const scheduledTaskIdPattern = /^[A-Za-z0-9][A-Za-z0-9._-]*$/u;

function valid(): NpPluginScheduledTaskValidationResult {
  return { ok: true };
}

function invalid(message: string): NpPluginScheduledTaskValidationResult {
  return { ok: false, message };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value) as unknown;
  return prototype === Object.prototype || prototype === null;
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}

export function npValidatePluginScheduledTaskId(
  value: unknown,
): NpPluginScheduledTaskValidationResult {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 128 ||
    !scheduledTaskIdPattern.test(value) ||
    value === "." ||
    value === ".."
  ) {
    return invalid(
      "scheduled task.id must be 1-128 characters, start with a letter or number, and use only letters, numbers, dots, underscores, or hyphens without dot segments.",
    );
  }
  return valid();
}

export function npValidatePluginCronExpression(
  value: unknown,
): NpPluginScheduledTaskValidationResult {
  if (typeof value !== "string" || value.length === 0) {
    return invalid("scheduled task.cron must be a non-empty string.");
  }
  if (value.length > 256) {
    return invalid("scheduled task.cron must be 256 characters or fewer.");
  }
  const fields = value.split(" ");
  if (fields.length !== 5 || fields.some((field) => field.length === 0)) {
    return invalid(
      "scheduled task.cron must use exactly five fields separated by single spaces: minute hour day-of-month month day-of-week.",
    );
  }
  try {
    CronExpressionParser.parse(value, { tz: "UTC", strict: false });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return invalid(`scheduled task.cron is invalid: ${reason}`);
  }
  return valid();
}

export function npValidatePluginScheduledTaskDefinition(
  value: unknown,
): NpPluginScheduledTaskValidationResult {
  if (!isRecord(value) || !hasOnlyKeys(value, scheduledTaskKeys)) {
    return invalid("scheduled task must contain only id, cron, handler, and description.");
  }
  const idValidation = npValidatePluginScheduledTaskId(value.id);
  if (!idValidation.ok) return idValidation;
  const cronValidation = npValidatePluginCronExpression(value.cron);
  if (!cronValidation.ok) return cronValidation;
  if (typeof value.handler !== "function") {
    return invalid("scheduled task.handler must be a function.");
  }
  if (
    value.description !== undefined &&
    (typeof value.description !== "string" ||
      value.description.trim().length === 0 ||
      value.description.length > 500)
  ) {
    return invalid(
      "scheduled task.description must be a non-empty string with at most 500 characters when provided.",
    );
  }
  return valid();
}

export function npAnalyzePluginScheduledTasks(value: unknown): NpPluginScheduledTaskIssue[] {
  if (!Array.isArray(value)) {
    return [{ code: "invalid-list", message: "scheduled must be an array." }];
  }
  const issues: NpPluginScheduledTaskIssue[] = [];
  const taskIds = new Set<string>();
  for (const [index, task] of value.entries()) {
    const validation = npValidatePluginScheduledTaskDefinition(task);
    if (!validation.ok) {
      issues.push({
        code: "invalid-definition",
        index,
        message: `invalid scheduled task at index ${index.toString()}: ${validation.message}`,
      });
    }
    if (!isRecord(task) || typeof task.id !== "string" || task.id.length === 0) continue;
    if (taskIds.has(task.id)) {
      issues.push({
        code: "duplicate-id",
        index,
        taskId: task.id,
        message: `duplicate scheduled task id "${task.id}".`,
      });
    }
    taskIds.add(task.id);
  }
  return issues;
}

export function npValidatePluginScheduledTaskResult(
  value: unknown,
): NpPluginScheduledTaskValidationResult {
  return value === undefined ? valid() : invalid("scheduled task handlers must return void.");
}
