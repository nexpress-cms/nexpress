import { describe, expect, it, vi } from "vitest";
import {
  createAgentResendNotificationProviderAdapterV1,
  createAgentSlackNotificationProviderAdapterV1,
} from "./provider-notification-reference.js";
import {
  NpAgentConnectionAuthAdapterRegistryV1,
  npParseAgentProviderConnectionConfigV1,
  type NpAgentConnectionAuthAdapterV1,
  type NpAgentProviderNotificationFacetV1,
} from "./provider-auth-contract.js";
import type { NpAgentJsonObject } from "../agent-contract/types.js";
import type {
  NpAgentConnectionCredentialEnvelopeV1,
  NpProviderCredentialLeaseV1,
} from "./vault-contract.js";
import { withAgentChangeSetPreview } from "./changeset-preview-overlay.js";
import { previewFixture } from "./changeset-preview-test-fixture.js";

const connectionId = "018f0f30-cd7b-7cc2-8b16-8c052c259bd3";
const incidentId = "018f0f30-cd7b-7cc2-8b16-8c052c259bd1";
const sourceId = "018f0f30-cd7b-7cc2-8b16-8c052c259bd2";
const messageId = "49a3999c-0ce1-4ea6-ab68-afcd6dc2e794";
const slackConfig = { teamId: "T12345678", userId: "U12345678", channelId: "C12345678" };
const resendConfig = {
  domainId: messageId,
  domain: "alerts.example.com",
  from: "incident@alerts.example.com",
  to: "staff@example.com",
};
const sendInput = (
  channel: "email" | "slack",
): Parameters<NpAgentProviderNotificationFacetV1["send"]>[0] => ({
  schemaVersion: "np.agent-notification-delivery.v1",
  notificationId: messageId,
  channel,
  deduplicationKey: `notification:${sourceId}:${channel}:${connectionId}`,
  payloadRedacted: {
    incidentId,
    incidentVersion: 1,
    transition: "opened",
    severity: "high",
    status: "open",
    summary: "Incident opened.",
    adminPath: `/admin/agents/incidents/${incidentId}`,
    sourceNotificationId: sourceId,
    recipientFingerprint: `cj1:sha256:${"A".repeat(43)}`,
  },
});
const acceptedSlack = () =>
  Response.json({
    ok: true,
    channel: slackConfig.channelId,
    ts: "1729737747.123456",
    message: { text: "provider echo not retained" },
  });
const acceptedResend = () => Response.json({ id: messageId });
const domain = () => ({
  object: "domain",
  id: resendConfig.domainId,
  name: resendConfig.domain,
  status: "verified",
  capabilities: { sending: "enabled", receiving: "disabled" },
});

function lease(
  adapter: NpAgentConnectionAuthAdapterV1,
  patch: Partial<Extract<NpAgentConnectionCredentialEnvelopeV1, { kind: "api_key" }>> = {},
) {
  const bytes = new TextEncoder().encode("test-only-secret");
  const value: NpProviderCredentialLeaseV1 = {
    secretVersionId: sourceId,
    envelopeVersion: 1,
    expiresAt: "2099-01-01T00:00:00.000Z",
    use: async (consume) =>
      consume({
        schemaVersion: "np.agent-credential-envelope.v1",
        kind: "api_key",
        adapterId: adapter.id,
        adapterContractVersion: adapter.contractVersion,
        adapterFingerprint: adapter.fingerprint,
        secret: bytes,
        ...patch,
      }),
    dispose: vi.fn(),
  };
  return { value, bytes, use: vi.spyOn(value, "use") };
}
async function fixture(
  kind: "slack" | "resend",
  fetch = vi
    .fn<typeof globalThis.fetch>()
    .mockImplementation(() =>
      Promise.resolve(kind === "slack" ? acceptedSlack() : acceptedResend()),
    ),
) {
  const adapter =
    kind === "slack"
      ? createAgentSlackNotificationProviderAdapterV1({ fetch })
      : createAgentResendNotificationProviderAdapterV1({ fetch });
  new NpAgentConnectionAuthAdapterRegistryV1().register(adapter);
  const config = kind === "slack" ? slackConfig : resendConfig;
  const connection = await npParseAgentProviderConnectionConfigV1({
    adapter,
    siteId: "test-site",
    connectionId,
    kind: "notification",
    provider: kind,
    authKind: "api_key",
    configVersion: 1,
    config,
    dataProcessingCeiling: "internal-redacted",
  });
  const credential = lease(adapter);
  const controller = new AbortController();
  const context = { connection, credentialLease: credential.value, signal: controller.signal };
  const input = sendInput(kind === "slack" ? "slack" : "email");
  return {
    adapter,
    connection,
    credential,
    controller,
    context,
    input,
    fetch,
    send: () => adapter.notification!.send(input, context),
  };
}

