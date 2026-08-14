import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@nexpress/shop-payment-stripe/client": fileURLToPath(
        new URL("./src/client.tsx", import.meta.url),
      ),
    },
  },
});
