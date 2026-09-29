import {
  canonicalBodyRecord,
  canonicalBodyInteger,
  canonicalBodyEnum,
  canonicalBodyUuid,
  canonicalBodyUtc,
  canonicalBodyAscii,
  failCanonicalBody,
} from "./canonical-body-validation.js";
import { cloneCanonicalRuntimeInput } from "./canonical-runtime-primitives.js";
export type NpAgentIncidentNotificationTransitionV1 =
  "opened" | "investigating" | "resolved" | "dismissed";
export interface NpAgentIncidentNotificationItemV1 {
  notificationId: string;
  incidentId: string;
  incidentVersion: number;
  transition: NpAgentIncidentNotificationTransitionV1;
  severity: "medium" | "high" | "critical";
  status: "open" | "investigating" | "resolved" | "dismissed";
  summary: string;
  adminPath: string;
  createdAt: string;
}
export interface NpAgentIncidentNotificationsV1 {
  schemaVersion: "np.agent-incident-notifications.v1";
  items: NpAgentIncidentNotificationItemV1[];
  nextCursor: string | null;
}
/** Exact observed-transition metadata. No current status, totals or inaccessible identifiers. */
export function npRequireAgentIncidentNotificationsV1(
  value: unknown,
): NpAgentIncidentNotificationsV1 {
  const bad = (): never =>
    failCanonicalBody("invalid-field", "incident.notifications", "Invalid notification projection");
  const record = (v: unknown, keys: string[]) =>
    canonicalBodyRecord(v, "incident.notifications", keys, keys, { seen: new WeakSet<object>() });
  const r = record(cloneCanonicalRuntimeInput(value, "incident.notifications", 65536), [
    "schemaVersion",
    "items",
    "nextCursor",
  ]);
  if (
    r.schemaVersion !== "np.agent-incident-notifications.v1" ||
    !Array.isArray(r.items) ||
    r.items.length > 20
  )
    bad();
  const ids = new Set<string>();
  const items = (r.items as unknown[]).map((value): NpAgentIncidentNotificationItemV1 => {
    const x = record(value, [
      "notificationId",
      "incidentId",
      "incidentVersion",
      "transition",
      "severity",
      "status",
      "summary",
      "adminPath",
      "createdAt",
    ]);
    const notificationId = canonicalBodyUuid(x.notificationId, "notification.id");
    if (ids.has(notificationId)) bad();
    ids.add(notificationId);
    const incidentId = canonicalBodyUuid(x.incidentId, "notification.incidentId");
    const transition = canonicalBodyEnum<NpAgentIncidentNotificationTransitionV1>(
      x.transition,
      "notification.transition",
      new Set(["opened", "investigating", "resolved", "dismissed"]),
    );
    const severity = canonicalBodyEnum<NpAgentIncidentNotificationItemV1["severity"]>(
      x.severity,
      "notification.severity",
      new Set(["medium", "high", "critical"]),
    );
    const status = transition === "opened" ? "open" : transition;
    const summary = `Incident ${transition}.`;
    const adminPath = `/admin/agents/incidents/${incidentId}`;
    if (
      x.status !== status ||
      x.summary !== summary ||
      x.adminPath !== adminPath ||
      (severity === "medium" && transition !== "opened") ||
      (severity === "high" && transition !== "opened" && transition !== "resolved")
    )
      bad();
    return {
      notificationId,
      incidentId,
      incidentVersion: canonicalBodyInteger(
        x.incidentVersion,
        "notification.version",
        1,
        2147483647,
      ),
      transition,
      severity,
      status,
      summary,
      adminPath,
      createdAt: canonicalBodyUtc(x.createdAt, "notification.createdAt"),
    };
  });
  return {
    schemaVersion: "np.agent-incident-notifications.v1",
    items,
    nextCursor:
      r.nextCursor === null ? null : canonicalBodyAscii(r.nextCursor, "notification.cursor", 2048),
  };
}
