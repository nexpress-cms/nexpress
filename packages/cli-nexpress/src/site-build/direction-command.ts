import { createHash } from "node:crypto";
import {
  npBuildDirectionLimitsV1,
  npBuildContractLimitsV1,
  npBuildInstalledCatalogBytesV1,
  npBuildInstalledCatalogDigestV1,
  npParseAgentDesignDirectionDraftSetV1,
  npParseAgentDesignDirectionSetV1,
  npParseAgentSiteBriefV1,
  npParseBuildInstalledCatalogJsonV1,
  npRequireAgentBuildRenderFixtureV1,
  npRequireBuildDirectionSetForBriefV1,
  npRequireBuildReadyBriefV1,
} from "@nexpress/core/agent-contract";
import { SiteArtifactFiles, SiteBuildError } from "./artifact-io.js";
import {
  prepareSiteBuildRenderSessionV1,
  reuseSiteBuildRenderSessionV1,
} from "./render-session.js";
import {
  prepareSiteBuildLinuxSandboxImageV1,
  runSiteBuildLinuxSandboxV1,
} from "./linux-sandbox.js";
import { observeSiteBuildRenderContextV1 } from "./render-context.js";
import {
  renderPreparedSiteBuildDirectionsV1,
  siteBuildDraftFromSealedDirectionsV1,
  siteBuildSealedDirectionBytesV1,
  validatePreparedSiteBuildDirectionsV1,
} from "./direction-render.js";
import { publishSiteBuildDirectionArtifactsV1 } from "./render-artifacts.js";

