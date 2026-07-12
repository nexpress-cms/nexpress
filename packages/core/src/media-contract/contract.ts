import { npValidateRichTextContent } from "../fields/rich-text.js";
import {
  npMediaCropPositions,
  npMediaImageFormats,
  npMediaStatuses,
  type NpMediaApiItem,
  type NpMediaFocalPoint,
  type NpMediaImageSize,
  type NpMediaProcessingOptions,
  type NpMediaRecord,
  type NpMediaVariant,
  type NpMediaVariants,
  type NpMediaWireRecord,
} from "./types.js";

export const npMediaContractLimits = {
  maxVariants: 64,
  variantNameLength: 63,
  filenameLength: 255,
  mimeTypeLength: 127,
  storageKeyLength: 2048,
  textLength: 4096,
  maxDimension: 16_384,
  maxStoredDimension: 100_000,
  maxFileSize: Number.MAX_SAFE_INTEGER,
} as const;

export const npMediaVariantNamePattern = "^(?!original$)[a-z0-9][a-z0-9_-]{0,62}$";
export const npMediaStorageKeyPattern = "^[A-Za-z0-9][A-Za-z0-9._/-]{0,2047}$";

export type NpMediaContractIssueCode =
  "shape" | "unknown-field" | "invalid-field" | "duplicate-variant" | "invariant";

export interface NpMediaContractIssue {
  readonly code: NpMediaContractIssueCode;
  readonly path: string;
  readonly message: string;
}

export type NpMediaValidationResult =
  { readonly ok: true } | { readonly ok: false; readonly issue: NpMediaContractIssue };

const variantNamePattern = new RegExp(npMediaVariantNamePattern, "u");
const storageKeyPattern = new RegExp(npMediaStorageKeyPattern, "u");
const mimeTypePattern = /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/u;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const hashPattern = /^[0-9a-f]{64}$/u;
const recordKeys = new Set([
  "id",
  "filename",
  "originalFilename",
  "mimeType",
  "filesize",
  "width",
  "height",
  "alt",
  "caption",
  "focalPoint",
  "sizes",
  "storageKey",
  "hash",
  "status",
  "folderId",
  "uploadedBy",
  "uploadedByMemberId",
  "createdAt",
  "updatedAt",
  "deletedAt",
]);
const variantKeys = new Set(["filename", "mimeType", "filesize", "width", "height", "storageKey"]);
const imageSizeKeys = new Set(["name", "width", "height", "crop"]);

function issue(
  code: NpMediaContractIssueCode,
  path: string,
  message: string,
): NpMediaContractIssue {
  return { code, path, message };
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value) as unknown;
  return prototype === Object.prototype || prototype === null;
}

function pushUnknownFields(
  value: Record<string, unknown>,
  allowed: ReadonlySet<string>,
  path: string,
  issues: NpMediaContractIssue[],
): void {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      issues.push(issue("unknown-field", `${path}.${key}`, `unsupported media field "${key}".`));
    }
  }
}

function isTrimmedString(value: unknown, maxLength: number): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= maxLength &&
    value === value.trim() &&
    !hasControlCharacter(value)
  );
}

function hasControlCharacter(value: string): boolean {
  return Array.from(value).some((character) => {
    const code = character.charCodeAt(0);
    return code <= 0x1f || code === 0x7f;
  });
}

function isDimension(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value > 0 &&
    value <= npMediaContractLimits.maxStoredDimension
  );
}

function isFileSize(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 0 &&
    value <= npMediaContractLimits.maxFileSize
  );
}

function isStorageKey(value: unknown): value is string {
  if (!isTrimmedString(value, npMediaContractLimits.storageKeyLength)) return false;
  if (!storageKeyPattern.test(value)) return false;
  return value.split("/").every((segment) => segment !== "" && segment !== "." && segment !== "..");
}

function isUuidOrNull(value: unknown): value is string | null {
  return value === null || (typeof value === "string" && uuidPattern.test(value));
}

function isIsoDate(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const date = new Date(value);
  return !Number.isNaN(date.valueOf()) && date.toISOString() === value;
}

