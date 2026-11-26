import { createHash } from "node:crypto";
import { cloneCanonicalRuntimeInput } from "../agent-contract/canonical-runtime-primitives.js";
import { npRequireAgentIncidentNotificationsV1 } from "../agent-contract/incident-notifications-contract.js";
import type { NpAgentJsonObject, NpAgentJsonSchema } from "../agent-contract/types.js";
import type { NpAgentNotificationDeliveryResultV1 } from "../agent-contract/notification-delivery-contract.js";
import { npAssertAgentPreviewEffectsAllowed } from "./changeset-preview-overlay.js";
import {
  NpAgentProviderError,
  npCreateAgentProviderResultDigestV1,
  type NpAgentConnectionAuthAdapterV1,
  type NpAgentParsedConnectionConfigV1,
  type NpAgentProviderNotificationFacetV1,
  type NpAgentProviderProbeResultV1,
} from "./provider-auth-contract.js";
import type { NpAgentConnectionCredentialEnvelopeV1 } from "./vault-contract.js";

const MAX_RESPONSE_BYTES = 64 * 1024;
const encoder = new TextEncoder();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const DOMAIN =
  /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?$/u;
const MAILBOX = /^[A-Za-z0-9](?:[A-Za-z0-9._+-]{0,62}[A-Za-z0-9])?@[^@]+$/u;
const SLACK_REJECTIONS = new Set([
  "account_inactive",
  "channel_not_found",
  "invalid_auth",
  "is_archived",
  "missing_scope",
  "msg_too_long",
  "no_permission",
  "no_text",
  "not_allowed_token_type",
  "not_authed",
  "not_in_channel",
  "restricted_action",
  "team_access_not_granted",
  "token_expired",
  "token_revoked",
]);
const RESEND_REJECTIONS: Readonly<Record<string, readonly number[]>> = {
  validation_error: [400, 401, 403],
  missing_api_key: [401],
  restricted_api_key: [401, 403],
  suspended_api_key: [403],
  invalid_permission: [403],
  invalid_parameter: [422],
  missing_required_field: [422],
  missing_required_parameter: [422],
};

function invalid(): never {
  throw new NpAgentProviderError(
    "PROVIDER_CONFIG_INVALID",
    "The notification configuration is invalid.",
  );
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return invalid();
  return value as Record<string, unknown>;
}
function exactConfig(value: NpAgentJsonObject, fields: readonly string[]): NpAgentJsonObject {
  const copied = object(cloneCanonicalRuntimeInput(value, "notification.config", 4096));
  if (
    Object.keys(copied).length !== fields.length ||
    fields.some((key) => typeof copied[key] !== "string")
  )
    invalid();
  return copied as NpAgentJsonObject;
}
function text(value: unknown, pattern: RegExp): string {
  if (typeof value !== "string" || !pattern.test(value)) return invalid();
  return value;
}
function mailbox(value: unknown): string {
  const address = text(value, MAILBOX);
  if (
    address.length > 254 ||
    address.includes("..") ||
    !DOMAIN.test(address.slice(address.lastIndexOf("@") + 1))
  )
    invalid();
  return address;
}
function configSchema(fields: readonly string[]): NpAgentJsonSchema {
  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    type: "object",
    properties: Object.fromEntries(
      fields.map((key) => [key, { type: "string", minLength: 1, maxLength: 254 }]),
    ),
    required: [...fields],
    additionalProperties: false,
  };
}
function interrupted(): never {
  throw new Error("Notification request interrupted");
}
async function abortable<T>(pending: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return interrupted();
  return new Promise<T>((resolve, reject) => {
    const stop = () => reject(new Error("Notification request interrupted"));
    signal.addEventListener("abort", stop, { once: true });
    pending.then(resolve, reject).finally(() => signal.removeEventListener("abort", stop));
  });
}
async function read(response: Response, signal: AbortSignal): Promise<Record<string, unknown>> {
  const body = response.body;
  const declared = response.headers.get("content-length");
  if (
    !body ||
    response.redirected ||
    (response.status >= 300 && response.status < 400) ||
    !/^application\/json(?:;|$)/iu.test(response.headers.get("content-type") ?? "") ||
    (declared !== null && (!/^\d+$/u.test(declared) || Number(declared) > MAX_RESPONSE_BYTES))
  ) {
    await body?.cancel().catch(() => undefined);
    throw new Error("Notification response unavailable");
  }
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  let bytes: Uint8Array | undefined;
  try {
    for (;;) {
      const part = await abortable(reader.read(), signal);
      if (part.done) break;
      size += part.value.byteLength;
      chunks.push(part.value);
      if (size > MAX_RESPONSE_BYTES) throw new Error("Notification response unavailable");
    }
    bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return object(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown);
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
    bytes?.fill(0);
    for (const chunk of chunks) chunk.fill(0);
  }
}

