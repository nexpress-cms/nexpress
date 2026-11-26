import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";
import { npRequireAgentBuildPreviewReportV1 } from "@nexpress/core/agent-contract";
import {
  composeSiteBuildBrowserPreviewChecksV1,
  createSiteBuildBrowserPreviewProgramV1,
  requireSiteBuildBrowserPreviewObservationV1,
  type NpSiteBuildBrowserPreviewInputV1,
  type NpSiteBuildBrowserPreviewObservationV1,
} from "./browser-preview-checks.js";

const origin = "http://127.0.0.1:18080";
const input = (
  phase: "document" | "interaction" = "document",
): NpSiteBuildBrowserPreviewInputV1 => ({
  phase,
  themePackage: "@nexpress/theme-default",
  origin,
  route: "/",
  locale: "ko",
  headerNavigation: "present",
  metadata: {
    owner: "page",
    canonicalPath: "/",
    descriptionRequired: true,
    structuredData: "optional",
  },
});
const observation = (
  phase: "document" | "interaction" = "document",
): NpSiteBuildBrowserPreviewObservationV1 => {
  const common = {
    schemaVersion: "np.site-build-browser-preview-observation.v1",
    themePackage: "@nexpress/theme-default",
    route: "/",
    locale: "ko",
    metadataOwner: "page",
    routeMatches: true,
  } as const;
  return phase === "document"
    ? {
        ...common,
        phase,
        complete: true,
        metadata: { missing: false, invalid: false },
        accessibility: [],
        overflow: { root: false, controls: false },
        links: [],
      }
    : { ...common, phase, supported: true, passed: true };
};

// A small deterministic DOM fixture for the fixed program's algorithms, not a
// browser/accessibility claim. Root's normal Next/CDP gate remains required.
class ElementFixture {
  nodeType = 1;
  parentElement: ElementFixture | null = null;
  children: ElementFixture[] = [];
  doc!: DocumentFixture;
  labels: ElementFixture[] = [];
  shadowRoot: object | null = null;
  hidden = false;
  inert = false;
  css = { display: "block", visibility: "visible", overflowX: "visible" };
  style = { overflowX: "", overflow: "", maxWidth: "" };
  rect = { left: 0, right: 100, width: 100, height: 20 };
  onClick = vi.fn();
  isConnected = true;
  constructor(
    readonly tagName: string,
    readonly attrs: Record<string, string> = {},
    public textContent = "",
  ) {}
  get localName() {
    return this.tagName.toLowerCase();
  }
  get childNodes() {
    return this.children;
  }
  get attributes() {
    return Object.keys(this.attrs).map((name) => ({ name }));
  }
  get lang() {
    return this.attrs.lang ?? "";
  }
  get value() {
    return this.attrs.value ?? "";
  }
  getAttribute(name: string) {
    return this.attrs[name] ?? null;
  }
  hasAttribute(name: string) {
    return Object.hasOwn(this.attrs, name);
  }
  getClientRects() {
    return this.css.display === "none" ? [] : [this.rect];
  }
  getBoundingClientRect() {
    return this.rect;
  }
  querySelectorAll(selector: string): ElementFixture[] {
    return this.doc.all.filter((e) => {
      let p = e.parentElement;
      while (p) {
        if (p === this) return matches(e, selector);
        p = p.parentElement;
      }
      return false;
    });
  }
  focus() {
    this.doc.activeElement = this;
  }
  blur() {
    this.doc.activeElement = this.doc.body;
  }
  click() {
    this.onClick();
  }
  add(e: ElementFixture) {
    e.parentElement = this;
    this.children.push(e);
    return this.doc.add(e);
  }
}
function matches(e: ElementFixture, selector: string): boolean {
  return selector.split(",").some((s) => {
    if (s === "*") return true;
    const tag = /^[a-z]+/u.exec(s)?.[0];
    if (tag && e.tagName !== tag.toUpperCase()) return false;
    const cls = /\.([a-zA-Z0-9_-]+)/u.exec(s)?.[1];
    if (cls && !e.attrs.class?.split(" ").includes(cls)) return false;
    if (s.includes(":not([alt])")) return !e.hasAttribute("alt");
    const attr = /\[([^\]~=]+)(~?=)?(?:"([^"]*)")?\]/u.exec(s);
    if (attr) {
      const v = e.getAttribute(attr[1]);
      if (v === null) return false;
      if (attr[2] === "=" && v !== attr[3]) return false;
      if (attr[2] === "~=" && !v.split(" ").includes(attr[3])) return false;
    }
    return true;
  });
}
class DocumentFixture {
  all: ElementFixture[] = [];
  documentElement = this.add(new ElementFixture("HTML", { lang: "ko" }));
  head = this.documentElement.add(new ElementFixture("HEAD"));
  body = this.documentElement.add(new ElementFixture("BODY"));
  activeElement = this.body;
  onKey = vi.fn();
  constructor() {
    this.head.add(new ElementFixture("TITLE", {}, "Synthetic title"));
    this.head.add(
      new ElementFixture("META", { name: "description", content: "Synthetic description" }),
    );
    this.head.add(
      new ElementFixture("META", {
        name: "viewport",
        content: "width=device-width, initial-scale=1",
      }),
    );
    this.head.add(new ElementFixture("LINK", { rel: "canonical", href: origin + "/" }));
    this.body.add(new ElementFixture("A", { href: "/", class: "np-site-logo" }, "Synthetic brand"));
    Object.assign(this.documentElement, { scrollWidth: 1000 });
    Object.assign(this.body, { scrollWidth: 1000 });
  }
  add(e: ElementFixture) {
    e.doc = this;
    this.all.push(e);
    return e;
  }
  querySelectorAll(s: string) {
    return this.all.filter((e) => matches(e, s));
  }
  querySelector(s: string) {
    return this.querySelectorAll(s)[0] ?? null;
  }
  getElementById(id: string) {
    return this.all.find((e) => e.attrs.id === id) ?? null;
  }
  getElementsByName(name: string) {
    return this.all.filter((e) => e.attrs.name === name);
  }
  dispatchEvent(e: unknown) {
    this.onKey(e);
    return true;
  }
}
async function evaluate(doc: DocumentFixture, context = input()) {
  const fetch = vi.fn(() => {
    throw new Error("not permitted");
  });
  const scrollTo = vi.fn();
  const value: unknown = await runInNewContext(createSiteBuildBrowserPreviewProgramV1(context), {
    document: doc,
    location: {
      origin,
      href: origin + context.route,
      pathname: context.route,
      search: "",
      hash: "",
    },
    URL,
    innerWidth: 1000,
    scrollX: 0,
    scrollY: 0,
    scrollTo,
    getComputedStyle: (e: ElementFixture) => e.css,
    requestAnimationFrame: (callback: () => void) => callback(),
    KeyboardEvent: class {
      constructor(
        readonly type: string,
        readonly options: unknown,
      ) {}
    },
    fetch,
  });
  expect(fetch).not.toHaveBeenCalled();
  // CDP serializes by value; drop the VM realm's prototypes before transport parsing.
  return requireSiteBuildBrowserPreviewObservationV1(JSON.parse(JSON.stringify(value)));
}

