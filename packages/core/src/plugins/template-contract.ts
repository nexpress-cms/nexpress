export interface NpPageTemplateRenderProps<
  TDocument = Record<string, unknown>,
  TBlockContext = unknown,
> {
  doc: TDocument;
  blockCtx?: TBlockContext;
}

export interface NpPageTemplateDefinition<
  TDocument = Record<string, unknown>,
  TBlockContext = unknown,
  TResult = unknown,
> {
  label: string;
  description?: string;
  component: (props: NpPageTemplateRenderProps<TDocument, TBlockContext>) => TResult;
}

export type NpPageTemplateRegistry<
  TDocument = Record<string, unknown>,
  TBlockContext = unknown,
  TResult = unknown,
> = Record<string, Record<string, NpPageTemplateDefinition<TDocument, TBlockContext, TResult>>>;

export interface NpPageTemplateContractIssue {
  code: "invalid-registry" | "invalid-collection" | "invalid-template";
  location: string;
  message: string;
}

export interface NpPluginTemplateRegistration {
  label: string;
  description?: string;
  component: (...args: never[]) => unknown;
}

const collectionSlugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const templateIdPattern = /^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/u;

function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value) as unknown;
  return prototype === Object.prototype || prototype === null;
}

function issue(
  code: NpPageTemplateContractIssue["code"],
  location: string,
  message: string,
): NpPageTemplateContractIssue {
  return { code, location, message };
}

export function npAnalyzePageTemplateRegistry(value: unknown): NpPageTemplateContractIssue[] {
  if (!isRecord(value)) {
    return [issue("invalid-registry", "templates", "templates must be a plain object.")];
  }

  const issues: NpPageTemplateContractIssue[] = [];
  for (const [collectionSlug, rawTemplates] of Object.entries(value)) {
    const collectionLocation = `templates.${collectionSlug}`;
    if (!collectionSlugPattern.test(collectionSlug) || collectionSlug.length > 100) {
      issues.push(
        issue(
          "invalid-collection",
          collectionLocation,
          `collection slug "${collectionSlug}" must use lowercase kebab-case and be 100 characters or fewer.`,
        ),
      );
      continue;
    }
    if (!isRecord(rawTemplates) || Object.keys(rawTemplates).length === 0) {
      issues.push(
        issue(
          "invalid-collection",
          collectionLocation,
          `template collection "${collectionSlug}" must be a non-empty plain object.`,
        ),
      );
      continue;
    }

    for (const [templateId, rawTemplate] of Object.entries(rawTemplates)) {
      const location = `${collectionLocation}.${templateId}`;
      if (!templateIdPattern.test(templateId) || templateId.length > 100) {
        issues.push(
          issue(
            "invalid-template",
            location,
            `template id "${templateId}" must be a safe identifier and be 100 characters or fewer.`,
          ),
        );
        continue;
      }
      if (!isRecord(rawTemplate)) {
        issues.push(
          issue(
            "invalid-template",
            location,
            `template "${collectionSlug}:${templateId}" must be an object.`,
          ),
        );
        continue;
      }
      const unsupported = Object.keys(rawTemplate).find(
        (key) => key !== "label" && key !== "description" && key !== "component",
      );
      if (unsupported) {
        issues.push(
          issue(
            "invalid-template",
            location,
            `template "${collectionSlug}:${templateId}" has unsupported field "${unsupported}".`,
          ),
        );
        continue;
      }
      if (
        typeof rawTemplate.label !== "string" ||
        rawTemplate.label.trim().length === 0 ||
        rawTemplate.label.length > 120
      ) {
        issues.push(
          issue(
            "invalid-template",
            location,
            `template "${collectionSlug}:${templateId}" label must be non-empty and 120 characters or fewer.`,
          ),
        );
      }
      if (
        rawTemplate.description !== undefined &&
        (typeof rawTemplate.description !== "string" ||
          rawTemplate.description.trim().length === 0 ||
          rawTemplate.description.length > 500)
      ) {
        issues.push(
          issue(
            "invalid-template",
            location,
            `template "${collectionSlug}:${templateId}" description must be non-empty and 500 characters or fewer.`,
          ),
        );
      }
      if (typeof rawTemplate.component !== "function") {
        issues.push(
          issue(
            "invalid-template",
            location,
            `template "${collectionSlug}:${templateId}" component must be a function.`,
          ),
        );
      }
    }
  }
  return issues;
}

export function npValidatePageTemplateRegistry(
  value: unknown,
): { ok: true } | { ok: false; message: string } {
  const first = npAnalyzePageTemplateRegistry(value)[0];
  return first ? { ok: false, message: first.message } : { ok: true };
}

export function npPageTemplateKeys(value: unknown): string[] {
  if (npAnalyzePageTemplateRegistry(value).length > 0) return [];
  return Object.entries(value as Record<string, Record<string, unknown>>).flatMap(
    ([collectionSlug, templates]) =>
      Object.keys(templates).map((templateId) => `${collectionSlug}:${templateId}`),
  );
}
