import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import {
  NP_AGENT_GUARDIAN_EXTERNAL_BODY_LIMIT_V1,
  NP_AGENT_GUARDIAN_EXTERNAL_FUTURE_SKEW_MS_V1,
  NP_AGENT_GUARDIAN_EXTERNAL_SOURCE_AGE_MS_V1,
  npAgentSentryIssueCreatedAdapterIdentityV1,
  type NpAgentExternalSignalAdapterIdentityV1,
} from "../agent-contract/guardian-external-contract.js";
import { canonicalBodyUuid } from "../agent-contract/canonical-body-validation.js";
import { serializeAgentCanonicalJson } from "../agent-contract/canonical-foundation.js";
import { NpAgentGatewayError } from "./admin-admission.js";

export interface NpAgentSentrySignatureKeyV1 {
  id: string;
  bytes: Uint8Array;
}
export interface NpAgentSentryIssueCreatedAdapterOptionsV1 {
  /** Host-owned mapping; signed payload identities must match it exactly. */
  installationId: string;
  projectId: string;
  /** Explicit current/retained verification keys; no key is loaded or generated here. */
  signatureKeys: readonly NpAgentSentrySignatureKeyV1[];
}
export interface NpAgentSentryIssueCreatedFactV1 {
  kind: "accepted";
  adapter: NpAgentExternalSignalAdapterIdentityV1;
  signingKeyId: string;
  occurredAt: string;
  sourceIdentityDigest: string;
  bodyDigest: string;
  freshness: "fresh" | "stale";
}
export type NpAgentSentryIssueCreatedResultV1 =
  | NpAgentSentryIssueCreatedFactV1
  | {
      kind: "ignored";
      code: "UNSUPPORTED_RESOURCE" | "UNSUPPORTED_ACTION" | "UNSUPPORTED_ISSUE_CATEGORY";
    };
export interface NpAgentSentryIssueCreatedAdapterV1 {
  readonly identity: NpAgentExternalSignalAdapterIdentityV1;
  verifyAndNormalize(input: {
    rawBody: Uint8Array;
    signature: string;
    resource: string;
    receivedAt: Date;
    signal: AbortSignal;
  }): NpAgentSentryIssueCreatedResultV1;
}
function reject(code = "GUARDIAN_EXTERNAL_PAYLOAD_INVALID", status = 400): never {
  throw new NpAgentGatewayError(code, status, "External security signal is unavailable.");
}
function object(value: unknown): Record<string, unknown> {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  )
    reject();
  return value as Record<string, unknown>;
}
function decimal(value: unknown): string {
  if (typeof value !== "string" || !/^[1-9][0-9]{0,29}$/u.test(value)) reject();
  return value;
}
function time(value: unknown): string {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|\+00:00)$/u.test(value)
  )
    reject();
  const parsed = new Date(value);
  if (
    !Number.isFinite(parsed.getTime()) ||
    parsed.toISOString().slice(0, 19) !== value.slice(0, 19)
  )
    reject();
  return parsed.toISOString();
}
export function npRequireAgentSentrySignatureKeyIdV1(value: unknown): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(value))
    reject("GUARDIAN_EXTERNAL_INSTALLATION_INVALID");
  return value;
}
/** Reference protocol: Sentry integration-platform issue.created, error category only.
 * https://docs.sentry.io/integrations/integration-platform/webhooks/
 * https://github.com/getsentry/integration-platform-example/blob/main/backend-py/src/api/middleware/verify_sentry_signature.py
 * The HMAC covers raw body bytes, not the timestamp, resource or Request-ID headers. */
