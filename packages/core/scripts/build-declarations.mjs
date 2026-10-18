import {
  mkdtemp,
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  copyFile,
  writeFile,
} from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const coreDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** The JS build supplies its real entry map; package exports remain the authority
 * for public filenames. No second hand-maintained entry inventory exists. */
export function declarationEntries(entries, manifest) {
  if (!entries || typeof entries !== "object" || Array.isArray(entries))
    throw new Error("Core declarations require the exact JS entry map.");
  const publicEntries = Object.entries(manifest.exports ?? {});
  if (Object.keys(entries).length !== publicEntries.length)
    throw new Error("Core declaration entries do not match package exports.");
  return publicEntries.map(([specifier, target]) => {
    const name = specifier === "." ? "index" : specifier.slice(2);
    const source = entries[name];
    if (
      (specifier !== "." && !specifier.startsWith("./")) ||
      !/^[a-z][a-z0-9-]*$/u.test(name) ||
      typeof source !== "string" ||
      !/^src\/(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_-]+\.ts$/u.test(source) ||
      target?.types !== `./dist/${name}.d.ts` ||
      target?.import !== `./dist/${name}.js`
    )
      throw new Error(`Invalid Core declaration entry: ${specifier}`);
    const module = source.slice("src/".length, -".ts".length);
    return { name, source, module, declaration: `${name}.d.ts` };
  });
}

export function declarationForwarder(entry, hasDefault = false) {
  const target = `./types/${entry.module}.js`;
  return `// Generated from the public JS entry; do not edit.\nexport * from ${JSON.stringify(target)};\n${hasDefault ? `export { default } from ${JSON.stringify(target)};\n` : ""}`;
}

async function walk(directory) {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) result.push(...(await walk(path)));
    else result.push(path);
  }
  return result;
}

function inside(directory, file) {
  const path = relative(directory, file);
  return path !== "" && !path.startsWith(`..${sep}`) && path !== ".." && !isAbsolute(path);
}

/** Fail before publication if an internal declaration reference escapes the
 * shipped tree or depends on source files left behind in the workspace. */
export async function verifyDeclarationTree(directory, ts) {
  const files = await walk(directory);
  const declarations = files.filter((file) => /\.d\.[cm]?ts$/u.test(file));
  if (!declarations.length) throw new Error("Core declaration emit produced no declarations.");
  for (const file of declarations) {
    const info = ts.preProcessFile(await readFile(file, "utf8"), true, true);
    for (const reference of [...info.importedFiles, ...info.referencedFiles]) {
      const specifier = reference.fileName;
      if (
        isAbsolute(specifier) ||
        specifier.includes("node_modules/") ||
        specifier.includes(".pnpm/")
      )
        throw new Error(`Nonportable declaration import in ${relative(directory, file)}.`);
      if (!specifier.startsWith(".")) continue;
      const stem = resolve(dirname(file), specifier);
      if (!inside(directory, stem))
        throw new Error(
          `Declaration import escapes the shipped tree: ${relative(directory, file)}.`,
        );
      const candidates = /\.d\.[cm]?ts$/u.test(stem)
        ? [stem]
        : /\.mjs$/u.test(stem)
          ? [stem.slice(0, -4) + ".d.mts"]
          : /\.cjs$/u.test(stem)
            ? [stem.slice(0, -4) + ".d.cts"]
            : /\.js$/u.test(stem)
              ? [stem.slice(0, -3) + ".d.ts"]
              : [stem + ".d.ts", join(stem, "index.d.ts")];
      if (!candidates.some((candidate) => declarations.includes(candidate)))
        throw new Error(
          `Missing private declaration for ${specifier} in ${relative(directory, file)}.`,
        );
    }
  }
  return declarations.length;
}

