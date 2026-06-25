import { resolve } from "node:path";

export function resolveRuntimePath(segment: string): string {
  return resolve(/*turbopackIgnore: true*/ process.cwd(), segment);
}
