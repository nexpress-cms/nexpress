export type NpPluginActionKind = "action" | "metric" | "status" | "table";

export type NpPluginActionRegistrationSource = "definition" | "setup";

export interface NpRegisteredPluginAction {
  id: string;
  kind: NpPluginActionKind;
  source: NpPluginActionRegistrationSource;
  description?: string;
}

export interface NpPluginAdminActionReference {
  actionId: string;
  expectedKind: Exclude<NpPluginActionKind, "action"> | null;
  location: string;
}

export type NpPluginAdminActionIssueCode =
  | "missing"
  | "kind-mismatch"
  | "conflicting-references"
  | "duplicate"
  | "untyped"
  | "unused"
  | "unsafe-id";

export interface NpPluginAdminActionIssue {
  code: NpPluginAdminActionIssueCode;
  severity: "error" | "warning";
  actionId: string;
  message: string;
  locations: string[];
  expectedKind?: Exclude<NpPluginActionKind, "action">;
  actualKind?: NpPluginActionKind;
}

export interface NpPluginActionRegistrationConflict {
  actionId: string;
  previous: NpRegisteredPluginAction;
  replacement: NpRegisteredPluginAction;
}

type AdminWidgetLike = {
  id?: unknown;
  kind?: unknown;
  actionId?: unknown;
};

