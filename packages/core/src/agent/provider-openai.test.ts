import { describe, expect, it, vi } from "vitest";
import { createAgentOpenAIProviderAdapterV1 } from "./provider-openai.js";
import { createAgentProviderInferenceRuntimeV1 } from "./provider-inference.js";
import {
  NpAgentConnectionAuthAdapterRegistryV1,
  npParseAgentProviderConnectionConfigV1,
} from "./provider-auth-contract.js";
import { providerInput, providerRequest } from "./provider-inference-fixture.js";

const result = () => ({
  id: "resp_test",
  model: "gpt-5",
  status: "completed",
  output: [
    { type: "reasoning", summary: [{ text: "never retain reasoning" }] },
    {
      type: "message",
      role: "assistant",
      content: [
        {
          type: "output_text",
          text: JSON.stringify({
            task: "interactive-capability",
            decision: { kind: "complete", summary: "Done" },
          }),
        },
      ],
    },
  ],
  usage: { input_tokens: 10, input_tokens_details: { cached_tokens: 0 }, output_tokens: 2 },
});
function fixture(
  fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(Response.json(result())),
) {
  const adapter = createAgentOpenAIProviderAdapterV1({
    pricingCatalog: [providerRequest().pricing],
    fetch,
  });
  const registry = new NpAgentConnectionAuthAdapterRegistryV1().register(adapter);
  return {
    adapter,
    fetch,
    input: providerInput(adapter),
    runtime: createAgentProviderInferenceRuntimeV1({ registry }),
  };
}
describe("OpenAI reference provider", () => {
  it("projects only admitted prompt data to the fixed endpoint and normalizes exact usage", async () => {
    const f = fixture();
    const response = await f.runtime.invoke(f.input);
    expect(response.outcome).toMatchObject({
      status: "succeeded",
      usage: { costMicros: 33, tokenSource: "provider", costSource: "adapter-estimate" },
    });
    expect(f.fetch).toHaveBeenCalledTimes(1);
    const [url, init] = f.fetch.mock.calls[0];
    expect(url).toBe("https://api.openai.com/v1/responses");
    expect(init).toMatchObject({ redirect: "error", credentials: "omit", cache: "no-store" });
    if (typeof init?.body !== "string") throw new Error("Expected JSON request body");
    const serialized = init.body;
    const body = JSON.parse(serialized);
    expect(body).toMatchObject({
      store: false,
      stream: false,
      background: false,
      text: { format: { type: "json_object" } },
    });
    for (const privateValue of [
      f.input.request.siteId,
      f.input.request.runId,
      f.input.request.providerCallId,
      f.input.request.connection.secretVersionId,
      f.input.request.instruction.digest,
      f.input.request.pricing.pricingId,
      "runtime.classifier",
      "test-only-openai-key",
    ]) {
      expect(serialized).not.toContain(privateValue);
    }
    expect(body).not.toHaveProperty("tools");
    expect(JSON.stringify(response)).not.toContain("never retain reasoning");
  });
  it.each([
    "malformed-json",
    "schema",
    "negative-usage",
    "model",
    "tool",
    "large",
    "network",
    "server",
  ])("keeps %s outcomes ambiguous with no replay", async (mode) => {
    const value = result();

    if (mode === "schema")
      value.output[1].content![0].text = JSON.stringify({
        task: "interactive-capability",
        decision: { kind: "complete", summary: "Done", extra: true },
      });
    if (mode === "negative-usage") value.usage.input_tokens = -1;
    if (mode === "model") value.model = "other";
    if (mode === "tool") value.output = [{ type: "function_call" } as never];
    const returned =
      mode === "malformed-json"
        ? new Response("broken", { headers: { "content-type": "application/json" } })
        : mode === "large"
          ? new Response("{}", {
              headers: { "content-type": "application/json", "content-length": "999999999" },
            })
          : mode === "server"
            ? new Response("sensitive server failure", { status: 503 })
            : Response.json(value);
    const fetch =
      mode === "network"
        ? vi.fn<typeof globalThis.fetch>().mockRejectedValue(new Error("secret provider body"))
        : vi.fn<typeof globalThis.fetch>().mockResolvedValue(returned);
    const f = fixture(fetch);
    const response = await f.runtime.invoke(f.input);
    expect(response.outcome).toMatchObject({
      status: "ambiguous",
      safeCode: "PROVIDER_OUTCOME_UNKNOWN",
      retryable: false,
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(response)).not.toContain("secret provider body");
  });
  it.each([401, 403, 429, 400])("returns bounded no-retry HTTP %i failures", async (status) => {
    const f = fixture(
      vi
        .fn<typeof globalThis.fetch>()
        .mockResolvedValue(new Response("private provider body", { status })),
    );
    const response = await f.runtime.invoke(f.input);
    expect(response.outcome).toMatchObject({
      status: "failed",
      retryable: false,
      dispatchState: "dispatched",
      usage: null,
    });
    expect(JSON.stringify(response)).not.toContain("private provider body");
  });
  it("fails the conservative input ceiling before using credentials or transport", async () => {
    const f = fixture();
    f.input.request.limits.maxInputTokens = 1;
    const use = vi.spyOn(f.input.credentialLease, "use");
    expect((await f.runtime.invoke(f.input)).outcome).toMatchObject({
      status: "failed",
      dispatchState: "not-dispatched",
    });
    expect(use).not.toHaveBeenCalled();
    expect(f.fetch).not.toHaveBeenCalled();
  });
  it("preserves explicit model/config pricing and probes only a verified configured model", async () => {
    const f = fixture(
      vi
        .fn<typeof globalThis.fetch>()
        .mockResolvedValue(
          Response.json(
            { id: "gpt-5", object: "model" },
            { headers: { "openai-organization": "org_test" } },
          ),
        ),
    );
    const parsed = await npParseAgentProviderConnectionConfigV1({
      adapter: f.adapter,
      siteId: f.input.request.siteId,
      connectionId: f.input.request.connection.id,
      kind: "model",
      provider: "openai",
      authKind: "api_key",
      configVersion: 1,
      config: { modelId: "gpt-5" },
      dataProcessingCeiling: "internal-redacted",
    });
    expect(parsed.configHash).toMatch(/^cj1:sha256:/u);
    const probed = await f.adapter.probeCredential(parsed, {
      credentialLease: f.input.credentialLease,
      signal: new AbortController().signal,
    });
    expect(probed.status).toBe("ready");
    expect(new TextDecoder().decode(probed.providerSubject!)).not.toContain("test-only-openai-key");
    expect(f.fetch.mock.calls[0][0]).toBe("https://api.openai.com/v1/models/gpt-5");
    expect(() =>
      f.adapter.parseConfig({
        schemaVersion: "np.agent-connection-config-parse.v1",
        connectionId: f.input.request.connection.id,
        configVersion: 1,
        config: { modelId: "uninstalled" },
      }),
    ).toThrow();
  });
  it("does not claim an account when authenticated organization evidence is absent", async () => {
    const f = fixture(
      vi
        .fn<typeof globalThis.fetch>()
        .mockResolvedValue(Response.json({ id: "gpt-5", object: "model" })),
    );
    const result = await f.adapter.probeCredential(f.input.connection, {
      credentialLease: f.input.credentialLease,
      signal: new AbortController().signal,
    });
    expect(result).toMatchObject({ status: "unavailable", providerSubject: null });
  });
});
