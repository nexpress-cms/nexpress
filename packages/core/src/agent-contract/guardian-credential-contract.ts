import { npMemberStatuses, type NpMemberStatus } from "../auth-contract/types.js";
import {
  canonicalBodyAscii,
  canonicalBodyEnum,
  canonicalBodyInteger,
  canonicalBodyRecord,
  canonicalBodyUuid,
  failCanonicalBody,
  type CanonicalBodyInspectionState,
} from "./canonical-body-validation.js";
import { cloneCanonicalRuntimeInput } from "./canonical-runtime-primitives.js";
import {
  npParseAgentSecurityImpactV1,
  type NpAgentSecurityImpactV1,
} from "./guardian-security-impact-contract.js";

/** Produced only by the trusted source owner from its locked persisted state.
 * Shape validation does not establish MAC authenticity or source authority.
 * The source domain must bind site/target/kind and omit bookkeeping timestamps. */
export interface NpAgentGuardianSourceStateCommitmentV1 {
  keyId: string;
  mac: string;
}
export function npParseAgentGuardianSourceStateCommitmentV1(
  value: unknown,
  path: string,
  state: CanonicalBodyInspectionState,
): NpAgentGuardianSourceStateCommitmentV1 {
  const keys = ["keyId", "mac"],
    row = canonicalBodyRecord(value, path, keys, keys, state);
  const keyId = canonicalBodyAscii(row.keyId, `${path}.keyId`, 128);
  if (
    !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(keyId) ||
    typeof row.mac !== "string" ||
    !/^hmac-sha256:[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/u.test(row.mac)
  )
    failCanonicalBody("invalid-field", path, "must identify a canonical keyed state commitment");
  return { keyId, mac: row.mac };
}
export function npRequireAgentGuardianSourceStateCommitmentV1(
  value: unknown,
): NpAgentGuardianSourceStateCommitmentV1 {
  return npParseAgentGuardianSourceStateCommitmentV1(
    cloneCanonicalRuntimeInput(value, "guardian.source.stateCommitment", 1024),
    "guardian.source.stateCommitment",
    { seen: new WeakSet<object>() },
  );
}
/** Before/current projections accepted by the credential source; never password material. */
export interface NpAgentSecurityPasswordSourceStateV1 {
  tokenVersion: number;
}
export interface NpAgentSecurityMemberResetStateV1 {
  emailVerified: boolean;
  status: NpMemberStatus;
}
/** A reset can verify email or activate pending membership; those are distinct
 * facts, not implied by password replacement or attributed to a logged-in actor. */
export interface NpAgentSecurityMemberResetActivationV1 {
  previous: NpAgentSecurityMemberResetStateV1;
  current: NpAgentSecurityMemberResetStateV1;
}
export type NpAgentSecurityPasswordTransitionV1 = {
  kind: "password-replaced";
  principalId: string;
  previous: NpAgentSecurityPasswordSourceStateV1;
  current: NpAgentSecurityPasswordSourceStateV1;
} & (
  | {
      audience: "staff";
      purpose: "password-change" | "password-reset" | "invite-accept";
      memberResetActivation: null;
    }
  | { audience: "member"; purpose: "password-change"; memberResetActivation: null }
  | {
      audience: "member";
      purpose: "password-reset";
      memberResetActivation: NpAgentSecurityMemberResetActivationV1;
    }
);
export interface NpAgentSecurityGatewayTokenSourceStateV1 {
  rowVersion: number;
  status: "active_head" | "overlap" | "revoked";
}
/** Rotation emits the actual old-row and new-row transitions, with distinct
 * transition UUIDs in the same mutation transaction. No plaintext token occurs here. */
export interface NpAgentSecurityGatewayTokenTransitionV1 {
  kind: "gateway-token";
  principalId: string;
  tokenId: string;
  reason: "issued" | "rotation" | "revoked";
  previous: NpAgentSecurityGatewayTokenSourceStateV1 | null;
  current: NpAgentSecurityGatewayTokenSourceStateV1;
}
/** Principal-wide authority changes are one committed fact, not a claim about
 * the status of every child token. Scope contents remain source-private. */
export interface NpAgentSecurityGatewayPrincipalSourceStateV1 {
  rowVersion: number;
  tokenVersion: number;
  status: "active" | "suspended" | "revoked";
  authorityPresent: boolean;
  scopeCommitment: NpAgentGuardianSourceStateCommitmentV1;
}
export interface NpAgentSecurityGatewayPrincipalTransitionV1 {
  kind: "gateway-principal";
  principalId: string;
  reason: "updated" | "suspended" | "resumed" | "revoked" | "authority-lost";
  previous: NpAgentSecurityGatewayPrincipalSourceStateV1;
  current: NpAgentSecurityGatewayPrincipalSourceStateV1;
}
/** Source commitment binds the actual selected credential identity privately;
 * secret-version UUIDs, locators, hashes and envelopes are not payload fields. */
export interface NpAgentSecurityConnectionCredentialSourceStateV1 {
  credentialVersion: number | null;
  commitment: NpAgentGuardianSourceStateCommitmentV1;
}
export interface NpAgentSecurityConnectionCredentialTransitionV1 {
  kind: "connection-credential";
  connectionId: string;
  operation: "activated" | "revoked";
  previous: NpAgentSecurityConnectionCredentialSourceStateV1;
  current: NpAgentSecurityConnectionCredentialSourceStateV1;
}
export type NpAgentSecurityCredentialTransitionV1 =
  | NpAgentSecurityPasswordTransitionV1
  | NpAgentSecurityGatewayTokenTransitionV1
  | NpAgentSecurityGatewayPrincipalTransitionV1
  | NpAgentSecurityConnectionCredentialTransitionV1;
interface SourceBinding {
  kind: "security.credential.changed";
  transitionId: string;
  sourceReceiptId: string;
}
export type NpAgentSecurityCredentialChangePayloadV1 = SourceBinding &
  (
    | {
        impact: NpAgentSecurityImpactV1 & { scope: "deployment" };
        transition: NpAgentSecurityPasswordTransitionV1;
      }
    | {
        impact: NpAgentSecurityImpactV1 & { scope: "site" };
        transition:
          | NpAgentSecurityGatewayTokenTransitionV1
          | NpAgentSecurityGatewayPrincipalTransitionV1
          | NpAgentSecurityConnectionCredentialTransitionV1;
      }
  );
const max = 2_147_483_647;
function passwordState(
  value: unknown,
  path: string,
  state: CanonicalBodyInspectionState,
): NpAgentSecurityPasswordSourceStateV1 {
  const keys = ["tokenVersion"],
    r = canonicalBodyRecord(value, path, keys, keys, state);
  return { tokenVersion: canonicalBodyInteger(r.tokenVersion, path, 0, max) };
}
function memberResetState(
  value: unknown,
  path: string,
  state: CanonicalBodyInspectionState,
): NpAgentSecurityMemberResetStateV1 {
  const keys = ["emailVerified", "status"],
    r = canonicalBodyRecord(value, path, keys, keys, state);
  if (typeof r.emailVerified !== "boolean")
    failCanonicalBody("invalid-field", path, "email verification state must be boolean");
  return {
    emailVerified: r.emailVerified,
    status: canonicalBodyEnum(r.status, path, new Set(npMemberStatuses)),
  };
}
function resetActivation(
  value: unknown,
  path: string,
  state: CanonicalBodyInspectionState,
): NpAgentSecurityMemberResetActivationV1 {
  const keys = ["previous", "current"],
    r = canonicalBodyRecord(value, path, keys, keys, state);
  const previous = memberResetState(r.previous, `${path}.previous`, state),
    current = memberResetState(r.current, `${path}.current`, state);
  if (
    current.emailVerified !== true ||
    current.status !== (previous.status === "pending" ? "active" : previous.status)
  )
    failCanonicalBody(
      "invalid-field",
      path,
      "must reflect only actual password-reset membership effects",
    );
  return { previous, current };
}
function tokenState(
  value: unknown,
  path: string,
  state: CanonicalBodyInspectionState,
): NpAgentSecurityGatewayTokenSourceStateV1 {
  const keys = ["rowVersion", "status"],
    r = canonicalBodyRecord(value, path, keys, keys, state);
  return {
    rowVersion: canonicalBodyInteger(r.rowVersion, path, 1, max),
    status: canonicalBodyEnum(r.status, path, new Set(["active_head", "overlap", "revoked"])),
  };
}
function principalState(
  value: unknown,
  path: string,
  state: CanonicalBodyInspectionState,
): NpAgentSecurityGatewayPrincipalSourceStateV1 {
  const keys = ["rowVersion", "tokenVersion", "status", "authorityPresent", "scopeCommitment"],
    r = canonicalBodyRecord(value, path, keys, keys, state);
  if (typeof r.authorityPresent !== "boolean")
    failCanonicalBody("invalid-field", path, "authority presence must be boolean");
  return {
    rowVersion: canonicalBodyInteger(r.rowVersion, path, 1, max),
    tokenVersion: canonicalBodyInteger(r.tokenVersion, path, 1, max),
    status: canonicalBodyEnum(r.status, path, new Set(["active", "suspended", "revoked"])),
    authorityPresent: r.authorityPresent,
    scopeCommitment: npParseAgentGuardianSourceStateCommitmentV1(
      r.scopeCommitment,
      `${path}.scopeCommitment`,
      state,
    ),
  };
}
function connectionState(
  value: unknown,
  path: string,
  state: CanonicalBodyInspectionState,
): NpAgentSecurityConnectionCredentialSourceStateV1 {
  const keys = ["credentialVersion", "commitment"],
    r = canonicalBodyRecord(value, path, keys, keys, state);
  return {
    credentialVersion:
      r.credentialVersion === null ? null : canonicalBodyInteger(r.credentialVersion, path, 1, max),
    commitment: npParseAgentGuardianSourceStateCommitmentV1(
      r.commitment,
      `${path}.commitment`,
      state,
    ),
  };
}
export function npParseAgentSecurityCredentialTransitionV1(
  value: unknown,
  path: string,
  state: CanonicalBodyInspectionState,
): NpAgentSecurityCredentialTransitionV1 {
  const kind =
    typeof value === "object" && value !== null
      ? (Object.getOwnPropertyDescriptor(value, "kind")?.value as unknown)
      : undefined;
  if (kind === "password-replaced") {
    const keys = [
        "kind",
        "audience",
        "principalId",
        "purpose",
        "previous",
        "current",
        "memberResetActivation",
      ],
      r = canonicalBodyRecord(value, path, keys, keys, state);
    const audience = canonicalBodyEnum<"staff" | "member">(
      r.audience,
      path,
      new Set(["staff", "member"]),
    );
    const previous = passwordState(r.previous, `${path}.previous`, state),
      current = passwordState(r.current, `${path}.current`, state);
    if (current.tokenVersion !== previous.tokenVersion + 1)
      failCanonicalBody(
        "invalid-field",
        path,
        "must advance the actual password authority version exactly once",
      );
    const common: Pick<
      NpAgentSecurityPasswordTransitionV1,
      "kind" | "principalId" | "previous" | "current"
    > = { kind, principalId: canonicalBodyUuid(r.principalId, path), previous, current };
    if (audience === "staff") {
      if (r.memberResetActivation !== null)
        failCanonicalBody(
          "invalid-field",
          path,
          "staff credentials cannot assert member activation",
        );
      return {
        ...common,
        audience,
        purpose: canonicalBodyEnum<"password-change" | "password-reset" | "invite-accept">(
          r.purpose,
          path,
          new Set(["password-change", "password-reset", "invite-accept"]),
        ),
        memberResetActivation: null,
      };
    }
    const purpose = canonicalBodyEnum<"password-change" | "password-reset">(
      r.purpose,
      path,
      new Set(["password-change", "password-reset"]),
    );
    if (purpose === "password-reset")
      return {
        ...common,
        audience,
        purpose,
        memberResetActivation: resetActivation(
          r.memberResetActivation,
          `${path}.memberResetActivation`,
          state,
        ),
      };
    if (r.memberResetActivation !== null)
      failCanonicalBody(
        "invalid-field",
        path,
        "ordinary password change cannot assert reset effects",
      );
    return { ...common, audience, purpose, memberResetActivation: null };
  }
  if (kind === "gateway-token") {
    const keys = ["kind", "principalId", "tokenId", "reason", "previous", "current"],
      r = canonicalBodyRecord(value, path, keys, keys, state);
    const reason = canonicalBodyEnum<NpAgentSecurityGatewayTokenTransitionV1["reason"]>(
      r.reason,
      path,
      new Set(["issued", "rotation", "revoked"]),
    );
    const previous = r.previous === null ? null : tokenState(r.previous, `${path}.previous`, state),
      current = tokenState(r.current, `${path}.current`, state);
    if (previous === null) {
      if (reason === "revoked" || current.rowVersion !== 1 || current.status !== "active_head")
        failCanonicalBody(
          "invalid-field",
          path,
          "new credentials must be an actual active head insertion",
        );
    } else if (
      current.rowVersion !== previous.rowVersion + 1 ||
      previous.status === "revoked" ||
      reason === "issued" ||
      (reason === "revoked"
        ? current.status !== "revoked"
        : previous.status !== "active_head" || !["overlap", "revoked"].includes(current.status))
    )
      failCanonicalBody(
        "invalid-field",
        path,
        "must be an actual bounded token retirement or revocation",
      );
    return {
      kind,
      principalId: canonicalBodyUuid(r.principalId, path),
      tokenId: canonicalBodyUuid(r.tokenId, path),
      reason,
      previous,
      current,
    };
  }
  if (kind === "gateway-principal") {
    const keys = ["kind", "principalId", "reason", "previous", "current"],
      r = canonicalBodyRecord(value, path, keys, keys, state),
      reason = canonicalBodyEnum<NpAgentSecurityGatewayPrincipalTransitionV1["reason"]>(
        r.reason,
        path,
        new Set(["updated", "suspended", "resumed", "revoked", "authority-lost"]),
      ),
      previous = principalState(r.previous, `${path}.previous`, state),
      current = principalState(r.current, `${path}.current`, state);
    const scopeChanged = previous.scopeCommitment.mac !== current.scopeCommitment.mac;
    if (
      previous.scopeCommitment.keyId !== current.scopeCommitment.keyId ||
      current.rowVersion !== previous.rowVersion + 1 ||
      current.tokenVersion !==
        previous.tokenVersion +
          (reason === "revoked" ||
          reason === "authority-lost" ||
          (reason === "updated" && scopeChanged)
            ? 1
            : 0) ||
      (reason !== "updated" && scopeChanged) ||
      (reason === "authority-lost"
        ? !previous.authorityPresent ||
          current.authorityPresent ||
          current.status !== (previous.status === "active" ? "suspended" : previous.status)
        : previous.authorityPresent !== current.authorityPresent) ||
      (reason === "updated"
        ? (!scopeChanged && previous.status === current.status) ||
          previous.status === "revoked" ||
          current.status === "revoked"
        : reason === "suspended"
          ? previous.status !== "active" || current.status !== "suspended"
          : reason === "resumed"
            ? previous.status !== "suspended" || current.status !== "active"
            : reason === "revoked"
              ? previous.status === "revoked" || current.status !== "revoked"
              : false)
    )
      failCanonicalBody(
        "invalid-field",
        path,
        "must reflect an actual version-owned principal authority change",
      );
    return { kind, principalId: canonicalBodyUuid(r.principalId, path), reason, previous, current };
  }
  if (kind === "connection-credential") {
    const keys = ["kind", "connectionId", "operation", "previous", "current"],
      r = canonicalBodyRecord(value, path, keys, keys, state);
    const operation = canonicalBodyEnum<
      NpAgentSecurityConnectionCredentialTransitionV1["operation"]
    >(r.operation, path, new Set(["activated", "revoked"]));
    const previous = connectionState(r.previous, `${path}.previous`, state),
      current = connectionState(r.current, `${path}.current`, state);
    if (
      previous.commitment.keyId !== current.commitment.keyId ||
      previous.commitment.mac === current.commitment.mac ||
      (operation === "revoked"
        ? previous.credentialVersion === null || current.credentialVersion !== null
        : current.credentialVersion === null ||
          (previous.credentialVersion !== null &&
            current.credentialVersion <= previous.credentialVersion))
    )
      failCanonicalBody(
        "invalid-field",
        path,
        "must bind an actual same-key credential activation or revocation",
      );
    return {
      kind,
      connectionId: canonicalBodyUuid(r.connectionId, path),
      operation,
      previous,
      current,
    };
  }
  return failCanonicalBody("invalid-field", path, "unknown credential transition kind");
}
export function npRequireAgentSecurityCredentialTransitionV1(
  value: unknown,
): NpAgentSecurityCredentialTransitionV1 {
  return npParseAgentSecurityCredentialTransitionV1(
    cloneCanonicalRuntimeInput(value, "guardian.credential.transition", 8192),
    "guardian.credential.transition",
    { seen: new WeakSet<object>() },
  );
}
/** Private source payload only. A parser cannot authorize credential mutation. */
export function npParseAgentSecurityCredentialChangePayloadV1(
  value: unknown,
  path: string,
  state: CanonicalBodyInspectionState,
): NpAgentSecurityCredentialChangePayloadV1 {
  const keys = ["kind", "transitionId", "sourceReceiptId", "impact", "transition"],
    r = canonicalBodyRecord(value, path, keys, keys, state);
  const common = {
    kind: canonicalBodyEnum<"security.credential.changed">(
      r.kind,
      path,
      new Set(["security.credential.changed"]),
    ),
    transitionId: canonicalBodyUuid(r.transitionId, path),
    sourceReceiptId: canonicalBodyUuid(r.sourceReceiptId, path),
  };
  const impact = npParseAgentSecurityImpactV1(r.impact, `${path}.impact`, state),
    transition = npParseAgentSecurityCredentialTransitionV1(
      r.transition,
      `${path}.transition`,
      state,
    );
  if (transition.kind === "password-replaced") {
    if (impact.scope !== "deployment")
      failCanonicalBody("invalid-field", path, "global credentials require deployment impact");
    return { ...common, impact: { ...impact, scope: "deployment" }, transition };
  }
  if (impact.scope !== "site")
    failCanonicalBody("invalid-field", path, "Gateway and connection credentials are site scoped");
  return { ...common, impact: { ...impact, scope: "site" }, transition };
}
export function npRequireAgentSecurityCredentialChangePayloadV1(
  value: unknown,
): NpAgentSecurityCredentialChangePayloadV1 {
  return npParseAgentSecurityCredentialChangePayloadV1(
    cloneCanonicalRuntimeInput(value, "guardian.credential.payload", 16384),
    "guardian.credential.payload",
    { seen: new WeakSet<object>() },
  );
}
