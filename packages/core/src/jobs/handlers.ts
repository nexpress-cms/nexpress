import { type NxJobType } from "../config/types.js";

export type NxJobHandler = (data: unknown) => Promise<void>;

const handlers = new Map<NxJobType, NxJobHandler>();

export function registerJobHandler(type: NxJobType, handler: NxJobHandler): void {
  handlers.set(type, handler);
}

export function getJobHandler(type: NxJobType): NxJobHandler | undefined {
  return handlers.get(type);
}

export function getAllJobHandlers(): ReadonlyMap<NxJobType, NxJobHandler> {
  return handlers;
}
