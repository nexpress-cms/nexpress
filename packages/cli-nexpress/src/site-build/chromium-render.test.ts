import { access, chmod, mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { inflateSync } from "node:zlib";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { SiteBuildError } from "./artifact-io.js";
import { NpSiteBuildBrowserFailureV1, renderSiteBuildBrowserPngV1 } from "./chromium-render.js";

async function installedBrowser(): Promise<string> {
  if (process.env.NP_BUILD_CHROMIUM_EXECUTABLE) return process.env.NP_BUILD_CHROMIUM_EXECUTABLE;
  const cache =
    process.env.PLAYWRIGHT_BROWSERS_PATH ??
    join(
      homedir(),
      process.platform === "darwin" ? "Library/Caches/ms-playwright" : ".cache/ms-playwright",
    );
  // Use the installed headless-shell owner, never an OS Chromium launcher or
  // Playwright's separate headed browser with a different CDP configuration.
  const candidates =
    process.platform === "darwin"
      ? [
          ["chrome-headless-shell-mac-arm64", "chrome-headless-shell"],
          ["chrome-headless-shell-mac-x64", "chrome-headless-shell"],
        ]
      : [
          ["chrome-headless-shell-linux64", "chrome-headless-shell"],
          ["chrome-linux", "headless_shell"],
        ];
  try {
    const versions = (await readdir(cache))
      .filter((name) => /^chromium_headless_shell-[0-9]+$/u.test(name))
      .sort((a, b) => Number(b.split("-").at(-1)) - Number(a.split("-").at(-1)));
    for (const version of versions)
      for (const [directory, binary] of candidates) {
        const executable = join(cache, version, directory, binary);
        try {
          await access(executable);
          return executable;
        } catch {
          /* Try the other installed platform build. */
        }
      }
  } catch {
    /* Optional local transport fixture; Linux image acceptance is separate. */
  }
  return join(cache, "unavailable-chromium");
}
const nativeExecutable = await installedBrowser();
let nativeAvailable = false;
try {
  await access(nativeExecutable);
  nativeAvailable = true;
} catch {
  /* Optional native transport fixture. */
}
const nativeRequired =
  Boolean(process.env.NP_BUILD_CHROMIUM_EXECUTABLE) ||
  process.env.NP_BUILD_REQUIRE_CHROMIUM === "1";
const roots: string[] = [];
async function output(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "np-browser-transport-"));
  roots.push(root);
  return root;
}
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

const clock = "2026-01-02T03:04:05.000Z";
const defaults = (outputRoot: string, url: string, allowedPaths = [new URL(url).pathname]) => ({
  executable: nativeExecutable,
  outputRoot,
  url,
  allowedPaths,
  viewport: { width: 480, height: 320, deviceScaleFactor: 2 as const },
  locale: "en-US",
  clockNow: clock,
  randomSeed: "1".repeat(64),
  timeoutMs: 15_000,
});

async function rejected(operation: Promise<unknown>): Promise<void> {
  try {
    await operation;
    throw new Error("unexpected render success");
  } catch (error) {
    expect(error).toBeInstanceOf(SiteBuildError);
    expect(error).toMatchObject({ reason: "input", message: "input" });
  }
}

function pixel(png: Uint8Array, x: number, y: number): number[] {
  const bytes = Buffer.from(png);
  const width = bytes.readUInt32BE(16);
  for (let offset = 8; offset < bytes.length;) {
    const length = bytes.readUInt32BE(offset);
    if (bytes.toString("ascii", offset + 4, offset + 8) === "IDAT") {
      const decoded = inflateSync(bytes.subarray(offset + 8, offset + 8 + length));
      const at = y * (width * 4 + 1) + 1 + x * 4;
      return [...decoded.subarray(at, at + 4)];
    }
    offset += length + 12;
  }
  throw new Error("missing canonical pixels");
}

