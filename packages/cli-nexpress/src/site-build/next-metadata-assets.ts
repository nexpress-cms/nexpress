import { createHash } from "node:crypto";
import { constants, type BigIntStats } from "node:fs";
import { lstat, open, opendir, realpath } from "node:fs/promises";
import { join } from "node:path";
import { Node, Project, SyntaxKind, type SourceFile } from "ts-morph";
import {
  npBuildInstalledPackageContentDigestV1,
  npParseBuildJsonV1,
  npRequireBuildInstalledPackageContentV1,
} from "@nexpress/core/agent-contract";
import { SiteBuildError } from "./artifact-io.js";
import type { NpObservedBuildPackagesV1 } from "./installed-packages.js";

const profile = "np.next-root-static-icon-svg.v1" as const;
const nextOwners = {
  "dist/server/base-server.js": "5c24d699cccb76b3346b279edfa8a4025f89c14322ee6569e4fb2cc2ae144777",
  "dist/build/webpack/loaders/next-metadata-route-loader.js":
    "1cb4ed333bdeaa80b62e0eb2f521ec1008a5f44eb9ef48fe948c387232ef21a9",
  "dist/server/route-modules/app-route/helpers/auto-implement-methods.js":
    "fecd56746f3aac13db5e804dc99a6fc87f970e380e57e125f0e0815373a4094d",
} as const;
const hash = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");
const compare = (a: string, b: string) => Buffer.compare(Buffer.from(a), Buffer.from(b));
const same = (a: BigIntStats, b: BigIntStats) =>
  a.dev === b.dev &&
  a.ino === b.ino &&
  a.mode === b.mode &&
  a.nlink === b.nlink &&
  a.size === b.size &&
  a.mtimeNs === b.mtimeNs &&
  a.ctimeNs === b.ctimeNs;
const fail = (): never => {
  throw new SiteBuildError("unavailable");
};
const record = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return fail();
  return value as Record<string, unknown>;
};

export interface NpSiteBuildNextMetadataAssetsV1 {
  readonly metadataRequests: readonly string[];
  readonly evidence: {
    readonly profile: typeof profile;
    readonly next: { readonly version: string; readonly contentDigest: string };
    readonly files: readonly {
      readonly path: string;
      readonly bytes: number;
      readonly sha256: string;
    }[];
    readonly assets: readonly {
      readonly request: string;
      readonly source: string;
      readonly body: string;
      readonly media: string;
      readonly routeOwner: string;
      readonly metadataOwner: string;
      readonly mediaOwner: string;
    }[];
  };
  readonly evidenceSha256: string;
  assertUnchanged(): Promise<void>;
}

/**
 * Trusted in-process capsule/package observation only, never an authored URL inventory.
 * This first profile supports the measured Next16.4.2 Turbopack root static icon.svg.
 * No project module is imported or executed. Other root icon conventions fail closed.
 * The caller still owns native execution, request policy and capsule authorization.
 */
