import {
  npAnalyzeAgentGatewaySettings,
  npAnalyzeAgentJsonSchema,
  npRequireAgentContractResult,
} from "./contract.js";
import {
  analyzeCanonicalBody,
  canonicalBodyArray,
  canonicalBodyEnum,
  canonicalBodyInteger,
  canonicalBodyRecord,
  failCanonicalBody,
  type CanonicalBodyInspectionState,
} from "./canonical-body-validation.js";
import { digestAgentCanonicalSha256 } from "./canonical-digest.js";
import { serializeAgentCanonicalJson } from "./canonical-foundation.js";
import {
  SIGNED_32_BIT_MAXIMUM,
  canonicalRuntimeStableCode,
  canonicalRuntimeText,
  cloneCanonicalRuntimeInput,
  parseCanonicalIdentifier,
  parseCanonicalJsonObject,
  parseCanonicalSha256,
  parseCanonicalSiteId,
  requireNestedCanonicalResult,
} from "./canonical-runtime-primitives.js";
import {
  npAnalyzeAgentConnectionV1,
  npAnalyzeAgentPrincipalV1,
  npAnalyzeAgentServiceTokenV1,
  type NpAgentConnectionV1,
  type NpAgentPrincipalV1,
  type NpAgentServiceTokenV1,
} from "./wire-contract.js";
import type {
  NpAgentConnectionKind,
  NpAgentContractResult,
  NpAgentGatewaySettingsV1,
  NpAgentJsonObject,
  NpAgentJsonSchema,
  NpAgentProviderDataClass,
} from "./types.js";

const STUDIO_BODY_MAXIMUM_BYTES = 512 * 1024;
const STUDIO_LIST_MAXIMUM = 100;
const CONNECTION_KINDS = new Set<string>(["model", "notification"]);
const AUTH_KINDS = new Set<string>(["api_key", "oauth"]);
const DATA_CLASSES = new Set<string>(["public-only", "internal-redacted", "sensitive-approved"]);
const RUNTIME_STATES = new Set<string>(["ready", "unavailable"]);

export interface NpAgentStudioAdapterOAuthV1 {
  authorizationOrigins: string[];
  permissionInventory: string[];
}

/** Browser-safe installed provider inventory. Executable adapter callbacks are absent. */
export interface NpAgentStudioAdapterV1 {
  schemaVersion: "np.agent-studio-adapter.v1";
  id: string;
  contractVersion: number;
  fingerprint: string;
  supportedConnectionKinds: NpAgentConnectionKind[];
  supportedAuthKinds: Array<"api_key" | "oauth">;
  configSchema: NpAgentJsonSchema;
  oauth: NpAgentStudioAdapterOAuthV1 | null;
}

export interface NpAgentStudioRuntimeStateV1 {
  state: "ready" | "unavailable";
  issueCode: string | null;
}

export interface NpAgentStudioRuntimeV1 {
  schemaVersion: "np.agent-studio-runtime.v1";
  connections: NpAgentStudioRuntimeStateV1;
  gateway: NpAgentStudioRuntimeStateV1;
}

export interface NpAgentStudioOverviewV1 {
  schemaVersion: "np.agent-studio-overview.v1";
  siteId: string;
  runtime: NpAgentStudioRuntimeV1;
  gatewaySettings: NpAgentGatewaySettingsV1;
  adapters: NpAgentStudioAdapterV1[];
  connections: NpAgentConnectionV1[];
  principals: NpAgentPrincipalV1[];
}

export interface NpAgentStudioConnectionDefinitionV1 {
  schemaVersion: "np.agent-studio-connection-definition.v1";
  name: string;
  kind: NpAgentConnectionKind;
  provider: string;
  adapterId: string;
  adapterContractVersion: number;
  adapterFingerprint: string;
  authKind: "api_key" | "oauth";
  config: NpAgentJsonObject;
  dataProcessingCeiling: NpAgentProviderDataClass;
}

export interface NpAgentStudioPrincipalDetailV1 {
  schemaVersion: "np.agent-studio-principal-detail.v1";
  principal: NpAgentPrincipalV1;
  tokens: NpAgentServiceTokenV1[];
}

