import { describe, expect, it } from "vitest";

import { npReadPluginApiRawBody } from "./plugin-route-request.js";

const encoder = new TextEncoder();

function request(body?: BodyInit, headers?: HeadersInit): Request {
  return new Request("http://localhost/api/plugins/payments/webhook", {
    method: "POST",
    body,
    headers,
  });
}

describe("plugin API raw request bodies", () => {
  it("preserves the exact signed bytes without JSON normalization", async () => {
    const source = '{\n  "event": "paid", "id": 7\n}\n';
    const expected = encoder.encode(source);

    const actual = await npReadPluginApiRawBody(
      request(source, {
        "content-type": "application/json; charset=utf-8",
        "content-length": expected.byteLength.toString(),
      }),
    );

    expect(actual).toEqual(expected);
    expect(new TextDecoder().decode(actual)).toBe(source);
  });

  it("allows an exact empty callback body", async () => {
    await expect(
      npReadPluginApiRawBody(request(undefined, { "content-length": "0" })),
    ).resolves.toEqual(new Uint8Array());
  });

  it.each([
    ["01", "", "Content-Length must be a canonical non-negative integer"],
    ["3", "{}", "Content-Length does not match the received request body"],
    [(1024 * 1024 + 1).toString(), "", "Request body exceeds 1048576 bytes"],
  ])("rejects invalid declared length %s", async (contentLength, body, message) => {
    await expect(
      npReadPluginApiRawBody(request(body, { "content-length": contentLength })),
    ).rejects.toMatchObject({
      errors: [{ field: "body", message }],
    });
  });

  it("bounds streamed bodies when Content-Length is absent", async () => {
    const body = new Uint8Array(1024 * 1024 + 1);
    await expect(npReadPluginApiRawBody(request(body))).rejects.toMatchObject({
      errors: [{ field: "body", message: "Request body exceeds 1048576 bytes" }],
    });
  });
});