const decode = (bytes: Uint8Array) => new TextDecoder("utf-8", { fatal: true }).decode(bytes);
const encode = (value: unknown) => Buffer.from(JSON.stringify(value));
async function existing(
  files: SiteArtifactFiles,
  path: string,
  maximum: number,
): Promise<Uint8Array | null> {
  try {
    return await files.read(path, maximum);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

/** CLI entry integration only. JSON artifacts never select an arbitrary executable or SQL connection. */
export async function runSiteBuildRenderOperationV1(
  operation: string,
  values: Map<string, string>,
  cwd: string,
): Promise<unknown> {
  const files = await SiteArtifactFiles.at(cwd),
    path = values.get("--out")!;
  if (operation === "renderer prepare") {
    if (path === values.get("--catalog-out")) throw new SiteBuildError("arguments");
    const manifest: unknown = JSON.parse(
      decode(await files.read(values.get("--fixtures")!, 64 * 1024)),
    );
    if (
      manifest === null ||
      typeof manifest !== "object" ||
      Array.isArray(manifest) ||
      Object.keys(manifest).sort().join(",") !== "files,schemaVersion"
    )
      throw new SiteBuildError("input");
    const body = manifest as Record<string, unknown>;
    if (
      body.schemaVersion !== "np.site-build-fixture-files.v1" ||
      !Array.isArray(body.files) ||
      body.files.length > 200 ||
      body.files.some((value) => typeof value !== "string") ||
      new Set(body.files).size !== body.files.length
    )
      throw new SiteBuildError("input");
    const fixtures = [];
    let fixtureBytes = 0;
    for (const item of body.files) {
      if (
        typeof item !== "string" ||
        !/^\.nexpress\/site\/fixtures\/[A-Za-z0-9][A-Za-z0-9._-]{0,127}\.json$/u.test(item)
      )
        throw new SiteBuildError("path");
      const bytes = await files.read(item, 4 * 1024 * 1024);
      if ((fixtureBytes += bytes.length) > 4 * 1024 * 1024) throw new SiteBuildError("input");
      npRequireAgentBuildRenderFixtureV1(JSON.parse(decode(bytes)));
      fixtures.push({ path: item, bytes });
    }
    const previous = await existing(files, path, 4 * 1024 * 1024);
    if (previous) {
      const observed = await reuseSiteBuildRenderSessionV1({
        session: JSON.parse(decode(previous)),
        projectRoot: cwd,
      });
      if (observed.config !== values.get("--config")) throw new SiteBuildError("conflict");
      const staged = observed.capsule.renderer.projectSources.files
        .filter((file) => file.path.startsWith(".nexpress/site/fixtures/"))
        .map((file) => file.path)
        .sort();
      if (JSON.stringify(staged) !== JSON.stringify(fixtures.map((file) => file.path).sort()))
        throw new SiteBuildError("conflict");
      const frozenFiles = await SiteArtifactFiles.at(observed.capsule.project);
      for (const fixture of fixtures)
        if (
          !Buffer.from(fixture.bytes).equals(await frozenFiles.read(fixture.path, 4 * 1024 * 1024))
        )
          throw new SiteBuildError("conflict");
      const image = await prepareSiteBuildLinuxSandboxImageV1();
      const result = await runSiteBuildLinuxSandboxV1({
        image,
        project: observed.capsule.project,
        inputBytes: encode({
          mode: "catalog",
          config: observed.config,
          renderer: observed.capsule.renderer,
          clockNow: observed.clock.now,
          randomSeed: observed.clock.randomSeed,
        }),
        artifacts: [{ name: "catalog.json", maxBytes: 4 * 1024 * 1024 }],
      });
      const catalogBytes = result.artifacts.get("catalog.json");
      if (!catalogBytes) throw new SiteBuildError("input");
      const catalog = npParseBuildInstalledCatalogJsonV1(decode(catalogBytes));
      await observed.capsule.assertOriginalUnchanged();
      const status = await files.write(
        values.get("--catalog-out")!,
        (await npBuildInstalledCatalogBytesV1(catalog)).canonicalJsonUtf8,
      );
      return {
        schemaVersion: "np.site-build-cli-result.v1",
        operation,
        status: "unchanged",
        path,
        catalogPath: values.get("--catalog-out"),
        catalogStatus: status,
        fingerprint: await npBuildInstalledCatalogDigestV1(catalog),
        validationScope: "prepared-render-inputs",
        renderedImages: 0,
      };
    }
    const created = await prepareSiteBuildRenderSessionV1({
      projectRoot: cwd,
      config: values.get("--config")!,
      fixtures,
      clock: {
        now: new Date().toISOString(),
        randomSeed: createHash("sha256").update("np.site-build-preview-random.v1").digest("hex"),
      },
    });
    try {
      const catalogStatus = await files.write(
        values.get("--catalog-out")!,
        (await npBuildInstalledCatalogBytesV1(created.catalog)).canonicalJsonUtf8,
      );
      const status = await files.write(path, encode(created.session));
      return {
        schemaVersion: "np.site-build-cli-result.v1",
        operation,
        status,
        path,
        catalogPath: values.get("--catalog-out"),
        catalogStatus,
        fingerprint: created.fingerprint,
        validationScope: "prepared-render-inputs",
        renderedImages: 0,
      };
    } catch (error) {
      await created.close();
      throw error;
    }
  }
  if (!["direction render", "direction validate", "fixture inspect"].includes(operation))
    throw new SiteBuildError("arguments");
  if (
    values.has("--review-dir") &&
    values.get("--review-dir") !== ".nexpress/site/review/directions"
  )
    throw new SiteBuildError("path");
  const brief = npRequireBuildReadyBriefV1(
    npParseAgentSiteBriefV1(
      decode(await files.read(values.get("--brief")!, npBuildContractLimitsV1.brief.bytes)),
    ),
  );
  const setBytes = await files.read(
    values.get(operation === "direction validate" ? "--file" : "--draft")!,
    npBuildDirectionLimitsV1.set.bytes,
  );
  const sealed =
    operation === "direction validate"
      ? await npRequireBuildDirectionSetForBriefV1(
          brief,
          npParseAgentDesignDirectionSetV1(decode(setBytes)),
          "sealed",
        )
      : null;
  const drafts = sealed
    ? siteBuildDraftFromSealedDirectionsV1(sealed)
    : await npRequireBuildDirectionSetForBriefV1(
        brief,
        npParseAgentDesignDirectionDraftSetV1(decode(setBytes)),
        "draft",
      );
  if (
    operation === "fixture inspect" &&
    !drafts.directions.some((direction) => direction.id === values.get("--direction"))
  )
    throw new SiteBuildError("input");
  const { observed, context, fingerprint, rendererFingerprint, commandRegistryFingerprint } =
    await observeSiteBuildRenderContextV1({
      cwd,
      files,
      runtimePath: values.get("--runtime")!,
      brief,
      drafts,
    });
  if (operation === "fixture inspect") {
    const directionId = values.get("--direction");
    const projected = await runSiteBuildLinuxSandboxV1({
      image: context.image,
      project: context.capsule.project,
      inputBytes: encode({
        mode: "projection",
        config: context.config,
        renderer: context.capsule.renderer,
        clockNow: observed.clock.now,
        randomSeed: observed.clock.randomSeed,
        brief,
        drafts,
        directionId,
      }),
      artifacts: [{ name: "fixture.json", maxBytes: 8 * 1024 * 1024 }],
    });
    const bytes = projected.artifacts.get("fixture.json");
    if (!bytes) throw new SiteBuildError("input");
    const fixture: unknown = JSON.parse(decode(bytes));
    if (
      !fixture ||
      typeof fixture !== "object" ||
      Array.isArray(fixture) ||
      Reflect.get(fixture, "schemaVersion") !== "np.configured-build-render-fixture.v1"
    )
      throw new SiteBuildError("input");
    await context.capsule.assertOriginalUnchanged();
    const status = await files.write(path, encode(fixture));
    return {
      schemaVersion: "np.site-build-cli-result.v1",
      operation,
      status,
      path,
      directionId,
      rendererFingerprint,
      renderEnvironmentFingerprint: fingerprint,
      commandRegistryFingerprint,
      validationScope: "configured-synthetic-fixture-projection",
      databaseMaterialized: false,
      renderedImages: 0,
      sourceWrites: 0,
    };
  }
  const previous =
    operation === "direction render"
      ? await existing(files, path, npBuildDirectionLimitsV1.set.bytes)
      : null;
  const existingSet =
    sealed ?? (previous ? npParseAgentDesignDirectionSetV1(decode(previous)) : null);
  if (existingSet) {
    if (
      JSON.stringify(siteBuildDraftFromSealedDirectionsV1(existingSet)) !== JSON.stringify(drafts)
    )
      throw new SiteBuildError("conflict");
    const validated = await validatePreparedSiteBuildDirectionsV1({
      ...context,
      sealedSet: existingSet,
      artifactProject: cwd,
    });
    await observed.capsule.assertOriginalUnchanged();
    const status =
      operation === "direction validate"
        ? await files.write(path, siteBuildSealedDirectionBytesV1(validated.set))
        : "unchanged";
    return {
      schemaVersion: "np.site-build-cli-result.v1",
      operation,
      status,
      path,
      renderedImages: 6,
      freshPageJobs: validated.audits.length - 1,
      rendererFingerprint,
      renderEnvironmentFingerprint: fingerprint,
      commandRegistryFingerprint,
      validationScope: "fresh-native-rerender-byte-equality",
      artifacts: validated.artifacts.map((item) => item.path),
    };
  }
  const rendered = await renderPreparedSiteBuildDirectionsV1(context);
  await observed.capsule.assertOriginalUnchanged();
  const publication = await publishSiteBuildDirectionArtifactsV1({
    project: cwd,
    artifacts: rendered.artifacts,
    sealedSet: { path, bytes: siteBuildSealedDirectionBytesV1(rendered.set) },
  });
  return {
    schemaVersion: "np.site-build-cli-result.v1",
    operation,
    status: publication.status,
    path,
    renderedImages: 6,
    freshPageJobs: rendered.audits.length - 1,
    rendererFingerprint,
    renderEnvironmentFingerprint: fingerprint,
    commandRegistryFingerprint,
    validationScope: "trusted-native-render-and-seal",
    artifacts: publication.paths,
  };
}
