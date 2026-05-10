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
  "@nexpress/core",
];

// Two build phases run sequentially via the `build` script
// (`tsup index && tsup client`). Doing them as a single
// `defineConfig([...])` array runs them in parallel, which
// races on the shared `dist/` directory — the index entry's
// `clean: true` can wipe the client entry's already-emitted
// dts. Sequencing avoids that.
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
