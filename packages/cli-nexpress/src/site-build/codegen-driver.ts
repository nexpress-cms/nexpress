import { SiteBuildError } from "./artifact-io.js";
import {
  createSiteBuildGenerationPreloadV1,
  type NpSiteBuildGenerationContextV1,
} from "./generation-context.js";

export interface NpSiteBuildCodegenDriverInputV1 {
  context: NpSiteBuildGenerationContextV1;
  command: { id: string; template: "schema-generate" | "migration-generate"; name: string | null };
  configPath: "src/nexpress.config.ts" | "nexpress.config.ts";
  preloadPath: string;
  loaderPath: string;
}

/** Fixed generation-only source. Parsing paths/context confers no tool or execution trust;
 * callers must observe and lease actual installed tools and the private workspace.
 * The normal command executor and the authoring probe share these exact drivers.
 */
export function createSiteBuildCodegenDriverV1(input: NpSiteBuildCodegenDriverInputV1) {
  if (
    !input ||
    !["src/nexpress.config.ts", "nexpress.config.ts"].includes(input.configPath) ||
    input.loaderPath !== "/np/project/node_modules/@nexpress/cli/dist/site-build-loader.js" ||
    !/^\/np\/project\/\.nexpress\/site\/tmp\/(?:command-executor|codegen-source)-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/generation-(?:0|[1-9][0-9]*)\.mjs$/u.test(
      input.preloadPath,
    )
  )
    throw new SiteBuildError("path");
  const preload = createSiteBuildGenerationPreloadV1(input.context, input.command);
  const driver =
    input.command.template === "schema-generate"
      ? `import config from ${JSON.stringify(`file:///np/project/${input.configPath}`)};\nimport {generateSchema} from "@nexpress/app/scripts/generate-schema";\ngenerateSchema({config,projectRoot:"/np/project"});\n`
      : `import {assertSiteBuildGenerationJournalV1} from ${JSON.stringify(`file://${input.preloadPath}`)};\nimport {spawn} from "node:child_process";\nconst child=spawn("/usr/local/bin/node",["/np/project/node_modules/drizzle-kit/bin.cjs","generate","--config","drizzle.config.ts","--name",${JSON.stringify(input.command.name)}],{stdio:"inherit",shell:false,env:process.env});\nawait new Promise((resolve,reject)=>{child.once("error",reject);child.once("close",(code,signal)=>code===0&&signal===null?resolve():reject(new Error("named-migration-failed")));});\nconst {generateMigrations}=await import("@nexpress/app/scripts/generate-migrations-core");\nawait generateMigrations();\nassertSiteBuildGenerationJournalV1();\n`;
  return { preload, driver };
}
