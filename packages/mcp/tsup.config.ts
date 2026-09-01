import { defineConfig } from "tsup";

const fast = process.env.NP_DEV_FAST === "1";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    http: "src/http.ts",
    stdio: "src/stdio.ts",
  },
  format: ["esm"],
  dts: !fast,
  clean: true,
  sourcemap: !fast,
  external: ["@modelcontextprotocol/sdk"],
});