describe("private Chromium CDP pipe input and process lifecycle", () => {
  it("rejects noncanonical URLs, paths and unbounded settings before launching", async () => {
    const root = await output();
    const base = defaults(root, "http://127.0.0.1:61000/fixture");
    for (const patch of [
      { url: "http://localhost:61000/fixture" },
      { url: "https://127.0.0.1:61000/fixture" },
      { url: "http://127.0.0.1:61000/fixture?private=value" },
      { url: "http://user:password@127.0.0.1:61000/fixture" },
      { allowedPaths: ["/other"] },
      { allowedPaths: ["/fixture", "/../outside"] },
      { allowedPaths: ["/fixture", "/x%2F..%2Fsecret"] },
      { allowedPaths: ["/fixture", "/fixture"] },
      { clockNow: "2026-02-30T00:00:00.000Z" },
      { randomSeed: "ambient" },
      { locale: "en-us" },
      { timeoutMs: 120_001 },
      { viewport: { width: 7680, height: 4320, deviceScaleFactor: 2 as const } },
    ])
      await rejected(renderSiteBuildBrowserPngV1({ ...base, ...patch }));
    expect(await readdir(root)).toEqual([]);
  });

  it("rejects an unexpected owned child exit without leaking stderr or leaving its profile", async () => {
    const root = await output();
    const outputRoot = join(root, "output");
    await mkdir(outputRoot);
    const executable = join(root, "exit-fixture");
    await writeFile(
      executable,
      `#!${process.execPath}\nprocess.stderr.write("synthetic-private-error");process.exit(9);\n`,
    );
    await chmod(executable, 0o700);
    await rejected(
      renderSiteBuildBrowserPngV1({
        ...defaults(outputRoot, "http://127.0.0.1:61000/fixture"),
        executable,
        timeoutMs: 2000,
      }),
    );
    expect(await readdir(outputRoot)).toEqual([]);
  });

  it.each([
    "initial-idle",
    "post-font-idle",
    "response-error",
    "loading-error",
    "loading-stream-error",
  ] as const)(
    "reports %s through the real CDP transport without weakening readiness or cleanup",
    async (step) => {
      const root = await output(),
        outputRoot = join(root, "output");
      await mkdir(outputRoot);
      const executable = join(root, "cdp-fixture");
      // A protocol peer, not Chromium: exercise the real render state machine,
      // timeout and child cleanup without claiming browser/native acceptance.
      await writeFile(
        executable,
        `#!${process.execPath}
const fs = require("node:fs"), input = fs.createReadStream(null, {fd: 3});
let bytes = "";
const send = value => fs.writeSync(4, JSON.stringify(value) + "\\0");
const event = (method, params) => send({method, params, sessionId: "main"});
const pending = () => {
  for (const [id, path] of [["one", "/api/members/me"], ["two", "/api/notifications?count=1"]])
    event("Network.requestWillBeSent", {requestId:id, type:"Fetch", request:{url:"http://127.0.0.1:61000"+path, method:"GET"}});
  event("Network.responseReceived", {requestId:"two", response:{status:200, mimeType:"application/json"}});
};
input.on("data", chunk => {
  bytes += chunk;
  for (let end; (end = bytes.indexOf("\\0")) >= 0;) {
    const row = JSON.parse(bytes.slice(0,end)); bytes = bytes.slice(end+1);
    let result = {};
    if (row.method === "Target.getTargets") result = {targetInfos:[]};
    if (row.method === "Target.createBrowserContext") result = {browserContextId:"context"};
    if (row.method === "Target.createTarget") result = {targetId:"page"};
    if (row.method === "Runtime.evaluate") {
      pending();
      if (${JSON.stringify(step)} === "response-error") event("Network.responseReceived", {requestId:"two", response:{status:503, mimeType:"application/json", headers:{"private":"not-retained"}}});
      if (${JSON.stringify(step)} === "loading-error") event("Network.loadingFailed", {requestId:"one", errorText:"net::ERR_ABORTED", canceled:true, private:"not-retained"});
      if (${JSON.stringify(step)} === "loading-stream-error") {
        event("Network.requestWillBeSent", {requestId:"stream",type:"EventSource",request:{url:"http://127.0.0.1:61000/api/community/events?scope=document&targetType=posts&targetId=00000000-0000-4000-8000-000000000001",method:"GET"}});
        event("Network.responseReceived", {requestId:"stream",response:{status:200,mimeType:"text/event-stream"}});
        event("Network.loadingFailed", {requestId:"stream",errorText:"net::ERR_ABORTED",canceled:true});
      }
      result = {result:{value:{href:"http://127.0.0.1:61000/fixture", width:480, height:320, scale:2, forumMatches:true}}};
    }
    if (row.method === "Browser.close") process.exit(0);
    send({id:row.id, result});
    if (row.method === "Target.createTarget") event("Target.attachedToTarget", {sessionId:"main", targetInfo:{targetId:"page",type:"page"}});
    if (row.method === "Page.navigate") {
      event("Network.responseReceived", {type:"Document", requestId:"document", response:{url:"http://127.0.0.1:61000/fixture",status:200}});
      event("Page.loadEventFired", {});
      if (${JSON.stringify(step)} === "initial-idle") pending();
    }
  }
});
`,
      );
      await chmod(executable, 0o700);
      const failure = await renderSiteBuildBrowserPngV1({
        ...defaults(outputRoot, "http://127.0.0.1:61000/fixture"),
        executable,
        timeoutMs: 1200,
        requestPolicy: {
          documentPaths: [],
          imagePaths: [],
          imageWidths: [],
          imageQualities: [],
          readRequests: [
            "/api/members/me",
            "/api/notifications?count=1",
            "/api/community/events?scope=document&targetType=posts&targetId=00000000-0000-4000-8000-000000000001",
          ],
        },
      }).catch((error: unknown) => error);
      expect(failure).toBeInstanceOf(NpSiteBuildBrowserFailureV1);
      if (!(failure instanceof NpSiteBuildBrowserFailureV1))
        throw new Error("expected owned failure");
      expect(failure.phase).toBe(step === "initial-idle" ? "network-idle" : "fonts");
      if (
        step === "response-error" ||
        step === "loading-error" ||
        step === "loading-stream-error"
      ) {
        expect(failure.diagnostic).toMatchObject({
          reason: "network",
          networkFailure:
            step === "response-error"
              ? {
                  cause: "response",
                  status: 503,
                  error: null,
                  canceled: false,
                  blocked: false,
                  request: { apiRole: "notifications", headersReceived: true },
                }
              : step === "loading-error"
                ? {
                    cause: "loading",
                    status: null,
                    error: "aborted",
                    canceled: true,
                    blocked: false,
                    request: { apiRole: "member-session", headersReceived: false },
                  }
                : {
                    cause: "loading",
                    status: null,
                    error: "aborted",
                    canceled: true,
                    blocked: false,
                    request: { apiRole: "events", headersReceived: true, eventStream: true },
                  },
        });
        expect(JSON.stringify(failure.diagnostic)).not.toContain("not-retained");
        expect(JSON.stringify(failure.diagnostic)).not.toContain("/api/");
        expect(await readdir(outputRoot)).toEqual([]);
        return;
      }
      expect(failure.diagnostic).toMatchObject({
        reason: "timeout",
        loaded: true,
        inflight: 2,
        ready: 0,
        wait: {
          step,
          pendingCount: 2,
          truncated: false,
          pending: [
            {
              target: "api",
              apiRole: "member-session",
              resourceType: "fetch",
              headersReceived: false,
              eventStream: false,
            },
            {
              target: "api",
              apiRole: "notifications",
              resourceType: "fetch",
              headersReceived: true,
              eventStream: false,
            },
          ],
        },
      });
      const wait = failure.diagnostic.wait!;
      // Date.now deadline scheduling and floored performance telemetry can differ by 1 ms.
      expect(wait.elapsedMs).toBeGreaterThanOrEqual(1200 - 1);
      expect(wait.stepElapsedMs).toBeGreaterThan(0);
      expect(wait.stepElapsedMs).toBeLessThanOrEqual(wait.elapsedMs);
      expect(wait.pending.every((row) => row.ageMs > 0 && row.ageMs <= wait.elapsedMs)).toBe(true);
      expect(JSON.stringify(failure.diagnostic)).not.toContain("/api/");
      expect(JSON.stringify(failure.diagnostic)).not.toContain("127.0.0.1");
      expect(await readdir(outputRoot)).toEqual([]);
    },
  );
});

