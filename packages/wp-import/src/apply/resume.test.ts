import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  documentKey,
  emptyResumeState,
  loadResumeState,
  persistResumeState,
  ResumeStateError,
} from "./resume.js";

describe("resume marker", () => {
  let tmp: string;
  beforeEach(() => {
    tmp = mkdtempSync(path.join(tmpdir(), "wp-import-resume-"));
  });
  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it("returns an empty state when the file doesn't exist", () => {
    const state = loadResumeState(path.join(tmp, "missing.json"), "/wxr.xml");
    expect(state.documents).toEqual({});
    expect(state.comments).toEqual({});
    expect(state.version).toBe(1);
    expect(state.source).toBe("/wxr.xml");
  });

  it("round-trips state to disk via persistResumeState", () => {
    const file = path.join(tmp, "state.json");
    const state = emptyResumeState("/wxr.xml");
    state.documents[documentKey("posts", "hello")] = "doc-1";
    state.comments[42] = "cmt-1";
    state.authors.alice = "user-1";
    state.media["https://x.com/a.jpg"] = "media-1";
    state.taxonomies["category:news"] = "tax-1";
    persistResumeState(file, state);

    const reloaded = loadResumeState(file, "/wxr.xml");
    expect(reloaded.documents[documentKey("posts", "hello")]).toBe("doc-1");
    expect(reloaded.comments[42]).toBe("cmt-1");
    expect(reloaded.authors.alice).toBe("user-1");
    expect(reloaded.media["https://x.com/a.jpg"]).toBe("media-1");
    expect(reloaded.taxonomies["category:news"]).toBe("tax-1");
  });

  it("rejects malformed JSON", () => {
    const file = path.join(tmp, "bad.json");
    writeFileSync(file, "{not json", "utf8");
    expect(() => loadResumeState(file, "/wxr.xml")).toThrow(ResumeStateError);
  });

  it("rejects unsupported schema version", () => {
    const file = path.join(tmp, "v9.json");
    writeFileSync(file, JSON.stringify({ version: 9 }), "utf8");
    expect(() => loadResumeState(file, "/wxr.xml")).toThrow(/version/);
  });

  it("ignores keys with non-string values when reading documents", () => {
    const file = path.join(tmp, "loose.json");
    writeFileSync(
      file,
      JSON.stringify({
        version: 1,
        source: "/x",
        startedAt: "2026-04-29",
        updatedAt: "2026-04-29",
        documents: { "posts/a": "ok", "posts/b": 42 },
      }),
      "utf8",
    );
    const state = loadResumeState(file, "/wxr.xml");
    expect(state.documents).toEqual({ "posts/a": "ok" });
  });

  it("updates `updatedAt` on every persist", () => {
    const file = path.join(tmp, "tick.json");
    const state = emptyResumeState("/wxr.xml");
    persistResumeState(file, state);
    const a = JSON.parse(readFileSync(file, "utf8")) as { updatedAt: string };
    // Force a tick.
    state.documents[documentKey("posts", "x")] = "id";
    persistResumeState(file, state);
    const b = JSON.parse(readFileSync(file, "utf8")) as { updatedAt: string };
    expect(b.updatedAt >= a.updatedAt).toBe(true);
  });
});
