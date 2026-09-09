import { describe, expect, it, vi, beforeEach } from "vitest";
import { runAgentPreviewChecksV1, type NpAgentPreviewChecksInputV1 } from "./preview-checks.js";
import { npRequireAgentPreviewReportPartsV1 } from "../agent-contract/changeset-wire-contract.js";
import { serializeAgentCanonicalJson } from "../agent-contract/canonical-foundation.js";
import { checkPreviewExternalLink } from "./preview-link-check.js";
vi.mock("./preview-link-check.js", () => ({
  checkPreviewExternalLink: vi.fn(() => Promise.resolve("reachable")),
}));
const route = { route: "/", locale: null, audience: "public" as const };
const good =
  '<html lang="en"><head><title>Example</title><meta name="description" content="Example"></head><body><a href="/">Home</a><label for="name">Name</label><input id="name"><img alt=""></body></html>';
function input(html = good): NpAgentPreviewChecksInputV1 {
  return {
    identity: {
      siteId: "default",
      changeSetId: "00000000-0000-4000-8000-000000000001",
      previewId: "00000000-0000-4000-8000-000000000002",
      generation: 1,
      planHash: `cj1:sha256:${"a".repeat(43)}`,
      previewContractFingerprint: `cj1:sha256:${"b".repeat(43)}`,
      generatedAt: "2026-09-09T00:00:00.000Z",
    },
    routes: [route],
    routeManifest: [route],
    render: vi.fn(() => Promise.resolve(html)),
    productionOrigins: ["https://cms.example.com"],
    linkAllowlistOrigins: [],
    resolveRoute: vi.fn(() => Promise.resolve(true)),
    assertCurrentAuthority: vi.fn(async () => {}),
  };
}
beforeEach(() => vi.clearAllMocks());
describe("framework preview checks", () => {
  it("emits exact canonical sorted reports for all five checks", async () => {
    const reports = await runAgentPreviewChecksV1(input());
    expect(npRequireAgentPreviewReportPartsV1(reports)).toEqual(reports);
    expect(reports.flatMap((p) => p.results).map((r) => [r.checkId, r.status])).toEqual([
      ["accessibility", "pass"],
      ["broken-links", "pass"],
      ["metadata", "pass"],
      ["route-collision", "pass"],
      ["structured-data", "pass"],
    ]);
    expect(reports[0].issues).toEqual([]);
  });
  it("reports concrete structural findings without DOM text, URLs, IDs or script content", async () => {
    const options = input(
      '<html><head><title></title><script type="application/ld+json">{"secret":"private@example.com"}</script></head><body><a href="/private@example.com?token=secret">private@example.com</a><img id="secret"><input value="secret"><button> </button></body></html>',
    );
    options.routeManifest = [route, route];
    const reports = await runAgentPreviewChecksV1(options);
    expect(new Set(reports.flatMap((p) => p.issues).map((i) => i.code))).toEqual(
      new Set([
        "METADATA_MISSING",
        "STRUCTURED_DATA_INVALID",
        "ACCESSIBILITY_VIOLATION",
        "ROUTE_COLLISION",
        "ROUTE_NOT_FOUND",
      ]),
    );
    const serialized = serializeAgentCanonicalJson(reports);
    for (const forbidden of ["private@example.com", "secret", "token=", "<html>"])
      expect(serialized).not.toContain(forbidden);
  });
  it("uses the current route resolver after manifest matching, including locale", async () => {
    const options = input(good.replace('href="/"', 'href="/destination?secret=1#private"'));
    options.routes = [{ ...route, locale: "ko" }];
    options.routeManifest = [{ ...route, route: "/destination", locale: "ko" }];
    options.resolveRoute = vi.fn(() => Promise.resolve(false));
    const reports = await runAgentPreviewChecksV1(options);
    expect(options.resolveRoute).toHaveBeenCalledWith({
      route: "/destination",
      locale: "ko",
      audience: "public",
    });
    expect(reports[0].issues.some((i) => i.code === "ROUTE_NOT_FOUND")).toBe(true);
    expect(checkPreviewExternalLink).not.toHaveBeenCalled();
  });
  it.each([
    "https://reviewed.example.com/path?",
    "https://reviewed.example.com/path#",
    "http://reviewed.example.com/path",
    "https://reviewed.example.com/path?token=secret",
    "https://reviewed.example.com/path#secret",
    "https://user:secret@reviewed.example.com/path",
    "https://reviewed.example.com:444/path",
    "https://reviewed.example.com/%70ath",
    "//reviewed.example.com/path",
    "https://reviewed.example.com/../path",
    "javascript:alert(1)",
    "file:///etc/passwd",
    "data:text/html,private",
    "https://unreviewed.example.com/path",
    "https://reviewed.example.com\\@localhost/path",
  ])("never fetches unsafe/unreviewed destination %s", async (href) => {
    const options = input(good.replace('href="/"', `href="${href}"`));
    options.linkAllowlistOrigins = ["https://reviewed.example.com"];
    const reports = await runAgentPreviewChecksV1(options);
    expect(checkPreviewExternalLink).not.toHaveBeenCalled();
    expect(reports[0].issues.some((i) => i.code === "EXTERNAL_UNVERIFIED")).toBe(true);
  });
  it("deduplicates allowlisted HTTPS links and caps dispatch at 100 unique URLs", async () => {
    const links = Array.from(
      { length: 102 },
      (_, i) => `<a href="https://reviewed.example.com/${i}">Link</a>`,
    ).join("");
    const options = input(good.replace("</body>", `${links}${links}</body>`));
    options.linkAllowlistOrigins = ["https://reviewed.example.com"];
    const reports = await runAgentPreviewChecksV1(options);
    expect(checkPreviewExternalLink).toHaveBeenCalledTimes(100);
    expect(reports[0].issues.filter((i) => i.code === "EXTERNAL_UNVERIFIED")).toHaveLength(2);
  });
  it("collects network outcomes deterministically despite completion order", async () => {
    const options = input(
      good.replace(
        "</body>",
        '<a href="https://reviewed.example.com/z">Z</a><a href="https://reviewed.example.com/a">A</a></body>',
      ),
    );
    options.linkAllowlistOrigins = ["https://reviewed.example.com"];
    vi.mocked(checkPreviewExternalLink).mockImplementation(async (url) => {
      await new Promise((resolve) => setTimeout(resolve, url.pathname === "/a" ? 10 : 0));
      return "unreachable";
    });
    const first = await runAgentPreviewChecksV1(options);
    vi.mocked(checkPreviewExternalLink).mockResolvedValue("unreachable");
    expect(await runAgentPreviewChecksV1(options)).toEqual(first);
  });
  it("checks authority around each render and never projects revoked evidence", async () => {
    const options = input();
    options.assertCurrentAuthority = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockRejectedValue(new Error("denied"));
    await expect(runAgentPreviewChecksV1(options)).rejects.toThrow("denied");
    expect(checkPreviewExternalLink).not.toHaveBeenCalled();
  });
  it("consumes one rendered page at a time", async () => {
    const options = input();
    options.routes = [route, { ...route, route: "/two" }];
    let active = 0,
      peak = 0;
    options.render = async () => {
      active++;
      peak = Math.max(peak, active);
      await Promise.resolve();
      active--;
      return good;
    };
    await runAgentPreviewChecksV1(options);
    expect(peak).toBe(1);
  });
  it("fails closed instead of truncating issues, HTML, depth or result inventory", async () => {
    await expect(
      runAgentPreviewChecksV1(input(good.replace("</body>", `${"<img>".repeat(1001)}</body>`))),
    ).rejects.toThrow();
    await expect(runAgentPreviewChecksV1(input("a".repeat(5 * 1024 * 1024 + 1)))).rejects.toThrow();
    await expect(runAgentPreviewChecksV1(input("<div>".repeat(260)))).rejects.toThrow();
    const options = input();
    options.routes = Array.from({ length: 201 }, (_, i) => ({ ...route, route: `/route-${i}` }));
    await expect(runAgentPreviewChecksV1(options)).rejects.toThrow();
  });
  it("understands escaped HTML attributes and ignores fake markup in comments/scripts", async () => {
    const options = input(
      good.replace(
        "</body>",
        '<!-- <img> --><script>"<img>"</script><a href="https://reviewed.example.com/?a=1&amp;b=2">Link</a></body>',
      ),
    );
    options.linkAllowlistOrigins = ["https://reviewed.example.com"];
    const reports = await runAgentPreviewChecksV1(options);
    expect(reports[0].issues).toHaveLength(1);
    expect(reports[0].issues[0].code).toBe("EXTERNAL_UNVERIFIED");
    expect(checkPreviewExternalLink).not.toHaveBeenCalled();
  });
  it("uses at most four network lanes and waits for their authority checks", async () => {
    const options = input(
      good.replace(
        "</body>",
        Array.from(
          { length: 8 },
          (_, i) => `<a href="https://reviewed.example.com/${i}">Link</a>`,
        ).join("") + "</body>",
      ),
    );
    options.linkAllowlistOrigins = ["https://reviewed.example.com"];
    let active = 0,
      peak = 0;
    vi.mocked(checkPreviewExternalLink).mockImplementation(async () => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active--;
      return "reachable";
    });
    await runAgentPreviewChecksV1(options);
    expect(peak).toBe(4);
    expect(active).toBe(0);
  });
  it("splits bounded canonical reports with complete issue ownership", async () => {
    const options = input();
    options.routes = Array.from({ length: 100 }, (_, i) => ({
      ...route,
      route: `/${"x".repeat(1200)}-${i}`,
    }));
    const reports = await runAgentPreviewChecksV1(options);
    expect(reports.length).toBeGreaterThan(1);
    expect(npRequireAgentPreviewReportPartsV1(reports)).toEqual(reports);
    expect(
      reports.every((r) => Buffer.byteLength(serializeAgentCanonicalJson(r)) <= 512 * 1024),
    ).toBe(true);
  });
  it("rejects invalid report identity before rendering or checking links", async () => {
    const options = input();
    options.identity.planHash = "invalid";
    await expect(runAgentPreviewChecksV1(options)).rejects.toThrow();
    expect(options.render).not.toHaveBeenCalled();
    expect(checkPreviewExternalLink).not.toHaveBeenCalled();
  });
  it("checks canonical metadata and native accessible names without requiring hidden controls", async () => {
    const options = input(
      good
        .replace(
          "</head>",
          '<link rel="canonical" href="https://wrong.example.com/?private=1"></head>',
        )
        .replace(
          "</body>",
          '<input type="submit"><input type="reset"><input type="image" alt="Submit"><div hidden><button></button><img></div></body>',
        ),
    );
    const reports = await runAgentPreviewChecksV1(options);
    expect(reports.flatMap((r) => r.issues).map((i) => i.code)).toEqual(["METADATA_INVALID"]);
  });
  it("derives cross-locale destinations from their unique canonical manifest entry", async () => {
    const options = input(good.replace('href="/"', 'href="/ko/about"'));
    options.routeManifest = [route, { route: "/ko/about", locale: "ko", audience: "public" }];
    const reports = await runAgentPreviewChecksV1(options);
    expect(options.resolveRoute).toHaveBeenCalledWith({
      route: "/ko/about",
      locale: "ko",
      audience: "public",
    });
    expect(reports.flatMap((r) => r.issues)).toEqual([]);
  });
});