export interface NpAgentStudioOneTimeTokenV1 {
  schemaVersion: "np.agent-studio-one-time-token.v1";
  token: NpAgentServiceTokenV1;
  value: string;
}

function sortedUniqueStrings(
  value: unknown,
  path: string,
  maximumItems: number,
  state: CanonicalBodyInspectionState,
): string[] {
  const values = canonicalBodyArray(value, path, maximumItems, state).map((entry, index) =>
    canonicalRuntimeText(entry, `${path}[${index.toString()}]`, 128, { requireTrimmed: true }),
  );
  if (
    new Set(values).size !== values.length ||
    values.some((entry, index) => index > 0 && values[index - 1] >= entry)
  ) {
    failCanonicalBody("invalid-field", path, "must be sorted and unique");
  }
  return values;
}

function parseAdapter(value: unknown, path: string): NpAgentStudioAdapterV1 {
  const state: CanonicalBodyInspectionState = { seen: new WeakSet<object>() };
  const record = canonicalBodyRecord(
    cloneCanonicalRuntimeInput(value, path, STUDIO_BODY_MAXIMUM_BYTES, { maximumDepth: 24 }),
    path,
    [
      "schemaVersion",
      "id",
      "contractVersion",
      "fingerprint",
      "supportedConnectionKinds",
      "supportedAuthKinds",
      "configSchema",
      "oauth",
    ],
    [
      "schemaVersion",
      "id",
      "contractVersion",
      "fingerprint",
      "supportedConnectionKinds",
      "supportedAuthKinds",
      "configSchema",
      "oauth",
    ],
    state,
  );
  if (record.schemaVersion !== "np.agent-studio-adapter.v1") {
    failCanonicalBody(
      "invalid-field",
      `${path}.schemaVersion`,
      "must be np.agent-studio-adapter.v1",
    );
  }
  const supportedConnectionKinds = sortedUniqueStrings(
    record.supportedConnectionKinds,
    `${path}.supportedConnectionKinds`,
    2,
    state,
  ) as NpAgentConnectionKind[];
  if (
    supportedConnectionKinds.length < 1 ||
    supportedConnectionKinds.some((kind) => !CONNECTION_KINDS.has(kind))
  ) {
    failCanonicalBody(
      "invalid-field",
      `${path}.supportedConnectionKinds`,
      "contains an unsupported kind",
    );
  }
  const supportedAuthKinds = sortedUniqueStrings(
    record.supportedAuthKinds,
    `${path}.supportedAuthKinds`,
    2,
    state,
  ) as Array<"api_key" | "oauth">;
  if (supportedAuthKinds.length < 1 || supportedAuthKinds.some((kind) => !AUTH_KINDS.has(kind))) {
    failCanonicalBody(
      "invalid-field",
      `${path}.supportedAuthKinds`,
      "contains an unsupported auth kind",
    );
  }
  let oauth: NpAgentStudioAdapterOAuthV1 | null = null;
  if (record.oauth !== null) {
    const oauthRecord = canonicalBodyRecord(
      record.oauth,
      `${path}.oauth`,
      ["authorizationOrigins", "permissionInventory"],
      ["authorizationOrigins", "permissionInventory"],
      state,
    );
    const authorizationOrigins = sortedUniqueStrings(
      oauthRecord.authorizationOrigins,
      `${path}.oauth.authorizationOrigins`,
      16,
      state,
    );
    if (
      authorizationOrigins.length < 1 ||
      authorizationOrigins.some((entry) => {
        try {
          const url = new URL(entry);
          return (
            url.protocol !== "https:" ||
            url.origin !== entry ||
            url.pathname !== "/" ||
            Boolean(url.search || url.hash)
          );
        } catch {
          return true;
        }
      })
    ) {
      failCanonicalBody(
        "invalid-field",
        `${path}.oauth.authorizationOrigins`,
        "must contain exact HTTPS origins",
      );
    }
    oauth = {
      authorizationOrigins,
      permissionInventory: sortedUniqueStrings(
        oauthRecord.permissionInventory,
        `${path}.oauth.permissionInventory`,
        64,
        state,
      ),
    };
  }
  if (supportedAuthKinds.includes("oauth") !== (oauth !== null)) {
    failCanonicalBody("invalid-field", `${path}.oauth`, "must match OAuth support");
  }
  return {
    schemaVersion: "np.agent-studio-adapter.v1",
    id: parseCanonicalIdentifier(record.id, `${path}.id`),
    contractVersion: canonicalBodyInteger(
      record.contractVersion,
      `${path}.contractVersion`,
      1,
      SIGNED_32_BIT_MAXIMUM,
    ),
    fingerprint: parseCanonicalSha256(record.fingerprint, `${path}.fingerprint`),
    supportedConnectionKinds,
    supportedAuthKinds,
    configSchema: requireNestedCanonicalResult(
      npAnalyzeAgentJsonSchema(record.configSchema),
      "agent.jsonSchema",
      `${path}.configSchema`,
    ),
    oauth,
  };
}

