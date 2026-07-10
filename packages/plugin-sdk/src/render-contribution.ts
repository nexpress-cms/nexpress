export type NpRenderContributionValidationResult = { ok: true } | { ok: false; message: string };

function invalid(message: string): NpRenderContributionValidationResult {
  return { ok: false, message };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value) as unknown;
  return prototype === Object.prototype || prototype === null;
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return isRecord(value) && Object.values(value).every((entry) => typeof entry === "string");
}

function validateHeadEntry(value: unknown, index: number): NpRenderContributionValidationResult {
  const path = `head[${index.toString()}]`;
  if (!isRecord(value) || typeof value.tag !== "string") {
    return invalid(`${path} must be a tagged object.`);
  }

  switch (value.tag) {
    case "meta":
    case "link":
      if (!hasOnlyKeys(value, ["tag", "attrs"]) || !isStringRecord(value.attrs)) {
        return invalid(`${path} ${value.tag} entries require string attrs and no extra fields.`);
      }
      return { ok: true };
    case "script":
      if (!hasOnlyKeys(value, ["tag", "attrs", "children"])) {
        return invalid(`${path} script entries contain unsupported fields.`);
      }
      if (value.attrs !== undefined && !isStringRecord(value.attrs)) {
        return invalid(`${path}.attrs must contain only string values.`);
      }
      if (value.children !== undefined && typeof value.children !== "string") {
        return invalid(`${path}.children must be a string when provided.`);
      }
      return { ok: true };
    case "style":
      if (!hasOnlyKeys(value, ["tag", "attrs", "children"])) {
        return invalid(`${path} style entries contain unsupported fields.`);
      }
      if (value.attrs !== undefined && !isStringRecord(value.attrs)) {
        return invalid(`${path}.attrs must contain only string values.`);
      }
      if (typeof value.children !== "string") {
        return invalid(`${path}.children must be a string.`);
      }
      return { ok: true };
    default:
      return invalid(`${path}.tag "${value.tag}" is not supported.`);
  }
}

function validateBodyEntry(value: unknown, index: number): NpRenderContributionValidationResult {
  const path = `bodyEnd[${index.toString()}]`;
  if (!isRecord(value) || typeof value.tag !== "string") {
    return invalid(`${path} must be a tagged object.`);
  }

  switch (value.tag) {
    case "script":
      if (!hasOnlyKeys(value, ["tag", "attrs", "children"])) {
        return invalid(`${path} script entries contain unsupported fields.`);
      }
      if (value.attrs !== undefined && !isStringRecord(value.attrs)) {
        return invalid(`${path}.attrs must contain only string values.`);
      }
      if (value.children !== undefined && typeof value.children !== "string") {
        return invalid(`${path}.children must be a string when provided.`);
      }
      return { ok: true };
    case "noscript":
      if (!hasOnlyKeys(value, ["tag", "children"]) || typeof value.children !== "string") {
        return invalid(`${path} noscript entries require string children and no extra fields.`);
      }
      return { ok: true };
    default:
      return invalid(`${path}.tag "${value.tag}" is not supported.`);
  }
}

/**
 * Runtime companion to the render-hook TypeScript contract. TypeScript catches
 * invalid contributions during authoring; the host calls this after a handler
 * returns so JavaScript plugins and casted values fail closed instead of being
 * partially rendered.
 */
export function npValidateRenderContribution(value: unknown): NpRenderContributionValidationResult {
  if (!isRecord(value)) {
    return invalid("render contribution must be a plain object.");
  }
  if (!hasOnlyKeys(value, ["head", "bodyEnd"])) {
    return invalid("render contribution supports only head and bodyEnd fields.");
  }

  if (value.head !== undefined) {
    if (!Array.isArray(value.head)) {
      return invalid("head must be an array.");
    }
    for (const [index, entry] of value.head.entries()) {
      const result = validateHeadEntry(entry, index);
      if (!result.ok) return result;
    }
  }

  if (value.bodyEnd !== undefined) {
    if (!Array.isArray(value.bodyEnd)) {
      return invalid("bodyEnd must be an array.");
    }
    for (const [index, entry] of value.bodyEnd.entries()) {
      const result = validateBodyEntry(entry, index);
      if (!result.ok) return result;
    }
  }

  return { ok: true };
}