export async function observeSiteBuildNextMetadataAssetsV1(input: {
  project: string;
  packages: NpObservedBuildPackagesV1;
  assertCapsuleUnchanged(): Promise<void>;
}): Promise<NpSiteBuildNextMetadataAssetsV1> {
  try {
    await input.assertCapsuleUnchanged();
    await input.packages.assertUnchanged();
    const next = input.packages.rootImports.get("next");
    if (
      !next ||
      !input.packages.instances.includes(next) ||
      next.name !== "next" ||
      next.version !== "16.4.2"
    )
      return fail();
    const inventory = npRequireBuildInstalledPackageContentV1({
      schemaVersion: "np.installed-package-content.v1",
      name: next.name,
      version: next.version,
      files: next.files,
    });
    const contentDigest = await npBuildInstalledPackageContentDigestV1(inventory);
    if (
      contentDigest !== next.contentDigest ||
      input.packages.packages.filter(
        (p) =>
          p.name === next.name && p.version === next.version && p.contentDigest === contentDigest,
      ).length !== 1 ||
      Object.entries(nextOwners).some(
        ([path, sha256]) => inventory.files.find((file) => file.path === path)?.sha256 !== sha256,
      )
    )
      return fail();
    const root = await realpath(input.project);
    if (root === "/" || !constants.O_NOFOLLOW) return fail();
    const identities = new Map<string, BigIntStats>();
    const absent = new Set<string>();
    const files = new Map<string, { bytes: Buffer; identity: BigIntStats }>();
    let charged = 0;
    const identity = async (relative: string, directory: boolean, optional = false) => {
      if (
        relative.length > 512 ||
        relative.startsWith("/") ||
        relative.includes("\\") ||
        relative.split("/").some((part) => !part || part === "." || part === "..")
      )
        return fail();
      const segments = relative.split("/");
      for (let index = 0; index < segments.length; index++) {
        const key = segments.slice(0, index + 1).join("/");
        let current: BigIntStats;
        try {
          current = await lstat(join(root, key), { bigint: true });
        } catch (error) {
          if (optional && (error as NodeJS.ErrnoException).code === "ENOENT") {
            absent.add(key);
            return null;
          }
          throw error;
        }
        const isDirectory = index < segments.length - 1 || directory;
        if (
          current.isSymbolicLink() ||
          (isDirectory ? !current.isDirectory() : !current.isFile() || current.nlink !== 1n) ||
          (identities.has(key) && !same(identities.get(key)!, current))
        )
          return fail();
        identities.set(key, current);
      }
      return identities.get(relative)!;
    };
    const read = async (path: string, maximum = 2 * 1024 * 1024): Promise<Buffer> => {
      const cached = files.get(path);
      if (cached) return cached.bytes;
      const before = await identity(path, false);
      if (!before || before.size < 0n || before.size > BigInt(maximum) || files.size >= 192)
        return fail();
      charged += Number(before.size);
      if (charged > 64 * 1024 * 1024) return fail();
      const fd = await open(
        join(root, path),
        constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
      );
      try {
        if (!same(before, await fd.stat({ bigint: true }))) return fail();
        const bytes = Buffer.alloc(Number(before.size) + 1);
        let offset = 0;
        while (offset < bytes.length) {
          const result = await fd.read(bytes, offset, bytes.length - offset, offset);
          if (!result.bytesRead) break;
          offset += result.bytesRead;
        }
        if (
          offset !== Number(before.size) ||
          !same(before, await fd.stat({ bigint: true })) ||
          !same(before, (await identity(path, false))!)
        )
          return fail();
        const result = bytes.subarray(0, offset);
        files.set(path, { bytes: result, identity: before });
        return result;
      } finally {
        await fd.close();
      }
    };
    const json = async (path: string) =>
      record(
        npParseBuildJsonV1(new TextDecoder("utf-8", { fatal: true }).decode(await read(path))),
      );
    const names = async (path: string, maximum: number) => {
      await identity(path, true);
      const result: string[] = [];
      const directory = await opendir(join(root, path));
      for await (const entry of directory) {
        if (result.length >= maximum) return fail();
        result.push(entry.name);
      }
      await identity(path, true);
      return result.sort(compare);
    };
    const parser = new Project({ useInMemoryFileSystem: true, skipAddingFilesFromTsConfig: true });
    const parse = (path: string, bytes: Buffer) => {
      const source = parser.createSourceFile(
        path,
        new TextDecoder("utf-8", { fatal: true }).decode(bytes),
        { overwrite: true },
      );
      if (parser.getProgram().compilerObject.getSyntacticDiagnostics(source.compilerNode).length)
        return fail();
      return source;
    };
    const property = (object: Node, name: string) => {
      if (!Node.isObjectLiteralExpression(object)) return undefined;
      const found = object.getProperties().filter((p) => {
        if (!Node.isPropertyAssignment(p)) return false;
        const key = p.getNameNode();
        return (Node.isStringLiteral(key) ? key.getLiteralText() : p.getName()) === name;
      });
      if (found.length !== 1 || !Node.isPropertyAssignment(found[0])) return undefined;
      return found[0].getInitializer();
    };
    const text = (node: Node | undefined) =>
      node && Node.isStringLiteral(node) ? node.getLiteralText() : undefined;
    const config = record((await json(".next/required-server-files.json")).config);
    const standalone = parse(
      ".next/standalone/server.js",
      await read(".next/standalone/server.js"),
    );
    const configDeclarations = standalone
      .getDescendantsOfKind(SyntaxKind.VariableDeclaration)
      .filter((v) => v.getName() === "nextConfig");
    if (configDeclarations.length !== 1) return fail();
    const compiledConfig = record(
      npParseBuildJsonV1(configDeclarations[0].getInitializerOrThrow().getText()),
    );
    for (const c of [config, compiledConfig])
      if (
        c.basePath !== "" ||
        c.assetPrefix !== "" ||
        c.output !== "standalone" ||
        (c.deploymentId !== undefined && c.deploymentId !== "")
      )
        return fail();
    if (await identity("app", true, true)) return fail();
    const sourceNames = await names("src/app", 1024);
    const metadataNames = sourceNames.filter((name) =>
      /^(?:icon|apple-icon|favicon)[0-9]*\./iu.test(name),
    );
    if (metadataNames.some((name) => name !== "icon.svg")) return fail();
    const appPaths = await json(".next/server/app-paths-manifest.json");
    const appRoutes = await json(".next/app-path-routes-manifest.json");
    const prerenders = record((await json(".next/prerender-manifest.json")).routes);
    const metadataKeys = Object.keys(appPaths).filter((key) =>
      /^\/(?:icon|apple-icon|favicon)[^/]*(?:\/|$)/u.test(key),
    );
    const assets: NpSiteBuildNextMetadataAssetsV1["evidence"]["assets"][number][] = [];
    if (!metadataNames.length) {
      if (
        metadataKeys.length ||
        Object.keys(appRoutes).some((key) =>
          /^\/(?:icon|apple-icon|favicon)[^/]*(?:\/|$)/u.test(key),
        ) ||
        Object.keys(prerenders).some((key) =>
          /^\/(?:icon|apple-icon|favicon)[^/]*(?:\/|$)/u.test(key),
        )
      )
        return fail();
      for (const path of [
        ".next/server/app/icon.svg.body",
        ".next/server/app/icon.svg.meta",
        ".next/server/app/icon.svg/route.js",
      ])
        if (await identity(path, false, true)) return fail();
    } else {
      if (
        metadataKeys.length !== 1 ||
        appPaths["/icon.svg/route"] !== "app/icon.svg/route.js" ||
        appRoutes["/icon.svg/route"] !== "/icon.svg"
      )
        return fail();
      const prerender = record(prerenders["/icon.svg"]);
      if (
        prerender.routeType !== "route" ||
        prerender.response !== "complete" ||
        prerender.compute !== "static" ||
        prerender.initialRevalidateSeconds !== false ||
        prerender.srcRoute !== "/icon.svg" ||
        record(prerender.initialHeaders)["content-type"] !== "image/svg+xml"
      )
        return fail();
      const source = await read("src/app/icon.svg", 1024 * 1024);
      const body = await read(".next/server/app/icon.svg.body", 1024 * 1024);
      if (!source.equals(body)) return fail();
      const meta = await json(".next/server/app/icon.svg.meta");
      const owner = record(record(meta.routeCache).owner);
      if (
        meta.status !== 200 ||
        record(meta.headers)["content-type"] !== "image/svg+xml" ||
        owner.kind !== "APP_ROUTE" ||
        owner.sourceRoute !== "/icon.svg/route"
      )
        return fail();
      const media: string[] = [];
      for (const name of await names(".next/static/media", 4096))
        if (
          /^icon\.[A-Za-z0-9_-]{1,64}\.svg$/u.test(name) &&
          source.equals(await read(`.next/static/media/${name}`, 1024 * 1024))
        )
          media.push(name);
      if (media.length !== 1) return fail();
      const mediaUrl = `/_next/static/media/${media[0]}`;
      const chunks = async (
        entry: string,
      ): Promise<Array<{ path: string; source: SourceFile }>> => {
        const main = parse(entry, await read(entry));
        const paths: string[] = [];
        for (const call of main.getDescendantsOfKind(SyntaxKind.CallExpression)) {
          const expression = call.getExpression();
          if (
            !Node.isPropertyAccessExpression(expression) ||
            expression.getExpression().getText() !== "R" ||
            expression.getName() !== "c"
          )
            continue;
          const args = call.getArguments(),
            path = text(args[0]);
          if (
            args.length !== 1 ||
            !path ||
            !/^server\/chunks\/[A-Za-z0-9_.@+()[\]/-]+\.js$/u.test(path) ||
            path.split("/").some((p) => p === "." || p === "..") ||
            paths.includes(path) ||
            paths.length >= 64
          )
            return fail();
          paths.push(path);
        }
        if (!paths.length) return fail();
        const result: Array<{ path: string; source: SourceFile }> = [];
        for (const path of paths) {
          const relative = `.next/${path}`,
            bytes = await read(relative, 8 * 1024 * 1024);
          if (bytes.includes("/icon.svg") || bytes.includes(media[0]))
            result.push({ path: relative, source: parse(relative, bytes) });
        }
        return result;
      };
      const routeChunks = await chunks(".next/server/app/icon.svg/route.js");
      const routeOwners: string[] = [];
      for (const chunk of routeChunks) {
        const route = chunk.source.getDescendantsOfKind(SyntaxKind.NewExpression).some((node) => {
          if (!node.getExpression().getText().endsWith(".AppRouteRouteModule")) return false;
          const argument = node.getArguments()[0];
          return (
            argument &&
            text(property(property(argument, "definition") ?? argument, "page")) ===
              "/icon.svg/route" &&
            text(property(property(argument, "definition") ?? argument, "pathname")) ===
              "/icon.svg" &&
            text(property(argument, "resolvedPagePath")) ===
              "[project]/src/app/icon.svg--route-entry.js"
          );
        });
        const exports = chunk.source
          .getDescendantsOfKind(SyntaxKind.CallExpression)
          .filter((call) => {
            const expression = call.getExpression(),
              array = call.getArguments()[0];
            if (
              !Node.isPropertyAccessExpression(expression) ||
              expression.getName() !== "s" ||
              !array ||
              !Node.isArrayLiteralExpression(array)
            )
              return false;
            const elements = array.getElements();
            const index = elements.findIndex((e) => text(e) === "GET");
            const method = elements[index + 2];
            if (
              index < 0 ||
              !method ||
              !Node.isFunctionExpression(method) ||
              elements.length !== 6 ||
              text(elements[3]) !== "dynamic" ||
              text(elements[5]) !== "force-static"
            )
              return false;
            const block = method.getBody();
            if (!Node.isBlock(block)) return false;
            const returned = block.getStatements();
            if (returned.length !== 1 || !Node.isReturnStatement(returned[0])) return false;
            const response = returned[0].getExpression();
            if (
              !response ||
              !Node.isNewExpression(response) ||
              !response.getExpression().getText().endsWith(".NextResponse")
            )
              return false;
            const args = response.getArguments(),
              content = args[0],
              headers = args[1] && property(args[1], "headers");
            if (
              !content ||
              !Node.isIdentifier(content) ||
              !headers ||
              args.length !== 2 ||
              !Node.isObjectLiteralExpression(headers) ||
              headers.getProperties().length !== 2 ||
              text(property(headers, "Content-Type")) !== "image/svg+xml" ||
              text(property(headers, "Cache-Control")) !== "public, max-age=0, must-revalidate"
            )
              return false;
            const buffers = chunk.source
              .getDescendantsOfKind(SyntaxKind.VariableDeclaration)
              .filter(
                (v) =>
                  v.getName() === content.getText() &&
                  v.getInitializer()?.getText().startsWith("Buffer.from("),
              );
            if (buffers.length !== 1) return false;
            const module = call.getFirstAncestorByKind(SyntaxKind.ArrowFunction);
            const moduleBody = module?.getBody();
            if (!moduleBody || !Node.isBlock(moduleBody)) return false;
            const statements = moduleBody.getStatements();
            if (
              statements.length !== 3 ||
              !Node.isVariableStatement(statements[0]) ||
              !Node.isVariableStatement(statements[1]) ||
              statements[1].getDeclarations().length !== 1 ||
              statements[1].getDeclarations()[0] !== buffers[0] ||
              !Node.isExpressionStatement(statements[2]) ||
              statements[2].getExpression() !== call
            )
              return false;
            const imports = statements[0].getDeclarations();
            const imported = imports[0]?.getInitializer();
            const importedExpression =
              imported && Node.isCallExpression(imported) ? imported.getExpression() : undefined;
            if (
              imports.length !== 1 ||
              !imported ||
              !Node.isCallExpression(imported) ||
              imported.getArguments().length !== 1 ||
              !Node.isNumericLiteral(imported.getArguments()[0]) ||
              !importedExpression ||
              !Node.isPropertyAccessExpression(importedExpression) ||
              importedExpression.getName() !== "i" ||
              response.getExpression().getText() !== `${imports[0].getName()}.NextResponse`
            )
              return false;
            const buffer = buffers[0].getInitializer();
            if (!buffer || !Node.isCallExpression(buffer)) return false;
            const data = text(buffer.getArguments()[0]);
            return (
              buffer.getArguments().length === 2 &&
              text(buffer.getArguments()[1]) === "base64" &&
              data !== undefined &&
              Buffer.from(data, "base64").toString("base64") === data &&
              Buffer.from(data, "base64").equals(source)
            );
          });
        if (route && exports.length === 1) routeOwners.push(chunk.path);
      }
      if (routeOwners.length !== 1) return fail();
      const siteEntry = appPaths["/(site)/[[...slug]]/page"];
      if (siteEntry !== "app/(site)/[[...slug]]/page.js") return fail();
      const pageChunks = await chunks(`.next/server/${siteEntry}`);
      const metadataOwners: string[] = [],
        mediaOwners: string[] = [];
      for (const chunk of pageChunks) {
        for (const template of chunk.source.getDescendantsOfKind(SyntaxKind.TemplateExpression)) {
          if (
            template.getHead().getLiteralText() !== "/icon.svg?" ||
            template.getTemplateSpans().length !== 1
          )
            continue;
          const span = template.getTemplateSpans()[0];
          const object = template
            .getParentIfKind(SyntaxKind.PropertyAssignment)
            ?.getParentIfKind(SyntaxKind.ObjectLiteralExpression);
          const arrow = template.getFirstAncestorByKind(SyntaxKind.ArrowFunction);
          const icon = arrow
            ?.getParentIfKind(SyntaxKind.ArrayLiteralExpression)
            ?.getParentIfKind(SyntaxKind.PropertyAssignment);
          if (
            span.getLiteral().getLiteralText() !== "" ||
            !/^[A-Za-z_$][\w$]*\.src\.split\("\/"\)\.splice\(-1\)\[0\]$/u.test(
              span.getExpression().getText(),
            ) ||
            !object ||
            text(property(object, "sizes")) !== "any" ||
            text(property(object, "type")) !== "image/svg+xml" ||
            icon?.getName() !== "icon" ||
            icon
              .getParentIfKind(SyntaxKind.ObjectLiteralExpression)
              ?.getParentIfKind(SyntaxKind.PropertyAssignment)
              ?.getName() !== "metadata"
          )
            return fail();
          metadataOwners.push(chunk.path);
        }
        for (const call of chunk.source.getDescendantsOfKind(SyntaxKind.CallExpression)) {
          const expression = call.getExpression(),
            arg = call.getArguments()[0];
          if (
            !Node.isPropertyAccessExpression(expression) ||
            expression.getName() !== "v" ||
            !arg ||
            !Node.isBinaryExpression(arg) ||
            text(arg.getLeft()) !== mediaUrl
          )
            continue;
          const right = arg.getRight();
          if (
            arg.getOperatorToken().getKind() !== SyntaxKind.PlusToken ||
            !Node.isParenthesizedExpression(right)
          )
            return fail();
          const fallback = right.getExpression();
          if (
            !Node.isBinaryExpression(fallback) ||
            fallback.getOperatorToken().getKind() !== SyntaxKind.BarBarToken ||
            fallback.getLeft().getText() !== "globalThis.NEXT_CLIENT_ASSET_SUFFIX" ||
            text(fallback.getRight()) !== ""
          )
            return fail();
          mediaOwners.push(chunk.path);
        }
      }
      if (metadataOwners.length !== 1 || mediaOwners.length !== 1) return fail();
      assets.push({
        request: `/icon.svg?${media[0]}`,
        source: "src/app/icon.svg",
        body: ".next/server/app/icon.svg.body",
        media: `.next/static/media/${media[0]}`,
        routeOwner: routeOwners[0],
        metadataOwner: metadataOwners[0],
        mediaOwner: mediaOwners[0],
      });
    }
    const assertUnchanged = async () => {
      try {
        await input.assertCapsuleUnchanged();
        await input.packages.assertUnchanged();
        for (const [path, before] of identities)
          if (!same(before, await lstat(join(root, path), { bigint: true }))) return fail();
        for (const path of absent) {
          try {
            await lstat(join(root, path));
            return fail();
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
          }
        }
        for (const [path, file] of files) {
          const fd = await open(
            join(root, path),
            constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
          );
          try {
            if (!same(file.identity, await fd.stat({ bigint: true }))) return fail();
            const bytes = Buffer.alloc(file.bytes.length + 1);
            let offset = 0;
            while (offset < bytes.length) {
              const result = await fd.read(bytes, offset, bytes.length - offset, offset);
              if (!result.bytesRead) break;
              offset += result.bytesRead;
            }
            if (
              offset !== file.bytes.length ||
              !bytes.subarray(0, offset).equals(file.bytes) ||
              !same(file.identity, await fd.stat({ bigint: true })) ||
              !same(file.identity, await lstat(join(root, path), { bigint: true }))
            )
              return fail();
          } finally {
            await fd.close();
          }
        }
      } catch {
        return fail();
      }
    };
    await assertUnchanged();
    const evidence = Object.freeze({
      profile,
      next: Object.freeze({ version: next.version, contentDigest }),
      files: Object.freeze(
        [...files]
          .sort(([a], [b]) => compare(a, b))
          .map(([path, file]) =>
            Object.freeze({ path, bytes: file.bytes.length, sha256: hash(file.bytes) }),
          ),
      ),
      assets: Object.freeze(assets.map((asset) => Object.freeze(asset))),
    });
    return Object.freeze({
      metadataRequests: Object.freeze(assets.map((asset) => asset.request)),
      evidence,
      evidenceSha256: hash(`${profile}\0${JSON.stringify(evidence)}`),
      assertUnchanged,
    });
  } catch {
    return fail();
  }
}