export function createAgentSentryIssueCreatedAdapterV1(
  options: NpAgentSentryIssueCreatedAdapterOptionsV1,
): NpAgentSentryIssueCreatedAdapterV1 {
  const installationId = canonicalBodyUuid(
    options.installationId,
    "guardian.external.installationId",
  );
  const projectId = decimal(options.projectId);
  if (
    !Array.isArray(options.signatureKeys) ||
    options.signatureKeys.length < 1 ||
    options.signatureKeys.length > 4
  )
    reject("GUARDIAN_EXTERNAL_INSTALLATION_INVALID");
  const keys = options.signatureKeys.map((entry) => {
    if (!(entry.bytes instanceof Uint8Array) || entry.bytes.length < 32 || entry.bytes.length > 256)
      reject("GUARDIAN_EXTERNAL_INSTALLATION_INVALID");
    return {
      id: npRequireAgentSentrySignatureKeyIdV1(entry.id),
      bytes: new Uint8Array(entry.bytes),
    };
  });
  if (
    new Set(keys.map((key) => key.id)).size !== keys.length ||
    new Set(keys.map((key) => Buffer.from(key.bytes).toString("base64url"))).size !== keys.length
  )
    reject("GUARDIAN_EXTERNAL_INSTALLATION_INVALID");
  const identity = npAgentSentryIssueCreatedAdapterIdentityV1;
  return Object.freeze({
    identity,
    verifyAndNormalize(
      input: Parameters<NpAgentSentryIssueCreatedAdapterV1["verifyAndNormalize"]>[0],
    ): NpAgentSentryIssueCreatedResultV1 {
      if (input.signal.aborted) reject("GUARDIAN_EXTERNAL_ABORTED", 503);
      if (
        !(input.rawBody instanceof Uint8Array) ||
        input.rawBody.length < 1 ||
        input.rawBody.length > NP_AGENT_GUARDIAN_EXTERNAL_BODY_LIMIT_V1
      )
        reject("GUARDIAN_EXTERNAL_BODY_LIMIT", 413);
      const rawBody = new Uint8Array(input.rawBody);
      if (typeof input.signature !== "string" || !/^[a-f0-9]{64}$/u.test(input.signature))
        reject("GUARDIAN_EXTERNAL_SIGNATURE_INVALID", 401);
      const presented = Buffer.from(input.signature, "hex");
      const matches = keys.filter((key) =>
        timingSafeEqual(createHmac("sha256", key.bytes).update(rawBody).digest(), presented),
      );
      if (matches.length !== 1) reject("GUARDIAN_EXTERNAL_SIGNATURE_INVALID", 401);
      if (input.resource !== "issue") return { kind: "ignored", code: "UNSUPPORTED_RESOURCE" };
      let parsed: unknown;
      try {
        parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(rawBody));
      } catch {
        return reject();
      }
      const body = object(parsed);
      if (body.action !== "created") return { kind: "ignored", code: "UNSUPPORTED_ACTION" };
      const installation = object(body.installation);
      const issue = object(object(body.data).issue);
      if (issue.issueCategory !== "error")
        return { kind: "ignored", code: "UNSUPPORTED_ISSUE_CATEGORY" };
      const actualInstallation = canonicalBodyUuid(
        installation.uuid,
        "guardian.external.installationId",
      );
      const actualProject = decimal(object(issue.project).id);
      if (actualInstallation !== installationId || actualProject !== projectId)
        reject("GUARDIAN_EXTERNAL_SOURCE_FORBIDDEN", 403);
      const issueId = decimal(issue.id);
      const occurredAt = time(issue.firstSeen);
      const receivedAt = input.receivedAt;
      if (!(receivedAt instanceof Date) || !Number.isFinite(receivedAt.getTime())) reject();
      const age = receivedAt.getTime() - Date.parse(occurredAt);
      if (age < -NP_AGENT_GUARDIAN_EXTERNAL_FUTURE_SKEW_MS_V1)
        reject("GUARDIAN_EXTERNAL_SOURCE_TIME_INVALID");
      if (input.signal.aborted) reject("GUARDIAN_EXTERNAL_ABORTED", 503);
      return {
        kind: "accepted",
        adapter: identity,
        signingKeyId: matches[0].id,
        occurredAt,
        sourceIdentityDigest: `cj1:sha256:${createHash("sha256")
          .update(
            serializeAgentCanonicalJson({
              domain: "np.agent-sentry-issue-identity.v1",
              installationId,
              projectId,
              issueId,
              occurredAt,
            }),
          )
          .digest("base64url")}`,
        bodyDigest: `sha256:${createHash("sha256").update(rawBody).digest("hex")}`,
        freshness: age > NP_AGENT_GUARDIAN_EXTERNAL_SOURCE_AGE_MS_V1 ? "stale" : "fresh",
      };
    },
  });
}
