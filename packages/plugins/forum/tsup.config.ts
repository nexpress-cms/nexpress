import { defineConfig } from "tsup";

const fast = process.env.NP_DEV_FAST === "1";
const target = process.env.NP_BUILD_TARGET; // "index" | "client" | undefined

const externals = [
  "next",
  "next/headers",
  "next/navigation",
  "next/link",
  "react",
  "react/jsx-runtime",
  "react-dom",
  "@nexpress/blocks",
  "@nexpress/core",
  "@nexpress/editor",
  "@nexpress/editor/server",
  "@nexpress/next",
  "@nexpress/next/client",
  "@nexpress/plugin-sdk",
  "drizzle-orm",
];

// Sequenced build (see `@nexpress/next/tsup.config.ts` for
// rationale): two configs in `defineConfig([...])` race on the
// shared `dist/`. The npm `build` script runs us twice — once
// for index, once for client — which avoids the race.
const indexConfig = {
  entry: { index: "src/index.ts" },
  format: ["esm"] as const,
  dts: !fast,
  clean: true,
  sourcemap: !fast,
  external: externals,
};

const clientConfig = {
  entry: { client: "src/client.ts" },
  format: ["esm"] as const,
  dts: !fast,
  clean: false,
  sourcemap: !fast,
  external: externals,
  esbuildOptions(options: { banner?: { js?: string } }) {
    options.banner = { js: '"use client";' };
  },
};

export default defineConfig(target === "client" ? clientConfig : indexConfig);
