import { ReadableStream } from "node:stream/web";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  npAnalyzeFileMetadata,
  npAnalyzeStorageKey,
  npAnalyzeStorageRuntimeConfig,
  npReadStorageRuntimeConfig,
  npRequireStorageAdapter,
} from "./contract.js";
import {
  npCloseStorageAdapter,
  npDeleteStorageObject,
  npGetStorageObjectStream,
  npGetStorageObjectUrl,
  npStorageObjectExists,
  npUploadStorageObject,
} from "./operations.js";
import {
  getOptionalStorageAdapter,
  getOptionalStorageRuntimeConfig,
  npShutdownStorageAdapter,
  setStorageAdapter,
} from "./registry.js";
import { configureStorageRuntime } from "./runtime.js";
import type { NpStorageAdapter } from "./types.js";

function adapter(overrides: Partial<NpStorageAdapter> = {}): NpStorageAdapter {
  return {
    kind: "memory",
    upload: vi.fn(() => Promise.resolve()),
    getStream: vi.fn(() => Promise.resolve(new ReadableStream())),
    getUrl: vi.fn(() => Promise.resolve("/media/file.txt")),
    delete: vi.fn(() => Promise.resolve()),
    exists: vi.fn(() => Promise.resolve(true)),
    ...overrides,
  };
}

afterEach(async () => {
  await npShutdownStorageAdapter();
});

describe("storage runtime configuration contract", () => {
  it("reads exact local, S3, and custom runtime intent", () => {
    expect(npReadStorageRuntimeConfig({})).toEqual({
      adapter: "local",
      local: { directory: "./public/media", baseUrl: "/media" },
    });
    expect(
      npReadStorageRuntimeConfig({
        NP_STORAGE_ADAPTER: "s3",
        NP_S3_BUCKET: "site-media",
        NP_S3_REGION: "ap-northeast-2",
        NP_S3_ENDPOINT: "https://objects.example.com/root",
      }),
    ).toEqual({
      adapter: "s3",
      s3: {
        bucket: "site-media",
        region: "ap-northeast-2",
        endpoint: "https://objects.example.com/root",
      },
    });
    expect(npReadStorageRuntimeConfig({ NP_STORAGE_ADAPTER: "custom" })).toEqual({
      adapter: "custom",
    });
  });

  it.each([
    [{ NP_STORAGE_ADAPTER: "S3" }, "env.NP_STORAGE_ADAPTER"],
    [{ NP_STORAGE_ADAPTER: "s3", NP_S3_BUCKET: "site-media" }, "storage.runtime.s3.region"],
    [
      {
        NP_STORAGE_ADAPTER: "s3",
        NP_S3_BUCKET: "127.0.0.1",
        NP_S3_REGION: "us-east-1",
      },
      "storage.runtime.s3.bucket",
    ],
    [
      {
        NP_STORAGE_ADAPTER: "s3",
        NP_S3_BUCKET: "site.-media",
        NP_S3_REGION: "us-east-1",
      },
      "storage.runtime.s3.bucket",
    ],
  ])("fails closed on malformed environment intent", (env, path) => {
    expect(() => npReadStorageRuntimeConfig(env)).toThrow(
      expect.objectContaining({
        name: "NpStorageContractError",
        issues: expect.arrayContaining([expect.objectContaining({ path })]),
      }),
    );
  });

  it("rejects inactive and unknown runtime fields", () => {
    expect(
      npAnalyzeStorageRuntimeConfig({
        adapter: "custom",
        local: { directory: "./media", baseUrl: "/media" },
        typo: true,
      }),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "unknown-field", path: "storage.runtime.local" }),
        expect.objectContaining({ code: "unknown-field", path: "storage.runtime.typo" }),
      ]),
    );
  });
});

