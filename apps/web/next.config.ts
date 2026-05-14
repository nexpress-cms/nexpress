import { createNextConfig, defaultTranspilePackages } from "@nexpress/app/config/next-config";

// apps/web has plugins that the default scaffold doesn't ship
// (the v0.2 reference site bundles every built-in plugin). Add
// them to `transpilePackages` so Next compiles their workspace
// source. Scaffolded projects only register the plugins they
// install, so the defaults are enough.
export default createNextConfig({
  transpilePackages: [...defaultTranspilePackages, "@nexpress/plugin-reading-time"],
});
