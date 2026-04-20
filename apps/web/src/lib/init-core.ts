import {
  setDb as setCoreDb,
  setMediaDb,
  setStorageAdapter,
  createStorageAdapter,
} from "@nexpress/core";

import { getDb } from "@/lib/db";

let initialized = false;

export function ensureCoreServices(): void {
  if (initialized) return;

  const db = getDb();
  setCoreDb(db);
  setMediaDb(db);

  const storageConfig =
    process.env.NX_STORAGE_ADAPTER === "s3"
      ? ({
          adapter: "s3" as const,
          s3: {
            bucket: process.env.NX_S3_BUCKET ?? "",
            region: process.env.NX_S3_REGION ?? "us-east-1",
            endpoint: process.env.NX_S3_ENDPOINT,
          },
        })
      : ({
          adapter: "local" as const,
          local: {
            directory: process.env.NX_STORAGE_DIR ?? "./uploads",
            baseUrl: process.env.NX_STORAGE_URL ?? "/uploads",
          },
        });

  setStorageAdapter(createStorageAdapter(storageConfig));
  initialized = true;
}
