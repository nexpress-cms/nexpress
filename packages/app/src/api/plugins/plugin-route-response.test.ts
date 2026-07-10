import { describe, expect, it } from "vitest";
import { npCreatePluginApiRouteResponse } from "./plugin-route-response";

describe("npCreatePluginApiRouteResponse", () => {
  it("serializes ordinary route results as JSON", async () => {
    const response = npCreatePluginApiRouteResponse(
      { status: 201, body: { created: true }, headers: { "x-plugin": "example" } },
      "POST",
    );

    expect(response.status).toBe(201);
    expect(response.headers.get("x-plugin")).toBe("example");
    await expect(response.json()).resolves.toEqual({ created: true });
  });

  it("does not serialize a body for no-body statuses", async () => {
    const response = npCreatePluginApiRouteResponse({ status: 204 }, "POST");

    expect(response.status).toBe(204);
    await expect(response.text()).resolves.toBe("");
  });

  it("strips the response body from HEAD requests", async () => {
    const response = npCreatePluginApiRouteResponse(
      { status: 200, body: { ignored: true }, headers: { "x-plugin": "example" } },
      "HEAD",
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("x-plugin")).toBe("example");
    await expect(response.text()).resolves.toBe("");
  });
});
