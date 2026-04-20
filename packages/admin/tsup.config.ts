import { defineConfig } from "tsup";

export default defineConfig([
  {
    entry: { index: "src/index.ts" },
    format: ["esm"],
    dts: true,
    clean: true,
    sourcemap: true,
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
    dts: true,
    sourcemap: true,
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