/** Only canonical Incident metadata is rendered; routing and provider input cannot come from content. */
function incidentText(payload: NpAgentJsonObject): string {
  const copied = object(cloneCanonicalRuntimeInput(payload, "notification.payload", 8192));
  const { sourceNotificationId, recipientFingerprint, ...metadata } = copied;
  if (
    typeof recipientFingerprint !== "string" ||
    !/^cj1:sha256:[A-Za-z0-9_-]{43}$/u.test(recipientFingerprint)
  )
    invalid();
  // The wire validator requires a timestamp. This constant validates the metadata shape only;
  // it is never rendered or retained as an observation time.
  const item = npRequireAgentIncidentNotificationsV1({
    schemaVersion: "np.agent-incident-notifications.v1",
    nextCursor: null,
    items: [
      { ...metadata, notificationId: sourceNotificationId, createdAt: "1970-01-01T00:00:00.000Z" },
    ],
  }).items[0];
  return [
    "NexPress Incident",
    item.summary,
    `Incident: ${item.incidentId}`,
    `Version: ${item.incidentVersion.toString()}`,
    `Severity: ${item.severity}`,
    `Status: ${item.status}`,
    `Admin path: ${item.adminPath}`,
  ].join("\n");
}

interface Definition {
  id: string;
  channel: "slack" | "email";
  fields: readonly string[];
  config(value: NpAgentJsonObject): NpAgentJsonObject;
  probe(config: NpAgentJsonObject): { url: string; method: "GET" | "POST" };
  subject(value: Record<string, unknown>, config: NpAgentJsonObject): string | null;
  send(config: NpAgentJsonObject, content: string): { url: string; body: NpAgentJsonObject };
  result(
    value: Record<string, unknown>,
    response: Response,
    config: NpAgentJsonObject,
  ): NpAgentNotificationDeliveryResultV1;
}
const unknown = (): NpAgentNotificationDeliveryResultV1 => ({
  state: "ambiguous",
  errorCode: "NOTIFICATION_OUTCOME_UNKNOWN",
});

