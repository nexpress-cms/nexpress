import { describe, expect, it } from "vitest";
import { equalPreviewLaunchCsrfToken, readAgentPreviewLaunchForm } from "./preview-launch-form";
const id = "10000000-0000-4000-8000-000000000001";
const path = `/api/admin/agents/changesets/${id}/previews/${id}/launch`;
function request(
  body = new URLSearchParams({
    command: JSON.stringify({ idempotencyKey: id, expectedVersion: 1 }),
    csrfToken: "test-csrf",
  }).toString(),
  headers: Record<string, string> = {},
  target = path,
) {
  return new Request(`https://site.example${target}`, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      origin: "https://site.example",
      "sec-fetch-site": "same-origin",
      ...headers,
    },
    body,
  });
}
describe("native preview launch form encoding", () => {
  it("preserves the existing command and compares staff tokens", async () => {
    expect(await readAgentPreviewLaunchForm(request())).toEqual({
      command: { idempotencyKey: id, expectedVersion: 1 },
      csrfToken: "test-csrf",
    });
    expect(equalPreviewLaunchCsrfToken("test-csrf", "test-csrf")).toBe(true);
    expect(equalPreviewLaunchCsrfToken(undefined, "")).toBe(false);
    expect(equalPreviewLaunchCsrfToken("test-csrf", "test-csre")).toBe(false);
  });
  it("rejects cross-origin, same-site, null Origin and duplicate/extra/oversize fields", async () => {
    const hostileHeaders: Array<Record<string, string>> = [
      { origin: "null" },
      { origin: "https://evil.example" },
      { "sec-fetch-site": "same-site" },
    ];
    for (const headers of hostileHeaders)
      await expect(readAgentPreviewLaunchForm(request(undefined, headers))).rejects.toThrow();
    for (const body of [
      "command={}&csrfToken=a&csrfToken=b",
      "command={}&csrfToken=a&extra=x",
      "command={}&csrfToken=" + "x".repeat(40000),
    ])
      await expect(readAgentPreviewLaunchForm(request(body))).rejects.toThrow();
    await expect(
      readAgentPreviewLaunchForm(request(undefined, {}, "/api/admin/agents/changesets")),
    ).rejects.toThrow();
  });
});
