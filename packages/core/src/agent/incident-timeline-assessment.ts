import type { getDb } from "../db/runtime.js";
import type { npAgentIncidentTimeline } from "../db/schema/agent.js";
import { npRequireAgentGuardianIncidentAssessmentEntryV1 } from "./guardian-incident-assessment-service.js";
import {
  npRequireAgentIncidentAssessmentEntryV1,
  npRequireAgentIncidentSegmentedAssessmentEntryV2,
} from "./incident-assessment-service.js";

export async function npRequireIncidentTimelineAssessmentV1(
  db: ReturnType<typeof getDb>,
  row: typeof npAgentIncidentTimeline.$inferSelect,
) {
  if (row.details.schemaVersion === "np.agent-guardian-assessment.v1")
    return { guardianAssessment: await npRequireAgentGuardianIncidentAssessmentEntryV1(db, row) };
  if (row.details.schemaVersion === "np.agent-moderator-segmented-assessment.v2")
    return { segmentedAssessment: await npRequireAgentIncidentSegmentedAssessmentEntryV2(db, row) };
  return { assessment: await npRequireAgentIncidentAssessmentEntryV1(db, row) };
}
