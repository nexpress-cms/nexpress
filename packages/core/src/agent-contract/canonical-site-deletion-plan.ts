import { npRequireAgentContractResult } from "./contract.js";
import {
  analyzeCanonicalBody,
  canonicalBodyArray,
  canonicalBodyAscii,
  canonicalBodyEnum,
  canonicalBodyIdentifier,
  canonicalBodyInteger,
  canonicalBodyRecord,
  canonicalBodySiteId,
  canonicalBodyUtc,
  canonicalBodyUuid,
  failCanonicalBody,
  type CanonicalBodyInspectionState,
} from "./canonical-body-validation.js";
import { digestAgentCanonicalSha256 } from "./canonical-digest.js";
import { buildAgentCanonicalFoundationBytes } from "./canonical-foundation.js";
import {
  npAgentCanonicalBodyMaxBytesV1,
  npAgentSiteDeletionExternalTargetKinds,
  type NpAgentCanonicalBodyBytesV1,
  type NpAgentContractResult,
  type NpAgentSiteDeletionExternalTargetCanonicalV1,
  type NpAgentSiteDeletionExternalTargetKind,
  type NpAgentSiteDeletionPlanCanonicalV1,
  type NpAgentSiteDeletionRowInventoryCanonicalV1,
} from "./types.js";

