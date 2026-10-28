import { createHash } from "node:crypto";
import { link, mkdir, mkdtemp, readFile, rename, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { npBuildInstalledPackageContentDigestV1 } from "@nexpress/core/agent-contract";
import { SiteBuildError } from "./artifact-io.js";
import type { NpObservedBuildPackageV1, NpObservedBuildPackagesV1 } from "./installed-packages.js";
import { observeSiteBuildNextMetadataAssetsV1 } from "./next-metadata-assets.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});
const svg =
  '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><path d="M0 0h64v64H0z"/></svg>\n';
const media = "icon.fixture-token.svg";
const digest = (value: string) => createHash("sha256").update(value).digest("hex");

async function fixture() {
  const project = await mkdtemp(join(tmpdir(), "np-next-metadata-"));
  roots.push(project);
  const put = async (path: string, value: string | object) => {
    const absolute = join(project, path);
    await mkdir(dirname(absolute), { recursive: true });
    await writeFile(absolute, typeof value === "string" ? value : JSON.stringify(value));
  };
  const config = { basePath: "", assetPrefix: "", output: "standalone" };
  await put(".next/required-server-files.json", { config });
  await put(".next/standalone/server.js", `const nextConfig=${JSON.stringify(config)};`);
  await put("src/app/icon.svg", svg);
  await put(".next/server/app/icon.svg.body", svg);
  await put(".next/static/media/" + media, svg);
  const appPaths = {
    "/icon.svg/route": "app/icon.svg/route.js",
    "/(site)/[[...slug]]/page": "app/(site)/[[...slug]]/page.js",
  };
  await put(".next/server/app-paths-manifest.json", appPaths);
  await put(".next/app-path-routes-manifest.json", { "/icon.svg/route": "/icon.svg" });
  await put(".next/prerender-manifest.json", {
    routes: {
      "/icon.svg": {
        routeType: "route",
        response: "complete",
        compute: "static",
        initialRevalidateSeconds: false,
        srcRoute: "/icon.svg",
        initialHeaders: { "content-type": "image/svg+xml" },
      },
    },
  });
  await put(".next/server/app/icon.svg.meta", {
    status: 200,
    headers: { "content-type": "image/svg+xml" },
    routeCache: { owner: { kind: "APP_ROUTE", sourceRoute: "/icon.svg/route" } },
  });
  await put(".next/server/app/icon.svg/route.js", 'var R={};R.c("server/chunks/icon-route.js");');
  await put(
    ".next/server/chunks/icon-route.js",
    `module.exports=[2,e=>{let route=new X.AppRouteRouteModule({definition:{page:"/icon.svg/route",pathname:"/icon.svg"},resolvedPagePath:"[project]/src/app/icon.svg--route-entry.js"})},3,e=>{var t=e.i(4);let body=Buffer.from("${Buffer.from(svg).toString("base64")}","base64");e.s(["GET",0,function(){return new t.NextResponse(body,{headers:{"Content-Type":"image/svg+xml","Cache-Control":"public, max-age=0, must-revalidate"}})},"dynamic",0,"force-static"])}];`,
  );
  await put(
    ".next/server/app/(site)/[[...slug]]/page.js",
    'var R={};R.c("server/chunks/layout.js");',
  );
  const layout =
    'module.exports=[1,a=>{const tree={metadata:{icon:[async()=>{let x=await example();return[{url:`/icon.svg?${x.src.split("/").splice(-1)[0]}`,sizes:"any",type:"image/svg+xml"}]}]}};a.v("/_next/static/media/' +
    media +
    '"+(globalThis.NEXT_CLIENT_ASSET_SUFFIX||""));}];';
  await put(".next/server/chunks/layout.js", layout);
  const next: NpObservedBuildPackageV1 = {
    root: join(project, "node_modules/next"),
    name: "next",
    version: "16.4.2",
    contentDigest: "",
    manifest: { name: "next", version: "16.4.2" },
    dependencies: new Map(),
    files: [
      {
        path: "package.json",
        mode: "100644",
        sha256: digest('{"name":"next","version":"16.4.2"}'),
      },
      {
        path: "dist/server/base-server.js",
        mode: "100644",
        sha256: "5c24d699cccb76b3346b279edfa8a4025f89c14322ee6569e4fb2cc2ae144777",
      },
      {
        path: "dist/build/webpack/loaders/next-metadata-route-loader.js",
        mode: "100644",
        sha256: "1cb4ed333bdeaa80b62e0eb2f521ec1008a5f44eb9ef48fe948c387232ef21a9",
      },
      {
        path: "dist/server/route-modules/app-route/helpers/auto-implement-methods.js",
        mode: "100644",
        sha256: "fecd56746f3aac13db5e804dc99a6fc87f970e380e57e125f0e0815373a4094d",
      },
    ],
  };
  const assertPackagesUnchanged = vi.fn(async () => {});
  const packages: NpObservedBuildPackagesV1 = {
    packages: [],
    instances: [next],
    rootImports: new Map([["next", next]]),
    assertUnchanged: assertPackagesUnchanged,
  };
  const refresh = async () => {
    next.files.sort((a, b) => Buffer.compare(Buffer.from(a.path), Buffer.from(b.path)));
    next.contentDigest = await npBuildInstalledPackageContentDigestV1({
      schemaVersion: "np.installed-package-content.v1",
      name: next.name,
      version: next.version,
      files: next.files,
    });
    packages.packages = [
      { name: next.name, version: next.version, contentDigest: next.contentDigest },
    ];
  };
  await refresh();
  const assertCapsuleUnchanged = vi.fn(async () => {});
  return {
    project,
    packages,
    next,
    refresh,
    put,
    layout,
    appPaths,
    config,
    assertCapsuleUnchanged,
    assertPackagesUnchanged,
  };
}
const observe = (input: Awaited<ReturnType<typeof fixture>>) =>
  observeSiteBuildNextMetadataAssetsV1(input);

describe("source-owned root Next static metadata assets", () => {
  it("derives one exact GET request from equal source/body/media and compiled owners without executing modules", async () => {
    const input = await fixture();
    const result = await observe(input);
    expect(result.metadataRequests).toEqual([`/icon.svg?${media}`]);
    expect(result.evidence.assets).toEqual([
      {
        request: `/icon.svg?${media}`,
        source: "src/app/icon.svg",
        body: ".next/server/app/icon.svg.body",
        media: `.next/static/media/${media}`,
        routeOwner: ".next/server/chunks/icon-route.js",
        metadataOwner: ".next/server/chunks/layout.js",
        mediaOwner: ".next/server/chunks/layout.js",
      },
    ]);
    expect(result.evidence.files.find((f) => f.path === "src/app/icon.svg")?.sha256).toBe(
      digest(svg),
    );
    expect(result.evidenceSha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(JSON.stringify(result)).not.toContain(input.project);
    expect(JSON.stringify(result)).not.toContain(svg);
    expect(Object.isFrozen(result.metadataRequests)).toBe(true);
    expect(input.assertCapsuleUnchanged).toHaveBeenCalledTimes(2);
    expect(input.assertPackagesUnchanged).toHaveBeenCalledTimes(2);
    await result.assertUnchanged();
    expect((await observe(input)).evidenceSha256).toBe(result.evidenceSha256);
  });
  it("observes complete absence and invalidates the lease when an icon later appears", async () => {
    const input = await fixture();
    for (const path of [
      "src/app/icon.svg",
      ".next/server/app/icon.svg.body",
      ".next/server/app/icon.svg.meta",
      ".next/server/app/icon.svg",
    ])
      await rm(join(input.project, path), { recursive: true, force: true });
    await input.put(".next/server/app-paths-manifest.json", {
      "/(site)/[[...slug]]/page": "app/(site)/[[...slug]]/page.js",
    });
    await input.put(".next/app-path-routes-manifest.json", {});
    await input.put(".next/prerender-manifest.json", { routes: {} });
    const result = await observe(input);
    expect(result.metadataRequests).toEqual([]);
    await input.put("src/app/icon.svg", svg);
    await expect(result.assertUnchanged()).rejects.toBeInstanceOf(SiteBuildError);
  });
  it("rejects missing source, body or media instead of inventing an asset", async () => {
    for (const path of [
      "src/app/icon.svg",
      ".next/server/app/icon.svg.body",
      `.next/static/media/${media}`,
    ]) {
      const input = await fixture();
      await rm(join(input.project, path));
      await expect(observe(input)).rejects.toBeInstanceOf(SiteBuildError);
    }
  });
  it("rejects byte disagreement and ambiguous equal media files", async () => {
    const input = await fixture();
    await input.put(`.next/static/media/${media}`, svg + " ");
    await expect(observe(input)).rejects.toBeInstanceOf(SiteBuildError);
    await input.put(`.next/static/media/${media}`, svg);
    await input.put(".next/static/media/icon.second.svg", svg);
    await expect(observe(input)).rejects.toBeInstanceOf(SiteBuildError);
  });
  it("rejects symlink source/ancestor and hardlinked body files", async () => {
    const source = await fixture();
    await rm(join(source.project, "src/app/icon.svg"));
    await symlink(
      join(source.project, `.next/static/media/${media}`),
      join(source.project, "src/app/icon.svg"),
    );
    await expect(observe(source)).rejects.toBeInstanceOf(SiteBuildError);
    const ancestor = await fixture();
    await rename(
      join(ancestor.project, ".next/static/media"),
      join(ancestor.project, ".next/static/actual"),
    );
    await symlink("actual", join(ancestor.project, ".next/static/media"));
    await expect(observe(ancestor)).rejects.toBeInstanceOf(SiteBuildError);
    const hardlink = await fixture();
    await rm(join(hardlink.project, ".next/server/app/icon.svg.body"));
    await link(
      join(hardlink.project, "src/app/icon.svg"),
      join(hardlink.project, ".next/server/app/icon.svg.body"),
    );
    await expect(observe(hardlink)).rejects.toBeInstanceOf(SiteBuildError);
  });
  it("rejects dynamic or unproved root metadata conventions", async () => {
    for (const name of ["icon.png", "icon.tsx", "favicon.ico", "apple-icon.png"]) {
      const input = await fixture();
      await input.put(`src/app/${name}`, "unproved");
      await expect(observe(input)).rejects.toBeInstanceOf(SiteBuildError);
    }
  });
  it("rejects nonempty path/asset/deployment configuration in either config owner", async () => {
    for (const [key, value] of [
      ["basePath", "/prefix"],
      ["assetPrefix", "https://example.invalid"],
      ["deploymentId", "opaque"],
    ]) {
      const input = await fixture();
      await input.put(".next/required-server-files.json", {
        config: { ...input.config, [key]: value },
      });
      await expect(observe(input)).rejects.toBeInstanceOf(SiteBuildError);
    }
    const input = await fixture();
    await input.put(
      ".next/standalone/server.js",
      `const nextConfig=${JSON.stringify({ ...input.config, deploymentId: "other" })};`,
    );
    await expect(observe(input)).rejects.toBeInstanceOf(SiteBuildError);
  });
  it("rejects a forged route owner or nonstatic prerender manifest", async () => {
    const input = await fixture();
    await input.put(".next/app-path-routes-manifest.json", { "/icon.svg/route": "/api/other" });
    await expect(observe(input)).rejects.toBeInstanceOf(SiteBuildError);
    const dynamic = await fixture();
    await dynamic.put(".next/prerender-manifest.json", {
      routes: {
        "/icon.svg": {
          routeType: "route",
          response: "complete",
          compute: "dynamic",
          initialRevalidateSeconds: false,
          srcRoute: "/icon.svg",
          initialHeaders: { "content-type": "image/svg+xml" },
        },
      },
    });
    await expect(observe(dynamic)).rejects.toBeInstanceOf(SiteBuildError);
  });
  it("rejects compiled GET content differing from the source despite matching prerender files", async () => {
    const input = await fixture();
    const path = ".next/server/chunks/icon-route.js";
    await input.put(
      path,
      (await readFile(join(input.project, path), "utf8")).replace(
        Buffer.from(svg).toString("base64"),
        Buffer.from("different").toString("base64"),
      ),
    );
    await expect(observe(input)).rejects.toBeInstanceOf(SiteBuildError);
  });
  it("requires actual AST metadata/media owners rather than comments or guessed asset queries", async () => {
    const input = await fixture();
    await input.put(".next/server/chunks/layout.js", "// " + input.layout);
    await expect(observe(input)).rejects.toBeInstanceOf(SiteBuildError);
    await input.put(
      ".next/server/chunks/layout.js",
      input.layout.replace(media, "icon.unobserved.svg"),
    );
    await expect(observe(input)).rejects.toBeInstanceOf(SiteBuildError);
    await input.put(
      ".next/server/chunks/layout.js",
      input.layout.replace("splice(-1)", "splice(-2)"),
    );
    await expect(observe(input)).rejects.toBeInstanceOf(SiteBuildError);
  });
  it("rejects traversal, duplicate manifest keys and oversized compiled input", async () => {
    const input = await fixture();
    await input.put(
      ".next/server/app/icon.svg/route.js",
      'var R={};R.c("server/chunks/../other.js");',
    );
    await expect(observe(input)).rejects.toBeInstanceOf(SiteBuildError);
    const duplicate = await fixture();
    await duplicate.put(
      ".next/app-path-routes-manifest.json",
      '{"/icon.svg/route":"/icon.svg","/icon.svg/route":"/icon.svg"}',
    );
    await expect(observe(duplicate)).rejects.toBeInstanceOf(SiteBuildError);
    const oversized = await fixture();
    await oversized.put(".next/server/chunks/layout.js", " ".repeat(8 * 1024 * 1024 + 1));
    await expect(observe(oversized)).rejects.toBeInstanceOf(SiteBuildError);
  });
  it("revalidates actual pinned Next owner bytes, inventory and existing observer leases", async () => {
    const input = await fixture();
    input.next.files.find((f) => f.path === "dist/server/base-server.js")!.sha256 = "0".repeat(64);
    await input.refresh();
    await expect(observe(input)).rejects.toBeInstanceOf(SiteBuildError);
    const version = await fixture();
    version.next.version = "16.4.3";
    await version.refresh();
    await expect(observe(version)).rejects.toBeInstanceOf(SiteBuildError);
    const lease = await fixture();
    lease.packages.assertUnchanged = () => Promise.reject(new Error(lease.project));
    await expect(observe(lease)).rejects.toMatchObject({ message: "unavailable" });
  });
  it("detects mutation during construction and after observation with safe errors", async () => {
    const input = await fixture();
    input.assertCapsuleUnchanged
      .mockImplementationOnce(async () => {})
      .mockImplementationOnce(async () => {
        await input.put(`.next/static/media/${media}`, "changed");
      });
    await expect(observe(input)).rejects.toMatchObject({ message: "unavailable" });
    const later = await fixture();
    const result = await observe(later);
    await later.put(".next/server/chunks/layout.js", later.layout + "\n");
    await expect(result.assertUnchanged()).rejects.toMatchObject({ message: "unavailable" });
  });
});
