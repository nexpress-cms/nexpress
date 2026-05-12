// Stub — see ./init-core.ts for the rationale.
import type { NpDb } from "@nexpress/next";

export function getDb(): NpDb {
  throw new Error("stub — overridden by consumer at compile time");
}

export type { NpDb };
