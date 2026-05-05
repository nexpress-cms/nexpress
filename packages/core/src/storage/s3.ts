import { Readable } from "node:stream";
import type { ReadableStream } from "node:stream/web";

import type { S3Client } from "@aws-sdk/client-s3";
// `import type *` keeps this a compile-time alias only —
// the actual `import("@aws-sdk/client-s3")` happens lazily
// in `s3ModulePromise` below, so apps that don't use S3
// don't pay the import cost.
import type * as awsS3 from "@aws-sdk/client-s3";

import type { NpFileMetadata, NpStorageAdapter } from "./types.js";

export interface S3StorageAdapterConfig {
  bucket: string;
  region: string;
  endpoint?: string;
  credentials?: {
    accessKeyId: string;
    secretAccessKey: string;
  };
}

type S3Module = typeof awsS3;

let s3ModulePromise: Promise<S3Module> | null = null;

export class S3StorageAdapter implements NpStorageAdapter {
  private clientPromise: Promise<S3Client> | null = null;

  constructor(private readonly config: S3StorageAdapterConfig) {}

  async upload(
    key: string,
    data: Buffer | ReadableStream,
    metadata: NpFileMetadata,
  ): Promise<void> {
    const [{ PutObjectCommand }, client] = await Promise.all([
      loadS3Module(),
      this.getClient(),
    ]);

    await client.send(
      new PutObjectCommand({
        Bucket: this.config.bucket,
        Key: key,
        Body: Buffer.isBuffer(data) ? data : Readable.fromWeb(data),
        ContentType: metadata.contentType,
        ContentLength: metadata.contentLength,
        Metadata: {
          originalFilename: metadata.originalFilename,
        },
      }),
    );
  }

  async getStream(key: string): Promise<ReadableStream> {
    const [{ GetObjectCommand }, client] = await Promise.all([
      loadS3Module(),
      this.getClient(),
    ]);
    const response = await client.send(
      new GetObjectCommand({
        Bucket: this.config.bucket,
        Key: key,
      }),
    );

    return toReadableStream(response.Body);
  }

  getUrl(key: string): Promise<string> {
    if (this.config.endpoint) {
      return Promise.resolve(
        new URL(
          key,
          `${normalizeUrl(this.config.endpoint)}/${this.config.bucket}/`,
        ).toString(),
      );
    }

    return Promise.resolve(
      new URL(
        key,
        `https://${this.config.bucket}.s3.${this.config.region}.amazonaws.com/`,
      ).toString(),
    );
  }

  async delete(key: string): Promise<void> {
    const [{ DeleteObjectCommand }, client] = await Promise.all([
      loadS3Module(),
      this.getClient(),
    ]);

    await client.send(
      new DeleteObjectCommand({
        Bucket: this.config.bucket,
        Key: key,
      }),
    );
  }

  async exists(key: string): Promise<boolean> {
    const [{ HeadObjectCommand }, client] = await Promise.all([
      loadS3Module(),
      this.getClient(),
    ]);

    try {
      await client.send(
        new HeadObjectCommand({
          Bucket: this.config.bucket,
          Key: key,
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

  private getClient(): Promise<S3Client> {
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
  return typeof value === "object"
    && value !== null
    && "transformToWebStream" in value
    && typeof value.transformToWebStream === "function";
}

function isNotFoundError(error: unknown): boolean {
  return typeof error === "object"
    && error !== null
    && (("name" in error && error.name === "NotFound")
      || ("$metadata" in error
        && typeof error.$metadata === "object"
        && error.$metadata !== null
        && "httpStatusCode" in error.$metadata
        && error.$metadata.httpStatusCode === 404));
}

function normalizeUrl(value: string): string {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}