describe.skipIf(!nativeAvailable && !nativeRequired)(
  "native Chromium transport/image fixture (not R8 sandbox evidence)",
  () => {
    let server: Server;
    let forbiddenServer: Server;
    let origin = "";
    let forbiddenOrigin = "";
    let forbiddenHits = 0;
    let passiveHits = 0;

    beforeAll(async () => {
      forbiddenServer = createServer((_, response) => {
        forbiddenHits++;
        response.end("forbidden");
      });
      await new Promise<void>((done) => forbiddenServer.listen(0, "127.0.0.1", done));
      const externalAddress = forbiddenServer.address();
      if (!externalAddress || typeof externalAddress === "string")
        throw new Error("missing fixture port");
      forbiddenOrigin = `http://127.0.0.1:${externalAddress.port}`;
      server = createServer((request, response) => {
        if (["/preview-checks", "/checks-mutation"].includes(request.url ?? "")) {
          response.setHeader("Content-Type", "text/html");
          response.end(`<!doctype html><html lang="en-US"><head><title>Fixture preview</title>
            <meta name="description" content="Synthetic browser fixture">
            <meta name="viewport" content="width=device-width, initial-scale=1">
            <link rel="canonical" href="${origin}${request.url}"></head><body>
            <a class="np-site-logo" href="${request.url}">Fixture</a>
            <button class="np-mobile-nav-toggle" type="button" aria-expanded="false" aria-controls="np-mobile-nav-drawer">Menu</button>
            <nav id="np-mobile-nav-drawer" hidden><a href="${request.url}">Page</a></nav>
            <script>const button=document.querySelector('button'),drawer=document.querySelector('nav');
            button.onclick=()=>{const open=button.getAttribute('aria-expanded')==='false';
              button.setAttribute('aria-expanded',String(open));drawer.hidden=!open;
              ${request.url === "/checks-mutation" ? 'fetch("/write",{method:"POST"}).catch(()=>{});' : ""}
            };</script></body></html>`);
        } else if (request.url === "/member") {
          if (request.headers.cookie !== "np-mb-session=np.synthetic.fixture") {
            response.statusCode = 404;
            response.end("withheld");
          } else {
            response.setHeader("Content-Type", "text/html");
            response.end(
              '<!doctype html><div data-np-forum-surface="post-detail"><h1>Synthetic member title</h1></div><script>new EventSource("/api/community/events?scope=document&targetType=communityPosts&targetId=00000000-0000-4000-8000-000000000001");</script>',
            );
          }
        } else if (
          request.url ===
          "/api/community/events?scope=document&targetType=communityPosts&targetId=00000000-0000-4000-8000-000000000001"
        ) {
          response.setHeader("Content-Type", "text/event-stream");
          response.write("event: connected\ndata: {}\n\n");
        } else if (request.url === "/asset.svg") {
          response.setHeader("Content-Type", "image/svg+xml");
          response.end(
            '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><rect width="20" height="20" fill="#123456"/></svg>',
          );
        } else if (request.url === "/transport") {
          response.setHeader("Content-Type", "text/html");
          response.end(
            '<!doctype html><img src="/_next/image?url=%2Fasset.svg&w=640&q=75"><script>fetch("/about?_rsc=HEAvJdHAQJrUAe2K").then(()=>document.body.style.background="rgb(20,40,60)");</script>',
          );
        } else if (request.url === "/about?_rsc=HEAvJdHAQJrUAe2K") {
          response.end("synthetic RSC transport");
        } else if (request.url === "/_next/image?url=%2Fasset.svg&w=640&q=75") {
          response.setHeader("Content-Type", "image/svg+xml");
          response.end(
            '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><rect width="20" height="20" fill="#123456"/></svg>',
          );
        } else if (request.url === "/bad-query") {
          response.setHeader("Content-Type", "text/html");
          response.end(
            '<!doctype html><script>fetch("/about?_rsc=HEAvJdHAQJrUAe2K&extra=1").catch(()=>{});</script>',
          );
        } else if (request.url === "/fixture") {
          response.setHeader("Content-Type", "text/html; charset=utf-8");
          response.end(`<!doctype html><html><head><style>
          body{margin:0;background:rgb(240,248,255);font:16px monospace}
          canvas{position:absolute;left:40px;top:40px;width:100px;height:100px}
          img{position:absolute;left:200px;top:40px}
        </style></head><body><canvas width="100" height="100"></canvas><img src="/asset.svg"><div id="clock"></div><script>
          if (new Date().toISOString() !== ${JSON.stringify(clock)} || Date.now() !== ${Date.parse(clock)} || Date.parse(Date()) !== Date.now() || Intl.DateTimeFormat().resolvedOptions().timeZone !== "UTC" || Intl.DateTimeFormat().resolvedOptions().locale !== "en-US" || !matchMedia("(prefers-color-scheme: light)").matches || !matchMedia("(prefers-reduced-motion: reduce)").matches) console.error("fixture settings missing");
          document.querySelector("#clock").textContent = new Date().toISOString() + " " + Math.random();
          const context = document.querySelector("canvas").getContext("2d");
          context.fillStyle = "rgb(" + Math.floor(Math.random()*255) + ",40,80)"; context.fillRect(0,0,100,100);
        </script></body></html>`);
        } else if (request.url === "/caught") {
          response.setHeader("Content-Type", "text/html");
          response.end(
            `<!doctype html><script>(async()=>{try{await fetch(${JSON.stringify(`${forbiddenOrigin}/forbidden`)});}catch{} document.body.textContent="caught";})();</script><body></body>`,
          );
        } else if (request.url === "/passive") {
          response.setHeader("Content-Type", "text/html");
          response.end('<!doctype html><img src="/unlisted">');
        } else if (request.url === "/unlisted") {
          passiveHits++;
          response.end("unlisted");
        } else if (request.url === "/never") {
          response.setHeader("Content-Type", "text/html");
          response.end('<!doctype html><img src="/slow">');
        } else if (request.url === "/slow") {
          // The browser's owned connection must close when its bounded render times out.
        } else if (request.url === "/exception") {
          response.setHeader("Content-Type", "text/html");
          response.end(
            '<!doctype html><script>throw new Error("synthetic private exception");</script>',
          );
        } else if (request.url === "/console") {
          response.setHeader("Content-Type", "text/html");
          response.end(
            '<!doctype html><script>console.error("synthetic private console");</script>',
          );
        } else {
          response.statusCode = 404;
          response.end("missing");
        }
      });
      await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("missing fixture port");
      origin = `http://127.0.0.1:${address.port}`;
    });
    afterAll(async () => {
      for (const fixture of [server, forbiddenServer]) {
        fixture?.closeAllConnections();
        if (fixture)
          await new Promise<void>((done, reject) =>
            fixture.close((error) => (error ? reject(error) : done())),
          );
      }
    });

    it("runs the fixed probes in an isolated world, restores the menu and retains sticky mutation denials", async () => {
      const root = await output();
      const previewChecks = {
        themePackage: "@nexpress/theme-default",
        headerNavigation: "present" as const,
        metadata: {
          owner: "page" as const,
          canonicalPath: "/preview-checks",
          descriptionRequired: true,
          structuredData: "optional" as const,
        },
      };
      const result = await renderSiteBuildBrowserPngV1({
        ...defaults(root, `${origin}/preview-checks`),
        previewChecks,
      });
      expect(result.status).toBe(200);
      expect(result.checks?.document).toMatchObject({
        phase: "document",
        complete: true,
        metadata: { missing: false, invalid: false },
        accessibility: [],
        overflow: { root: false, controls: false },
      });
      expect(result.checks?.interaction).toMatchObject({
        phase: "interaction",
        supported: true,
        passed: true,
      });
      await rejected(
        renderSiteBuildBrowserPngV1({
          ...defaults(root, `${origin}/checks-mutation`),
          previewChecks: {
            ...previewChecks,
            metadata: { ...previewChecks.metadata, canonicalPath: "/checks-mutation" },
          },
        }),
      );
      expect(await readdir(root)).toEqual([]);
    }, 20_000);

    it("captures actual canonical pixels and repeats bytes under the same fixed clock/random seed", async () => {
      const root = await output();
      const args = defaults(root, `${origin}/fixture`, ["/fixture", "/asset.svg"]);
      const first = await renderSiteBuildBrowserPngV1(args);
      const second = await renderSiteBuildBrowserPngV1(args);
      expect(first.png).toEqual(second.png);
      const dimensions = new DataView(first.png.buffer, first.png.byteOffset, first.png.byteLength);
      expect([dimensions.getUint32(16), dimensions.getUint32(20)]).toEqual([960, 640]);
      expect(pixel(first.png, 0, 100)).toEqual([240, 248, 255, 255]);
      expect(pixel(first.png, 410, 90)).toEqual([18, 52, 86, 255]);
      const changed = await renderSiteBuildBrowserPngV1({ ...args, randomSeed: "2".repeat(64) });
      expect(changed.png).not.toEqual(first.png);
      expect(await readdir(root)).toEqual([]);
    }, 30_000);

    it("uses a fresh private member cookie context and read-only SSE readiness without leaking it to anonymous jobs", async () => {
      const root = await output();
      const input = defaults(root, `${origin}/member`);
      await rejected(renderSiteBuildBrowserPngV1(input));
      const first = await renderSiteBuildBrowserPngV1({
        ...input,
        memberSessionToken: "np.synthetic.fixture",
        expectedForumTitle: "Synthetic member title",
        requestPolicy: {
          documentPaths: ["/member"],
          imagePaths: [],
          imageWidths: [],
          imageQualities: [],
          readRequests: [
            "/api/community/events?scope=document&targetType=communityPosts&targetId=00000000-0000-4000-8000-000000000001",
          ],
        },
      });
      expect(first.png.length).toBeGreaterThan(100);
      await rejected(renderSiteBuildBrowserPngV1(input));
      expect(await readdir(root)).toEqual([]);
    }, 25_000);

    it("blocks caught foreign fetch and parser-driven undeclared requests before either listener", async () => {
      const root = await output();
      for (const path of ["/caught", "/passive"])
        await rejected(renderSiteBuildBrowserPngV1(defaults(root, `${origin}${path}`)));
      expect(forbiddenHits).toBe(0);
      expect(passiveHits).toBe(0);
      expect(await readdir(root)).toEqual([]);
    }, 20_000);

    it("permits the closed Next transport inventory through both guards and rejects an extra query", async () => {
      const root = await output();
      const requestPolicy = {
        documentPaths: ["/about"],
        imagePaths: ["/asset.svg"],
        imageWidths: [640],
        imageQualities: [75],
      };
      const first = await renderSiteBuildBrowserPngV1({
        ...defaults(root, `${origin}/transport`),
        requestPolicy,
      });
      expect(pixel(first.png, 800, 500)).toEqual([20, 40, 60, 255]);
      await rejected(
        renderSiteBuildBrowserPngV1({ ...defaults(root, `${origin}/bad-query`), requestPolicy }),
      );
      expect(await readdir(root)).toEqual([]);
    }, 20_000);

    it("fails on runtime/console errors and a stalled allowed request, cleaning each owned browser", async () => {
      const root = await output();
      for (const path of ["/exception", "/console"])
        await rejected(renderSiteBuildBrowserPngV1(defaults(root, `${origin}${path}`)));
      await rejected(
        renderSiteBuildBrowserPngV1({
          ...defaults(root, `${origin}/never`, ["/never", "/slow"]),
          timeoutMs: 1500,
        }),
      );
      expect(await readdir(root)).toEqual([]);
    }, 20_000);
  },
);