function parseRuntimeState(value: unknown, path: string): NpAgentStudioRuntimeStateV1 {
  const state: CanonicalBodyInspectionState = { seen: new WeakSet<object>() };
  const record = canonicalBodyRecord(
    value,
    path,
    ["state", "issueCode"],
    ["state", "issueCode"],
    state,
  );
  const runtimeState = canonicalBodyEnum<NpAgentStudioRuntimeStateV1["state"]>(
    record.state,
    `${path}.state`,
    RUNTIME_STATES,
  );
  const issueCode =
    record.issueCode === null
      ? null
      : canonicalRuntimeStableCode(record.issueCode, `${path}.issueCode`);
  if ((runtimeState === "ready") !== (issueCode === null)) {
    failCanonicalBody("invalid-field", `${path}.issueCode`, "must be absent only when ready");
  }
  return { state: runtimeState, issueCode };
}

function parseRuntime(value: unknown, path: string): NpAgentStudioRuntimeV1 {
  const state: CanonicalBodyInspectionState = { seen: new WeakSet<object>() };
  const record = canonicalBodyRecord(
    value,
    path,
    ["schemaVersion", "connections", "gateway"],
    ["schemaVersion", "connections", "gateway"],
    state,
  );
  if (record.schemaVersion !== "np.agent-studio-runtime.v1") {
    failCanonicalBody(
      "invalid-field",
      `${path}.schemaVersion`,
      "must be np.agent-studio-runtime.v1",
    );
  }
  return {
    schemaVersion: "np.agent-studio-runtime.v1",
    connections: parseRuntimeState(record.connections, `${path}.connections`),
    gateway: parseRuntimeState(record.gateway, `${path}.gateway`),
  };
}

function parseDefinition(value: unknown): NpAgentStudioConnectionDefinitionV1 {
  const path = "agent.studio.connectionDefinition";
  const state: CanonicalBodyInspectionState = { seen: new WeakSet<object>() };
  const record = canonicalBodyRecord(
    cloneCanonicalRuntimeInput(value, path, 256 * 1024, { maximumDepth: 24 }),
    path,
    [
      "schemaVersion",
      "name",
      "kind",
      "provider",
      "adapterId",
      "adapterContractVersion",
      "adapterFingerprint",
      "authKind",
      "config",
      "dataProcessingCeiling",
    ],
    [
      "schemaVersion",
      "name",
      "kind",
      "provider",
      "adapterId",
      "adapterContractVersion",
      "adapterFingerprint",
      "authKind",
      "config",
      "dataProcessingCeiling",
    ],
    state,
  );
  if (record.schemaVersion !== "np.agent-studio-connection-definition.v1") {
    failCanonicalBody(
      "invalid-field",
      `${path}.schemaVersion`,
      "must be np.agent-studio-connection-definition.v1",
    );
  }
  return {
    schemaVersion: "np.agent-studio-connection-definition.v1",
    name: canonicalRuntimeText(record.name, `${path}.name`, 120, { requireTrimmed: true }),
    kind: canonicalBodyEnum<NpAgentConnectionKind>(record.kind, `${path}.kind`, CONNECTION_KINDS),
    provider: parseCanonicalIdentifier(record.provider, `${path}.provider`),
    adapterId: parseCanonicalIdentifier(record.adapterId, `${path}.adapterId`),
    adapterContractVersion: canonicalBodyInteger(
      record.adapterContractVersion,
      `${path}.adapterContractVersion`,
      1,
      SIGNED_32_BIT_MAXIMUM,
    ),
    adapterFingerprint: parseCanonicalSha256(
      record.adapterFingerprint,
      `${path}.adapterFingerprint`,
    ),
    authKind: canonicalBodyEnum(record.authKind, `${path}.authKind`, AUTH_KINDS),
    config: parseCanonicalJsonObject(record.config, `${path}.config`),
    dataProcessingCeiling: canonicalBodyEnum<NpAgentProviderDataClass>(
      record.dataProcessingCeiling,
      `${path}.dataProcessingCeiling`,
      DATA_CLASSES,
    ),
  };
}

