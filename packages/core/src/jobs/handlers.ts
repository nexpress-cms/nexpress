import { type NpJobType } from "../config/types.js";

export type NpJobHandler = (data: unknown) => Promise<void>;

const handlers = new Map<NpJobType, NpJobHandler>();

export function registerJobHandler(type: NpJobType, handler: NpJobHandler): void {
  handlers.set(type, handler);
}

export function getJobHandler(type: NpJobType): NpJobHandler | undefined {
  return handlers.get(type);
}

export function getAllJobHandlers(): ReadonlyMap<NpJobType, NpJobHandler> {
  return handlers;
}