function create(
  definition: Definition,
  options: { fetch?: typeof globalThis.fetch },
): NpAgentConnectionAuthAdapterV1 {
  const transport = options.fetch ?? globalThis.fetch;
  const fingerprint = `cj1:sha256:${createHash("sha256").update(`np.agent-notification-reference.${definition.id}.v1`).digest("base64url")}`;
  const config = (connection: NpAgentParsedConnectionConfigV1) => {
    if (
      connection.adapterId !== definition.id ||
      connection.adapterContractVersion !== 1 ||
      connection.adapterFingerprint !== fingerprint
    )
      invalid();
    return definition.config(connection.config);
  };
  const secret = (credential: NpAgentConnectionCredentialEnvelopeV1): string => {
    if (
      credential.schemaVersion !== "np.agent-credential-envelope.v1" ||
      credential.kind !== "api_key" ||
      credential.adapterId !== definition.id ||
      credential.adapterContractVersion !== 1 ||
      credential.adapterFingerprint !== fingerprint
    )
      invalid();
    if (credential.secret.byteLength < 1 || credential.secret.byteLength > 65536) invalid();
    let decoded: string;
    try {
      decoded = new TextDecoder("utf-8", { fatal: true }).decode(credential.secret);
    } catch {
      return invalid();
    }
    if (!/^[\x21-\x7e]+$/u.test(decoded)) invalid();
    return decoded;
  };
  const erase = (credential: NpAgentConnectionCredentialEnvelopeV1) => {
    if (credential.kind === "api_key") credential.secret.fill(0);
    else {
      credential.accessToken.fill(0);
      if (credential.refresh.mode === "present") credential.refresh.token.fill(0);
    }
  };
  const request = async (url: string, init: RequestInit, signal: AbortSignal) => {
    const pending = transport(url, {
      ...init,
      signal,
      redirect: "error",
      credentials: "omit",
      cache: "no-store",
    });
    void pending.then(
      (response) => {
        if (signal.aborted) void response.body?.cancel().catch(() => undefined);
      },
      () => undefined,
    );
    return abortable(pending, signal);
  };
  const unavailable = (): NpAgentProviderProbeResultV1 => ({
    schemaVersion: "np.agent-provider-probe-result.v1",
    status: "unavailable",
    providerSubject: null,
    grantedPermissions: [],
    capabilityIds: [],
    safeCode: "NOTIFICATION_PROBE_UNAVAILABLE",
    resultDigest: npCreateAgentProviderResultDigestV1(definition.id, { status: "unavailable" }),
  });
  const notification: NpAgentProviderNotificationFacetV1 = {
    channels: [definition.channel],
    idempotency: "none",
    async send(input, context) {
      npAssertAgentPreviewEffectsAllowed();
      let dispatched = false;
      let inputValid = false;
      try {
        const parsed = config(context.connection);
        if (
          input.schemaVersion !== "np.agent-notification-delivery.v1" ||
          input.channel !== definition.channel ||
          !UUID.test(input.notificationId) ||
          typeof input.deduplicationKey !== "string" ||
          !/^[\x21-\x7e]{1,256}$/u.test(input.deduplicationKey)
        )
          invalid();
        const prepared = definition.send(parsed, incidentText(input.payloadRedacted));
        inputValid = true;
        if (context.signal.aborted)
          return { state: "retryable_not_sent", errorCode: "NOTIFICATION_ABORTED_BEFORE_DISPATCH" };
        return await context.credentialLease.use(async (credential) => {
          try {
            const key = secret(credential);
            if (context.signal.aborted)
              return {
                state: "retryable_not_sent",
                errorCode: "NOTIFICATION_ABORTED_BEFORE_DISPATCH",
              };
            dispatched = true;
            const response = await request(
              prepared.url,
              {
                method: "POST",
                headers: {
                  Authorization: `Bearer ${key}`,
                  Accept: "application/json",
                  "Content-Type": "application/json",
                },
                body: JSON.stringify(prepared.body),
              },
              context.signal,
            );
            const value = await read(response, context.signal);
            return definition.result(value, response, parsed);
          } finally {
            erase(credential);
          }
        });
      } catch (error) {
        return dispatched
          ? unknown()
          : inputValid && !(error instanceof NpAgentProviderError)
            ? { state: "retryable_not_sent", errorCode: "NOTIFICATION_CREDENTIAL_UNAVAILABLE" }
            : { state: "permanent_failure", errorCode: "NOTIFICATION_INPUT_OR_CREDENTIAL_INVALID" };
      }
    },
  };
  const schema = configSchema(definition.fields);
  return {
    id: definition.id,
    contractVersion: 1,
    fingerprint,
    credentialEnvelopeVersions: [1],
    supportedConnectionKinds: ["notification"],
    supportedAuthKinds: ["api_key"],
    oauth: null,
    configSchema: schema,
    destinationDescriptorSchema: schema,
    notification,
    parseConfig(input) {
      return {
        schemaVersion: "np.agent-parsed-connection-config.v1",
        connectionId: input.connectionId,
        adapterId: definition.id,
        adapterContractVersion: 1,
        adapterFingerprint: fingerprint,
        configVersion: input.configVersion,
        configHash: "",
        config: definition.config(input.config),
        pricingCatalog: [],
        pricingCatalogFingerprint: "",
      };
    },
    deriveDestinationDescriptor(input) {
      return {
        schemaVersion: "np.agent-connection-destination-descriptor.v1",
        kind: "notification",
        adapterId: definition.id,
        descriptor: config(input.parsedConfig),
      };
    },
    async probeCredential(connection, context) {
      npAssertAgentPreviewEffectsAllowed();
      try {
        const parsed = config(connection);
        if (context.signal.aborted) return unavailable();
        return await context.credentialLease.use(async (credential) => {
          try {
            const key = secret(credential);
            if (context.signal.aborted) return unavailable();
            const prepared = definition.probe(parsed);
            const response = await request(
              prepared.url,
              {
                method: prepared.method,
                headers: {
                  Authorization: `Bearer ${key}`,
                  Accept: "application/json",
                  "Content-Type": "application/json",
                },
                ...(prepared.method === "POST" ? { body: "{}" } : {}),
              },
              context.signal,
            );
            const value = await read(response, context.signal);
            const subject = response.ok ? definition.subject(value, parsed) : null;
            if (!subject) return unavailable();
            return {
              schemaVersion: "np.agent-provider-probe-result.v1",
              status: "ready",
              providerSubject: encoder.encode(subject),
              grantedPermissions: [],
              capabilityIds: ["notification.send"],
              safeCode: null,
              resultDigest: npCreateAgentProviderResultDigestV1(definition.id, {
                status: "ready",
                subject,
              }),
            };
          } finally {
            erase(credential);
          }
        });
      } catch {
        return unavailable();
      }
    },
  };
}

