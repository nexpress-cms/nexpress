import { describe, expect, it } from "vitest";
import vectors from "./__fixtures__/renderer-v1.json" with { type: "json" };
import {
  npBuildInstalledPackageContentDigestV1,
  npRequireBuildInstalledPackageContentV1,
} from "./index.js";

describe("installed package content identity", () => {
  it("matches an independent Python vector and binds bytes, mode, path and version", async () => {
    const body = npRequireBuildInstalledPackageContentV1(JSON.parse(vectors.package.canonical));
    expect(await npBuildInstalledPackageContentDigestV1(body)).toBe(vectors.package.digest);
    for (const change of [
      (value: typeof body) => {
        value.files[0].mode = "100755";
      },
      (value: typeof body) => {
        value.files[0].sha256 = "b".repeat(64);
      },
      (value: typeof body) => {
        value.files[0].path = "dist/other.js";
      },
      (value: typeof body) => {
        value.version = "0.4.7";
      },
    ]) {
      const changed = structuredClone(body);
      change(changed);
      expect(await npBuildInstalledPackageContentDigestV1(changed)).not.toBe(
        vectors.package.digest,
      );
    }
  });
  it("rejects collisions, unbounded/ambiguous file inventories and credential paths", () => {
    const body = npRequireBuildInstalledPackageContentV1(JSON.parse(vectors.package.canonical));
    body.files.push({ ...body.files[0] });
    expect(() => npRequireBuildInstalledPackageContentV1(body)).toThrow();
    const unsafe = npRequireBuildInstalledPackageContentV1(JSON.parse(vectors.package.canonical));
    unsafe.files[0].path = ".env.local";
    expect(() => npRequireBuildInstalledPackageContentV1(unsafe)).toThrow();
    unsafe.files[0].path = "../outside";
    expect(() => npRequireBuildInstalledPackageContentV1(unsafe)).toThrow();
  });
});
