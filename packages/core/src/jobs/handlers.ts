import {
  NP_BUILTIN_JOB_TYPES,
  npNormalizeJobPayload,
  npRequireJobType,
  type NpJobData,
  type NpJobPayload,
  type NpJobType,
} from "../jobs-contract/index.js";

export type NpJobPayloadParser<TPayload extends object = NpJobData> = (data: NpJobData) => TPayload;

export type NpJobHandler<TPayload extends object = NpJobData> = (data: TPayload) => Promise<void>;

export interface NpJobHandlerOptions<TPayload extends object = NpJobData> {
  /**
   * Optional application/plugin-owned parser for custom job payloads. It is
   * called both before enqueue and again before handler dispatch. Built-in
   * job types always use the framework parser first.
   */
  parsePayload?: NpJobPayloadParser<TPayload>;
}

interface NpJobHandlerRegistration {
  handler: NpJobHandler;
  parsePayload(data: unknown): NpJobData;
  sourceHandler: NpJobHandler<object>;
  sourceParser: NpJobPayloadParser<object> | undefined;
}

const registrations = new Map<NpJobType, NpJobHandlerRegistration>();

export function registerJobHandler<
  TType extends NpJobType,
  TPayload extends object = NpJobPayload<TType>,
>(type: TType, handler: NpJobHandler<TPayload>, options: NpJobHandlerOptions<TPayload> = {}): void {
  const canonicalType = npRequireJobType(type);
  if (!isExactHandlerOptions(options)) {
    throw new Error(`Job handler options for "${canonicalType}" must contain only parsePayload.`);
  }
  if (typeof handler !== "function") {
    throw new Error(`Job handler for "${canonicalType}" must be a function.`);
  }
  if (options.parsePayload !== undefined && typeof options.parsePayload !== "function") {
    throw new Error(`Payload parser for "${canonicalType}" must be a function.`);
  }
  const existing = registrations.get(canonicalType);
  if (existing) {
    if (existing.sourceHandler === handler && existing.sourceParser === options.parsePayload)
      return;
    throw new Error(`Job handler "${canonicalType}" is already registered.`);
  }

  const parsePayload = (data: unknown): NpJobData => {
    const frameworkPayload = npNormalizeJobPayload(canonicalType, data) as NpJobData;
    return options.parsePayload
      ? (npNormalizeJobPayload(canonicalType, options.parsePayload(frameworkPayload)) as NpJobData)
      : frameworkPayload;
  };
  const wrapped: NpJobHandler = async (data) => {
    const result = await handler(parsePayload(data) as TPayload);
    if (result !== undefined) {
      throw new Error(`Job handler "${canonicalType}" must resolve to void.`);
    }
  };
  registrations.set(canonicalType, {
    handler: wrapped,
    parsePayload,
    sourceHandler: handler as NpJobHandler<object>,
    sourceParser: options.parsePayload,
  });
}

function isExactHandlerOptions(value: unknown): value is NpJobHandlerOptions<object> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value) as unknown;
  if (prototype !== Object.prototype && prototype !== null) return false;
  for (const key of Reflect.ownKeys(value)) {
    if (key !== "parsePayload") return false;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !("value" in descriptor)) return false;
  }
  return true;
}

export function normalizeRegisteredJobPayload<TType extends NpJobType>(
  type: TType,
  data: unknown,
): NpJobPayload<TType> & NpJobData {
  const canonicalType = npRequireJobType(type);
  const registration = registrations.get(canonicalType);
  return (registration?.parsePayload(data) ??
    npNormalizeJobPayload(canonicalType, data)) as NpJobPayload<TType> & NpJobData;
}

export function getJobHandler(type: NpJobType): NpJobHandler | undefined {
  return registrations.get(type)?.handler;
}

export function getAllJobHandlers(): ReadonlyMap<NpJobType, NpJobHandler> {
  return new Map(
    Array.from(registrations, ([type, registration]) => [type, registration.handler] as const),
  );
}

export function getKnownJobTypes(): readonly NpJobType[] {
  return Array.from(new Set<NpJobType>([...NP_BUILTIN_JOB_TYPES, ...registrations.keys()])).sort(
    (left, right) => (left < right ? -1 : left > right ? 1 : 0),
  );
}