/** Explicit Slack API-key adapter. auth.test proves the frozen team/user, not channel membership. */
export function createAgentSlackNotificationProviderAdapterV1(
  options: { fetch?: typeof globalThis.fetch } = {},
): NpAgentConnectionAuthAdapterV1 {
  return create(
    {
      id: "slack.notification",
      channel: "slack",
      fields: ["teamId", "userId", "channelId"],
      config(input) {
        const value = exactConfig(input, ["teamId", "userId", "channelId"]);
        text(value.teamId, /^T[A-Z0-9]{1,63}$/u);
        text(value.userId, /^[UW][A-Z0-9]{1,63}$/u);
        text(value.channelId, /^[CGD][A-Z0-9]{1,63}$/u);
        return value;
      },
      probe: () => ({ url: "https://slack.com/api/auth.test", method: "POST" }),
      subject: (value, config) =>
        value.ok === true && value.team_id === config.teamId && value.user_id === config.userId
          ? `slack-team-user:${String(value.team_id)}:${String(value.user_id)}`
          : null,
      send: (config, content) => ({
        url: "https://slack.com/api/chat.postMessage",
        body: {
          channel: config.channelId,
          text: content.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;"),
          mrkdwn: false,
          parse: "none",
          link_names: false,
          unfurl_links: false,
          unfurl_media: false,
        },
      }),
      result(value, response, config) {
        if (
          response.status === 200 &&
          value.ok === true &&
          value.channel === config.channelId &&
          typeof value.ts === "string" &&
          /^\d{1,20}\.\d{6}$/u.test(value.ts) &&
          (value.error === undefined || value.error === null)
        )
          return { state: "confirmed", providerMessageId: `${String(value.channel)}:${value.ts}` };
        if (
          value.ok === false &&
          Object.keys(value).every((key) =>
            ["ok", "error", "needed", "provided", "response_metadata"].includes(key),
          ) &&
          typeof value.error === "string"
        ) {
          if (
            SLACK_REJECTIONS.has(value.error) &&
            (response.ok || [400, 401, 403].includes(response.status))
          )
            return { state: "permanent_failure", errorCode: "SLACK_REQUEST_REJECTED" };
          if (value.error === "ratelimited" && (response.ok || response.status === 429))
            return { state: "retryable_not_sent", errorCode: "SLACK_RATE_LIMITED" };
        }
        return unknown();
      },
    },
    options,
  );
}

/** Explicit Resend adapter. Domain read proof requires a full-access key; sending-only keys fail closed. */
export function createAgentResendNotificationProviderAdapterV1(
  options: { fetch?: typeof globalThis.fetch } = {},
): NpAgentConnectionAuthAdapterV1 {
  return create(
    {
      id: "resend.notification",
      channel: "email",
      fields: ["domainId", "domain", "from", "to"],
      config(input) {
        const value = exactConfig(input, ["domainId", "domain", "from", "to"]);
        text(value.domainId, UUID);
        const domain = text(value.domain, DOMAIN);
        const from = mailbox(value.from);
        mailbox(value.to);
        if (from.slice(from.lastIndexOf("@") + 1) !== domain) invalid();
        return value;
      },
      probe: (config) => ({
        url: `https://api.resend.com/domains/${encodeURIComponent(text(config.domainId, UUID))}`,
        method: "GET",
      }),
      subject(value, config) {
        if (
          value.object !== "domain" ||
          value.id !== config.domainId ||
          value.name !== config.domain ||
          value.status !== "verified" ||
          object(value.capabilities).sending !== "enabled"
        )
          return null;
        return `resend-domain:${String(value.id)}:${String(value.name)}`;
      },
      send: (config, content) => ({
        url: "https://api.resend.com/emails",
        body: {
          from: config.from,
          to: [config.to],
          subject: "NexPress Incident notification",
          text: content,
        },
      }),
      result(value, response) {
        if (
          response.status === 200 &&
          Object.keys(value).length === 1 &&
          typeof value.id === "string" &&
          UUID.test(value.id)
        )
          return { state: "confirmed", providerMessageId: value.id };
        if (
          !response.ok &&
          typeof value.name === "string" &&
          typeof value.message === "string" &&
          Object.keys(value).every((key) => ["name", "message", "statusCode"].includes(key)) &&
          (value.statusCode === undefined || value.statusCode === response.status) &&
          value.id === undefined
        ) {
          if (RESEND_REJECTIONS[value.name]?.includes(response.status))
            return { state: "permanent_failure", errorCode: "RESEND_REQUEST_REJECTED" };
          if (
            response.status === 429 &&
            ["rate_limit_exceeded", "daily_quota_exceeded", "monthly_quota_exceeded"].includes(
              value.name,
            )
          )
            return { state: "retryable_not_sent", errorCode: "RESEND_RATE_OR_QUOTA_LIMITED" };
        }
        return unknown();
      },
    },
    options,
  );
}