describe("fixed browser preview program", () => {
  it("covers the actual finite Next live-region shadow shape and rejects added controls or altered attributes", async () => {
    const doc = new DocumentFixture();
    const host = doc.body.add(
      new ElementFixture("NEXT-ROUTE-ANNOUNCER", { style: "position:absolute" }),
    );
    const live = new ElementFixture("DIV", {
      id: "__next-route-announcer__",
      "aria-live": "assertive",
      role: "alert",
      style: "owned visually hidden live region",
    });
    Object.assign(live.css, {
      position: "absolute",
      width: "1px",
      height: "1px",
      overflow: "hidden",
      whiteSpace: "nowrap",
    });
    host.shadowRoot = { mode: "open", childNodes: [live] };
    const actual = await evaluate(doc);
    expect(actual).toMatchObject({ complete: true, diagnostics: { completeness: [] } });
    live.children.push(new ElementFixture("BUTTON", { type: "button" }, "hidden control"));
    expect(await evaluate(doc)).toMatchObject({
      complete: false,
      diagnostics: { completeness: ["next-route-announcer-shadow"] },
    });
    live.children = [];
    live.attrs.tabindex = "0";
    expect(await evaluate(doc)).toMatchObject({
      complete: false,
      diagnostics: { completeness: ["next-route-announcer-shadow"] },
    });
  });
  it("observes actual fixture DOM rules and returns no source strings or query values", async () => {
    const doc = new DocumentFixture();
    doc.body.add(new ElementFixture("DIV", { id: "target" }));
    for (const href of [
      "#target",
      "#absent",
      "/other?q=secret-query",
      "https://external.example/path?secret=query",
      "mailto:private@example.invalid",
      "tel:+123",
      "javascript:alert(1)",
    ])
      doc.body.add(new ElementFixture("A", { href }, "PRIVATE DOM TEXT"));
    const result = await evaluate(doc);
    expect(result.phase).toBe("document");
    if (result.phase !== "document") throw new Error("fixture");
    expect(result.metadata).toEqual({ missing: false, invalid: false });
    expect(result.links).toContainEqual({
      kind: "local",
      route: "/",
      query: false,
      fragment: "present",
    });
    expect(result.links).toContainEqual({
      kind: "local",
      route: "/",
      query: false,
      fragment: "missing",
    });
    expect(result.links).toContainEqual({
      kind: "local",
      route: "/other",
      query: true,
      fragment: "none",
    });
    expect(result.links).toContainEqual({ kind: "external", origin: "https://external.example" });
    expect(result.links).toContainEqual({ kind: "unrequested-scheme" });
    expect(result.links).toContainEqual({ kind: "unsupported" });
    for (const secret of ["PRIVATE", "secret-query", "private@example", "+123", "alert(1)"])
      expect(JSON.stringify(result)).not.toContain(secret);
  });
  it("reports label/alt/id/lang errors, skips hidden controls, and preserves intentional local scrollers", async () => {
    const doc = new DocumentFixture();
    doc.documentElement.attrs.lang = "en";
    doc.body.add(new ElementFixture("IMG"));
    doc.body.add(new ElementFixture("BUTTON", { type: "button" }));
    const hidden = doc.body.add(new ElementFixture("BUTTON"));
    hidden.css.display = "none";
    doc.body.add(new ElementFixture("DIV", { id: "duplicate" }));
    doc.body.add(new ElementFixture("DIV", { id: "duplicate" }));
    const scroll = doc.body.add(new ElementFixture("DIV"));
    scroll.css.overflowX = "auto";
    scroll.rect.right = 1000;
    const link = scroll.add(new ElementFixture("A", { href: "/" }, "Offscreen carousel item"));
    link.rect = { left: 1100, right: 1200, width: 100, height: 20 };
    const result = await evaluate(doc);
    if (result.phase !== "document") throw new Error("fixture");
    expect(result.accessibility).toEqual(["control-name", "duplicate-id", "image-alt", "lang"]);
    expect(result.overflow).toEqual({ root: false, controls: false });
    const overflow = doc.body.add(new ElementFixture("BUTTON", { type: "button" }, "Overflow"));
    overflow.rect.right = 1002;
    Object.assign(doc.documentElement, { scrollWidth: 1002 });
    const changed = await evaluate(doc);
    if (changed.phase !== "document") throw new Error("fixture");
    expect(changed.overflow).toEqual({ root: true, controls: true });
  });
  it("uses explicit Forum privacy metadata fallback instead of insisting on a detail canonical or JSON-LD", async () => {
    const doc = new DocumentFixture();
    doc.querySelector('link[rel~="canonical"]').attrs.href = origin + "/boards";
    const ctx = input();
    ctx.route = "/boards/members/post";
    ctx.metadata = {
      owner: "forum-member",
      canonicalPath: "/boards",
      descriptionRequired: false,
      structuredData: "forbidden",
    };
    const result = await evaluate(doc, ctx);
    if (result.phase !== "document") throw new Error("fixture");
    expect(result.metadata).toEqual({ missing: false, invalid: false });
    doc.head.add(
      new ElementFixture(
        "SCRIPT",
        { type: "application/ld+json" },
        JSON.stringify({
          "@context": "https://schema.org",
          "@type": "DiscussionForumPosting",
          headline: "PRIVATE",
        }),
      ),
    );
    const leaked = await evaluate(doc, ctx);
    if (leaked.phase !== "document") throw new Error("fixture");
    expect(leaked.metadata.invalid).toBe(true);
    expect(JSON.stringify(leaked)).not.toContain("PRIVATE");
  });
  it("fails incomplete frame/shadow coverage and malformed metadata rather than silently passing", async () => {
    const doc = new DocumentFixture();
    doc.body.add(new ElementFixture("IFRAME"));
    doc.body.add(new ElementFixture("DIV")).shadowRoot = {};
    doc.head.add(new ElementFixture("TITLE", {}, "Duplicate"));
    doc.querySelector('link[rel~="canonical"]').attrs.href =
      "https://unexpected.example/?secret=hidden";
    const result = await evaluate(doc);
    if (result.phase !== "document") throw new Error("fixture");
    expect(result.complete).toBe(false);
    expect(result.metadata.invalid).toBe(true);
    expect(result.diagnostics).toEqual({
      metadata: ["canonical-origin", "canonical-query", "duplicate-title"],
      completeness: ["frame", "other-shadow"],
    });
    expect(JSON.stringify(result)).not.toContain("secret");
  });
  it.each([
    ["default", ".np-mobile-nav-toggle", "np-mobile-nav-drawer"],
    ["community", ".np-community-mobile-toggle", "np-community-mobile-menu"],
    ["magazine", ".np-magazine-mobile-nav-toggle", "np-magazine-mobile-nav-drawer"],
    ["portfolio", ".np-portfolio-nav-toggle", "np-portfolio-nav-drawer"],
  ])(
    "opens and closes only the %s owned menu, leaving Forum controls untouched",
    async (name, selector, id) => {
      const doc = new DocumentFixture();
      const button = doc.body.add(
        new ElementFixture(
          "BUTTON",
          {
            class: selector.slice(1),
            type: "button",
            "aria-controls": id,
            "aria-expanded": "false",
          },
          "Menu",
        ),
      );
      const drawer = doc.body.add(new ElementFixture("ASIDE", { id, "aria-hidden": "true" }));
      drawer.css.display = "none";
      button.onClick.mockImplementation(() => {
        const open = button.attrs["aria-expanded"] === "false";
        button.attrs["aria-expanded"] = String(open);
        drawer.attrs["aria-hidden"] = String(!open);
        drawer.css.display = open ? "block" : "none";
        doc.body.style.overflow = open ? "hidden" : "";
        doc.body.attrs.style = open ? "overflow: hidden;" : "";
      });
      const mutation = doc.body.add(
        new ElementFixture("BUTTON", { "data-np-forum-moderation-action": "delete" }, "Delete"),
      );
      const ctx = input("interaction");
      ctx.themePackage = `@nexpress/theme-${name}`;
      const result = await evaluate(doc, ctx);
      expect(result).toMatchObject({ phase: "interaction", supported: true, passed: true });
      expect(button.onClick).toHaveBeenCalledTimes(2);
      expect(mutation.onClick).not.toHaveBeenCalled();
      expect(button.attrs["aria-expanded"]).toBe("false");
      expect(doc.activeElement).toBe(doc.body);
    },
  );
  it("reports failed menu hydration, supports docs focus and static storefront focus without submission", async () => {
    const doc = new DocumentFixture();
    doc.body.add(
      new ElementFixture(
        "BUTTON",
        {
          class: "np-mobile-nav-toggle",
          type: "button",
          "aria-controls": "np-mobile-nav-drawer",
          "aria-expanded": "false",
        },
        "Menu",
      ),
    );
    expect(await evaluate(doc, input("interaction"))).toMatchObject({ passed: false });
    const target = doc.body.add(new ElementFixture("INPUT", { id: "np-docs-search-input" }));
    doc.onKey.mockImplementation(() => target.focus());
    const ctx = input("interaction");
    ctx.themePackage = "@nexpress/theme-docs";
    expect(await evaluate(doc, ctx)).toMatchObject({ passed: true });
    expect(doc.onKey).toHaveBeenCalledOnce();
    expect(doc.activeElement).toBe(doc.body);
    ctx.themePackage = "@nexpress/theme-storefront";
    doc.body.add(new ElementFixture("A", { href: "/", class: "np-storefront-brand" }, "Brand"));
    expect(await evaluate(doc, ctx)).toMatchObject({ passed: true });
    ctx.themePackage = "@nexpress/theme-unregistered";
    expect(await evaluate(doc, ctx)).toMatchObject({ supported: false, passed: false });
  });
});

