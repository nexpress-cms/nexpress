import {
  NxError,
  type NxAuthUser,
  NxValidationError,
} from "@nexpress/core";

import { ensureCoreServices, ensurePluginsLoaded } from "@/lib/init-core";

export interface NxFindOptions {
  page?: number;
  limit?: number;
  sort?: string;
  search?: string;
  where?: Record<string, unknown>;
}

export interface NxFindResult<T = Record<string, unknown>> {
  docs: T[];
  totalDocs: number;
  totalPages: number;
  page: number;
  limit: number;
  hasNextPage: boolean;
  hasPrevPage: boolean;
}

export interface NxSaveResult {
  doc: Record<string, unknown>;
  operation: "create" | "update";
}

interface CollectionPipelineModule {
  findDocuments(
    slug: string,
    options: NxFindOptions,
    user: NxAuthUser | null,
  ): Promise<NxFindResult>;
  getDocumentById(
    slug: string,
    id: string,
    user: NxAuthUser | null,
  ): Promise<Record<string, unknown> | null>;
  saveDocument(
    slug: string,
    id: string | null,
    data: Record<string, unknown>,
    user: NxAuthUser,
  ): Promise<NxSaveResult>;
  deleteDocument(slug: string, id: string, user: NxAuthUser): Promise<void>;
}

const coreModulePromise = import("@nexpress/core") as Promise<
  Record<string, unknown> & CollectionPipelineModule
>;

async function getCollectionPipeline(): Promise<CollectionPipelineModule> {
  ensureCoreServices();
  await ensurePluginsLoaded();
  const coreModule = await coreModulePromise;

  if (
    typeof coreModule.findDocuments !== "function" ||
    typeof coreModule.getDocumentById !== "function" ||
    typeof coreModule.saveDocument !== "function" ||
    typeof coreModule.deleteDocument !== "function"
  ) {
    throw new NxError("Collection pipeline functions are unavailable", "INTERNAL_ERROR", 500);
  }

  return coreModule;
}

function parseWhere(where: string | null): Record<string, unknown> | undefined {
  if (!where) {
    return undefined;
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(where);
  } catch {
    throw new NxValidationError("Invalid query parameters", [
      {
        field: "where",
        message: "Must be valid JSON",
      },
    ]);
  }

  if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") {
    throw new NxValidationError("Invalid query parameters", [
      {
        field: "where",
        message: "Must be a JSON object",
      },
    ]);
  }

  return parsed as Record<string, unknown>;
}

function parsePositiveInt(
  value: string | null,
  field: string,
  max?: number,
): number | undefined {
  if (value === null) {
    return undefined;
  }

  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed <= 0 || (max !== undefined && parsed > max)) {
    throw new NxValidationError("Invalid query parameters", [
      {
        field,
        message:
          max === undefined
            ? "Must be a positive integer"
            : `Must be a positive integer no greater than ${max}`,
      },
    ]);
  }

  return parsed;
}

export function parseFindOptions(searchParams: URLSearchParams): NxFindOptions {
  const sort = searchParams.get("sort");
  const search = searchParams.get("search");

  return {
    page: parsePositiveInt(searchParams.get("page"), "page"),
    limit: parsePositiveInt(searchParams.get("limit"), "limit", 100),
    sort: sort && sort.length > 0 ? sort : undefined,
    search: search && search.length > 0 ? search : undefined,
    where: parseWhere(searchParams.get("where")),
  };
}

export async function findCollectionDocuments(
  slug: string,
  options: NxFindOptions,
  user: NxAuthUser | null,
): Promise<NxFindResult> {
  return (await getCollectionPipeline()).findDocuments(slug, options, user);
}

export async function getCollectionDocument(
  slug: string,
  id: string,
  user: NxAuthUser | null,
): Promise<Record<string, unknown> | null> {
  return (await getCollectionPipeline()).getDocumentById(slug, id, user);
}

export async function saveCollectionDocument(
  slug: string,
  id: string | null,
  data: Record<string, unknown>,
  user: NxAuthUser,
): Promise<NxSaveResult> {
  return (await getCollectionPipeline()).saveDocument(slug, id, data, user);
}

export async function deleteCollectionDocument(
  slug: string,
  id: string,
  user: NxAuthUser,
): Promise<void> {
  await (await getCollectionPipeline()).deleteDocument(slug, id, user);
}
