export const NP_MINIMUM_NODE_VERSION = "20.19.0";
export const NP_MINIMUM_NODE_ENGINE = `>=${NP_MINIMUM_NODE_VERSION}`;

const MINIMUM_NODE_PARTS = [20, 19, 0] as const;

export function npIsSupportedNodeVersion(version: string): boolean {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:[-+]|$)/.exec(version);
  if (!match) return false;

  const parts = match.slice(1, 4).map((part) => Number.parseInt(part ?? "", 10));
  if (parts.some((part) => !Number.isSafeInteger(part) || part < 0)) return false;

  for (let index = 0; index < MINIMUM_NODE_PARTS.length; index += 1) {
    const current = parts[index] ?? 0;
    const minimum = MINIMUM_NODE_PARTS[index] ?? 0;
    if (current > minimum) return true;
    if (current < minimum) return false;
  }
  return true;
}
