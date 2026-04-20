import { randomBytes } from "node:crypto";

export function generateSecret(): string {
  return randomBytes(32).toString("hex");
}

export function formatProjectName(name: string): string {
  const formatted = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");

  return formatted || "my-nexpress-site";
}
