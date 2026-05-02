import { defineConfig } from "tsup";

const fast = process.env.NX_DEV_FAST === "1";

export default defineConfig([
  {
    entry: { index: "src/index.ts" },
    format: ["esm"],
    dts: !fast,
    clean: true,
    sourcemap: !fast,
    external: [
      "react",
      "react-dom",
      "@nexpress/core",
      "@nexpress/editor",
      "@nexpress/blocks",
    ],
  },
  {
    entry: { client: "src/client.ts" },
    format: ["esm"],
    dts: !fast,
    sourcemap: !fast,
    esbuildOptions(options) {
      options.banner = { js: '"use client";' };
    },
    external: [
      "react",
      "react-dom",
      "next",
      "next/navigation",
      "next/link",
      "@nexpress/core",
      "@nexpress/editor",
      "@nexpress/blocks",
      /^@radix-ui\//,
      "lucide-react",
      "react-hook-form",
      "@hookform/resolvers",
      "zod",
      "class-variance-authority",
      "clsx",
      "tailwind-merge",
    ],
  },
]);