const PURPOSE = "np.agent-site-deletion-plan.v1" as const;
const INVENTORY_VERSION = 1;
const SIGNED_32_BIT_MAXIMUM = 2_147_483_647;
const MAXIMUM_BODY_BYTES = npAgentCanonicalBodyMaxBytesV1[PURPOSE];
const MAXIMUM_TABLE_NAME_CHARACTERS = 128;
const MAXIMUM_REQUEST_DIGEST_CHARACTERS = 128;
const MAXIMUM_ADAPTER_FINGERPRINT_CHARACTERS = 256;
const MAXIMUM_IDEMPOTENCY_KEY_CHARACTERS = 256;
const SITE_DELETION_MARKER_TABLE = "np_agent_site_deletion_sagas";
const TABLE_NAME_PATTERN = /^np_agent_[a-z0-9]+(?:_[a-z0-9]+)*$/u;
const SAFE_DIGEST_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/u;
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9._:-]{1,256}$/u;
const SITE_VERSION_DIGEST_PATTERN = /^sdsv1:sha256:[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/u;
const ROW_IDENTITY_DIGEST_PATTERN = /^sdri1:sha256:[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/u;
const TARGET_KINDS = new Set<string>(npAgentSiteDeletionExternalTargetKinds);

export const npAgentSiteDeletionPlanCanonicalIncludedKeysV1 = [
  "schemaVersion",
  "inventoryVersion",
  "sagaId",
  "siteId",
  "siteVersionDigest",
  "preparedAt",
  "rowInventory",
  "externalTargets",
] as const satisfies readonly (keyof NpAgentSiteDeletionPlanCanonicalV1)[];

export const npAgentSiteDeletionPlanCanonicalExcludedKeysV1 = [
  "planHash",
  "state",
  "cursor",
  "requestedByUserId",
  "requesterFingerprint",
  "lastErrorCode",
  "leaseUntil",
  "updatedAt",
  "cleanupCompletedAt",
  "attempt",
  "result",
  "receipt",
] as const;

export const npAgentSiteDeletionRowInventoryCanonicalIncludedKeysV1 = [
  "table",
  "count",
  "identityDigest",
] as const satisfies readonly (keyof NpAgentSiteDeletionRowInventoryCanonicalV1)[];

export const npAgentSiteDeletionExternalTargetCanonicalIncludedKeysV1 = [
  "kind",
  "targetId",
  "requestDigest",
  "adapterId",
  "adapterContractVersion",
  "adapterFingerprint",
  "idempotencyKey",
] as const satisfies readonly (keyof NpAgentSiteDeletionExternalTargetCanonicalV1)[];

function parseExactDigest(
  value: unknown,
  path: string,
  pattern: RegExp,
  kind: "row identity" | "site version",
): string {
  if (typeof value !== "string" || !pattern.test(value)) {
    failCanonicalBody(
      "invalid-field",
      path,
      `must be a canonical ${kind} SHA-256 digest with unpadded base64url encoding`,
    );
  }
  return value;
}

function parseTableName(value: unknown, path: string): string {
  if (
    typeof value !== "string" ||
    value.length > MAXIMUM_TABLE_NAME_CHARACTERS ||
    !TABLE_NAME_PATTERN.test(value)
  ) {
    failCanonicalBody(
      "invalid-field",
      path,
      `must be a 1..${MAXIMUM_TABLE_NAME_CHARACTERS.toString()} character Agent SQL table name`,
    );
  }
  if (value === SITE_DELETION_MARKER_TABLE) {
    failCanonicalBody("invalid-field", path, "must exclude the site-deletion marker table");
  }
  return value;
}

function parseRequestDigest(value: unknown, path: string): string {
  if (typeof value !== "string" || !SAFE_DIGEST_PATTERN.test(value)) {
    failCanonicalBody(
      "invalid-field",
      path,
      `must be a 1..${MAXIMUM_REQUEST_DIGEST_CHARACTERS.toString()} character safe ASCII request digest`,
    );
  }
  return value;
}

function parseIdempotencyKey(value: unknown, path: string): string {
  if (typeof value !== "string" || !IDEMPOTENCY_KEY_PATTERN.test(value)) {
    failCanonicalBody(
      "invalid-field",
      path,
      `must be a 1..${MAXIMUM_IDEMPOTENCY_KEY_CHARACTERS.toString()} character safe ASCII idempotency key`,
    );
  }
  return value;
}

function parseRowInventory(
  value: unknown,
  path: string,
  state: CanonicalBodyInspectionState,
): NpAgentSiteDeletionRowInventoryCanonicalV1[] {
  const entries = canonicalBodyArray(value, path, MAXIMUM_BODY_BYTES, state);
  const result: NpAgentSiteDeletionRowInventoryCanonicalV1[] = [];
  let previousTable: string | null = null;
  entries.forEach((entry, index) => {
    const entryPath = `${path}[${index.toString()}]`;
    const record = canonicalBodyRecord(
      entry,
      entryPath,
      npAgentSiteDeletionRowInventoryCanonicalIncludedKeysV1,
      npAgentSiteDeletionRowInventoryCanonicalIncludedKeysV1,
      state,
    );
    const table = parseTableName(record.table, `${entryPath}.table`);
    if (previousTable !== null && table <= previousTable) {
      failCanonicalBody(
        table === previousTable ? "duplicate" : "order",
        `${entryPath}.table`,
        "must be sorted unique by exact table name",
      );
    }
    result.push({
      table,
      count: canonicalBodyInteger(record.count, `${entryPath}.count`, 0, Number.MAX_SAFE_INTEGER),
      identityDigest: parseExactDigest(
        record.identityDigest,
        `${entryPath}.identityDigest`,
        ROW_IDENTITY_DIGEST_PATTERN,
        "row identity",
      ),
    });
    previousTable = table;
  });
  return result;
}

function parseExternalTargets(
  value: unknown,
  path: string,
  state: CanonicalBodyInspectionState,
): NpAgentSiteDeletionExternalTargetCanonicalV1[] {
  const entries = canonicalBodyArray(value, path, MAXIMUM_BODY_BYTES, state);
  const result: NpAgentSiteDeletionExternalTargetCanonicalV1[] = [];
  let previousTuple: string | null = null;
  entries.forEach((entry, index) => {
    const entryPath = `${path}[${index.toString()}]`;
    const record = canonicalBodyRecord(
      entry,
      entryPath,
      npAgentSiteDeletionExternalTargetCanonicalIncludedKeysV1,
      npAgentSiteDeletionExternalTargetCanonicalIncludedKeysV1,
      state,
    );
    const kind = canonicalBodyEnum<NpAgentSiteDeletionExternalTargetKind>(
      record.kind,
      `${entryPath}.kind`,
      TARGET_KINDS,
    );
    const targetId = canonicalBodyUuid(record.targetId, `${entryPath}.targetId`);
    const tuple = `${kind}\0${targetId}`;
    if (previousTuple !== null && tuple <= previousTuple) {
      failCanonicalBody(
        tuple === previousTuple ? "duplicate" : "order",
        entryPath,
        "must be sorted unique by (kind,targetId)",
      );
    }
    result.push({
      kind,
      targetId,
      requestDigest: parseRequestDigest(record.requestDigest, `${entryPath}.requestDigest`),
      adapterId: canonicalBodyIdentifier(record.adapterId, `${entryPath}.adapterId`),
      adapterContractVersion: canonicalBodyInteger(
        record.adapterContractVersion,
        `${entryPath}.adapterContractVersion`,
        1,
        SIGNED_32_BIT_MAXIMUM,
      ),
      adapterFingerprint: canonicalBodyAscii(
        record.adapterFingerprint,
        `${entryPath}.adapterFingerprint`,
        MAXIMUM_ADAPTER_FINGERPRINT_CHARACTERS,
      ),
      idempotencyKey: parseIdempotencyKey(record.idempotencyKey, `${entryPath}.idempotencyKey`),
    });
    previousTuple = tuple;
  });
  return result;
}

function parseSiteDeletionPlanCanonical(value: unknown): NpAgentSiteDeletionPlanCanonicalV1 {
  const path = "agent.canonical.siteDeletionPlan";
  const state: CanonicalBodyInspectionState = { seen: new WeakSet<object>() };
  const record = canonicalBodyRecord(
    value,
    path,
    npAgentSiteDeletionPlanCanonicalIncludedKeysV1,
    npAgentSiteDeletionPlanCanonicalIncludedKeysV1,
    state,
  );
  if (record.schemaVersion !== PURPOSE) {
    failCanonicalBody("invalid-field", `${path}.schemaVersion`, `must be ${PURPOSE}`);
  }
  if (record.inventoryVersion !== INVENTORY_VERSION) {
    failCanonicalBody("invalid-field", `${path}.inventoryVersion`, "must be exactly 1");
  }

  const result: NpAgentSiteDeletionPlanCanonicalV1 = {
    schemaVersion: PURPOSE,
    inventoryVersion: INVENTORY_VERSION,
    sagaId: canonicalBodyUuid(record.sagaId, `${path}.sagaId`),
    siteId: canonicalBodySiteId(record.siteId, `${path}.siteId`),
    siteVersionDigest: parseExactDigest(
      record.siteVersionDigest,
      `${path}.siteVersionDigest`,
      SITE_VERSION_DIGEST_PATTERN,
      "site version",
    ),
    preparedAt: canonicalBodyUtc(record.preparedAt, `${path}.preparedAt`),
    rowInventory: parseRowInventory(record.rowInventory, `${path}.rowInventory`, state),
    externalTargets: parseExternalTargets(record.externalTargets, `${path}.externalTargets`, state),
  };
  buildAgentCanonicalFoundationBytes(PURPOSE, result);
  return result;
}

export function npAnalyzeAgentSiteDeletionPlanCanonical(
  value: unknown,
): NpAgentContractResult<NpAgentSiteDeletionPlanCanonicalV1> {
  return analyzeCanonicalBody("agent.canonical.siteDeletionPlan", () =>
    parseSiteDeletionPlanCanonical(value),
  );
}

export function npRequireAgentSiteDeletionPlanCanonical(
  value: unknown,
): NpAgentSiteDeletionPlanCanonicalV1 {
  return npRequireAgentContractResult(
    npAnalyzeAgentSiteDeletionPlanCanonical(value),
    "Invalid Agent site-deletion-plan canonical body",
  );
}

export function npBuildAgentSiteDeletionPlanCanonicalBytes(
  value: unknown,
): NpAgentCanonicalBodyBytesV1<
  "np.agent-site-deletion-plan.v1",
  NpAgentSiteDeletionPlanCanonicalV1
> {
  return buildAgentCanonicalFoundationBytes(
    PURPOSE,
    npRequireAgentSiteDeletionPlanCanonical(value),
  ) as unknown as NpAgentCanonicalBodyBytesV1<
    "np.agent-site-deletion-plan.v1",
    NpAgentSiteDeletionPlanCanonicalV1
  >;
}

export async function npDigestAgentSiteDeletionPlanCanonical(
  value: unknown,
): Promise<`cj1:sha256:${string}`> {
  return digestAgentCanonicalSha256(
    npBuildAgentSiteDeletionPlanCanonicalBytes(value).domainSeparatedUtf8,
  );
}