function analyzeFocalPointAt(value: unknown, path: string): NpMediaContractIssue[] {
  if (!isPlainRecord(value)) {
    return [issue("shape", path, "media focal points must be plain objects.")];
  }
  const issues: NpMediaContractIssue[] = [];
  pushUnknownFields(value, new Set(["x", "y"]), path, issues);
  for (const coordinate of ["x", "y"] as const) {
    const candidate = value[coordinate];
    if (
      typeof candidate !== "number" ||
      !Number.isFinite(candidate) ||
      candidate < 0 ||
      candidate > 1
    ) {
      issues.push(
        issue(
          "invalid-field",
          `${path}.${coordinate}`,
          `media focal-point ${coordinate} must be a finite number from 0 through 1.`,
        ),
      );
    }
  }
  return issues;
}

function analyzeVariantAt(value: unknown, path: string): NpMediaContractIssue[] {
  if (!isPlainRecord(value)) {
    return [issue("shape", path, "media variants must be plain objects.")];
  }
  const issues: NpMediaContractIssue[] = [];
  pushUnknownFields(value, variantKeys, path, issues);
  if (
    !isTrimmedString(value.filename, npMediaContractLimits.filenameLength) ||
    /[/\\]/u.test(value.filename)
  ) {
    issues.push(
      issue(
        "invalid-field",
        `${path}.filename`,
        "variant filenames must be safe basename strings.",
      ),
    );
  }
  if (
    !isTrimmedString(value.mimeType, npMediaContractLimits.mimeTypeLength) ||
    !mimeTypePattern.test(value.mimeType) ||
    !value.mimeType.startsWith("image/")
  ) {
    issues.push(
      issue(
        "invalid-field",
        `${path}.mimeType`,
        "variant mimeType must be a canonical image MIME type.",
      ),
    );
  }
  if (!isFileSize(value.filesize) || value.filesize === 0) {
    issues.push(
      issue(
        "invalid-field",
        `${path}.filesize`,
        "variant filesize must be a positive safe integer.",
      ),
    );
  }
  for (const dimension of ["width", "height"] as const) {
    if (!isDimension(value[dimension])) {
      issues.push(
        issue(
          "invalid-field",
          `${path}.${dimension}`,
          `variant ${dimension} must be a positive integer no greater than ${npMediaContractLimits.maxStoredDimension.toString()}.`,
        ),
      );
    }
  }
  if (!isStorageKey(value.storageKey)) {
    issues.push(
      issue(
        "invalid-field",
        `${path}.storageKey`,
        "variant storageKey must be a safe relative object key.",
      ),
    );
  }
  return issues;
}

export function npAnalyzeMediaVariants(value: unknown): NpMediaContractIssue[] {
  if (!isPlainRecord(value)) {
    return [issue("shape", "media.sizes", "media sizes must be a plain object.")];
  }
  const entries = Object.entries(value);
  if (entries.length > npMediaContractLimits.maxVariants) {
    return [
      issue(
        "shape",
        "media.sizes",
        `media sizes may contain at most ${npMediaContractLimits.maxVariants.toString()} variants.`,
      ),
    ];
  }
  const issues: NpMediaContractIssue[] = [];
  for (const [name, variant] of entries) {
    if (!variantNamePattern.test(name) || name === "original") {
      issues.push(
        issue(
          "invalid-field",
          `media.sizes.${name}`,
          'variant names must be lowercase safe path segments and may not be "original".',
        ),
      );
    }
    issues.push(...analyzeVariantAt(variant, `media.sizes.${name}`));
  }
  return issues;
}

export function npValidateMediaVariants(value: unknown): NpMediaValidationResult {
  const first = npAnalyzeMediaVariants(value)[0];
  return first ? { ok: false, issue: first } : { ok: true };
}

export function isNpMediaVariants(value: unknown): value is NpMediaVariants {
  return npValidateMediaVariants(value).ok;
}

export function npAnalyzeMediaFocalPoint(value: unknown): NpMediaContractIssue[] {
  return analyzeFocalPointAt(value, "media.focalPoint");
}

export function npValidateMediaFocalPoint(value: unknown): NpMediaValidationResult {
  const first = npAnalyzeMediaFocalPoint(value)[0];
  return first ? { ok: false, issue: first } : { ok: true };
}

export function isNpMediaFocalPoint(value: unknown): value is NpMediaFocalPoint {
  return npValidateMediaFocalPoint(value).ok;
}