export function npAnalyzeAgentStudioAdapterV1(
  value: unknown,
): NpAgentContractResult<NpAgentStudioAdapterV1> {
  return analyzeCanonicalBody("agent.studio.adapter", () =>
    parseAdapter(value, "agent.studio.adapter"),
  );
}

export function npRequireAgentStudioAdapterV1(value: unknown): NpAgentStudioAdapterV1 {
  return npRequireAgentContractResult(
    npAnalyzeAgentStudioAdapterV1(value),
    "Invalid Agent Studio adapter",
  );
}

export function npAnalyzeAgentStudioConnectionDefinitionV1(
  value: unknown,
): NpAgentContractResult<NpAgentStudioConnectionDefinitionV1> {
  return analyzeCanonicalBody("agent.studio.connectionDefinition", () => parseDefinition(value));
}

export function npRequireAgentStudioConnectionDefinitionV1(
  value: unknown,
): NpAgentStudioConnectionDefinitionV1 {
  return npRequireAgentContractResult(
    npAnalyzeAgentStudioConnectionDefinitionV1(value),
    "Invalid Agent Studio connection definition",
  );
}

export function npSerializeAgentStudioConnectionDefinitionV1(value: unknown): string {
  return serializeAgentCanonicalJson(npRequireAgentStudioConnectionDefinitionV1(value));
}

export async function npDigestAgentStudioConnectionDefinitionV1(
  value: unknown,
): Promise<`cj1:sha256:${string}`> {
  return digestAgentCanonicalSha256(
    new TextEncoder().encode(npSerializeAgentStudioConnectionDefinitionV1(value)),
  );
}

export function npAnalyzeAgentStudioOverviewV1(
  value: unknown,
): NpAgentContractResult<NpAgentStudioOverviewV1> {
  return analyzeCanonicalBody("agent.studio.overview", () => {
    const path = "agent.studio.overview";
    const state: CanonicalBodyInspectionState = { seen: new WeakSet<object>() };
    const record = canonicalBodyRecord(
      cloneCanonicalRuntimeInput(value, path, STUDIO_BODY_MAXIMUM_BYTES, { maximumDepth: 32 }),
      path,
      [
        "schemaVersion",
        "siteId",
        "runtime",
        "gatewaySettings",
        "adapters",
        "connections",
        "principals",
      ],
      [
        "schemaVersion",
        "siteId",
        "runtime",
        "gatewaySettings",
        "adapters",
        "connections",
        "principals",
      ],
      state,
    );
    if (record.schemaVersion !== "np.agent-studio-overview.v1") {
      failCanonicalBody(
        "invalid-field",
        `${path}.schemaVersion`,
        "must be np.agent-studio-overview.v1",
      );
    }
    const parseList = <T>(
      input: unknown,
      listPath: string,
      parser: (entry: unknown, index: number) => T,
    ): T[] => canonicalBodyArray(input, listPath, STUDIO_LIST_MAXIMUM, state).map(parser);
    return {
      schemaVersion: "np.agent-studio-overview.v1",
      siteId: parseCanonicalSiteId(record.siteId, `${path}.siteId`),
      runtime: parseRuntime(record.runtime, `${path}.runtime`),
      gatewaySettings: requireNestedCanonicalResult(
        npAnalyzeAgentGatewaySettings(record.gatewaySettings),
        "agent.gatewaySettings",
        `${path}.gatewaySettings`,
      ),
      adapters: parseList(record.adapters, `${path}.adapters`, (entry, index) =>
        parseAdapter(entry, `${path}.adapters[${index.toString()}]`),
      ),
      connections: parseList(record.connections, `${path}.connections`, (entry, index) =>
        requireNestedCanonicalResult(
          npAnalyzeAgentConnectionV1(entry),
          "agent.wire.connection",
          `${path}.connections[${index.toString()}]`,
        ),
      ),
      principals: parseList(record.principals, `${path}.principals`, (entry, index) =>
        requireNestedCanonicalResult(
          npAnalyzeAgentPrincipalV1(entry),
          "agent.wire.principal",
          `${path}.principals[${index.toString()}]`,
        ),
      ),
    };
  });
}

