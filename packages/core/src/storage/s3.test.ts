import { ReadableStream } from "node:stream/web";

import { beforeEach, describe, expect, it, vi } from "vitest";

const aws = vi.hoisted(() => ({
  clientConfig: vi.fn(),
  destroy: vi.fn(),
  send: vi.fn(),
}));

vi.mock("@aws-sdk/client-s3", () => {
  class Command {
    readonly input: unknown;

    constructor(input: unknown) {
      this.input = input;
    }
  }

  return {
    DeleteObjectCommand: Command,
    GetObjectCommand: Command,
    HeadObjectCommand: Command,
    PutObjectCommand: Command,
    S3Client: class {
      constructor(config: unknown) {
        aws.clientConfig(config);
      }

      send(command: unknown): Promise<unknown> {
        return aws.send(command);
      }

      destroy(): void {
        aws.destroy();
      }
    },
  };
});

const { S3StorageAdapter } = await import("./s3.js");

describe("S3StorageAdapter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    aws.send.mockResolvedValue({});
  });

  it("passes validated object metadata to the lazy S3 client", async () => {
    const adapter = new S3StorageAdapter({
      bucket: "site-media",
      region: "ap-northeast-2",
      endpoint: "https://objects.example.com/root",
    });
    const data = Buffer.from("data");

    await adapter.upload("nested/file.txt", data, {
      contentType: "text/plain",
      contentLength: data.byteLength,
      originalFilename: "file.txt",
    });

    expect(aws.clientConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        endpoint: "https://objects.example.com/root",
        forcePathStyle: true,
        region: "ap-northeast-2",
      }),
    );
    expect(aws.send).toHaveBeenCalledWith(
      expect.objectContaining({
        input: expect.objectContaining({
          Bucket: "site-media",
          Key: "nested/file.txt",
          ContentLength: 4,
          Metadata: { originalFilename: "file.txt" },
        }),
      }),
    );
  });

  it("converts a supported S3 body and rejects an unsupported body", async () => {
    const adapter = new S3StorageAdapter({ bucket: "site-media", region: "us-east-1" });
    const stream = new ReadableStream();
    aws.send.mockResolvedValueOnce({ Body: { transformToWebStream: () => stream } });

    await expect(adapter.getStream("file.txt")).resolves.toBe(stream);

    aws.send.mockResolvedValueOnce({ Body: Buffer.from("not web-compatible") });
    await expect(adapter.getStream("file.txt")).rejects.toThrow(/not a readable stream/u);
  });

  it("returns false only for not-found responses", async () => {
    const adapter = new S3StorageAdapter({ bucket: "site-media", region: "us-east-1" });
    aws.send.mockRejectedValueOnce({ name: "NotFound" });
    await expect(adapter.exists("missing.txt")).resolves.toBe(false);

    const denied = new Error("denied");
    aws.send.mockRejectedValueOnce(denied);
    await expect(adapter.exists("denied.txt")).rejects.toBe(denied);
  });

  it("destroys an initialized client exactly once per concurrent shutdown", async () => {
    const adapter = new S3StorageAdapter({ bucket: "site-media", region: "us-east-1" });
    await adapter.exists("file.txt");

    await Promise.all([adapter.shutdown(), adapter.shutdown()]);

    expect(aws.destroy).toHaveBeenCalledOnce();
  });
});
