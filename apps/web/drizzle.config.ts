import { createDrizzleConfig } from "@nexpress/app/config/drizzle-config";

// Reach up to the monorepo root `.env` — the shared dev convention
// in this repo. A scaffolded project would omit this and pick up
// the local `.env` default.
export default createDrizzleConfig({ envPath: "../../.env" });
