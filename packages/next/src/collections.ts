import {
  NpValidationError,
  type NpAuthUser,
  type NpFindOptions,
  type NpFindResult,
  type NpSaveOptions,
  type NpSaveResult,
  findDocuments as coreFindDocuments,
  getDocumentById as coreGetDocumentById,
  saveDocument as coreSaveDocument,
  deleteDocument as coreDeleteDocument,
} from "@nexpress/core";

export interface CollectionHelpersOptions {
  /** Called before every collection operation — wire DB/storage/plugins here. */
  ensureReady(): void | Promise<void>;
}

export type CollectionHelpers = {
  readonly parseFindOptions: (this: void, searchParams: URLSearchParams) => NpFindOptions;
  readonly findCollectionDocuments: (
    this: void,
    slug: string,
    options: NpFindOptions,
    user: NpAuthUser | null,
  ) => Promise<NpFindResult>;
  readonly getCollectionDocument: (
    this: void,
    slug: string,
    id: string,
    user: NpAuthUser | null,
  ) => Promise<Record<string, unknown> | null>;
  readonly saveCollectionDocument: (
    this: void,
    slug: string,
    id: string | null,
    data: Record<string, unknown>,
    user: NpAuthUser,
    options?: NpSaveOptions,
  ) => Promise<NpSaveResult>;
  readonly deleteCollectionDocument: (
    this: void,
    slug: string,
    id: string,
    user: NpAuthUser,
  ) => Promise<void>;
};

function parseWhere(where: string | null): Record<string, unknown> | undefined {
  if (!where) return undefined;

  let parsed: unknown;
  try {
    parsed = JSON.parse(where);
  } catch {
    throw new NpValidationError("Invalid query parameters", [
      { field: "where", message: "Must be valid JSON" },
    ]);
  }

  if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") {
    throw new NpValidationError("Invalid query parameters", [
      { field: "where", message: "Must be a JSON object" },
    ]);
  }

  return parsed as Record<string, unknown>;
}

function parsePositiveInt(
  value: string | null,
  field: string,
  max?: number,
): number | undefined {
  if (value === null) return undefined;

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0 || (max !== undefined && parsed > max)) {
    throw new NpValidationError("Invalid query parameters", [
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

/**
 * Factory for the collection-API helpers used by Next route handlers. The
 * `ensureReady` callback runs before every operation so the consumer can
 * wire up DB + plugins lazily (typically that's `getDb()` +
 * `ensurePluginsLoaded()`).
 */
export function createCollectionHelpers(
  options: CollectionHelpersOptions,
): CollectionHelpers {
  async function ready(): Promise<void> {
    await options.ensureReady();
  }

  const parseFindOptions = (searchParams: URLSearchParams): NpFindOptions => {
    const sort = searchParams.get("sort");
    const search = searchParams.get("search");
    return {
      page: parsePositiveInt(searchParams.get("page"), "page"),
      limit: parsePositiveInt(searchParams.get("limit"), "limit", 100),
      sort: sort && sort.length > 0 ? sort : undefined,
      search: search && search.length > 0 ? search : undefined,
      where: parseWhere(searchParams.get("where")),
    };
  };

  const findCollectionDocuments = async (
    slug: string,
    opts: NpFindOptions,
    user: NpAuthUser | null,
  ): Promise<NpFindResult> => {
    await ready();
    return coreFindDocuments(slug, opts, user ?? undefined);
  };

  const getCollectionDocument = async (
    slug: string,
    id: string,
    user: NpAuthUser | null,
  ): Promise<Record<string, unknown> | null> => {
    await ready();
    return coreGetDocumentById(slug, id, user ?? undefined);
  };

  const saveCollectionDocument = async (
    slug: string,
    id: string | null,
    data: Record<string, unknown>,
    user: NpAuthUser,
    options?: NpSaveOptions,
  ): Promise<NpSaveResult> => {
    await ready();
    return coreSaveDocument(slug, id, data, user, options);
  };

  const deleteCollectionDocument = async (
    slug: string,
    id: string,
    user: NpAuthUser,
  ): Promise<void> => {
    await ready();
    await coreDeleteDocument(slug, id, user);
  };

  return {
    parseFindOptions,
    findCollectionDocuments,
    getCollectionDocument,
    saveCollectionDocument,
    deleteCollectionDocument,
  };
}
