import { readFile, realpath, stat } from "node:fs/promises";
import { createRequire, isBuiltin, type LoadHook, type ResolveHook } from "node:module";
import { dirname, extname, isAbsolute, join, resolve as resolvePath } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { ts } from "ts-morph";

// Private fixed worker loader. No package-manager hooks, project scripts, compiler plugins,
// config evaluation, child compiler or inherited NODE_OPTIONS are involved.
const project = process.env.NP_BUILD_CAPSULE_PROJECT;
const dependencies = process.env.NP_BUILD_CAPSULE_DEPENDENCIES;
if (!project || !dependencies || !isAbsolute(project) || !isAbsolute(dependencies))
  throw new Error("Build capsule loader is unavailable");
const within = (root: string, path: string) => path === root || path.startsWith(`${root}/`);
async function confined(path: string): Promise<string> {
  const canonical = await realpath(path);
  // Two immutable framework assets in the native renderer image. Their bytes
  // are included in that image's identity, never taken from model input.
  if (
    process.platform === "linux" &&
    ["/opt/np/driver/worker.mjs", "/opt/np/driver/clock.mjs"].includes(canonical)
  )
    return canonical;
  if (!within(project!, canonical) && !within(dependencies!, canonical))
    throw new Error("Module is outside the Build capsule");
  return canonical;
}
async function candidate(path: string): Promise<string | null> {
  const candidates = [path];
  if (path.endsWith(".js")) candidates.push(path.slice(0, -3) + ".ts", path.slice(0, -3) + ".tsx");
  // TypeScript source specifiers may contain a descriptive dot without a
  // module extension (the standard scaffold imports @/nexpress.config).
  // Recognized module/data suffixes remain exact; no compiler plugins run.
  if (
    ![".ts", ".tsx", ".mts", ".cts", ".js", ".mjs", ".cjs", ".json", ".node"].includes(
      extname(path),
    )
  )
    candidates.push(
      ...[".ts", ".tsx", ".js", ".mjs", "/index.ts", "/index.tsx", "/index.js"].map(
        (suffix) => path + suffix,
      ),
    );
  for (const file of candidates) {
    try {
      if ((await stat(file)).isFile()) return await confined(file);
    } catch (error) {
      if (
        (error as NodeJS.ErrnoException).code !== "ENOENT" &&
        (error as NodeJS.ErrnoException).code !== "ENOTDIR"
      )
        throw error;
    }
  }
  return null;
}

// The standard NexPress scaffold owns this alias. Unknown aliases fail resolution;
// evaluating a project's compiler/plugins to discover aliases would expand authority.
export const resolve: ResolveHook = async (specifier, context, nextResolve) => {
  if (isBuiltin(specifier)) return nextResolve(specifier, context);
  if (specifier.startsWith("@/")) {
    const target = await candidate(resolvePath(project, "src", specifier.slice(2)));
    if (!target || !within(join(project, "src"), target)) throw new Error("Invalid project alias");
    return { url: pathToFileURL(target).href, shortCircuit: true };
  }
  try {
    const result = await nextResolve(specifier, context);
    if (!result.url.startsWith("file:")) throw new Error("Unsupported capsule module protocol");
    await confined(fileURLToPath(result.url));
    return result;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "ERR_MODULE_NOT_FOUND" && code !== "ERR_UNSUPPORTED_DIR_IMPORT") throw error;
    let target: string | null = null;
    if (
      context.parentURL?.startsWith("file:") &&
      (specifier.startsWith(".") || isAbsolute(specifier))
    ) {
      target = await candidate(resolvePath(dirname(fileURLToPath(context.parentURL)), specifier));
    } else if (!specifier.includes(":") && context.parentURL?.startsWith("file:")) {
      // Published Next/React entry points also expose CommonJS-style extensionless subpaths.
      try {
        target = await confined(createRequire(context.parentURL).resolve(specifier));
      } catch {
        throw error;
      }
    }
    if (!target) throw error;
    return { url: pathToFileURL(target).href, shortCircuit: true };
  }
};

export const load: LoadHook = async (url, context, nextLoad) => {
  if (url.startsWith("node:")) return nextLoad(url, context);
  if (!url.startsWith("file:")) throw new Error("Unsupported capsule module protocol");
  const path = await confined(fileURLToPath(url));
  if (/\.[cm]?tsx?$/u.test(path)) {
    const source = await readFile(path, "utf8");
    if (Buffer.byteLength(source) > 4 * 1024 * 1024) throw new Error("Build module exceeds limit");
    const compiled = ts.transpileModule(source, {
      fileName: path,
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.ESNext,
        jsx: ts.JsxEmit.ReactJSX,
        isolatedModules: true,
        esModuleInterop: true,
        sourceMap: false,
      },
      reportDiagnostics: true,
    });
    if (
      compiled.diagnostics?.some(
        (diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error,
      )
    )
      throw new Error("Build module syntax is invalid");
    return { source: compiled.outputText, format: "module", shortCircuit: true };
  }
  return nextLoad(url, context);
};
