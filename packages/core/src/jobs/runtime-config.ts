export function npRequireJobDurationMs(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${path} must be a positive safe integer`);
  }
  return value;
}

export function npReadJobDurationMs(envVar: string, fallbackUnits: number, unitMs: number): number {
  const raw = process.env[envVar];
  const units =
    raw === undefined || raw === ""
      ? npRequireJobDurationMs(fallbackUnits, `${envVar}.default`)
      : readPositiveInteger(raw, envVar);
  const multiplier = npRequireJobDurationMs(unitMs, `${envVar}.unitMs`);
  const milliseconds = units * multiplier;
  if (!Number.isSafeInteger(milliseconds)) {
    throw new Error(`${envVar} exceeds the safe duration range`);
  }
  return milliseconds;
}

function readPositiveInteger(value: string, path: string): number {
  if (!/^[1-9]\d*$/u.test(value)) {
    throw new Error(`${path} must be a positive integer`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new Error(`${path} exceeds the safe integer range`);
  return parsed;
}
