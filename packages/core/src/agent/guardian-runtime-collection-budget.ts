import { NpAgentGatewayError } from "./admin-admission.js";

export class CollectionTimeout extends NpAgentGatewayError {
  constructor() {
    super("GUARDIAN_RUNTIME_SOURCE_TIMEOUT", 503, "Runtime observation collection is unavailable.");
  }
}

export interface CollectionBudget {
  checkpoint(this: void): void;
  remaining(this: void): number;
  wait<T>(this: void, work: () => T | Promise<T>): Promise<T>;
}

export function collectionBudget(): CollectionBudget {
  const deadline = performance.now() + 5000;
  let expired = false;
  const expire = () => {
    expired = true;
    return new CollectionTimeout();
  };
  const checkpoint = () => {
    if (expired || performance.now() >= deadline) throw expire();
  };
  const remaining = () => {
    checkpoint();
    const milliseconds = Math.floor(deadline - performance.now());
    if (milliseconds < 1) throw expire();
    return milliseconds;
  };
  return {
    checkpoint,
    remaining,
    async wait(work) {
      const milliseconds = remaining();
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const result = await Promise.race([
          Promise.resolve().then(() => {
            checkpoint();
            return work();
          }),
          new Promise<never>((_, reject) => {
            // Every nested wait and transaction checkpoint shares this expiry,
            // including when the rounded timer fires just before the deadline.
            timer = setTimeout(() => reject(expire()), milliseconds);
          }),
        ]);
        checkpoint();
        return result;
      } finally {
        if (timer !== undefined) clearTimeout(timer);
      }
    },
  };
}
