import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as CoreModule from "@nexpress/core";

import { npRequireI18nStringsResponse } from "@nexpress/core/i18n-contract";

const mocks = vi.hoisted(() => ({
  ensureFor: vi.fn(() => Promise.resolve()),
  requireAuth: vi.fn(() =>
    Promise.resolve({ id: "01234567-89ab-4def-8abc-0123456789ab", role: "admin" }),
  ),
  can: vi.fn(() => true),
  readJsonBody: vi.fn<() => Promise<unknown>>(() => Promise.resolve({})),
  setStringOverride: vi.fn(() => Promise.resolve()),
  deleteStringOverride: vi.fn(() => Promise.resolve()),
}));

vi.mock("@nexpress/core", async (importOriginal) => ({
  ...(await importOriginal<typeof CoreModule>()),
  can: mocks.can,
  getCurrentSiteId: () => Promise.resolve("default"),
  getI18nConfig: () => ({ locales: ["en", "ko"], defaultLocale: "en" }),
  getAllStrings: () => ({
    en: { title: "Title" },
    ko: { title: "제목" },
  }),
  listStringOverridesForSite: () =>
    Promise.resolve([
      {
        siteId: "default",
        locale: "ko",
        key: "title",
        value: "새 제목",
        updatedAt: new Date("2026-07-15T00:00:00.000Z"),
        updatedBy: null,
      },
    ]),
  setStringOverride: mocks.setStringOverride,
  deleteStringOverride: mocks.deleteStringOverride,
}));
vi.mock("@nexpress/next", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  readJsonBody: mocks.readJsonBody,
}));
vi.mock("../../../../lib/auth-helpers", () => ({ requireAuth: mocks.requireAuth }));
vi.mock("../../../../lib/init-core", () => ({ ensureFor: mocks.ensureFor }));

const { DELETE, GET, PUT } = await import("./route.js");

describe("admin i18n strings API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.can.mockReturnValue(true);
  });

  it("returns the exact shared Admin catalog", async () => {
    const response = await GET({} as never);
    const payload = npRequireI18nStringsResponse(await response.json());

    expect(response.status).toBe(200);
    expect(payload).toEqual({
      locales: ["en", "ko"],
      defaultLocale: "en",
      siteId: "default",
      keys: [
        {
          key: "title",
          values: {
            en: { base: "Title", override: null },
            ko: { base: "제목", override: "새 제목" },
          },
        },
      ],
    });
  });

  it("rejects unknown fields and malformed ICU before persistence", async () => {
    mocks.readJsonBody.mockResolvedValueOnce({
      locale: "en",
      key: "title",
      value: "Title",
      extra: true,
    });
    expect((await PUT({} as never)).status).toBe(400);

    mocks.readJsonBody.mockResolvedValueOnce({
      locale: "en",
      key: "title",
      value: "{count, plural,",
    });
    expect((await PUT({} as never)).status).toBe(400);
    expect(mocks.setStringOverride).not.toHaveBeenCalled();
  });

  it("rejects unregistered keys and persists a valid override", async () => {
    mocks.readJsonBody.mockResolvedValueOnce({
      locale: "en",
      key: "orphan",
      value: "Orphan",
    });
    expect((await PUT({} as never)).status).toBe(400);

    mocks.readJsonBody.mockResolvedValueOnce({
      locale: "ko",
      key: "title",
      value: "{count, plural, other {제목 #개}}",
    });
    expect((await PUT({} as never)).status).toBe(200);
    expect(mocks.setStringOverride).toHaveBeenCalledWith(
      "ko",
      "title",
      "{count, plural, other {제목 #개}}",
      { updatedBy: "01234567-89ab-4def-8abc-0123456789ab" },
    );
  });

  it("rejects unknown or duplicate delete query parameters", async () => {
    const duplicate = new URLSearchParams("locale=en&locale=ko&key=title");
    expect((await DELETE({ nextUrl: { searchParams: duplicate } } as never)).status).toBe(400);

    const unknown = new URLSearchParams("locale=en&key=title&extra=1");
    expect((await DELETE({ nextUrl: { searchParams: unknown } } as never)).status).toBe(400);
    expect(mocks.deleteStringOverride).not.toHaveBeenCalled();
  });
});
