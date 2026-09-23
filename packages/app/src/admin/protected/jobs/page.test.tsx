import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { ensure, verify, allowed, session } = vi.hoisted(() => {
  const session: { token: string | undefined } = { token: "test-token" };
  return { ensure: vi.fn(), verify: vi.fn(), allowed: vi.fn(), session };
});
vi.mock("@nexpress/admin/client", () => ({
  JobsView: ({ queueName }: { queueName?: string }) => <div>Queue: {queueName ?? "all"}</div>,
}));
vi.mock("@nexpress/core/auth", () => ({ can: allowed, verifyTokenFull: verify }));
vi.mock("@nexpress/core/search", () => ({ getSearchCollectionLabels: () => ({}) }));
vi.mock("next/headers", () => ({
  cookies: () =>
    Promise.resolve({ get: () => (session.token ? { value: session.token } : undefined) }),
}));
vi.mock("next/navigation", () => ({
  redirect: (path: string) => {
    throw new Error(`redirect:${path}`);
  },
}));
vi.mock("../../../lib/init-core", () => ({ ensureFor: ensure }));
vi.mock("../../../lib/auth-helpers", () => ({
  getAuthRuntimeConfig: () => ({ secret: "test-secret" }),
}));
vi.mock("../../../lib/db", () => ({ getDb: () => ({}) }));
import JobsPage from "./page.js";

beforeEach(() => {
  vi.clearAllMocks();
  session.token = "test-token";
  verify.mockResolvedValue({ id: "admin" });
  allowed.mockReturnValue(true);
});

describe("Jobs page investigation", () => {
  it("validates exact queue names without broadening invalid filters or installing producers", async () => {
    expect(
      renderToStaticMarkup(
        await JobsPage({ searchParams: Promise.resolve({ name: "agent.runExecute" }) }),
      ),
    ).toContain("Queue: agent.runExecute");
    expect(renderToStaticMarkup(await JobsPage({ searchParams: Promise.resolve({}) }))).toContain(
      "Queue: all",
    );
    for (const name of [
      "",
      "private-token\ninvalid",
      ["agent.runExecute", "agent.eventDispatch"],
    ]) {
      const html = renderToStaticMarkup(
        await JobsPage({ searchParams: Promise.resolve({ name }) }),
      );
      expect(html).toContain("The queue filter is invalid");
      expect(html).not.toContain("Queue:");
      expect(html).not.toContain("private-token");
    }
    expect(ensure.mock.calls.every(([intent]) => intent === "read")).toBe(true);
  });

  it("gates the Jobs client behind existing admin capability and authenticated session", async () => {
    allowed.mockReturnValue(false);
    expect(renderToStaticMarkup(await JobsPage({ searchParams: Promise.resolve({}) }))).toContain(
      "You need admin.manage",
    );
    expect(allowed).toHaveBeenCalledWith({ id: "admin" }, "admin.manage");
    verify.mockResolvedValue(null);
    await expect(JobsPage({ searchParams: Promise.resolve({}) })).rejects.toThrow(
      "redirect:/admin/login",
    );
    session.token = undefined;
    await expect(JobsPage({ searchParams: Promise.resolve({}) })).rejects.toThrow(
      "redirect:/admin/login",
    );
  });
});
