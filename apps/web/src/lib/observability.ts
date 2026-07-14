import type { NpObservabilityAdapters } from "@nexpress/core/observability";

/**
 * One adapter definition shared by the web process, worker, and generated
 * scripts. Set the matching environment intent to `custom` when populating
 * either field; built-in defaults are console logging and noop reporting.
 */
export const observabilityAdapters = {} satisfies NpObservabilityAdapters;
