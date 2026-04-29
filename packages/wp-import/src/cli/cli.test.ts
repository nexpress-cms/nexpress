import { fileURLToPath } from "node:url";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { type CliIo, runCli } from "./index.js";

const FIXTURES_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../tests/fixtures",
);

function captureIo(): { io: CliIo; out: string[]; err: string[] } {
  const out: string[] = [];
  const err: string[] = [];
  return {
    out,
    err,
    io: {
      stdout: (line) => out.push(line),
      stderr: (line) => err.push(line),
    },
  };
}

describe("runCli", () => {
  it("prints the dry-run summary and exits 0 for a valid WXR file", async () => {
    const { io, out, err } = captureIo();
    const code = await runCli([path.join(FIXTURES_DIR, "minimal.wxr.xml")], io);
    expect(code).toBe(0);
    expect(err).toHaveLength(0);
    expect(out).toHaveLength(1);
    expect(out[0]).toContain("WordPress import — dry run");
    expect(out[0]).toContain("Acme Test Blog");
    expect(out[0]).toContain("Records (3)");
  });

  it("exits 2 with usage help when no path is given", async () => {
    const { io, out, err } = captureIo();
    const code = await runCli([], io);
    expect(code).toBe(2);
    expect(out).toHaveLength(0);
    expect(err.join("\n")).toContain("missing path");
    expect(err.join("\n")).toContain("Usage:");
  });

  it("exits 0 and prints usage for --help", async () => {
    const { io, out, err } = captureIo();
    const code = await runCli(["--help"], io);
    expect(code).toBe(0);
    expect(err).toHaveLength(0);
    expect(out.join("\n")).toContain("Usage:");
  });

  it("exits 1 with a clear error when the path doesn't exist", async () => {
    const { io, out, err } = captureIo();
    const code = await runCli(["/nope/does-not-exist.xml"], io);
    expect(code).toBe(1);
    expect(out).toHaveLength(0);
    expect(err.join("\n")).toContain("cannot read");
  });

  it("exits 2 on unknown flag with a usage hint", async () => {
    const { io, out: _out, err } = captureIo();
    const code = await runCli(["--bogus"], io);
    expect(code).toBe(2);
    expect(err.join("\n")).toContain("Usage:");
  });

  it("exits 1 with a clear hint when --apply is used without the shim's hooks", async () => {
    const { io, out, err } = captureIo();
    const code = await runCli([path.join(FIXTURES_DIR, "minimal.wxr.xml"), "--apply"], io);
    expect(code).toBe(1);
    expect(out).toHaveLength(0);
    expect(err.join("\n")).toContain("--apply requires the shim");
  });

  it("21.8 — passes ctx.createAuthors=false when --no-create-authors is set", async () => {
    const { io } = captureIo();
    const received: { createAuthors?: boolean } = {};
    const code = await runCli(
      [path.join(FIXTURES_DIR, "minimal.wxr.xml"), "--apply", "--no-create-authors"],
      io,
      {
        applyBundle: (_b, ctx) => {
          received.createAuthors = ctx.createAuthors;
          return Promise.resolve({
            applied: [], skipped: [], errors: [],
            attachments: { byId: new Map(), byUrl: new Map() },
            media: null, taxonomies: null, comments: null, authors: null, notes: [],
          });
        },
        resolveActor: () =>
          Promise.resolve({
            id: "u1", email: "x@y.com", name: "x", role: "admin", tokenVersion: 0,
          }),
      },
    );
    expect(code).toBe(0);
    expect(received.createAuthors).toBe(false);
  });

  it("21.8 — defaults ctx.createAuthors=true when --no-create-authors is omitted", async () => {
    const { io } = captureIo();
    const received: { createAuthors?: boolean } = {};
    const code = await runCli(
      [path.join(FIXTURES_DIR, "minimal.wxr.xml"), "--apply"],
      io,
      {
        applyBundle: (_b, ctx) => {
          received.createAuthors = ctx.createAuthors;
          return Promise.resolve({
            applied: [], skipped: [], errors: [],
            attachments: { byId: new Map(), byUrl: new Map() },
            media: null, taxonomies: null, comments: null, authors: null, notes: [],
          });
        },
        resolveActor: () =>
          Promise.resolve({
            id: "u1", email: "x@y.com", name: "x", role: "admin", tokenVersion: 0,
          }),
      },
    );
    expect(code).toBe(0);
    expect(received.createAuthors).toBe(true);
  });

  it("21.9 — loads collection mappings from --config and forwards them to applyBundle", async () => {
    const { io, err } = captureIo();
    const configPath = path.join(FIXTURES_DIR, "config.json");
    const captured: { mappings?: Record<string, { collection: string }> } = {};
    const code = await runCli(
      [path.join(FIXTURES_DIR, "minimal.wxr.xml"), "--apply", "--config", configPath],
      io,
      {
        applyBundle: (_b, ctx) => {
          captured.mappings = ctx.collectionMappings;
          return Promise.resolve({
            applied: [], skipped: [], errors: [],
            attachments: { byId: new Map(), byUrl: new Map() },
            media: null, taxonomies: null, comments: null, authors: null, notes: [],
          });
        },
        resolveActor: () =>
          Promise.resolve({
            id: "u1", email: "x@y.com", name: "x", role: "admin", tokenVersion: 0,
          }),
      },
    );
    expect(err).toEqual([]);
    expect(code).toBe(0);
    expect(captured.mappings?.product?.collection).toBe("products");
  });

  it("21.12 — passes ctx.strict / ctx.update / ctx.reportHtmlPath when the flags are set", async () => {
    const { io } = captureIo();
    const captured: { strict?: boolean; update?: boolean; reportHtmlPath?: string | null } = {};
    const code = await runCli(
      [
        path.join(FIXTURES_DIR, "minimal.wxr.xml"),
        "--apply",
        "--strict",
        "--update",
        "--report-html",
      ],
      io,
      {
        applyBundle: (_b, ctx) => {
          captured.strict = ctx.strict;
          captured.update = ctx.update;
          captured.reportHtmlPath = ctx.reportHtmlPath;
          return Promise.resolve({
            applied: [], skipped: [], errors: [],
            attachments: { byId: new Map(), byUrl: new Map() },
            media: null, taxonomies: null, comments: null, authors: null, notes: [],
          });
        },
        resolveActor: () =>
          Promise.resolve({
            id: "u1", email: "x@y.com", name: "x", role: "admin", tokenVersion: 0,
          }),
      },
    );
    expect(code).toBe(0);
    expect(captured.strict).toBe(true);
    expect(captured.update).toBe(true);
    // Default path is `<wxr>.report.html` when --report-html has no value.
    expect(captured.reportHtmlPath).toMatch(/\.report\.html$/);
  });

  it("21.12 — defaults ctx.strict / ctx.update / ctx.reportHtmlPath off when flags omitted", async () => {
    const { io } = captureIo();
    const captured: { strict?: boolean; update?: boolean; reportHtmlPath?: string | null } = {};
    const code = await runCli(
      [path.join(FIXTURES_DIR, "minimal.wxr.xml"), "--apply"],
      io,
      {
        applyBundle: (_b, ctx) => {
          captured.strict = ctx.strict;
          captured.update = ctx.update;
          captured.reportHtmlPath = ctx.reportHtmlPath;
          return Promise.resolve({
            applied: [], skipped: [], errors: [],
            attachments: { byId: new Map(), byUrl: new Map() },
            media: null, taxonomies: null, comments: null, authors: null, notes: [],
          });
        },
        resolveActor: () =>
          Promise.resolve({
            id: "u1", email: "x@y.com", name: "x", role: "admin", tokenVersion: 0,
          }),
      },
    );
    expect(code).toBe(0);
    expect(captured.strict).toBe(false);
    expect(captured.update).toBe(false);
    expect(captured.reportHtmlPath).toBeNull();
  });

  it("21.14 — passes ctx.resumeStatePath when --resume is set", async () => {
    const { io } = captureIo();
    const captured: { resumeStatePath?: string | null } = {};
    const code = await runCli(
      [path.join(FIXTURES_DIR, "minimal.wxr.xml"), "--apply", "--resume"],
      io,
      {
        applyBundle: (_b, ctx) => {
          captured.resumeStatePath = ctx.resumeStatePath;
          return Promise.resolve({
            applied: [], skipped: [], errors: [],
            attachments: { byId: new Map(), byUrl: new Map() },
            media: null, taxonomies: null, comments: null, authors: null, notes: [],
          });
        },
        resolveActor: () =>
          Promise.resolve({
            id: "u1", email: "x@y.com", name: "x", role: "admin", tokenVersion: 0,
          }),
      },
    );
    expect(code).toBe(0);
    expect(captured.resumeStatePath).toMatch(/\.import-state\.json$/);
  });

  it("21.9 — exits 1 with a clear message when --config points at a malformed file", async () => {
    const { io, err } = captureIo();
    const configPath = path.join(FIXTURES_DIR, "config-bad.json");
    const code = await runCli(
      [path.join(FIXTURES_DIR, "minimal.wxr.xml"), "--apply", "--config", configPath],
      io,
      {
        applyBundle: () => Promise.reject(new Error("should not run")),
        resolveActor: () => Promise.reject(new Error("should not run")),
      },
    );
    expect(code).toBe(1);
    expect(err.join("\n")).toMatch(/wpType|invalid JSON|cannot read/);
  });
});
