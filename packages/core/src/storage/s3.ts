import { Readable } from "node:stream";
import type { ReadableStream } from "node:stream/web";

import type { S3Client } from "@aws-sdk/client-s3";
// `import type *` keeps this a compile-time alias only —
// the actual `import("@aws-sdk/client-s3")` happens lazily
// in `s3ModulePromise` below, so apps that don't use S3
// don't pay the import cost.
import type * as awsS3 from "@aws-sdk/client-s3";

import {
  npRequireFileMetadata,
  npRequireS3StorageAdapterConfig,
  npRequireStorageKey,
  npRequireStorageStream,
  npRequireStorageUploadData,
  npRequireStorageUrl,
} from "./contract.js";
import type { NpFileMetadata, NpStorageAdapter, S3StorageAdapterConfig } from "./types.js";

export type { S3StorageAdapterConfig } from "./types.js";

type S3Module = typeof awsS3;

let s3ModulePromise: Promise<S3Module> | null = null;

export class S3StorageAdapter implements NpStorageAdapter {
  readonly kind = "s3";
  private readonly config: S3StorageAdapterConfig;
  private clientPromise: Promise<S3Client> | null = null;
  private shutdownPromise: Promise<void> | null = null;

  constructor(config: S3StorageAdapterConfig) {
    this.config = npRequireS3StorageAdapterConfig(config);
  }

  async upload(
    key: string,
    data: Buffer | ReadableStream,
    metadata: NpFileMetadata,
  ): Promise<void> {
    const validatedKey = npRequireStorageKey(key);
    const validatedMetadata = npRequireFileMetadata(metadata);
    const validatedData = npRequireStorageUploadData(data, validatedMetadata);
    const [{ PutObjectCommand }, client] = await Promise.all([loadS3Module(), this.getClient()]);

    await client.send(
      new PutObjectCommand({
        Bucket: this.config.bucket,
        Key: validatedKey,
        Body: Buffer.isBuffer(validatedData) ? validatedData : Readable.fromWeb(validatedData),
        ContentType: validatedMetadata.contentType,
        ContentLength: validatedMetadata.contentLength,
        Metadata: {
          originalFilename: validatedMetadata.originalFilename,
        },
      }),
    );
  }

  async getStream(key: string): Promise<ReadableStream> {
    const validatedKey = npRequireStorageKey(key);
    const [{ GetObjectCommand }, client] = await Promise.all([loadS3Module(), this.getClient()]);
    const response = await client.send(
      new GetObjectCommand({
        Bucket: this.config.bucket,
        Key: validatedKey,
      }),
    );

    return npRequireStorageStream(toReadableStream(response.Body));
  }

  getUrl(key: string): Promise<string> {
    const validatedKey = npRequireStorageKey(key);
    if (this.config.endpoint) {
      const endpoint = new URL(this.config.endpoint);
      const endpointPath = endpoint.pathname.replace(/\/+$/u, "");
      endpoint.pathname = `${endpointPath}/${this.config.bucket}/`;
      endpoint.search = "";
      endpoint.hash = "";
      return Promise.resolve(npRequireStorageUrl(new URL(validatedKey, endpoint).toString()));
    }

    return Promise.resolve(
      npRequireStorageUrl(
        new URL(
          validatedKey,
          `https://${this.config.bucket}.s3.${this.config.region}.amazonaws.com/`,
        ).toString(),
      ),
    );
  }

  async delete(key: string): Promise<void> {
    const validatedKey = npRequireStorageKey(key);
    const [{ DeleteObjectCommand }, client] = await Promise.all([loadS3Module(), this.getClient()]);

    await client.send(
      new DeleteObjectCommand({
        Bucket: this.config.bucket,
        Key: validatedKey,
      }),
    );
  }

  async exists(key: string): Promise<boolean> {
    const validatedKey = npRequireStorageKey(key);
    const [{ HeadObjectCommand }, client] = await Promise.all([loadS3Module(), this.getClient()]);

    try {
      await client.send(
        new HeadObjectCommand({
          Bucket: this.config.bucket,
          Key: validatedKey,
        }),
      );
      return true;
    } catch (error) {
      if (isNotFoundError(error)) {
        return false;
      }

      throw error;
    }
  }

  shutdown(): Promise<void> {
    if (this.shutdownPromise) return this.shutdownPromise;
    const client = this.clientPromise;
    this.clientPromise = null;
    this.shutdownPromise = (async () => {
      if (client) (await client).destroy();
    })().finally(() => {
      this.shutdownPromise = null;
    });
    return this.shutdownPromise;
  }

  private async getClient(): Promise<S3Client> {
    if (this.shutdownPromise) await this.shutdownPromise;
    if (!this.clientPromise) {
      this.clientPromise = this.createClient();
    }

    return this.clientPromise;
  }

  private async createClient(): Promise<S3Client> {
    const { S3Client } = await loadS3Module();

    return new S3Client({
      region: this.config.region,
      endpoint: this.config.endpoint,
      credentials: this.config.credentials,
      forcePathStyle: Boolean(this.config.endpoint),
    });
  }
}

async function loadS3Module(): Promise<S3Module> {
  s3ModulePromise ??= import("@aws-sdk/client-s3");
  return s3ModulePromise;
}

function toReadableStream(body: unknown): ReadableStream {
  if (hasTransformToWebStream(body)) {
    return body.transformToWebStream();
  }

  if (body instanceof Readable) {
    return Readable.toWeb(body);
  }

  throw new Error("S3 object body is not a readable stream.");
}

function hasTransformToWebStream(
  value: unknown,
): value is { transformToWebStream(): ReadableStream } {
  return (
    typeof value === "object" &&
    value !== null &&
    "transformToWebStream" in value &&
    typeof value.transformToWebStream === "function"
  );
}

function isNotFoundError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (("name" in error && error.name === "NotFound") ||
      ("$metadata" in error &&
        typeof error.$metadata === "object" &&
        error.$metadata !== null &&
        "httpStatusCode" in error.$metadata &&
        error.$metadata.httpStatusCode === 404))
  );
}