describe("storage object contract", () => {
  it.each(["media/image.jpg", "..hidden/file.txt", "folder/name.with-dots_1-2"])(
    "accepts a canonical relative object key: %s",
    (key) => {
      expect(npAnalyzeStorageKey(key)).toEqual([]);
    },
  );

  it.each([
    "",
    "/absolute",
    "../escape",
    "folder/../escape",
    "folder//file",
    "folder/file name",
    "folder\\file",
  ])("rejects an unsafe object key: %s", (key) => {
    expect(npAnalyzeStorageKey(key)).toEqual([
      expect.objectContaining({ code: "invalid-field", path: "storage.key" }),
    ]);
  });

  it("requires exact metadata and matching Buffer lengths", async () => {
    expect(
      npAnalyzeFileMetadata({
        contentType: "text/plain",
        contentLength: 4,
        originalFilename: "file.txt",
        extra: true,
      }),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "unknown-field", path: "storage.metadata.extra" }),
      ]),
    );

    await expect(
      npUploadStorageObject(adapter(), "file.txt", Buffer.from("five"), {
        contentType: "text/plain",
        contentLength: 3,
        originalFilename: "file.txt",
      }),
    ).rejects.toThrow(/Buffer byte length/u);
  });

  it("rejects incomplete or non-canonical adapters", () => {
    expect(() =>
      npRequireStorageAdapter({ kind: "Memory Store", upload: () => undefined }),
    ).toThrow(
      expect.objectContaining({
        issues: expect.arrayContaining([
          expect.objectContaining({ path: "storage.adapter.kind" }),
          expect.objectContaining({ path: "storage.adapter.getStream" }),
        ]),
      }),
    );
  });

  it("validates every adapter result at the dispatch boundary", async () => {
    const broken = {
      kind: "broken",
      upload: () => Promise.resolve("unexpected"),
      getStream: () => Promise.resolve(Buffer.from("not a stream")),
      getUrl: () => Promise.resolve("javascript:alert(1)"),
      delete: () => Promise.resolve(false),
      exists: () => Promise.resolve("yes"),
      shutdown: () => Promise.resolve("closed"),
    } as unknown as NpStorageAdapter;
    const metadata = {
      contentType: "text/plain",
      contentLength: 1,
      originalFilename: "x.txt",
    };

    await expect(
      npUploadStorageObject(broken, "x.txt", Buffer.from("x"), metadata),
    ).rejects.toThrow(/resolve to void/u);
    await expect(npGetStorageObjectStream(broken, "x.txt")).rejects.toThrow(/ReadableStream/u);
    await expect(npGetStorageObjectUrl(broken, "x.txt")).rejects.toThrow(/HTTP\(S\)/u);
    await expect(npDeleteStorageObject(broken, "x.txt")).rejects.toThrow(/resolve to void/u);
    await expect(npStorageObjectExists(broken, "x.txt")).rejects.toThrow(/boolean/u);
    await expect(npCloseStorageAdapter(broken)).rejects.toThrow(/resolve to void/u);
  });
});

describe("storage runtime registry", () => {
  it("installs only a non-built-in custom adapter for custom intent", () => {
    const custom = adapter();

    expect(configureStorageRuntime({ adapter: "custom" }, custom)).toBe(custom);
    expect(getOptionalStorageAdapter()).toBe(custom);
    expect(getOptionalStorageRuntimeConfig()).toEqual({ adapter: "custom" });
    expect(() => configureStorageRuntime({ adapter: "custom" }, adapter({ kind: "s3" }))).toThrow(
      /non-built-in adapter kind/u,
    );
    expect(getOptionalStorageAdapter()).toBe(custom);
  });

  it("rejects custom injection for a built-in runtime intent", () => {
    expect(() =>
      configureStorageRuntime(
        {
          adapter: "local",
          local: { directory: "./media", baseUrl: "/media" },
        },
        adapter(),
      ),
    ).toThrow(/only be injected when adapter is custom/u);
  });

  it("detaches the active adapter before awaiting teardown", async () => {
    let detachedDuringShutdown = false;
    setStorageAdapter(
      adapter({
        shutdown: () => {
          detachedDuringShutdown = getOptionalStorageAdapter() === null;
          return Promise.resolve();
        },
      }),
    );

    await npShutdownStorageAdapter();

    expect(detachedDuringShutdown).toBe(true);
    expect(getOptionalStorageAdapter()).toBeNull();
    expect(getOptionalStorageRuntimeConfig()).toBeNull();
  });
});