function analyzeImageSizeAt(value: unknown, index: number): NpMediaContractIssue[] {
  const path = `media.processing.sizes.${index.toString()}`;
  if (!isPlainRecord(value)) {
    return [issue("shape", path, "media image sizes must be plain objects.")];
  }
  const issues: NpMediaContractIssue[] = [];
  pushUnknownFields(value, imageSizeKeys, path, issues);
  if (
    typeof value.name !== "string" ||
    !variantNamePattern.test(value.name) ||
    value.name === "original"
  ) {
    issues.push(
      issue(
        "invalid-field",
        `${path}.name`,
        'image size names must be safe lowercase variant names other than "original".',
      ),
    );
  }
  if (!isDimension(value.width) || value.width > npMediaContractLimits.maxDimension) {
    issues.push(
      issue(
        "invalid-field",
        `${path}.width`,
        "image size width must be a bounded positive integer.",
      ),
    );
  }
  if (
    value.height !== undefined &&
    (!isDimension(value.height) || value.height > npMediaContractLimits.maxDimension)
  ) {
    issues.push(
      issue(
        "invalid-field",
        `${path}.height`,
        "image size height must be a bounded positive integer.",
      ),
    );
  }
  if (
    value.crop !== undefined &&
    !(npMediaCropPositions as readonly unknown[]).includes(value.crop)
  ) {
    issues.push(issue("invalid-field", `${path}.crop`, "image size crop is not supported."));
  } else if (value.crop !== undefined && value.height === undefined) {
    issues.push(issue("invariant", `${path}.crop`, "image size crop requires an explicit height."));
  }
  return issues;
}

export function npAnalyzeMediaProcessingOptions(value: unknown): NpMediaContractIssue[] {
  if (!isPlainRecord(value)) {
    return [issue("shape", "media.processing", "media processing options must be a plain object.")];
  }
  const issues: NpMediaContractIssue[] = [];
  pushUnknownFields(value, new Set(["sizes", "format", "quality"]), "media.processing", issues);
  if (value.sizes !== undefined) {
    if (!Array.isArray(value.sizes) || value.sizes.length > npMediaContractLimits.maxVariants) {
      issues.push(
        issue(
          "shape",
          "media.processing.sizes",
          `media processing sizes must be an array with at most ${npMediaContractLimits.maxVariants.toString()} entries.`,
        ),
      );
    } else {
      const seen = new Map<string, number>();
      for (const [index, size] of value.sizes.entries()) {
        issues.push(...analyzeImageSizeAt(size, index));
        if (isPlainRecord(size) && typeof size.name === "string") {
          const previous = seen.get(size.name);
          if (previous !== undefined) {
            issues.push(
              issue(
                "duplicate-variant",
                `media.processing.sizes.${index.toString()}.name`,
                `duplicate media variant "${size.name}"; first declared at index ${previous.toString()}.`,
              ),
            );
          } else {
            seen.set(size.name, index);
          }
        }
      }
    }
  }
  if (
    value.format !== undefined &&
    !(npMediaImageFormats as readonly unknown[]).includes(value.format)
  ) {
    issues.push(
      issue(
        "invalid-field",
        "media.processing.format",
        "media format must be avif, jpeg, png, or webp.",
      ),
    );
  }
  if (
    value.quality !== undefined &&
    (typeof value.quality !== "number" ||
      !Number.isInteger(value.quality) ||
      value.quality < 1 ||
      value.quality > 100)
  ) {
    issues.push(
      issue(
        "invalid-field",
        "media.processing.quality",
        "media quality must be an integer from 1 through 100.",
      ),
    );
  }
  return issues;
}

export function npValidateMediaProcessingOptions(value: unknown): NpMediaValidationResult {
  const first = npAnalyzeMediaProcessingOptions(value)[0];
  return first ? { ok: false, issue: first } : { ok: true };
}

export function isNpMediaProcessingOptions(value: unknown): value is NpMediaProcessingOptions {
  return npValidateMediaProcessingOptions(value).ok;
}

