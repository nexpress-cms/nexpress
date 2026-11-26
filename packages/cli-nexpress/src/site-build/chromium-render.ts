import { spawn, type ChildProcess } from "node:child_process";
import { lstat, mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import { Readable, Writable } from "node:stream";
import { SiteBuildError } from "./artifact-io.js";
import { canonicalizeSiteBuildPngV1 } from "./png-canonicalizer.js";
import { runSiteBuildBrowserPreviewChecksV1 } from "./browser-preview-runtime.js";
import type { NpSiteBuildBrowserPreviewInputV1 } from "./browser-preview-probes.js";
import {
  classifySiteBuildBrowserRequestV1,
  classifySiteBuildBrowserPendingRequestV1,
  requireSiteBuildBrowserRequestDiagnosticV1,
  type NpSiteBuildBrowserDiagnosticV1,
  type NpSiteBuildBrowserPendingRequestV1,
  type NpSiteBuildBrowserWaitDiagnosticV1,
  type NpSiteBuildBrowserRequestDiagnosticV1,
} from "./browser-request-diagnostic.js";
import {
  isSiteBuildBrowserRequestAllowedV1,
  requireSiteBuildBrowserRequestPolicyV1,
  type NpSiteBuildBrowserRequestPolicyV1,
} from "./browser-request-policy.js";

interface BrowserRenderInput {
  executable: string;
  outputRoot: string;
  url: string;
  allowedPaths: readonly string[];
  requestPolicy?: NpSiteBuildBrowserRequestPolicyV1;
  viewport: { width: number; height: number; deviceScaleFactor: 1 | 2 };
  locale: string;
  clockNow: string;
  randomSeed: string;
  timeoutMs: number;
  /** Supplied only by the fixed job driver from its fresh synthetic member session. */
  memberSessionToken?: string;
  expectedForumTitle?: string;
  /** Expectations from the live host-owned fixture/config projection, never authored fields. */
  previewChecks?: Omit<NpSiteBuildBrowserPreviewInputV1, "phase" | "origin" | "route" | "locale">;
  /** Fixed driver diagnostic sink only; never read from an authored JSON artifact. */
  onPhase?: (phase: (typeof siteBuildBrowserPhasesV1)[number]) => void;
  onProgress?: (progress: {
    phase: (typeof siteBuildBrowserPhasesV1)[number];
    elapsedMs: number;
    reason: NpSiteBuildBrowserFailureV1["diagnostic"]["reason"] | null;
    loaded: boolean;
    inflight: number;
    ready: number;
    wait?: NpSiteBuildBrowserWaitDiagnosticV1;
  }) => void;
}
export const siteBuildBrowserPhasesV1 = [
  "input",
  "launch",
  "protocol",
  "configure",
  "navigate",
  "network-idle",
  "fonts",
  "checks",
  "freeze",
  "screenshot",
  "close",
] as const;
export class NpSiteBuildBrowserFailureV1 extends SiteBuildError {
  constructor(
    readonly phase: (typeof siteBuildBrowserPhasesV1)[number],
    readonly diagnostic: NpSiteBuildBrowserDiagnosticV1,
  ) {
    super("input");
  }
}
type RecordValue = Record<string, unknown>;
const record = (value: unknown): value is RecordValue =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const inputError = () => new SiteBuildError("input");
const delay = (milliseconds: number) => new Promise<void>((done) => setTimeout(done, milliseconds));
const MAX_CDP_MESSAGE = 90 * 1024 * 1024;
const MAX_CDP_TOTAL = 256 * 1024 * 1024;

/** Private NUL-framed CDP pipe, with no WebSocket listener or ambient browser attachment. */
class CdpPipe {
  private nextId = 0;
  private readonly pending = new Map<
    number,
    { resolve: (result: RecordValue) => void; reject: (error: Error) => void }
  >();
  private pieces: Buffer[] = [];
  private length = 0;
  private total = 0;
  private messages = 0;
  private failed = false;

  constructor(
    private readonly input: Writable,
    output: Readable,
    private readonly event: (method: string, params: RecordValue, session?: string) => void,
    private readonly fail: () => void,
  ) {
    output.on("data", (bytes: Buffer) => {
      try {
        this.receive(bytes);
      } catch {
        this.fail();
      }
    });
    input.on("error", () => this.fail());
    output.on("error", () => this.fail());
  }

  abort(): void {
    this.failed = true;
    for (const pending of this.pending.values()) pending.reject(inputError());
    this.pending.clear();
    this.pieces = [];
    this.length = 0;
  }

  closeBrowser(): void {
    // Failure has already rejected ordinary commands. The owned browser must still
    // receive its graceful close before the process-group reaper considers a kill.
    if (!this.failed) void this.command("Browser.close").catch(() => {});
    else
      this.input.write(
        `${JSON.stringify({ id: ++this.nextId, method: "Browser.close", params: {} })}\0`,
        () => {},
      );
  }

  command(method: string, params: RecordValue = {}, sessionId?: string): Promise<RecordValue> {
    if (this.failed || this.pending.size >= 256) return Promise.reject(inputError());
    const id = ++this.nextId;
    const message = Buffer.from(
      `${JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) })}\0`,
    );
    if (message.length > 2 * 1024 * 1024) return Promise.reject(inputError());
    return new Promise((resolveResult, reject) => {
      this.pending.set(id, { resolve: resolveResult, reject });
      this.input.write(message, (error) => {
        if (error) this.fail();
      });
    });
  }

  private receive(bytes: Buffer): void {
    if (this.failed) return;
    this.total += bytes.length;
    if (this.total > MAX_CDP_TOTAL) throw inputError();
    let start = 0;
    for (;;) {
      const end = bytes.indexOf(0, start);
      const piece = bytes.subarray(start, end < 0 ? bytes.length : end);
      this.length += piece.length;
      if (this.length > MAX_CDP_MESSAGE || this.pieces.length > 32_768) throw inputError();
      if (piece.length) this.pieces.push(piece);
      if (end < 0) return;
      if (!this.length || ++this.messages > 100_000) throw inputError();
      const message: unknown = JSON.parse(Buffer.concat(this.pieces, this.length).toString("utf8"));
      this.pieces = [];
      this.length = 0;
      if (!record(message)) throw inputError();
      if (typeof message.id === "number") {
        const waiting = this.pending.get(message.id);
        if (!waiting) throw inputError();
        this.pending.delete(message.id);
        if ("error" in message) waiting.reject(inputError());
        else if (record(message.result)) waiting.resolve(message.result);
        else throw inputError();
      } else if (typeof message.method === "string" && record(message.params)) {
        if (message.sessionId !== undefined && typeof message.sessionId !== "string")
          throw inputError();
        this.event(message.method, message.params, message.sessionId);
      } else throw inputError();
      start = end + 1;
      if (start === bytes.length) return;
    }
  }
}

function validateInput(input: BrowserRenderInput): URL {
  const url = new URL(input.url);
  const { width, height, deviceScaleFactor } = input.viewport;
  if (
    !["darwin", "linux"].includes(process.platform) ||
    !isAbsolute(input.executable) ||
    input.executable !== resolve(input.executable) ||
    !isAbsolute(input.outputRoot) ||
    input.outputRoot !== resolve(input.outputRoot) ||
    input.outputRoot === "/" ||
    url.href !== input.url ||
    url.protocol !== "http:" ||
    url.hostname !== "127.0.0.1" ||
    !/^[1-9][0-9]{0,4}$/u.test(url.port) ||
    Number(url.port) > 65_535 ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !Number.isInteger(width) ||
    width < 240 ||
    width > 7680 ||
    !Number.isInteger(height) ||
    height < 240 ||
    height > 4320 ||
    ![1, 2].includes(deviceScaleFactor) ||
    width * height * deviceScaleFactor ** 2 * 4 > 60 * 1024 * 1024 ||
    !Number.isInteger(input.timeoutMs) ||
    input.timeoutMs < 250 ||
    input.timeoutMs > 120_000 ||
    !/^[a-f0-9]{64}$/u.test(input.randomSeed) ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(input.clockNow) ||
    new Date(input.clockNow).toISOString() !== input.clockNow ||
    Intl.getCanonicalLocales(input.locale)[0] !== input.locale ||
    input.locale.length > 35 ||
    !Array.isArray(input.allowedPaths) ||
    !input.allowedPaths.length ||
    input.allowedPaths.length > 4096 ||
    new Set(input.allowedPaths).size !== input.allowedPaths.length ||
    Buffer.byteLength(JSON.stringify(input.allowedPaths)) > 1024 * 1024
  )
    throw inputError();
  if (
    (input.memberSessionToken !== undefined &&
      (typeof input.memberSessionToken !== "string" ||
        input.memberSessionToken.length > 4096 ||
        !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/u.test(input.memberSessionToken))) ||
    (input.expectedForumTitle !== undefined &&
      (typeof input.expectedForumTitle !== "string" ||
        !input.expectedForumTitle ||
        input.expectedForumTitle.length > 500))
  )
    throw inputError();
  for (const path of input.allowedPaths) {
    if (
      typeof path !== "string" ||
      path.length > 2048 ||
      !path.startsWith("/") ||
      path.startsWith("//")
    )
      throw inputError();
    const parsed = new URL(path, url.origin);
    const decoded = decodeURIComponent(path);
    if (
      parsed.href !== `${url.origin}${path}` ||
      parsed.search ||
      parsed.hash ||
      decoded.includes("\\") ||
      decoded.includes("\0") ||
      decoded.split("/").some((part) => part === "." || part === "..")
    )
      throw inputError();
  }
  if (!input.allowedPaths.includes(url.pathname)) throw inputError();
  return url;
}

function bootstrap(input: BrowserRenderInput, origin: string): string {
  // This script runs in every new document before its authored JavaScript. Its binding
  // makes caught API denials sticky; Fetch interception separately checks browser requests.
  return `(() => {
    const epoch = ${Date.parse(input.clockNow)};
    const NativeDate = Date;
    function BuildDate(...args) {
      if (!new.target) return new NativeDate(epoch).toString();
      return Reflect.construct(NativeDate, args.length ? args : [epoch], new.target);
    }
    Object.setPrototypeOf(BuildDate, NativeDate);
    BuildDate.prototype = NativeDate.prototype;
    Object.defineProperty(BuildDate.prototype, "constructor", {value: BuildDate});
    Object.defineProperty(BuildDate, "now", {value: () => epoch});
    Object.defineProperty(globalThis, "Date", {value: BuildDate, writable: false, configurable: false});
    let seed = 2166136261;
    for (const character of ${JSON.stringify(input.randomSeed)}) seed = Math.imul(seed ^ character.charCodeAt(0), 16777619) >>> 0;
    Object.defineProperty(Math, "random", {value: () => {
      seed = (seed + 0x6d2b79f5) >>> 0;
      let value = Math.imul(seed ^ (seed >>> 15), seed | 1);
      value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
      return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
    }, writable: false, configurable: false});
    const reportDenied = globalThis.__npBuildDeniedV1;
    Object.defineProperty(globalThis, "__npBuildDeniedV1", {value: reportDenied, writable: false, configurable: false});
    const classifyRequest = ${classifySiteBuildBrowserRequestV1.toString()};
    const deny = (href, method) => { reportDenied(JSON.stringify(classifyRequest(href,method,${JSON.stringify(origin)},${JSON.stringify(input.allowedPaths)},${JSON.stringify(input.requestPolicy?.documentPaths ?? [])}))); throw new Error("np build request denied"); };
    const allowed = ${JSON.stringify(input.allowedPaths)};
    const requestPolicy = ${JSON.stringify(input.requestPolicy ?? null)};
    const requestAllowed = ${isSiteBuildBrowserRequestAllowedV1.toString()};
    const check = (value, method = "GET") => {
      let parsed;
      try { parsed = new URL(value, location.href); } catch { return deny(); }
      if (!requestAllowed(parsed.href,String(method),${JSON.stringify(origin)},allowed,requestPolicy)) return deny(parsed.href,String(method));
    };
    const nativeFetch = globalThis.fetch;
    Object.defineProperty(globalThis, "fetch", {value: function(value, options) {
      check(value instanceof Request ? value.url : value, options?.method ?? (value instanceof Request ? value.method : "GET"));
      return nativeFetch.apply(this, arguments);
    }, writable: false, configurable: false});
    const nativeOpen = XMLHttpRequest.prototype.open;
    Object.defineProperty(XMLHttpRequest.prototype, "open", {value: function(method, url) {
      check(url, method); return nativeOpen.apply(this, arguments);
    }, writable: false, configurable: false});
    const NativeEventSource = globalThis.EventSource;
    if (typeof NativeEventSource === "function")
      Object.defineProperty(globalThis, "EventSource", {value: new Proxy(NativeEventSource, {
        construct(target,args,newTarget) {
          let parsed;
          try {parsed=new URL(String(args[0]),location.href);} catch {return deny();}
          if (parsed.pathname !== "/api/community/events" ||
              !requestPolicy?.readRequests?.includes(parsed.pathname+parsed.search)) return deny();
          check(parsed.href,"GET");
          return Reflect.construct(target,args,newTarget);
        }
      }), writable:false,configurable:false});
    for (const name of ["WebSocket", "WebTransport", "Worker", "SharedWorker"])
      Object.defineProperty(globalThis, name, {value: function() { return deny(); }, writable: false, configurable: false});
    const css = "*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important;cursor:none!important;scroll-behavior:auto!important}html{scroll-behavior:auto!important}";
    const apply = () => {
      const style = document.createElement("style"); style.textContent = css;
      (document.head || document.documentElement).appendChild(style);
    };
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", apply, {once: true}); else apply();
  })();`;
}

function base64Png(value: unknown): Uint8Array {
  if (
    typeof value !== "string" ||
    !value.length ||
    value.length % 4 ||
    value.length > Math.ceil((64 * 1024 * 1024) / 3) * 4
  )
    throw inputError();
  const padding = value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0;
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  for (let index = 0; index < value.length - padding; index++)
    if (!alphabet.includes(value[index])) throw inputError();
  const tail = alphabet.indexOf(value[value.length - padding - 1]);
  if ((padding === 2 && tail & 15) || (padding === 1 && tail & 3)) throw inputError();
  const bytes = Buffer.from(value, "base64");
  if (bytes.length > 64 * 1024 * 1024) throw inputError();
  return bytes;
}

function groupExists(pid: number): boolean {
  try {
    process.kill(-pid, 0);
    return true;
  } catch (error) {
    if (record(error) && error.code === "ESRCH") return false;
    throw inputError();
  }
}

async function waitForBrowserClose(closed: Promise<void>, milliseconds: number): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      closed,
      new Promise<void>((done) => {
        timer = setTimeout(done, milliseconds);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

async function stopBrowser(
  child: ChildProcess,
  closed: Promise<void>,
  pipe: CdpPipe | undefined,
): Promise<{ normal: boolean; gone: boolean }> {
  if (!child.pid) return { normal: true, gone: true };
  let orphan = false;
  if (child.exitCode === null && child.signalCode === null) pipe?.closeBrowser();
  // Native syscall observation pauses every tracee; graceful Chromium shutdown
  // needs its own bounded allowance after the screenshot deadline has ended.
  // Retain the outer native deadline and fail if a forced kill is needed. A
  // captured image never converts incomplete browser cleanup into success.
  await waitForBrowserClose(closed, 30_000);
  for (let attempt = 0; attempt < 100 && groupExists(child.pid); attempt++) await delay(50);
  if (groupExists(child.pid)) {
    orphan = true;
    try {
      process.kill(-child.pid, "SIGKILL");
    } catch (error) {
      if (!record(error) || error.code !== "ESRCH") child.kill("SIGKILL");
    }
  }
  await waitForBrowserClose(closed, 1000);
  for (let attempt = 0; attempt < 20 && groupExists(child.pid); attempt++) await delay(25);
  pipe?.abort();
  const gone = !groupExists(child.pid);
  return { normal: !orphan && gone, gone };
}

/**
 * Real Chromium transport only. Its caller must independently prove the outer native/
 * container sandbox, executable/fonts/source identities, egress audit and descendant reaping.
 */
export async function renderSiteBuildBrowserPngV1(input: BrowserRenderInput): Promise<{
  png: Uint8Array;
  checks?: Awaited<ReturnType<typeof runSiteBuildBrowserPreviewChecksV1>>;
  status: number;
}> {
  const startedAt = Date.now();
  const progressStartedAt = performance.now();
  let scratch: string | undefined;
  let child: ChildProcess | undefined;
  let pipe: CdpPipe | undefined;
  let closed: Promise<void> = Promise.resolve();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopping = false;
  let failed = false;
  let stdioOverflow = false;
  let cleanupPassed = true;
  let processesGone = true;
  const diagnostic: NpSiteBuildBrowserFailureV1["diagnostic"] = {
    reason: "protocol",
    loaded: false,
    inflight: 0,
    ready: 0,
    request: null,
  };
  let phase: (typeof siteBuildBrowserPhasesV1)[number] = "input";
  let waitStep: NpSiteBuildBrowserWaitDiagnosticV1["step"] = "none";
  let waitStartedAt = progressStartedAt;
  let refreshWait = () => {};
  const setWaitStep = (next: NpSiteBuildBrowserWaitDiagnosticV1["step"]) => {
    waitStep = next;
    waitStartedAt = performance.now();
  };
  const progress = () => {
    refreshWait();
    input.onProgress?.({
      ...diagnostic,
      phase,
      reason: failed ? diagnostic.reason : null,
      elapsedMs: Math.floor(performance.now() - progressStartedAt),
    });
  };
  const setPhase = (next: (typeof siteBuildBrowserPhasesV1)[number]) => {
    setWaitStep("none");
    phase = next;
    input.onPhase?.(next);
    progress();
  };
  let rejectFailure: (error: Error) => void = () => {};
  const failure = new Promise<never>((_, reject) => {
    rejectFailure = reject;
  });
  void failure.catch(() => {});
  const fail = (reason: NpSiteBuildBrowserFailureV1["diagnostic"]["reason"] = "protocol") => {
    if (failed) return;
    diagnostic.reason = reason;
    failed = true;
    progress();
    if (stopping) return;
    pipe?.abort();
    rejectFailure(inputError());
  };
  let png: Uint8Array | undefined;
  let checks: Awaited<ReturnType<typeof runSiteBuildBrowserPreviewChecksV1>> | undefined;
  let documentStatus = 0;
  try {
    if (input.requestPolicy !== undefined)
      input = {
        ...input,
        requestPolicy: requireSiteBuildBrowserRequestPolicyV1(input.requestPolicy),
      };
    const url = validateInput(input);
    const executable = await lstat(input.executable);
    if (!executable.isFile() || executable.isSymbolicLink()) throw inputError();
    const output = await realpath(input.outputRoot);
    if (!(await lstat(output)).isDirectory()) throw inputError();
    scratch = await mkdtemp(join(output, "np-browser-"));
    await Promise.all([
      mkdir(join(scratch, "home")),
      mkdir(join(scratch, "tmp")),
      mkdir(join(scratch, "profile")),
    ]);
    setPhase("launch");
    child = spawn(
      input.executable,
      [
        "--headless=new",
        "--remote-debugging-pipe",
        "--no-startup-window",
        "--no-first-run",
        "--no-default-browser-check",
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-background-networking",
        "--disable-background-timer-throttling",
        "--disable-backgrounding-occluded-windows",
        "--disable-renderer-backgrounding",
        "--disable-breakpad",
        "--disable-crash-reporter",
        "--disable-crashpad",
        "--disable-gpu",
        "--disable-component-update",
        "--disable-default-apps",
        "--disable-domain-reliability",
        "--disable-extensions",
        "--disable-sync",
        "--dns-prefetch-disable",
        "--disable-features=Translate,MediaRouter,OptimizationHints,Prerender2,SpeculationRulesPrefetch,NetworkPrediction",
        "--metrics-recording-only",
        "--mute-audio",
        "--hide-scrollbars",
        "--force-color-profile=srgb",
        "--font-render-hinting=none",
        "--disable-lcd-text",
        "--password-store=basic",
        "--use-mock-keychain",
        "--noerrdialogs",
        "--log-level=3",
        `--lang=${input.locale}`,
        `--user-data-dir=${join(scratch, "profile")}`,
      ],
      {
        cwd: scratch,
        detached: true,
        stdio: ["ignore", "pipe", "pipe", "pipe", "pipe"],
        env: {
          PATH: "/usr/bin:/bin",
          HOME: join(scratch, "home"),
          TMPDIR: join(scratch, "tmp"),
          XDG_CONFIG_HOME: join(scratch, "home"),
          XDG_CACHE_HOME: join(scratch, "tmp"),
          LANG: "C.UTF-8",
          LC_ALL: "C.UTF-8",
          TZ: "UTC",
          DBUS_SYSTEM_BUS_ADDRESS: `unix:path=${join(scratch, "tmp/dbus-system.sock")}`,
          DBUS_SESSION_BUS_ADDRESS: `unix:path=${join(scratch, "tmp/dbus-session.sock")}`,
        },
      },
    );
    closed = new Promise((done) => {
      child?.once("close", (code, signal) => {
        if (!stopping || code !== 0 || signal !== null) fail();
        done();
      });
      child?.once("error", () => {
        fail();
        done();
      });
    });
    const inputPipe = child.stdio[3],
      outputPipe = child.stdio[4];
    if (!(inputPipe instanceof Writable) || !(outputPipe instanceof Readable)) throw inputError();
    let stdioBytes = 0;
    const boundedStdio = (bytes: Buffer) => {
      stdioBytes += bytes.length;
      if (stdioBytes > 512 * 1024) {
        stdioOverflow = true;
        fail();
      }
    };
    child.stdout?.on("data", boundedStdio);
    child.stderr?.on("data", boundedStdio);
    timer = setTimeout(
      () => fail("timeout"),
      Math.max(0, input.timeoutMs - (Date.now() - startedAt)),
    );
    const run = async () => {
      const attached = new Map<string, { session: string; type: string }>();
      const ignored = new Set<string>();
      const ready = new Map<string, Promise<void>>();
      const inflight = new Set<string>();
      const requestUrls = new Map<string, string>();
      const requestMetadata = new Map<
        string,
        {
          detail: Omit<NpSiteBuildBrowserPendingRequestV1, "ageMs">;
          startedAt: number;
        }
      >();
      // A completed SSE handshake leaves the idle set, but a later transport
      // failure still needs its safe role. Keep telemetry separate from readiness.
      const settledStreamMetadata = new Map<
        string,
        {
          detail: Omit<NpSiteBuildBrowserPendingRequestV1, "ageMs">;
          startedAt: number;
        }
      >();
      const recordNetworkFailure = (
        cause: "response" | "loading",
        params: RecordValue,
        session: string | undefined,
      ) => {
        const key = `${session}:${String(params.requestId)}`;
        const metadata = requestMetadata.get(key) ?? settledStreamMetadata.get(key);
        const errors = new Map<
          string,
          NonNullable<NpSiteBuildBrowserDiagnosticV1["networkFailure"]>["error"]
        >([
          ["net::ERR_ABORTED", "aborted"],
          ["net::ERR_CONNECTION_CLOSED", "closed"],
          ["net::ERR_CONNECTION_RESET", "reset"],
          ["net::ERR_CONNECTION_REFUSED", "refused"],
          ["net::ERR_TIMED_OUT", "timed-out"],
          ["net::ERR_FAILED", "failed"],
        ]);
        const status = record(params.response) ? params.response.status : null;
        diagnostic.networkFailure = {
          cause,
          status:
            cause === "response" &&
            typeof status === "number" &&
            Number.isInteger(status) &&
            status >= 100 &&
            status <= 599
              ? status
              : null,
          error:
            cause === "loading"
              ? ((typeof params.errorText === "string" ? errors.get(params.errorText) : null) ??
                "other")
              : null,
          canceled: cause === "loading" && params.canceled === true,
          blocked: cause === "loading" && typeof params.blockedReason === "string",
          request: metadata
            ? { ...metadata.detail, ageMs: Math.floor(performance.now() - metadata.startedAt) }
            : null,
        };
      };
      refreshWait = () => {
        // Overflow still takes the existing failure path; never normalize it to 256.
        if (inflight.size > 256) {
          delete diagnostic.wait;
          return;
        }
        const now = performance.now();
        diagnostic.inflight = inflight.size;
        diagnostic.ready = ready.size;
        diagnostic.wait = {
          step: waitStep,
          elapsedMs: Math.floor(now - progressStartedAt),
          stepElapsedMs: Math.floor(now - waitStartedAt),
          pendingCount: inflight.size,
          truncated: inflight.size > 8,
          pending: [...requestMetadata.values()].slice(0, 8).map(({ detail, startedAt }) => ({
            ...detail,
            ageMs: Math.floor(now - startedAt),
          })),
        };
      };
      let mainTarget = "";
      let mainSession = "";
      let loaded = false;
      let navigating = false;
      let mainFrame = "";
      let activity = Date.now();
      const requestAllowed = (request: unknown) => {
        if (
          !record(request) ||
          typeof request.url !== "string" ||
          !["GET", "HEAD"].includes(String(request.method))
        )
          return false;
        try {
          return isSiteBuildBrowserRequestAllowedV1(
            request.url,
            String(request.method),
            url.origin,
            input.allowedPaths,
            input.requestPolicy,
          );
        } catch {
          return false;
        }
      };
      const denyRequest = (
        sink: NpSiteBuildBrowserRequestDiagnosticV1["sink"],
        request: unknown,
      ) => {
        const row = record(request) ? request : {};
        diagnostic.request = {
          sink,
          ...classifySiteBuildBrowserRequestV1(
            row.url,
            row.method,
            url.origin,
            input.allowedPaths,
            input.requestPolicy?.documentPaths ?? [],
          ),
        };
        fail("request");
      };
      const configure = async (session: string, main: boolean) => {
        if (!pipe) throw inputError();
        await pipe.command(
          "Fetch.enable",
          { patterns: [{ urlPattern: "*", requestStage: "Request" }] },
          session,
        );
        await pipe.command("Network.enable", {}, session);
        await pipe.command("Network.setCacheDisabled", { cacheDisabled: true }, session);
        await pipe.command("Network.setBypassServiceWorker", { bypass: true }, session);
        await pipe.command(
          "Network.setExtraHTTPHeaders",
          { headers: { "Accept-Language": input.locale } },
          session,
        );
        await pipe.command("Page.enable", {}, session);
        await pipe.command("Runtime.enable", {}, session);
        await pipe.command("Runtime.addBinding", { name: "__npBuildDeniedV1" }, session);
        await pipe.command("Emulation.setTimezoneOverride", { timezoneId: "UTC" }, session);
        await pipe.command("Emulation.setLocaleOverride", { locale: input.locale }, session);
        await pipe.command(
          "Emulation.setEmulatedMedia",
          {
            features: [
              { name: "prefers-color-scheme", value: "light" },
              { name: "prefers-reduced-motion", value: "reduce" },
            ],
          },
          session,
        );
        if (main)
          await pipe.command(
            "Emulation.setDeviceMetricsOverride",
            {
              ...input.viewport,
              mobile: false,
              screenWidth: input.viewport.width,
              screenHeight: input.viewport.height,
            },
            session,
          );
        await pipe.command(
          "Page.addScriptToEvaluateOnNewDocument",
          { source: bootstrap(input, url.origin) },
          session,
        );
        await pipe.command(
          "Target.setAutoAttach",
          { autoAttach: true, waitForDebuggerOnStart: true, flatten: true },
          session,
        );
        await pipe.command("Runtime.runIfWaitingForDebugger", {}, session);
      };
      pipe = new CdpPipe(
        inputPipe,
        outputPipe,
        (method, params, session) => {
          if (failed) return;
          if (stopping) {
            if (
              ((method === "Fetch.requestPaused" || method === "Network.requestWillBeSent") &&
                !requestAllowed(params.request)) ||
              (method === "Runtime.bindingCalled" && params.name === "__npBuildDeniedV1") ||
              method === "Runtime.exceptionThrown" ||
              (method === "Runtime.consoleAPICalled" &&
                ["error", "assert"].includes(String(params.type))) ||
              method === "Network.webSocketCreated" ||
              method === "Network.webTransportCreated" ||
              method === "Inspector.targetCrashed" ||
              method === "Target.targetCrashed"
            )
              fail();
            return;
          }
          if (method === "Target.attachedToTarget") {
            if (
              !record(params.targetInfo) ||
              typeof params.targetInfo.targetId !== "string" ||
              typeof params.targetInfo.type !== "string" ||
              typeof params.sessionId !== "string"
            ) {
              fail();
              return;
            }
            const { targetId, type } = params.targetInfo;
            if (attached.size >= 32) {
              fail();
              return;
            }
            attached.set(targetId, { session: params.sessionId, type });
            if (mainTarget && targetId !== mainTarget && !ignored.has(targetId)) {
              if (type !== "iframe") {
                fail();
                return;
              }
              const task = configure(params.sessionId, false);
              ready.set(targetId, task);
              void task.catch(() => fail());
            }
          } else if (
            (method === "Target.targetCrashed" || method === "Target.targetDestroyed") &&
            params.targetId === mainTarget
          )
            fail("target");
          else if (method === "Target.detachedFromTarget" && params.sessionId === mainSession)
            fail("target");
          else if (
            method === "Inspector.targetCrashed" ||
            method === "Runtime.exceptionThrown" ||
            method === "Page.javascriptDialogOpening" ||
            method === "Page.windowOpen"
          )
            fail(method === "Runtime.exceptionThrown" ? "exception" : "target");
          else if (
            method === "Runtime.consoleAPICalled" &&
            ["error", "assert"].includes(String(params.type))
          )
            fail("console");
          else if (method === "Runtime.bindingCalled" && params.name === "__npBuildDeniedV1") {
            try {
              diagnostic.request = requireSiteBuildBrowserRequestDiagnosticV1({
                ...JSON.parse(
                  typeof params.payload === "string" && params.payload.length <= 1024
                    ? params.payload
                    : "{}",
                ),
                sink: "binding",
              });
            } catch {
              /* Raw binding payload never enters diagnostics. */
            }
            diagnostic.request ??= {
              sink: "binding",
              target: "unknown",
              query: "none",
              method: "other",
            };
            fail("request");
          } else if (
            method === "Network.webSocketCreated" ||
            method === "Network.webTransportCreated"
          )
            denyRequest("socket", null);
          else if (method === "Fetch.requestPaused") {
            activity = Date.now();
            if (
              !session ||
              !requestAllowed(params.request) ||
              typeof params.requestId !== "string"
            ) {
              denyRequest("fetch", params.request);
              return;
            }
            void pipe
              ?.command("Fetch.continueRequest", { requestId: params.requestId }, session)
              .catch(() => fail());
          } else if (method === "Network.requestWillBeSent") {
            activity = Date.now();
            if (!requestAllowed(params.request) || typeof params.requestId !== "string") {
              denyRequest("request", params.request);
              return;
            }
            inflight.add(`${session}:${params.requestId}`);
            if (record(params.request) && typeof params.request.url === "string")
              requestUrls.set(`${session}:${params.requestId}`, params.request.url);
            if (inflight.size <= 256)
              requestMetadata.set(`${session}:${params.requestId}`, {
                detail: {
                  ...classifySiteBuildBrowserPendingRequestV1(
                    record(params.request) ? params.request.url : undefined,
                    record(params.request) ? params.request.method : undefined,
                    params.type,
                    url.origin,
                    input.allowedPaths,
                    input.requestPolicy?.documentPaths ?? [],
                    input.requestPolicy?.readRequests ?? [],
                  ),
                  headersReceived: false,
                  eventStream: false,
                },
                startedAt: performance.now(),
              });
            if (inflight.size > 256) fail();
          } else if (method === "Network.loadingFinished" || method === "Network.loadingFailed") {
            activity = Date.now();
            if (method === "Network.loadingFailed")
              recordNetworkFailure("loading", params, session);
            inflight.delete(`${session}:${String(params.requestId)}`);
            requestUrls.delete(`${session}:${String(params.requestId)}`);
            requestMetadata.delete(`${session}:${String(params.requestId)}`);
            settledStreamMetadata.delete(`${session}:${String(params.requestId)}`);
            if (method === "Network.loadingFailed") fail("network");
          } else if (method === "Network.responseReceived" && record(params.response)) {
            const metadata = requestMetadata.get(`${session}:${String(params.requestId)}`);
            if (metadata) {
              metadata.detail.headersReceived = true;
              metadata.detail.eventStream = params.response.mimeType === "text/event-stream";
            }
            if (
              session === mainSession &&
              params.type === "Document" &&
              params.response.url === input.url &&
              typeof params.response.status === "number"
            )
              documentStatus = params.response.status;
            if (typeof params.response.status !== "number" || params.response.status >= 400) {
              recordNetworkFailure("response", params, session);
              fail("network");
            } else if (params.response.mimeType === "text/event-stream") {
              const key = `${session}:${String(params.requestId)}`;
              const request = requestUrls.get(key);
              if (!request) {
                fail();
                return;
              }
              const stream = new URL(request);
              if (
                stream.pathname !== "/api/community/events" ||
                !input.requestPolicy?.readRequests?.includes(stream.pathname + stream.search)
              )
                fail();
              else {
                // A successful finite-profile SSE handshake is ready even while
                // the normal stream stays open. Its requests remain audited.
                inflight.delete(key);
                const metadata = requestMetadata.get(key);
                if (metadata && settledStreamMetadata.size < 256)
                  settledStreamMetadata.set(key, metadata);
                requestMetadata.delete(key);
                activity = Date.now();
              }
            }
          } else if (method === "Page.loadEventFired" && session === mainSession && navigating)
            loaded = diagnostic.loaded = true;
          else if (
            method === "Page.frameNavigated" &&
            session === mainSession &&
            navigating &&
            record(params.frame) &&
            !params.frame.parentId
          ) {
            if (typeof params.frame.id !== "string" || params.frame.url !== input.url) fail();
            else mainFrame = params.frame.id;
          } else if (
            method === "Page.navigatedWithinDocument" &&
            params.frameId === mainFrame &&
            params.url !== input.url
          )
            fail();
        },
        fail,
      );
      await pipe.command("Browser.getVersion");
      await pipe.command("Target.setAutoAttach", {
        autoAttach: true,
        waitForDebuggerOnStart: true,
        flatten: true,
      });
      const existing = await pipe.command("Target.getTargets");
      if (!Array.isArray(existing.targetInfos)) throw inputError();
      for (const target of existing.targetInfos) {
        if (
          !record(target) ||
          typeof target.targetId !== "string" ||
          target.type !== "page" ||
          target.url !== "about:blank"
        )
          throw inputError();
        ignored.add(target.targetId);
        await pipe.command("Target.closeTarget", { targetId: target.targetId });
      }
      setPhase("protocol");
      const context = await pipe.command("Target.createBrowserContext", { disposeOnDetach: true });
      if (typeof context.browserContextId !== "string") throw inputError();
      if (input.memberSessionToken)
        await pipe.command("Storage.setCookies", {
          browserContextId: context.browserContextId,
          cookies: [
            {
              name: "np-mb-session",
              value: input.memberSessionToken,
              url: url.origin,
              path: "/",
              httpOnly: true,
              secure: false,
              sameSite: "Lax",
            },
          ],
        });
      const target = await pipe.command("Target.createTarget", {
        url: "about:blank",
        browserContextId: context.browserContextId,
      });
      if (typeof target.targetId !== "string") throw inputError();
      mainTarget = target.targetId;
      while (!attached.has(mainTarget)) {
        if (failed) throw inputError();
        await delay(5);
      }
      mainSession = attached.get(mainTarget)?.session ?? "";
      if (!mainSession) throw inputError();
      setPhase("configure");
      await configure(mainSession, true);
      navigating = true;
      activity = Date.now();
      setPhase("navigate");
      const navigation = await pipe.command("Page.navigate", { url: input.url }, mainSession);
      if (navigation.errorText || navigation.isDownload) throw inputError();
      const idle = async (step: NpSiteBuildBrowserWaitDiagnosticV1["step"]) => {
        setWaitStep(step);
        let lastProgress = 0;
        for (;;) {
          if (failed) throw inputError();
          await Promise.all(ready.values());
          diagnostic.inflight = inflight.size;
          diagnostic.ready = ready.size;
          if (Date.now() - lastProgress >= 500) {
            progress();
            lastProgress = Date.now();
          }
          if (loaded && !inflight.size && Date.now() - activity >= 250) {
            setWaitStep("none");
            return;
          }
          await delay(20);
        }
      };
      setPhase("network-idle");
      await idle("initial-idle");
      setPhase("fonts");
      setWaitStep("font-and-frames");
      progress();
      const settled = await pipe.command(
        "Runtime.evaluate",
        {
          expression: `(async () => {
          const pending = []; let count = 0;
          const visit = (doc) => {
            if (++count > 32) throw new Error("np build frame limit");
            pending.push(doc.fonts.ready);
            for (const frame of doc.querySelectorAll("iframe")) {
              if (!frame.contentDocument) throw new Error("np build frame unavailable");
              visit(frame.contentDocument);
            }
          }; visit(document); await Promise.all(pending);
          await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
          const expectedForumTitle = ${JSON.stringify(input.expectedForumTitle ?? null)};
          const forum = document.querySelector('[data-np-forum-surface="post-detail"]');
          return {href: location.href, width: innerWidth, height: innerHeight, scale: devicePixelRatio,
            forumMatches: expectedForumTitle === null || !!forum &&
              forum.querySelector('h1')?.textContent === expectedForumTitle};
        })()`,
          awaitPromise: true,
          returnByValue: true,
        },
        mainSession,
      );
      if (settled.exceptionDetails || !record(settled.result) || !record(settled.result.value))
        throw inputError();
      const page = settled.result.value;
      if (
        page.href !== input.url ||
        page.width !== input.viewport.width ||
        page.height !== input.viewport.height ||
        page.scale !== input.viewport.deviceScaleFactor ||
        page.forumMatches !== true
      )
        throw inputError();
      await idle("post-font-idle");
      if (input.previewChecks) {
        setPhase("checks");
        checks = await runSiteBuildBrowserPreviewChecksV1({
          command: (method, params) => pipe!.command(method, params, mainSession),
          frameId: mainFrame,
          context: {
            ...input.previewChecks,
            origin: url.origin,
            route: url.pathname,
            locale: input.locale,
          },
          settle: () => idle("check-idle"),
        });
      }
      if (documentStatus !== 200) throw inputError();
      // Stop authored timers/scripts after readiness. Keep CDP request auditing alive
      // through capture and graceful close so late caught attempts cannot disappear.
      setPhase("freeze");
      for (const [targetId, targetSession] of attached)
        if (!ignored.has(targetId))
          await pipe.command(
            "Emulation.setScriptExecutionDisabled",
            { value: true },
            targetSession.session,
          );
      await idle("frozen-idle");
      setPhase("screenshot");
      const screenshot = await pipe.command(
        "Page.captureScreenshot",
        {
          format: "png",
          fromSurface: true,
          captureBeyondViewport: false,
          clip: {
            x: 0,
            y: 0,
            width: input.viewport.width,
            height: input.viewport.height,
            scale: 1,
          },
        },
        mainSession,
      );
      const result = canonicalizeSiteBuildPngV1(base64Png(screenshot.data));
      const dimensions = new DataView(result.buffer, result.byteOffset, result.byteLength);
      if (
        dimensions.getUint32(16) !== input.viewport.width * input.viewport.deviceScaleFactor ||
        dimensions.getUint32(20) !== input.viewport.height * input.viewport.deviceScaleFactor
      )
        throw inputError();
      if (failed || Date.now() - startedAt > input.timeoutMs) throw inputError();
      return result;
    };
    png = await Promise.race([run(), failure]);
  } catch {
    failed = true;
    refreshWait();
  } finally {
    stopping = true;
    if (!failed && png) setPhase("close");
    if (timer) clearTimeout(timer);
    if (child) {
      try {
        const stopped = await stopBrowser(child, closed, pipe);
        cleanupPassed = stopped.normal;
        processesGone = stopped.gone;
      } catch {
        cleanupPassed = false;
        processesGone = false;
      }
    }
    pipe?.abort();
    if (scratch && processesGone) {
      try {
        await rm(scratch, { recursive: true, force: true });
      } catch {
        cleanupPassed = false;
      }
    }
  }
  if (failed || stdioOverflow || !cleanupPassed || !png)
    throw new NpSiteBuildBrowserFailureV1(phase, diagnostic);
  return { png, ...(checks ? { checks } : {}), status: documentStatus };
}