describe("preview observation boundary and Core issue composer", () => {
  const page = () => ({ pageId: "home", route: "/", locale: null, audience: "public" as const });
  const composeInput = () => ({
    page: page(),
    viewport: "desktop" as const,
    document: observation(),
    interaction: observation("interaction"),
    observedRoutes: [{ ...page(), status: 200 }],
    screenshotPath: ".nexpress/site/review/final/home-desktop.png",
  });
  it("rejects hidden/executable/proxy/unknown data without invoking user accessors", async () => {
    const accessed = vi.fn(() => {
      throw new Error("PRIVATE");
    });
    const accessor = Object.defineProperty(observation(), "links", { get: accessed });
    const proxy = new Proxy(observation(), {
      get: accessed,
      ownKeys: accessed,
      getPrototypeOf: accessed,
    });
    const values = [
      accessor,
      proxy,
      { ...observation(), html: "PRIVATE" },
      { ...observation(), diagnostics: { metadata: ["PRIVATE"], completeness: [] } },
      { ...observation(), diagnostics: { metadata: ["duplicate-title"], completeness: [] } },
      { ...observation(), route: "/\ud800" },
      {
        ...observation(),
        links: [{ kind: "external", origin: "https://example.com/?token=PRIVATE" }],
      },
      {
        ...observation(),
        links: [{ kind: "local", route: "/about?secret=PRIVATE", query: false, fragment: "none" }],
      },
    ];
    for (const value of values)
      expect(() => requireSiteBuildBrowserPreviewObservationV1(value)).toThrow(TypeError);
    const bad = Object.defineProperty(composeInput(), "screenshotPath", { get: accessed });
    await expect(composeSiteBuildBrowserPreviewChecksV1(bad)).rejects.toThrow(TypeError);
    expect(accessed).not.toHaveBeenCalled();
    expect(() =>
      createSiteBuildBrowserPreviewProgramV1({ ...input(), selector: "button" }),
    ).toThrow(TypeError);
  });
  it("only passes links with actual matching route outcomes; query/external/scheme remain warnings", async () => {
    const value = composeInput(),
      doc = observation();
    if (doc.phase !== "document") throw new Error("fixture");
    doc.links = [
      { kind: "local", route: "/", query: false, fragment: "none" },
      { kind: "local", route: "/query", query: true, fragment: "none" },
      { kind: "local", route: "/other", query: false, fragment: "none" },
      { kind: "external", origin: "https://example.com" },
      { kind: "unrequested-scheme" },
    ];
    value.document = doc;
    const result = await composeSiteBuildBrowserPreviewChecksV1(value);
    expect(result.page.checks.find((c) => c.id === "links")?.status).toBe("warning");
    expect(result.issues.map((i) => i.code).sort()).toEqual([
      "EXTERNAL_LINK_UNVERIFIED",
      "INTERNAL_LINK_UNVERIFIED",
      "INTERNAL_LINK_UNVERIFIED",
      "LINK_SCHEME_UNVERIFIED",
    ]);
    const body = {
      schemaVersion: "np.agent-build-preview-report.v1",
      blueprintHash: `nb1:sha256:${"A".repeat(43)}`,
      comparisonInputsDigest: `nb1:sha256:${"B".repeat(42)}A`,
      renderEnvironmentFingerprint: `nb1:sha256:${"C".repeat(42)}A`,
      routes: [result.page],
      issues: result.issues,
    };
    expect(npRequireAgentBuildPreviewReportV1(body)).toEqual(body);
  });
  it("reports exact failures, uses fixed selector digests and never attaches closed screenshots to interaction assertions", async () => {
    const value = composeInput(),
      doc = observation(),
      interaction = observation("interaction");
    if (doc.phase !== "document" || interaction.phase !== "interaction") throw new Error("fixture");
    doc.complete = false;
    doc.metadata.invalid = true;
    doc.accessibility = ["image-alt"];
    doc.overflow.root = true;
    doc.links = [
      { kind: "local", route: "/", query: false, fragment: "missing" },
      { kind: "unsupported" },
    ];
    interaction.supported = false;
    value.document = doc;
    value.interaction = interaction;
    const result = await composeSiteBuildBrowserPreviewChecksV1(value);
    expect(result.page.checks.every((c) => c.status === "fail")).toBe(true);
    for (const issue of result.issues.filter((i) => i.checkId === "interaction-smoke"))
      expect(issue.evidenceArtifactPaths).toEqual([]);
    expect(
      result.issues.some(
        (i) =>
          i.target?.kind === "selector" &&
          /^nb1:file-sha256:[A-Za-z0-9_-]{43}$/u.test(i.target.selectorDigest),
      ),
    ).toBe(true);
    expect(await composeSiteBuildBrowserPreviewChecksV1(value)).toEqual(result);
  });
  it("does not convert other-audience, other-locale or unobserved redirects into successful links", async () => {
    const value = composeInput();
    value.observedRoutes = [{ ...page(), status: 302 }];
    const doc = observation();
    if (doc.phase !== "document") throw new Error("fixture");
    doc.links = [{ kind: "local", route: "/", query: false, fragment: "none" }];
    value.document = doc;
    expect((await composeSiteBuildBrowserPreviewChecksV1(value)).issues[0]?.code).toBe(
      "LINK_TARGET_MISSING",
    );
    const different = {
      ...value,
      observedRoutes: [{ ...page(), audience: "member" as const, status: 200 }],
    };
    expect((await composeSiteBuildBrowserPreviewChecksV1(different)).issues[0]?.code).toBe(
      "INTERNAL_LINK_UNVERIFIED",
    );
    await expect(
      composeSiteBuildBrowserPreviewChecksV1({
        ...value,
        observedRoutes: [...value.observedRoutes, ...value.observedRoutes.map((v) => ({ ...v }))],
      }),
    ).rejects.toThrow(TypeError);
  });
});