export function npRequireAgentStudioOverviewV1(value: unknown): NpAgentStudioOverviewV1 {
  return npRequireAgentContractResult(
    npAnalyzeAgentStudioOverviewV1(value),
    "Invalid Agent Studio overview",
  );
}

export function npAnalyzeAgentStudioPrincipalDetailV1(
  value: unknown,
): NpAgentContractResult<NpAgentStudioPrincipalDetailV1> {
  return analyzeCanonicalBody("agent.studio.principalDetail", () => {
    const path = "agent.studio.principalDetail";
    const state: CanonicalBodyInspectionState = { seen: new WeakSet<object>() };
    const record = canonicalBodyRecord(
      value,
      path,
      ["schemaVersion", "principal", "tokens"],
      ["schemaVersion", "principal", "tokens"],
      state,
    );
    if (record.schemaVersion !== "np.agent-studio-principal-detail.v1") {
      failCanonicalBody(
        "invalid-field",
        `${path}.schemaVersion`,
        "must be np.agent-studio-principal-detail.v1",
      );
    }
    return {
      schemaVersion: "np.agent-studio-principal-detail.v1",
      principal: requireNestedCanonicalResult(
        npAnalyzeAgentPrincipalV1(record.principal),
        "agent.wire.principal",
        `${path}.principal`,
      ),
      tokens: canonicalBodyArray(record.tokens, `${path}.tokens`, STUDIO_LIST_MAXIMUM, state).map(
        (entry, index) =>
          requireNestedCanonicalResult(
            npAnalyzeAgentServiceTokenV1(entry),
            "agent.wire.serviceToken",
            `${path}.tokens[${index.toString()}]`,
          ),
      ),
    };
  });
}

export function npRequireAgentStudioPrincipalDetailV1(
  value: unknown,
): NpAgentStudioPrincipalDetailV1 {
  return npRequireAgentContractResult(
    npAnalyzeAgentStudioPrincipalDetailV1(value),
    "Invalid Agent Studio principal detail",
  );
}

export function npAnalyzeAgentStudioOneTimeTokenV1(
  value: unknown,
): NpAgentContractResult<NpAgentStudioOneTimeTokenV1> {
  return analyzeCanonicalBody("agent.studio.oneTimeToken", () => {
    const path = "agent.studio.oneTimeToken";
    const state: CanonicalBodyInspectionState = { seen: new WeakSet<object>() };
    const record = canonicalBodyRecord(
      value,
      path,
      ["schemaVersion", "token", "value"],
      ["schemaVersion", "token", "value"],
      state,
    );
    if (record.schemaVersion !== "np.agent-studio-one-time-token.v1") {
      failCanonicalBody(
        "invalid-field",
        `${path}.schemaVersion`,
        "must be np.agent-studio-one-time-token.v1",
      );
    }
    const token = requireNestedCanonicalResult(
      npAnalyzeAgentServiceTokenV1(record.token),
      "agent.wire.serviceToken",
      `${path}.token`,
    );
    const oneTimeValue = canonicalRuntimeText(record.value, `${path}.value`, 512, {
      requireTrimmed: true,
    });
    const secret = oneTimeValue.slice(token.prefix.length + 1);
    if (!oneTimeValue.startsWith(`${token.prefix}_`) || !/^[A-Za-z0-9_-]{43}$/u.test(secret)) {
      failCanonicalBody("invalid-field", `${path}.value`, "must match the returned token prefix");
    }
    return { schemaVersion: "np.agent-studio-one-time-token.v1", token, value: oneTimeValue };
  });
}

export function npRequireAgentStudioOneTimeTokenV1(value: unknown): NpAgentStudioOneTimeTokenV1 {
  return npRequireAgentContractResult(
    npAnalyzeAgentStudioOneTimeTokenV1(value),
    "Invalid Agent Studio one-time token",
  );
}
