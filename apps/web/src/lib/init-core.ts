import { ensureCoreServices, ensureJobProducer, ensurePluginsLoaded } from "@/lib/bootstrap";

export { ensureCoreServices, ensureJobProducer, ensurePluginsLoaded };

/**
 * One-call setup for any write entrypoint (API route, server action, import).
 * Wires core services, loads plugins so hooks fire, and starts the pg-boss
 * producer so `enqueueJob` actually sends work to the worker when
 * `NX_ENABLE_JOBS=1`. Without this, writes that go through the pipeline or
 * `uploadMedia` silently drop their follow-up jobs.
 */
export async function ensureWriteReady(): Promise<void> {
  ensureCoreServices();
  await ensurePluginsLoaded();
  await ensureJobProducer();
}
