import { defineConfig } from "tsup";

const fast = process.env.NP_DEV_FAST === "1";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  dts: !fast,
  clean: true,
  sourcemap: !fast,
  external: [
    "@nexpress/core",
    "@nexpress/core/auth",
    "@nexpress/oauth-providers",
    "@nexpress/plugin-sdk",
  ],
});