function analyzeRecord(value: unknown, wire: boolean): NpMediaContractIssue[] {
  const path = "media.record";
  if (!isPlainRecord(value)) return [issue("shape", path, "media records must be plain objects.")];
  const issues: NpMediaContractIssue[] = [];
  pushUnknownFields(value, recordKeys, path, issues);

  if (typeof value.id !== "string" || !uuidPattern.test(value.id)) {
    issues.push(issue("invalid-field", `${path}.id`, "media id must be a UUID."));
  }
  for (const key of ["filename", "originalFilename"] as const) {
    if (
      !isTrimmedString(value[key], npMediaContractLimits.filenameLength) ||
      /[/\\]/u.test(value[key])
    ) {
      issues.push(
        issue("invalid-field", `${path}.${key}`, `${key} must be a non-empty trimmed basename.`),
      );
    }
  }
  if (
    !isTrimmedString(value.mimeType, npMediaContractLimits.mimeTypeLength) ||
    !mimeTypePattern.test(value.mimeType)
  ) {
    issues.push(
      issue(
        "invalid-field",
        `${path}.mimeType`,
        "media mimeType must be canonical type/subtype text.",
      ),
    );
  }
  if (!isFileSize(value.filesize)) {
    issues.push(
      issue(
        "invalid-field",
        `${path}.filesize`,
        "media filesize must be a non-negative safe integer.",
      ),
    );
  }

  const widthValid = value.width === null || isDimension(value.width);
  const heightValid = value.height === null || isDimension(value.height);
  if (!widthValid)
    issues.push(
      issue(
        "invalid-field",
        `${path}.width`,
        "media width must be null or a bounded positive integer.",
      ),
    );
  if (!heightValid)
    issues.push(
      issue(
        "invalid-field",
        `${path}.height`,
        "media height must be null or a bounded positive integer.",
      ),
    );
  if ((value.width === null) !== (value.height === null)) {
    issues.push(
      issue(
        "invariant",
        `${path}.width`,
        "media width and height must either both be null or both be dimensions.",
      ),
    );
  }

  if (
    value.alt !== null &&
    (typeof value.alt !== "string" ||
      value.alt.length > npMediaContractLimits.textLength ||
      hasControlCharacter(value.alt))
  ) {
    issues.push(issue("invalid-field", `${path}.alt`, "media alt must be null or bounded text."));
  }
  if (value.caption !== null && !npValidateRichTextContent(value.caption).ok) {
    issues.push(
      issue(
        "invalid-field",
        `${path}.caption`,
        "media caption must use the NexPress rich-text v1 contract.",
      ),
    );
  }
  if (value.focalPoint !== null)
    issues.push(...analyzeFocalPointAt(value.focalPoint, `${path}.focalPoint`));
  if (value.sizes !== null) {
    issues.push(
      ...npAnalyzeMediaVariants(value.sizes).map((entry) => ({
        ...entry,
        path: entry.path.replace(/^media\.sizes/u, `${path}.sizes`),
      })),
    );
  }
  if (!isStorageKey(value.storageKey)) {
    issues.push(
      issue(
        "invalid-field",
        `${path}.storageKey`,
        "media storageKey must be a safe relative object key.",
      ),
    );
  }
  if (typeof value.hash !== "string" || !hashPattern.test(value.hash)) {
    issues.push(
      issue("invalid-field", `${path}.hash`, "media hash must be a lowercase SHA-256 digest."),
    );
  }
  if (!(npMediaStatuses as readonly unknown[]).includes(value.status)) {
    issues.push(
      issue("invalid-field", `${path}.status`, "media status must be processing, ready, or error."),
    );
  }
  for (const key of ["folderId", "uploadedBy", "uploadedByMemberId"] as const) {
    if (!isUuidOrNull(value[key])) {
      issues.push(issue("invalid-field", `${path}.${key}`, `${key} must be null or a UUID.`));
    }
  }
  if (value.uploadedBy !== null && value.uploadedByMemberId !== null) {
    issues.push(
      issue(
        "invariant",
        `${path}.uploadedBy`,
        "media records may have at most one staff or member uploader.",
      ),
    );
  }

  for (const key of ["createdAt", "updatedAt"] as const) {
    const valid = wire
      ? isIsoDate(value[key])
      : value[key] instanceof Date && !Number.isNaN(value[key].valueOf());
    if (!valid)
      issues.push(
        issue(
          "invalid-field",
          `${path}.${key}`,
          `${key} must be a valid ${wire ? "ISO date string" : "Date"}.`,
        ),
      );
  }
  const deletedValid =
    value.deletedAt === null ||
    (wire
      ? isIsoDate(value.deletedAt)
      : value.deletedAt instanceof Date && !Number.isNaN(value.deletedAt.valueOf()));
  if (!deletedValid) {
    issues.push(
      issue(
        "invalid-field",
        `${path}.deletedAt`,
        `deletedAt must be null or a valid ${wire ? "ISO date string" : "Date"}.`,
      ),
    );
  }
  return issues;
}

export function npAnalyzeMediaRecord(value: unknown): NpMediaContractIssue[] {
  return analyzeRecord(value, false);
}

