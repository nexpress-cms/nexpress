import { describe, expect, it } from "vitest";

import { buildPayload, signPayload, webhookRelayPlugin } from "./index.js";

describe("webhook-relay", () => {
  it("builds a compact lifecycle payload", () => {
    expect(
      buildPayload("content:afterUpdate", {
        collection: "posts",
        doc: { id: "post-1", status: "published", title: "Ignored" },
      }),
    ).toMatchObject({
      event: "content:afterUpdate",
      collection: "posts",
      documentId: "post-1",
      status: "published",
    });
  });

  it("signs payloads deterministically", () => {
    const payload = {
      event: "test",
      collection: "posts",
      documentId: "1",
      status: "published",
      at: "2026-05-22T00:00:00.000Z",
    };

    expect(signPayload(payload, "secret")).toBe(signPayload(payload, "secret"));
    expect(signPayload(payload, "secret")).not.toBe(signPayload(payload, "other"));
  });

  it("declares wildcard outbound hosts for operator-configured endpoints", () => {
    expect(webhookRelayPlugin.manifest.allowedHosts).toEqual(["*"]);
  });
});