describe("explicit Incident notification reference adapters", () => {
  it("freezes exact destination/config identity without installing a transport or promising indefinite idempotency", async () => {
    const slack = await fixture("slack");
    const resend = await fixture("resend");
    for (const f of [slack, resend]) {
      expect(f.fetch).not.toHaveBeenCalled();
      expect(f.adapter.notification).toMatchObject({ idempotency: "none" });
      expect(f.adapter.deriveDestinationDescriptor({ parsedConfig: f.connection })).toMatchObject({
        schemaVersion: "np.agent-connection-destination-descriptor.v1",
        kind: "notification",
        adapterId: f.adapter.id,
        descriptor: f.connection.config,
      });
      const parse = (config: NpAgentJsonObject) =>
        f.adapter.parseConfig({
          schemaVersion: "np.agent-connection-config-parse.v1",
          connectionId,
          configVersion: 1,
          config,
        });
      expect(() => parse({ ...f.connection.config, url: "https://arbitrary.invalid" })).toThrow();
    }
    for (const channelId of ["#general", "U12345678", "C1/../../other", "C123\n"]) {
      expect(() =>
        slack.adapter.parseConfig({
          schemaVersion: "np.agent-connection-config-parse.v1",
          connectionId,
          configVersion: 1,
          config: { ...slackConfig, channelId },
        }),
      ).toThrow();
    }
    for (const patch of [
      { from: "staff@other.example" },
      { to: "a@example.com,b@example.com" },
      { to: "Staff <staff@example.com>" },
      { domain: "ALERTS.example.com" },
      { from: "a\r\nBcc:bad@alerts.example.com" },
    ]) {
      expect(() =>
        resend.adapter.parseConfig({
          schemaVersion: "np.agent-connection-config-parse.v1",
          connectionId,
          configVersion: 1,
          config: { ...resendConfig, ...patch },
        }),
      ).toThrow();
    }
  });

  it("binds Slack probe identity to actual authenticated team and user without leaking the token", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(
        Response.json({ ok: true, team_id: slackConfig.teamId, user_id: slackConfig.userId }),
      );
    const f = await fixture("slack", fetch);
    const result = await f.adapter.probeCredential(f.connection, f.context);
    expect(result).toMatchObject({
      status: "ready",
      grantedPermissions: [],
      capabilityIds: ["notification.send"],
    });
    expect(new TextDecoder().decode(result.providerSubject!)).toBe(
      `slack-team-user:${slackConfig.teamId}:${slackConfig.userId}`,
    );
    expect(fetch.mock.calls[0]).toEqual([
      "https://slack.com/api/auth.test",
      expect.objectContaining({
        method: "POST",
        redirect: "error",
        credentials: "omit",
        cache: "no-store",
      }),
    ]);
    expect(JSON.stringify(result)).not.toContain("test-only-secret");
    expect(f.credential.bytes.every((byte) => byte === 0)).toBe(true);
    fetch.mockResolvedValueOnce(
      Response.json({ ok: true, team_id: "TOTHER", user_id: slackConfig.userId }),
    );
    const changed = await f.adapter.probeCredential(f.connection, {
      ...f.context,
      credentialLease: lease(f.adapter).value,
    });
    expect(changed).toMatchObject({ status: "unavailable", providerSubject: null });
  });

  it("requires the authenticated exact Resend domain to be verified and sending enabled", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValueOnce(Response.json(domain()));
    const f = await fixture("resend", fetch);
    const result = await f.adapter.probeCredential(f.connection, f.context);
    expect(result.status).toBe("ready");
    expect(new TextDecoder().decode(result.providerSubject!)).toBe(
      `resend-domain:${resendConfig.domainId}:${resendConfig.domain}`,
    );
    expect(fetch.mock.calls[0][0]).toBe(`https://api.resend.com/domains/${resendConfig.domainId}`);
    for (const patch of [
      { name: "other.example.com" },
      { id: incidentId },
      { status: "pending" },
      { capabilities: { sending: "disabled" } },
    ]) {
      fetch.mockResolvedValueOnce(Response.json({ ...domain(), ...patch }));
      const result = await f.adapter.probeCredential(f.connection, {
        ...f.context,
        credentialLease: lease(f.adapter).value,
      });
      expect(result).toMatchObject({ status: "unavailable", providerSubject: null });
    }
    fetch.mockResolvedValueOnce(
      Response.json(
        { name: "restricted_api_key", message: "requires full access" },
        { status: 401 },
      ),
    );
    expect(
      await f.adapter.probeCredential(f.connection, {
        ...f.context,
        credentialLease: lease(f.adapter).value,
      }),
    ).toMatchObject({ status: "unavailable", providerSubject: null });
  });

  it("sends only canonical plain Incident metadata to the frozen Slack channel with markup and previews disabled", async () => {
    const f = await fixture("slack");
    expect(await f.send()).toEqual({
      state: "confirmed",
      providerMessageId: `${slackConfig.channelId}:1729737747.123456`,
    });
    const [url, init] = f.fetch.mock.calls[0];
    expect(url).toBe("https://slack.com/api/chat.postMessage");
    expect(init).toMatchObject({
      method: "POST",
      redirect: "error",
      credentials: "omit",
      cache: "no-store",
    });
    if (typeof init?.body !== "string") throw new Error("Expected JSON request body");
    const body: unknown = JSON.parse(init.body);
    expect(body).toMatchObject({
      channel: slackConfig.channelId,
      mrkdwn: false,
      parse: "none",
      link_names: false,
      unfurl_links: false,
      unfurl_media: false,
    });
    expect(init.body).toContain(incidentId);
    for (const privateValue of [
      sourceId,
      "recipientFingerprint",
      "test-only-secret",
      "provider echo not retained",
    ])
      expect(init.body).not.toContain(privateValue);
    expect(f.credential.bytes.every((byte) => byte === 0)).toBe(true);
    const injected = await fixture("slack");
    injected.input.payloadRedacted.summary = "<!channel> <@U111> https://evil.invalid";
    expect(await injected.send()).toMatchObject({ state: "permanent_failure" });
    expect(injected.fetch).not.toHaveBeenCalled();
    expect(injected.credential.use).not.toHaveBeenCalled();
  });

  it("sends one Resend recipient with plain text, a fixed subject and no headers, HTML, attachments or idempotency promise", async () => {
    const f = await fixture("resend");
    expect(await f.send()).toEqual({ state: "confirmed", providerMessageId: messageId });
    const [url, init] = f.fetch.mock.calls[0];
    expect(url).toBe("https://api.resend.com/emails");
    if (typeof init?.body !== "string") throw new Error("Expected JSON request body");
    const body: unknown = JSON.parse(init.body);
    expect(body).toEqual({
      from: resendConfig.from,
      to: [resendConfig.to],
      subject: "NexPress Incident notification",
      text: expect.stringContaining("Incident opened."),
    });
    expect(new Headers(init?.headers).has("Idempotency-Key")).toBe(false);
    expect(f.credential.bytes.every((byte) => byte === 0)).toBe(true);
  });

  it("recognizes explicit documented rejections without treating server errors or contradictory acknowledgements as not sent", async () => {
    const slackFetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(Response.json({ ok: false, error: "channel_not_found" }));
    const slack = await fixture("slack", slackFetch);
    expect(await slack.send()).toMatchObject({
      state: "permanent_failure",
      errorCode: "SLACK_REQUEST_REJECTED",
    });
    const cases: Array<["slack" | "resend", Response, string]> = [
      [
        "slack",
        Response.json({ ok: false, error: "ratelimited" }, { status: 429 }),
        "retryable_not_sent",
      ],
      [
        "slack",
        Response.json({ ok: false, error: "internal_error" }, { status: 503 }),
        "ambiguous",
      ],
      [
        "slack",
        Response.json({ ok: true, channel: "COTHER", ts: "1729737747.123456" }),
        "ambiguous",
      ],
      [
        "slack",
        Response.json({ ok: false, error: "channel_not_found", ts: "1729737747.123456" }),
        "ambiguous",
      ],
      [
        "resend",
        Response.json(
          { name: "validation_error", statusCode: 400, message: "private recipient details" },
          { status: 400 },
        ),
        "permanent_failure",
      ],
      [
        "resend",
        Response.json({ name: "rate_limit_exceeded", message: "private account" }, { status: 429 }),
        "retryable_not_sent",
      ],
      [
        "resend",
        Response.json({ name: "application_error", message: "private fault" }, { status: 500 }),
        "ambiguous",
      ],
      [
        "resend",
        Response.json(
          { name: "validation_error", statusCode: 403, message: "conflicting status" },
          { status: 400 },
        ),
        "ambiguous",
      ],
      ["resend", Response.json({ id: messageId, error: "contradiction" }), "ambiguous"],
      [
        "resend",
        Response.json({ name: "new_unknown_error", message: "private fault" }, { status: 403 }),
        "ambiguous",
      ],
    ];
    for (const [kind, response, state] of cases) {
      const f = await fixture(kind, vi.fn<typeof globalThis.fetch>().mockResolvedValue(response));
      const result = await f.send();
      expect(result.state).toBe(state);
      expect(JSON.stringify(result)).not.toContain("private");
      expect(f.fetch).toHaveBeenCalledTimes(1);
      expect(f.credential.bytes.every((byte) => byte === 0)).toBe(true);
    }
  });

  it("keeps network loss, redirects, malformed and oversized streamed responses ambiguous and never retries internally", async () => {
    const streamCancel = vi.fn();
    const tooLarge = new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(new Uint8Array(65537));
        },
        cancel: streamCancel,
      }),
      { headers: { "content-type": "application/json" } },
    );
    const cases: Array<() => Promise<Response>> = [
      () => Promise.reject(new Error("secret network exception")),
      () =>
        Promise.resolve(
          new Response("{}", {
            status: 302,
            headers: { location: "https://attacker.invalid", "content-type": "application/json" },
          }),
        ),
      () =>
        Promise.resolve(
          new Response("broken", { headers: { "content-type": "application/json" } }),
        ),
      () =>
        Promise.resolve(
          new Response("{}", {
            headers: { "content-type": "application/json", "content-length": "65537" },
          }),
        ),
      () => Promise.resolve(tooLarge),
    ];
    for (const returned of cases) {
      const f = await fixture(
        "slack",
        vi.fn<typeof globalThis.fetch>().mockImplementation(returned),
      );
      const result = await f.send();
      expect(result).toEqual({ state: "ambiguous", errorCode: "NOTIFICATION_OUTCOME_UNKNOWN" });
      expect(f.fetch).toHaveBeenCalledTimes(1);
      expect(f.credential.bytes.every((byte) => byte === 0)).toBe(true);
      expect(JSON.stringify(result)).not.toContain("secret");
    }
    expect(streamCancel).toHaveBeenCalledOnce();
  });

  it("distinguishes cancellation before dispatch from an abort while fetch or its body is pending", async () => {
    const before = await fixture("slack");
    before.controller.abort();
    expect(await before.send()).toMatchObject({
      state: "retryable_not_sent",
      errorCode: "NOTIFICATION_ABORTED_BEFORE_DISPATCH",
    });
    expect(before.fetch).not.toHaveBeenCalled();
    expect(before.credential.use).not.toHaveBeenCalled();
    for (const bodyPending of [false, true]) {
      const cancel = vi.fn();
      const response = new Response(new ReadableStream({ cancel }), {
        headers: { "content-type": "application/json" },
      });
      const fetch = vi
        .fn<typeof globalThis.fetch>()
        .mockImplementation(() =>
          bodyPending ? Promise.resolve(response) : new Promise(() => undefined),
        );
      const f = await fixture("slack", fetch);
      const pending = f.send();
      await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
      f.controller.abort();
      expect(await pending).toMatchObject({ state: "ambiguous" });
      expect(f.credential.bytes.every((byte) => byte === 0)).toBe(true);
      if (bodyPending) expect(cancel).toHaveBeenCalledOnce();
    }
  });

  it("refuses mismatched adapter/credential identities before network and erases rejected secret copies", async () => {
    const f = await fixture("slack");
    const credential = lease(f.adapter, { adapterFingerprint: `cj1:sha256:${"B".repeat(43)}` });
    expect(
      await f.adapter.notification!.send(f.input, {
        ...f.context,
        credentialLease: credential.value,
      }),
    ).toMatchObject({ state: "permanent_failure" });
    expect(f.fetch).not.toHaveBeenCalled();
    expect(credential.bytes.every((byte) => byte === 0)).toBe(true);
    f.connection.adapterId = "other.adapter";
    expect(await f.send()).toMatchObject({ state: "permanent_failure" });
    expect(f.credential.use).not.toHaveBeenCalled();
    const malformed = await fixture("resend");
    malformed.credential.bytes[0] = 255;
    expect(await malformed.send()).toMatchObject({ state: "permanent_failure" });
    expect(malformed.fetch).not.toHaveBeenCalled();
    expect(malformed.credential.bytes.every((byte) => byte === 0)).toBe(true);
    const unavailable = await fixture("resend");
    unavailable.credential.use.mockRejectedValueOnce(new Error("private vault error"));
    expect(await unavailable.send()).toEqual({
      state: "retryable_not_sent",
      errorCode: "NOTIFICATION_CREDENTIAL_UNAVAILABLE",
    });
    expect(unavailable.fetch).not.toHaveBeenCalled();
  });

  it("preserves the preview effect guard for both probes and sends", async () => {
    const preview = await previewFixture();
    for (const kind of ["slack", "resend"] as const) {
      const f = await fixture(kind);
      await withAgentChangeSetPreview(preview, async () => {
        await expect(f.send()).rejects.toThrow("Effects are unavailable");
        await expect(f.adapter.probeCredential(f.connection, f.context)).rejects.toThrow(
          "Effects are unavailable",
        );
      });
      expect(f.fetch).not.toHaveBeenCalled();
      expect(f.credential.use).not.toHaveBeenCalled();
    }
  });
});