type AdminActionLike = {
  id?: unknown;
  actionId?: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readEntries(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function readId(value: unknown, fallback: string): string {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

function addWidgetReferences(
  references: NpPluginAdminActionReference[],
  value: unknown,
  location: string,
): void {
  for (const [index, entry] of readEntries(value).entries()) {
    if (!isRecord(entry)) continue;
    const widget = entry as AdminWidgetLike;
    if (typeof widget.actionId !== "string" || widget.actionId.length === 0) continue;
    if (widget.kind !== "metric" && widget.kind !== "status") continue;
    references.push({
      actionId: widget.actionId,
      expectedKind: widget.kind,
      location: `${location}.${readId(widget.id, index.toString())}`,
    });
  }
}

function addButtonReferences(
  references: NpPluginAdminActionReference[],
  value: unknown,
  location: string,
): void {
  for (const [index, entry] of readEntries(value).entries()) {
    if (!isRecord(entry)) continue;
    const action = entry as AdminActionLike;
    if (typeof action.actionId !== "string" || action.actionId.length === 0) continue;
    references.push({
      actionId: action.actionId,
      // Buttons consume the base NpActionResult and intentionally accept
      // typed metric/status/table handlers too.
      expectedKind: null,
      location: `${location}.${readId(action.id, index.toString())}`,
    });
  }
}

/**
 * Flattens every declarative admin action reference into one diagnostic form.
 * The input stays structural so core can inspect SDK-built and hand-rolled
 * plugin definitions without depending on `@nexpress/plugin-sdk`.
 */
export function npCollectPluginAdminActionReferences(
  admin: unknown,
): NpPluginAdminActionReference[] {
  if (!isRecord(admin)) return [];
  const references: NpPluginAdminActionReference[] = [];
  addWidgetReferences(references, admin.widgets, "admin.widgets");
  addButtonReferences(references, admin.actions, "admin.actions");

  for (const [index, entry] of readEntries(admin.tables).entries()) {
    if (!isRecord(entry)) continue;
    if (typeof entry.rowsActionId !== "string" || entry.rowsActionId.length === 0) continue;
    references.push({
      actionId: entry.rowsActionId,
      expectedKind: "table",
      location: `admin.tables.${readId(entry.id, index.toString())}`,
    });
  }

  for (const [index, entry] of readEntries(admin.collectionTabs).entries()) {
    if (!isRecord(entry)) continue;
    const tabId = readId(entry.id, index.toString());
    addWidgetReferences(references, entry.widgets, `admin.collectionTabs.${tabId}.widgets`);
    addButtonReferences(references, entry.actions, `admin.collectionTabs.${tabId}.actions`);
  }

  addWidgetReferences(references, admin.dashboardWidgets, "admin.dashboardWidgets");
  return references;
}

/**
 * Compares declarative admin consumers with registered action ids/kinds.
 * Generic setup-time `register()` remains a compatibility wildcard for typed
 * consumers and is reported as a warning rather than a hard mismatch.
 */
export function npAnalyzePluginAdminActionContract(
  admin: unknown,
  actions: Iterable<NpRegisteredPluginAction>,
  conflicts: Iterable<NpPluginActionRegistrationConflict> = [],
): NpPluginAdminActionIssue[] {
  const registered = [...actions];
  const byId = new Map(registered.map((action) => [action.id, action]));
  const references = npCollectPluginAdminActionReferences(admin);
  const issues: NpPluginAdminActionIssue[] = [];
  const unsafeIds = new Set<string>(
    references
      .map((reference) => reference.actionId)
      .filter((actionId) => actionId === "." || actionId === ".."),
  );

  for (const actionId of unsafeIds) {
    issues.push({
      code: "unsafe-id",
      severity: "error",
      actionId,
      message: `Declarative admin uses unsafe URL-segment action id "${actionId}".`,
      locations: references
        .filter((reference) => reference.actionId === actionId)
        .map((reference) => reference.location),
    });
  }

  for (const conflict of conflicts) {
    issues.push({
      code: "duplicate",
      severity: "warning",
      actionId: conflict.actionId,
      message:
        `Action "${conflict.actionId}" was registered more than once; ` +
        `${conflict.replacement.source} ${conflict.replacement.kind} replaced ` +
        `${conflict.previous.source} ${conflict.previous.kind}.`,
      locations: [],
      actualKind: conflict.replacement.kind,
    });
  }

  const typedKindsByAction = new Map<string, Set<Exclude<NpPluginActionKind, "action">>>();
  for (const reference of references) {
    if (reference.expectedKind === null) continue;
    const kinds = typedKindsByAction.get(reference.actionId) ?? new Set();
    kinds.add(reference.expectedKind);
    typedKindsByAction.set(reference.actionId, kinds);
  }
  for (const [actionId, kinds] of typedKindsByAction) {
    if (kinds.size < 2) continue;
    const locations = references
      .filter((reference) => reference.actionId === actionId && reference.expectedKind !== null)
      .map((reference) => reference.location);
    issues.push({
      code: "conflicting-references",
      severity: "error",
      actionId,
      message: `Action "${actionId}" is consumed as incompatible kinds: ${[...kinds].join(", ")}.`,
      locations,
    });
  }

  const missingIds = new Set<string>();
  const untypedIds = new Set<string>();
  const mismatchKeys = new Set<string>();
  for (const reference of references) {
    if (unsafeIds.has(reference.actionId)) continue;
    const action = byId.get(reference.actionId);
    if (!action) {
      if (missingIds.has(reference.actionId)) continue;
      missingIds.add(reference.actionId);
      issues.push({
        code: "missing",
        severity: "error",
        actionId: reference.actionId,
        message: `Declarative admin references missing action "${reference.actionId}".`,
        locations: references
          .filter((candidate) => candidate.actionId === reference.actionId)
          .map((candidate) => candidate.location),
      });
      continue;
    }
    if (reference.expectedKind === null || action.kind === reference.expectedKind) continue;
    if (action.kind === "action" && action.source === "setup") {
      if (untypedIds.has(reference.actionId)) continue;
      untypedIds.add(reference.actionId);
      issues.push({
        code: "untyped",
        severity: "warning",
        actionId: reference.actionId,
        message:
          `Setup action "${reference.actionId}" uses generic register(); ` +
          `use register${reference.expectedKind[0]?.toUpperCase()}${reference.expectedKind.slice(1)}() ` +
          "or a definition-level action to verify its result kind.",
        locations: references
          .filter((candidate) => candidate.actionId === reference.actionId)
          .map((candidate) => candidate.location),
        expectedKind: reference.expectedKind,
        actualKind: action.kind,
      });
      continue;
    }

    const key = `${reference.actionId}:${reference.expectedKind}:${action.kind}`;
    if (mismatchKeys.has(key)) continue;
    mismatchKeys.add(key);
    issues.push({
      code: "kind-mismatch",
      severity: "error",
      actionId: reference.actionId,
      message:
        `Action "${reference.actionId}" is registered as ${action.kind}, ` +
        `but declarative admin expects ${reference.expectedKind}.`,
      locations: references
        .filter(
          (candidate) =>
            candidate.actionId === reference.actionId &&
            candidate.expectedKind === reference.expectedKind,
        )
        .map((candidate) => candidate.location),
      expectedKind: reference.expectedKind,
      actualKind: action.kind,
    });
  }

  const referencedIds = new Set(references.map((reference) => reference.actionId));
  for (const action of registered) {
    if (referencedIds.has(action.id)) continue;
    issues.push({
      code: "unused",
      severity: "warning",
      actionId: action.id,
      message:
        `Action "${action.id}" is not referenced by declarative admin. ` +
        "This may be intentional when it is only used through inter-plugin dispatch.",
      locations: [],
      actualKind: action.kind,
    });
  }

  return issues;
}

type RuntimeActionResult = { ok: boolean; data?: unknown; error?: string };

function invalidResult(pluginId: string, actionId: string, detail: string): RuntimeActionResult {
  return {
    ok: false,
    error: `[plugin:${pluginId}] action "${actionId}" returned an invalid result: ${detail}`,
  };
}

/** Validates the base action envelope and kind-specific successful data. */
export function npValidatePluginActionResult(
  pluginId: string,
  actionId: string,
  kind: NpPluginActionKind,
  value: unknown,
): RuntimeActionResult {
  if (!isRecord(value) || typeof value.ok !== "boolean") {
    return invalidResult(pluginId, actionId, "expected an object with boolean ok");
  }
  if (!value.ok) {
    if (value.error !== undefined && typeof value.error !== "string") {
      return invalidResult(pluginId, actionId, "error must be a string when provided");
    }
    // Preserve the original valid envelope. Existing setup handlers may carry
    // additional JSON fields that inter-plugin callers already consume even
    // though the public NpActionResult type only names ok/data/error.
    return value as RuntimeActionResult;
  }
  if (kind === "action") {
    return value as RuntimeActionResult;
  }
  if (!isRecord(value.data)) {
    return invalidResult(pluginId, actionId, `${kind} actions require object data`);
  }
  if (kind === "metric") {
    if (typeof value.data.value !== "string" && typeof value.data.value !== "number") {
      return invalidResult(pluginId, actionId, "metric data.value must be a string or number");
    }
    if (typeof value.data.value === "number" && !Number.isFinite(value.data.value)) {
      return invalidResult(pluginId, actionId, "metric data.value must be finite");
    }
    if (value.data.delta !== undefined && typeof value.data.delta !== "string") {
      return invalidResult(pluginId, actionId, "metric data.delta must be a string when provided");
    }
  } else if (kind === "status") {
    if (value.data.level !== "ok" && value.data.level !== "warn" && value.data.level !== "error") {
      return invalidResult(pluginId, actionId, "status data.level must be ok, warn, or error");
    }
    if (typeof value.data.message !== "string") {
      return invalidResult(pluginId, actionId, "status data.message must be a string");
    }
  } else {
    if (!Array.isArray(value.data.rows) || !value.data.rows.every(isRecord)) {
      return invalidResult(pluginId, actionId, "table data.rows must contain objects");
    }
    if (typeof value.data.total !== "number" || !Number.isFinite(value.data.total)) {
      return invalidResult(pluginId, actionId, "table data.total must be a finite number");
    }
  }
  return value as RuntimeActionResult;
}
