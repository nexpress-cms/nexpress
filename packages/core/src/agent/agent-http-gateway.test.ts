import { NpAgentGatewayError } from "./admin-admission.js";
import type { NpAgentAuthenticatedServicePrincipalV1 } from "./gateway-service.js";
import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  createAgentHttpGatewayV1,
  type NpAgentHttpGatewayOptionsV1,
} from "./agent-http-gateway.js";
import { npAgentReadCapabilityDescriptorsV1 } from "../agent-contract/read-capability-contract.js";

function fixture() {
  const authentication = {
    principal: { siteId: "default", id: "00000000-0000-4000-8000-000000000001" },
    serviceToken: { transport: "agent-http", audience: "https://example.test/api/agent/v1" },
    authorizationContext: { transport: "agent-api" },
    scopes: ["site:read", "changeset:read"],
  } as unknown as NpAgentAuthenticatedServicePrincipalV1;
  const gateway = { authenticateTransportServiceToken: vi.fn().mockResolvedValue(authentication) };
  const admission = {
    project: vi.fn().mockResolvedValue({
      entries: [{ definition: { descriptor: npAgentReadCapabilityDescriptorsV1["site.inspect"] } }],
    }),
    invoke: vi.fn(),
  };
  const options = { gateway, admission } as unknown as NpAgentHttpGatewayOptionsV1;
  return { authentication, gateway, admission, options, http: createAgentHttpGatewayV1(options) };
}
describe("Agent HTTP shared gateway", () => {
  it("uses only credential-selected agent-http authority and canonical origin", async () => {
    const f = fixture();
    await expect(
      f.http.authenticate({
        authorization: "bEaReR credential",
        requestUrl: "https://example.test/api/agent/v1/capabilities",
        host: "example.test",
      }),
    ).resolves.toBe(f.authentication);
    expect(f.gateway.authenticateTransportServiceToken).toHaveBeenCalledWith({
      credential: "credential",
      transport: "agent-http",
    });
    for (const authorization of [
      null,
      "Basic secret",
      "Bearer a,b",
      "Bearer a b",
      "Bearer \tsecret",
    ])
      await expect(
        f.http.authenticate({
          authorization,
          requestUrl: "https://example.test/api/agent/v1/capabilities",
        }),
      ).rejects.toMatchObject({ status: 401 });
    for (const extra of [
      { requestUrl: "https://other.test/api/agent/v1/capabilities" },
      { origin: "https://other.test" },
      { host: "other.test" },
      { requestUrl: "https://example.test/api/agent/v1/capabilities?siteId=other" },
    ])
      await expect(
        f.http.authenticate({
          authorization: "Bearer credential",
          requestUrl: "https://example.test/api/agent/v1/capabilities",
          ...extra,
        }),
      ).rejects.toMatchObject({ status: 403 });
  });
  it("returns safe404 for a verified credential whose exposure is disabled and401 for unknown credentials", async () => {
    const f = fixture();
    f.gateway.authenticateTransportServiceToken.mockRejectedValue(
      new NpAgentGatewayError("GATEWAY_EXPOSURE_DENIED", 403, "private"),
    );
    await expect(
      f.http.authenticate({
        authorization: "Bearer credential",
        requestUrl: "https://example.test/api/agent/v1/previews/unknown/artifacts/unknown",
      }),
    ).rejects.toMatchObject({ status: 404 });
    f.gateway.authenticateTransportServiceToken.mockRejectedValue(
      new NpAgentGatewayError("SERVICE_TOKEN_INVALID", 401, "private"),
    );
    await expect(
      f.http.authenticate({
        authorization: "Bearer credential",
        requestUrl: "https://example.test/api/agent/v1/capabilities",
      }),
    ).rejects.toMatchObject({ status: 401 });
  });
  it("cannot invoke a known hidden capability and rechecks live projection", async () => {
    const f = fixture();
    expect((await f.http.capabilities(f.authentication)).capabilities.map((d) => d.id)).toEqual([
      "site.inspect",
    ]);
    await expect(
      f.http.invoke(f.authentication, {
        schemaVersion: "np.agent-invocation-request.v1",
        capabilityId: "schema.get",
        arguments: { input: { selector: "catalog" }, idempotencyKey: null },
      }),
    ).rejects.toMatchObject({ status: 404 });
    expect(f.admission.invoke).not.toHaveBeenCalled();
    f.admission.project.mockRejectedValue(new Error("private"));
    await expect(f.http.capabilities(f.authentication)).rejects.toThrow();
  });
  it("returns one unavailable result for absent run and artifact facades", async () => {
    const f = fixture();
    const id = "00000000-0000-4000-8000-000000000001";
    for (const runId of [id, "bad"])
      await expect(f.http.getRun(f.authentication, runId)).rejects.toMatchObject({ status: 404 });
    for (const previewId of [id, "bad"])
      await expect(f.http.readArtifact(f.authentication, previewId, id)).rejects.toMatchObject({
        status: 404,
      });
  });
  it("validates host artifact bytes and rechecks authority after the shared read", async () => {
    const f = fixture();
    const bytes = new TextEncoder().encode("{}");
    const id = "00000000-0000-4000-8000-000000000001";
    const readArtifact = vi.fn().mockResolvedValue({
      kind: "ok",
      bytes,
      mime: "application/json",
      contentDigest: `ac1:sha256:${createHash("sha256").update(bytes).digest("base64url")}`,
      expiresAt: "2099-01-01T00:00:00.000Z",
    });
    const http = createAgentHttpGatewayV1({ ...f.options, artifacts: { readArtifact } });
    await expect(http.readArtifact(f.authentication, id, id)).resolves.toEqual({
      bytes,
      mime: "application/json",
    });
    expect(f.admission.project).toHaveBeenCalledTimes(2);
    f.admission.project
      .mockImplementationOnce(() => Promise.resolve({ entries: [] }))
      .mockImplementationOnce(() => {
        bytes[0] = 0;
        return Promise.resolve({ entries: [] });
      });
    const snapshot = await http.readArtifact(f.authentication, id, id);
    expect(snapshot.bytes).toEqual(new TextEncoder().encode("{}"));

    readArtifact.mockResolvedValue({
      kind: "ok",
      bytes,
      mime: "text/html",
      contentDigest: "private",
      expiresAt: "2099-01-01T00:00:00.000Z",
    });
    await expect(http.readArtifact(f.authentication, id, id)).rejects.toMatchObject({
      status: 500,
    });
  });
});
