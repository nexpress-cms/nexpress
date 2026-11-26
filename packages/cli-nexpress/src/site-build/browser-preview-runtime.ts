import { SiteBuildError } from "./artifact-io.js";
import {
  createSiteBuildBrowserPreviewProgramV1,
  requireSiteBuildBrowserPreviewObservationV1,
  type NpSiteBuildBrowserPreviewInputV1,
  type NpSiteBuildBrowserPreviewObservationV1,
} from "./browser-preview-probes.js";

type Result = Record<string, unknown>;
const record = (value: unknown): value is Result =>
  value !== null && typeof value === "object" && !Array.isArray(value);

/**
 * Internal fixed CDP owner. Its caller owns continuous request auditing, the
 * source-derived expectations, timeout, audience proof and browser lifecycle.
 * No expression or execution-context identifier comes from an authored file.
 */
export async function runSiteBuildBrowserPreviewChecksV1(input: {
  command: (method: string, params: Result) => Promise<Result>;
  frameId: string;
  context: Omit<NpSiteBuildBrowserPreviewInputV1, "phase">;
  settle: () => Promise<void>;
}): Promise<{
  document: NpSiteBuildBrowserPreviewObservationV1 & { phase: "document" };
  interaction: NpSiteBuildBrowserPreviewObservationV1 & { phase: "interaction" };
}> {
  const fail = (): never => {
    throw new SiteBuildError("input");
  };
  if (!/^[A-Za-z0-9_-]{1,128}$/u.test(input.frameId)) return fail();
  // Validate both programs before creating a world or interacting with the DOM.
  const documentProgram = createSiteBuildBrowserPreviewProgramV1({
    ...input.context,
    phase: "document",
  });
  const interactionProgram = createSiteBuildBrowserPreviewProgramV1({
    ...input.context,
    phase: "interaction",
  });
  const world = await input.command("Page.createIsolatedWorld", {
    frameId: input.frameId,
    worldName: "np-site-build-preview-checks-v1",
    grantUniveralAccess: false,
  });
  if (
    !Number.isSafeInteger(world.executionContextId) ||
    typeof world.executionContextId !== "number" ||
    world.executionContextId <= 0
  )
    return fail();
  const evaluate = async (expression: string) => {
    const result = await input.command("Runtime.evaluate", {
      expression,
      contextId: world.executionContextId,
      awaitPromise: true,
      returnByValue: true,
      timeout: 5000,
    });
    if (
      result.exceptionDetails ||
      !record(result.result) ||
      result.result.type !== "object" ||
      !Object.hasOwn(result.result, "value")
    )
      return fail();
    return requireSiteBuildBrowserPreviewObservationV1(result.result.value);
  };
  const document = await evaluate(documentProgram);
  if (document.phase !== "document") return fail();
  const interaction = await evaluate(interactionProgram);
  if (interaction.phase !== "interaction") return fail();
  // The fixed interaction restores focus, scroll and menu state before settling.
  // A screenshot is captured later, after the caller freezes script execution.
  await input.settle();
  return { document, interaction };
}
