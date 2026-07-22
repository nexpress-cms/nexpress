import { describe, expect, it } from "vitest";

import {
  evaluateSiteQuotaObservations,
  selectSiteQuotaDocumentTables,
} from "./site-quota-check.js";

describe("site quota operations check", () => {
  it("reports unlimited defaults as ready", () => {
    expect(evaluateSiteQuotaObservations([])).toEqual(
      expect.objectContaining({ id: "sites.quotas", state: "ok" }),
    );
  });

  it("warns when a configured site is at capacity", () => {
    expect(
      evaluateSiteQuotaObservations([
        {
          siteId: "tenant-a",
          limits: { storageBytes: 10, documents: 2, jobEnqueuesPerHour: null },
          storageBytes: 9,
          documents: 2,
          jobEnqueuesLastHour: null,
        },
      ]),
    ).toEqual(
      expect.objectContaining({
        id: "sites.quotas",
        state: "warn",
        detail: expect.stringContaining("tenant-a"),
      }),
    );
  });

  it("fails closed when an enforced job window cannot be measured", () => {
    expect(
      evaluateSiteQuotaObservations([
        {
          siteId: "tenant-a",
          limits: { storageBytes: null, documents: null, jobEnqueuesPerHour: 10 },
          storageBytes: 0,
          documents: 0,
          jobEnqueuesLastHour: null,
        },
      ]),
    ).toEqual(expect.objectContaining({ id: "sites.quotas", state: "error" }));
  });

  it("counts only canonical collection main tables", () => {
    expect(
      selectSiteQuotaDocumentTables([
        "np_c_posts",
        "np_c_posts__categories",
        "np_c_forum-posts",
        "np_settings",
      ]),
    ).toEqual(["np_c_posts", "np_c_forum-posts"]);
    expect(() => selectSiteQuotaDocumentTables(["np_c_Broken"])).toThrow(
      "Unsafe collection table name",
    );
  });
});