export async function buildDeclarations({ entries, outDir = resolve(coreDirectory, "dist") }) {
  const started = performance.now();
  const ts = (await import("typescript")).default;
  const manifest = JSON.parse(await readFile(join(coreDirectory, "package.json"), "utf8"));
  const publicEntries = declarationEntries(entries, manifest);
  const output = resolve(outDir);
  if (
    output === coreDirectory ||
    inside(join(coreDirectory, "src"), output) ||
    output === join(coreDirectory, "src")
  )
    throw new Error("Core declarations cannot overwrite source files.");
  const stagingParent = join(coreDirectory, "node_modules", ".cache", "declarations");
  await mkdir(stagingParent, { recursive: true });
  const staging = await mkdtemp(join(stagingParent, "emit-"));
  try {
    const configPath = join(coreDirectory, "tsconfig.build.json");
    const loaded = ts.readConfigFile(configPath, ts.sys.readFile);
    if (loaded.error)
      throw new Error(ts.flattenDiagnosticMessageText(loaded.error.messageText, "\n"));
    const config = ts.parseJsonConfigFileContent(
      loaded.config,
      ts.sys,
      coreDirectory,
      {
        noEmit: false,
        noEmitOnError: true,
        declaration: true,
        emitDeclarationOnly: true,
        declarationMap: false,
        sourceMap: false,
        incremental: false,
        outDir: staging,
      },
      configPath,
    );
    const program = ts.createProgram({ rootNames: config.fileNames, options: config.options });
    const diagnostics = [...config.errors, ...ts.getPreEmitDiagnostics(program)];
    if (diagnostics.length) {
      process.stderr.write(
        ts.formatDiagnosticsWithColorAndContext(diagnostics, {
          getCurrentDirectory: () => coreDirectory,
          getCanonicalFileName: (file) => file,
          getNewLine: () => "\n",
        }),
      );
      throw new Error(`Core declaration typecheck failed (${diagnostics.length} diagnostics).`);
    }
    const emitted = program.emit(undefined, undefined, undefined, true);
    if (emitted.emitSkipped || emitted.diagnostics.length) {
      process.stderr.write(
        ts.formatDiagnosticsWithColorAndContext(emitted.diagnostics, {
          getCurrentDirectory: () => coreDirectory,
          getCanonicalFileName: (file) => file,
          getNewLine: () => "\n",
        }),
      );
      throw new Error("Core declaration emit failed.");
    }
    // TypeScript consumes ambient inputs but does not copy them to outDir.
    // Preserve future source-owned ambient modules without shipping dev typings.
    const sourceDirectory = join(coreDirectory, "src");
    for (const file of program.getSourceFiles()) {
      if (!file.isDeclarationFile || !inside(sourceDirectory, file.fileName)) continue;
      const target = join(staging, relative(sourceDirectory, file.fileName));
      await mkdir(dirname(target), { recursive: true });
      await copyFile(file.fileName, target);
    }
    const count = await verifyDeclarationTree(staging, ts);
    const checker = program.getTypeChecker();
    const forwarders = [];
    for (const entry of publicEntries) {
      const file = program.getSourceFile(resolve(coreDirectory, entry.source));
      const symbol = file && checker.getSymbolAtLocation(file);
      if (!symbol) throw new Error(`Missing public declaration module: ${entry.source}`);
      if (
        file.statements.some(
          (statement) => ts.isExportAssignment(statement) && statement.isExportEquals,
        )
      )
        throw new Error(
          `CommonJS export assignment is unsupported for Core ESM entry: ${entry.source}`,
        );
      const hasDefault = checker
        .getExportsOfModule(symbol)
        .some((exported) => exported.name === "default");
      forwarders.push([entry.declaration, declarationForwarder(entry, hasDefault)]);
    }
    // Publish only after the complete emit and dependency checks pass. Runtime JS
    // chunks and singleton boundaries are exclusively owned by the existing tsup build.
    await mkdir(output, { recursive: true });
    await rm(join(output, "types"), { recursive: true, force: true });
    await rename(staging, join(output, "types"));
    for (const [name, content] of forwarders) await writeFile(join(output, name), content);
    console.log(
      `DTS TypeScript emitted ${count} private modules and ${forwarders.length} public entries in ${Math.round(performance.now() - started)}ms (peak RSS ${Math.ceil(process.resourceUsage().maxRSS / 1024)} MiB).`,
    );
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

function argumentsFromCli() {
  const args = process.argv.slice(2);
  const values = new Map();
  for (let i = 0; i < args.length; i += 2) {
    if (!["--entries", "--out-dir"].includes(args[i]) || !args[i + 1] || values.has(args[i]))
      throw new Error(
        "Usage: build-declarations.mjs --entries '<exact JS entry map>' [--out-dir <ignored prototype or dist directory>]",
      );
    values.set(args[i], args[i + 1]);
  }
  return {
    entries: JSON.parse(values.get("--entries") ?? "null"),
    outDir: values.get("--out-dir"),
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    await buildDeclarations(argumentsFromCli());
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
