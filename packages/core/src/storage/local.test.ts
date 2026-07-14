import { access, mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ReadableStream } from "node:stream/web";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { LocalStorageAdapter } from "./local.js";
import {
  npDeleteStorageObject,
  npGetStorageObjectStream,
  npStorageObjectExists,
  npUploadStorageObject,
} from "./operations.js";

describe("LocalStorageAdapter", () => {
  let directory: string;
  let outsideDirectory: string;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "nexpress-storage-"));
    outsideDirectory = await mkdtemp(join(tmpdir(), "nexpress-storage-outside-"));
  });

  afterEach(async () => {
    await Promise.all([
      rm(directory, { recursive: true, force: true }),
      rm(outsideDirectory, { recursive: true, force: true }),
    ]);
  });

  it("round-trips an object through the validated operation boundary", async () => {
    const adapter = new LocalStorageAdapter({ directory, baseUrl: "/media" });
    const data = Buffer.from("stored object", "utf8");

    await npUploadStorageObject(adapter, "nested/object.txt", data, {
      contentType: "text/plain; charset=utf-8",
      contentLength: data.byteLength,
      originalFilename: "object.txt",
    });

    await expect(npStorageObjectExists(adapter, "nested/object.txt")).resolves.toBe(true);
    const stream = await npGetStorageObjectStream(adapter, "nested/object.txt");
    await expect(new Response(stream).text()).resolves.toBe("stored object");
    await expect(adapter.getUrl("nested/object.txt")).resolves.toBe("/media/nested/object.txt");

    await npDeleteStorageObject(adapter, "nested/object.txt");
    await npDeleteStorageObject(adapter, "nested/object.txt");
    await expect(npStorageObjectExists(adapter, "nested/object.txt")).resolves.toBe(false);
  });

  it("confines file operations to the configured root", async () => {
    const adapter = new LocalStorageAdapter({ directory, baseUrl: "/media" });

    await expect(adapter.exists("../outside.txt")).rejects.toThrow(/safe relative object key/u);
    await expect(adapter.exists("nested/../../outside.txt")).rejects.toThrow(
      /safe relative object key/u,
    );
  });

  it("keeps the previous object when a streaming replacement fails", async () => {
    const adapter = new LocalStorageAdapter({ directory, baseUrl: "/media" });
    const original = Buffer.from("original");
    await adapter.upload("object.txt", original, {
      contentType: "text/plain",
      contentLength: original.byteLength,
      originalFilename: "object.txt",
    });
    const failedStream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(Buffer.from("partial"));
        controller.error(new Error("stream failed"));
      },
    });

    await expect(
      adapter.upload("object.txt", failedStream, {
        contentType: "text/plain",
        contentLength: 7,
        originalFilename: "object.txt",
      }),
    ).rejects.toThrow("stream failed");

    const stored = await adapter.getStream("object.txt");
    await expect(new Response(stored).text()).resolves.toBe("original");
  });

  it("does not confuse a dot-prefixed segment with parent traversal", async () => {
    const adapter = new LocalStorageAdapter({ directory, baseUrl: "/media" });

    await expect(adapter.exists("..hidden/object.txt")).resolves.toBe(false);
  });

  it("rejects a symbolic-link parent instead of writing outside the root", async () => {
    const adapter = new LocalStorageAdapter({ directory, baseUrl: "/media" });
    await symlink(outsideDirectory, join(directory, "linked"), "dir");
    const data = Buffer.from("outside");

    await expect(
      adapter.upload("linked/object.txt", data, {
        contentType: "text/plain",
        contentLength: data.byteLength,
        originalFilename: "object.txt",
      }),
    ).rejects.toThrow(/symbolic link/u);
    await expect(access(join(outsideDirectory, "object.txt"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });
});
