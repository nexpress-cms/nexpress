import { defineConfig } from "vitest/config";

// Build tests load and canonicalize all default plugin and theme declarations.
// Keep one file active while preserving every assertion and deadline.
export default defineConfig({
  test: { maxWorkers: 1 },
});