export function npValidateMediaRecord(value: unknown): NpMediaValidationResult {
  const first = npAnalyzeMediaRecord(value)[0];
  return first ? { ok: false, issue: first } : { ok: true };
}

export function isNpMediaRecord(value: unknown): value is NpMediaRecord {
  return npValidateMediaRecord(value).ok;
}

export function npAssertMediaRecord(value: unknown): asserts value is NpMediaRecord {
  const validation = npValidateMediaRecord(value);
  if (!validation.ok) {
    throw new Error(
      `Invalid persisted media record at ${validation.issue.path}: ${validation.issue.message}`,
    );
  }
}

export function npAnalyzeMediaWireRecord(value: unknown): NpMediaContractIssue[] {
  return analyzeRecord(value, true);
}

export function npValidateMediaWireRecord(value: unknown): NpMediaValidationResult {
  const first = npAnalyzeMediaWireRecord(value)[0];
  return first ? { ok: false, issue: first } : { ok: true };
}

export function isNpMediaWireRecord(value: unknown): value is NpMediaWireRecord {
  return npValidateMediaWireRecord(value).ok;
}

export function npSerializeMediaRecord(record: NpMediaRecord): NpMediaWireRecord {
  npAssertMediaRecord(record);
  return {
    ...record,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
    deletedAt: record.deletedAt?.toISOString() ?? null,
  };
}

export function npAnalyzeMediaApiItem(value: unknown): NpMediaContractIssue[] {
  if (!isPlainRecord(value))
    return [issue("shape", "media.item", "media API items must be plain objects.")];
  const { urls, uploader, ...record } = value;
  const issues = npAnalyzeMediaWireRecord(record);
  if (!isPlainRecord(urls)) {
    issues.push(issue("shape", "media.item.urls", "media API urls must be a plain object."));
  } else {
    pushUnknownFields(urls, new Set(["original", "thumbnail"]), "media.item.urls", issues);
    if (!isTrimmedString(urls.original, npMediaContractLimits.storageKeyLength)) {
      issues.push(
        issue(
          "invalid-field",
          "media.item.urls.original",
          "original media URL must be a non-empty string.",
        ),
      );
    }
    if (
      urls.thumbnail !== null &&
      !isTrimmedString(urls.thumbnail, npMediaContractLimits.storageKeyLength)
    ) {
      issues.push(
        issue(
          "invalid-field",
          "media.item.urls.thumbnail",
          "thumbnail media URL must be null or a non-empty string.",
        ),
      );
    }
  }
  if (uploader !== undefined && uploader !== null) {
    if (!isPlainRecord(uploader) || (uploader.kind !== "staff" && uploader.kind !== "member")) {
      issues.push(
        issue(
          "shape",
          "media.item.uploader",
          "media uploader must be null, staff, or member metadata.",
        ),
      );
    } else if (uploader.kind === "staff") {
      pushUnknownFields(
        uploader,
        new Set(["kind", "name", "email"]),
        "media.item.uploader",
        issues,
      );
      if (uploader.name !== null && typeof uploader.name !== "string") {
        issues.push(
          issue(
            "invalid-field",
            "media.item.uploader.name",
            "staff uploader name must be null or text.",
          ),
        );
      }
      if (uploader.email !== null && typeof uploader.email !== "string") {
        issues.push(
          issue(
            "invalid-field",
            "media.item.uploader.email",
            "staff uploader email must be null or text.",
          ),
        );
      }
    } else {
      pushUnknownFields(
        uploader,
        new Set(["kind", "handle", "displayName"]),
        "media.item.uploader",
        issues,
      );
      if (!isTrimmedString(uploader.handle, npMediaContractLimits.textLength)) {
        issues.push(
          issue(
            "invalid-field",
            "media.item.uploader.handle",
            "member uploader handle must be non-empty text.",
          ),
        );
      }
      if (uploader.displayName !== null && typeof uploader.displayName !== "string") {
        issues.push(
          issue(
            "invalid-field",
            "media.item.uploader.displayName",
            "member display name must be null or text.",
          ),
        );
      }
    }
  }
  return issues;
}

export function npValidateMediaApiItem(value: unknown): NpMediaValidationResult {
  const first = npAnalyzeMediaApiItem(value)[0];
  return first ? { ok: false, issue: first } : { ok: true };
}

export function isNpMediaApiItem(value: unknown): value is NpMediaApiItem {
  return npValidateMediaApiItem(value).ok;
}

export type { NpMediaImageSize, NpMediaProcessingOptions, NpMediaVariant };
