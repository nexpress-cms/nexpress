// Side-effect import triggers consumer's bootstrap.ts in Next bundler
// context (see lib/init-core.ts for the full rationale).
import "@/lib/bootstrap";
export { getDb, type NpDb } from "@nexpress/next";
