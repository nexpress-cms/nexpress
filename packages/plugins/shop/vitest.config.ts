import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@nexpress/plugin-shop/client": fileURLToPath(new URL("./src/client.tsx", import.meta.url)),
    },
  },
});
