import { defineConfig } from "@nexpress/core";
import { postsCollection } from "./collections/posts";
import { pagesCollection } from "./collections/pages";

// @nexpress:plugins-imports-start
// @nexpress:plugins-imports-end

export default defineConfig({
  site: {
    name: "tmp-np-dock2-53672",
    url: process.env.SITE_URL || "http://localhost:3000",
  },
  db: {
    connectionString: process.env.DATABASE_URL!,
  },
  storage:
    process.env.NP_STORAGE_ADAPTER === "s3"
      ? {
          adapter: "s3",
          s3: {
            bucket: process.env.NP_S3_BUCKET ?? "",
            region: process.env.NP_S3_REGION ?? "us-east-1",
            endpoint: process.env.NP_S3_ENDPOINT,
          },
        }
      : {
          adapter: "local",
          local: { directory: "./public/media", baseUrl: "/media" },
        },
  collections: [postsCollection, pagesCollection],
  auth: {
    secret: process.env.NP_SECRET!,
  },
  plugins: [
    // @nexpress:plugins-list-start
    // @nexpress:plugins-list-end
  ],
});
