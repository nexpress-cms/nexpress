import { createHash } from "node:crypto";
import type { getDb } from "../db/runtime.js";
import { serializeAgentCanonicalJson } from "../agent-contract/canonical-foundation.js";
import {
  createAgentGuardianControlsV1,
  NpAgentGuardianControlError,
  npReadAgentGuardianCaptureAdmissionFromRetainedRowV1 as readRetainedAdmission,
} from "./guardian-controls.js";
import { NpAgentGatewayError } from "./admin-admission.js";

// Constructing a reader neither initializes DB/Runtime nor installs any source.
const controls = createAgentGuardianControlsV1();
type Db = ReturnType<typeof getDb>;
function safe(error: unknown): never {
  if (error instanceof NpAgentGuardianControlError)
    throw new NpAgentGatewayError(
      error.code,
      error.code === "GUARDIAN_DISABLED" ? 409 : 503,
      "Guardian admission is unavailable.",
    );
  throw error;
}
/** Used only inside an explicitly installed source. Intentionally disabled capture is a normal skip. */
export async function npReadAgentGuardianCaptureAdmissionV1(db: Db, siteId: string) {
  try {
    return await controls.readCaptureAdmission({ db, siteId, sourceInstalled: true });
  } catch (error) {
    return safe(error);
  }
}
/** Internal projection for a fresh settings row already read by the admission owner. */
export function npReadAgentGuardianCaptureAdmissionFromRetainedRowV1(
  siteId: string,
  row: { value: unknown } | undefined,
) {
  try {
    return readRetainedAdmission(siteId, row);
  } catch (error) {
    return safe(error);
  }
}
/** Additional new-effect guard; never replaces policy, source proof or human approval. */
export async function npRequireAgentGuardianNewResponseV1(db: Db, siteId: string) {
  try {
    return await controls.requireNewResponseAdmission({ db, siteId, sourceInstalled: true });
  } catch (error) {
    return safe(error);
  }
}
/** Bind new-effect approvals to the current disable/enable generation without changing historical bytes. */
export async function npAgentGuardianResponsePolicyDigestV1(
  db: Db,
  siteId: string,
  policyDigest: string,
): Promise<string> {
  const control = await npReadAgentGuardianCaptureAdmissionV1(db, siteId);
  if (control.revision === 0) return policyDigest;
  return `cj1:sha256:${createHash("sha256")
    .update("np.agent-guardian-response-control-policy.v1\0")
    .update(
      serializeAgentCanonicalJson({ siteId, policyDigest, controlDigest: control.controlDigest }),
    )
    .digest("base64url")}`;
}
