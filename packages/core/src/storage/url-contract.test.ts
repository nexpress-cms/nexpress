import { describe, expect, it } from "vitest";

import { LocalStorageAdapter } from "./local.js";
import { S3StorageAdapter } from "./s3.js";

describe("storage URL construction", () => {
  it("uses the site root as a valid local storage base path", async () => {
    const adapter = new LocalStorageAdapter({ directory: "./media", baseUrl: "/" });

    await expect(adapter.getUrl("nested/image.jpg")).resolves.toBe("/nested/image.jpg");
  });

  it("preserves an absolute local storage base path", async () => {
    const adapter = new LocalStorageAdapter({
      directory: "./media",
      baseUrl: "https://cdn.example.com/assets/",
    });

    await expect(adapter.getUrl("nested/image.jpg")).resolves.toBe(
      "https://cdn.example.com/assets/nested/image.jpg",
    );
  });

  it("preserves an S3 endpoint path before the bucket", async () => {
    const adapter = new S3StorageAdapter({
      bucket: "media",
      region: "us-east-1",
      endpoint: "https://s3.example.com/root/",
    });

    await expect(adapter.getUrl("nested/image.jpg")).resolves.toBe(
      "https://s3.example.com/root/media/nested/image.jpg",
    );
  });
});
