import {
  NpValidationError,
  NpCollectionContractError,
  getCollectionConfig,
  npSerializeCollectionDocumentWithDiagnostics,
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
import {
  npRequireCollectionFindOptions,
  type NpCollectionDocumentWire,
} from "@nexpress/core/collection-contract";

export type NpCollectionApiDocument = NpCollectionDocumentWire<Record<string, unknown>>;
export type NpCollectionApiFindResult = Omit<NpFindResult, "docs"> & {
  docs: NpCollectionApiDocument[];
};
export type NpCollectionApiSaveResult = Omit<NpSaveResult, "doc"> & {
  doc: NpCollectionApiDocument;
};

export interface CollectionHelpersOptions {
  /** Called before every collection operation — wire DB/storage/plugins here. */
  ensureReady(): void | Promise<void>;
  /** Optional host-level contract check run after bootstrap and before a save. */
  validateSave?(slug: string, data: Record<string, unknown>): void | Promise<void>;
}

export type CollectionHelpers = {
  readonly parseFindOptions: (this: void, searchParams: URLSearchParams) => NpFindOptions;
  readonly findCollectionDocuments: (
    this: void,
    slug: string,
    options: NpFindOptions,
    user: NpAuthUser | null,
  ) => Promise<NpCollectionApiFindResult>;
  readonly getCollectionDocument: (
    this: void,
    slug: string,
    id: string,
    user: NpAuthUser | null,
  ) => Promise<NpCollectionApiDocument | null>;
  readonly saveCollectionDocument: (
    this: void,
    slug: string,
    id: string | null,
    data: Record<string, unknown>,
    user: NpAuthUser,
    options?: NpSaveOptions,
  ) => Promise<NpCollectionApiSaveResult>;
  readonly deleteCollectionDocument: (
    this: void,
    slug: string,
    id: string,
    user: NpAuthUser,
  ) => Promise<void>;
};

/**
 * Reserved `where` keys that the pipeline interprets as
 * trusted-caller sentinels (cross-site / cross-visibility queries
 * for admin tools and bulk-export jobs). Per the security review
 * (#598), the public `?where=` query parameter must NOT be allowed
 * to set these — otherwise an anonymous request can pass
 * `{"siteId":"*","visibility":"*"}` and read documents from sibling
 * tenants and from `visibility=private` posts that anonymous users
 * shouldn't see.
 *
 * The pipeline still honors these sentinels when an INTERNAL caller
 * passes them programmatically (admin export tools build the where
 * dict in TypeScript, not from a request); the gate lives at the
 * trust boundary — this `parseWhere` helper — rather than inside
 * the pipeline so the distinction stays visible at the API layer.
 */
const RESERVED_WHERE_KEYS = ["siteId", "visibility"] as const;

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

  const sanitized = { ...(parsed as Record<string, unknown>) };
  for (const key of RESERVED_WHERE_KEYS) {
    if (Object.hasOwn(sanitized, key)) {
      throw new NpValidationError("Invalid query parameters", [
        { field: `where.${key}`, message: "Reserved collection filters are not public." },
      ]);
    }
  }

  return sanitized;
}

function parsePositiveInt(value: string | null, field: string, max?: number): number | undefined {
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
 * `ensureFor("plugins")`).
 */
export function createCollectionHelpers(
  helperOptions: CollectionHelpersOptions,
): CollectionHelpers {
  async function ready(): Promise<void> {
    await helperOptions.ensureReady();
  }

  const parseFindOptions = (searchParams: URLSearchParams): NpFindOptions => {
    const allowed = new Set(["page", "limit", "sort", "search", "where", "locale"]);
    for (const key of searchParams.keys()) {
      if (!allowed.has(key)) {
        throw new NpValidationError("Invalid query parameters", [
          { field: key, message: "Unsupported query parameter" },
        ]);
      }
      if (searchParams.getAll(key).length > 1) {
        throw new NpValidationError("Invalid query parameters", [
          { field: key, message: "Query parameter must not be repeated" },
        ]);
      }
    }
    const sort = searchParams.get("sort");
    const search = searchParams.get("search");
    const locale = searchParams.get("locale");
    return {
      page: parsePositiveInt(searchParams.get("page"), "page"),
      limit: parsePositiveInt(searchParams.get("limit"), "limit", 100),
      sort: sort && sort.length > 0 ? sort : undefined,
      search: search && search.length > 0 ? search : undefined,
      where: parseWhere(searchParams.get("where")),
      locale: locale && locale.length > 0 ? locale : undefined,
    };
  };

  const findCollectionDocuments = async (
    slug: string,
    opts: NpFindOptions,
    user: NpAuthUser | null,
  ): Promise<NpCollectionApiFindResult> => {
    await ready();
    const config = getCollectionConfig(slug);
    let validated: NpFindOptions;
    try {
      validated = npRequireCollectionFindOptions(opts, config, {
        maximumLimit: 100,
        allowSystemWildcards: false,
      });
    } catch (error) {
      if (error instanceof NpCollectionContractError) {
        throw new NpValidationError(
          "Invalid query parameters",
          error.issues.map((entry) => ({ field: entry.path, message: entry.message })),
        );
      }
      throw error;
    }
    const result = await coreFindDocuments(slug, validated, user ?? undefined);
    return {
      ...result,
      docs: result.docs.map((document) =>
        npSerializeCollectionDocumentWithDiagnostics<Record<string, unknown>>(document, config),
      ),
    };
  };

  const getCollectionDocument = async (
    slug: string,
    id: string,
    user: NpAuthUser | null,
  ): Promise<NpCollectionApiDocument | null> => {
    await ready();
    const document = await coreGetDocumentById<Record<string, unknown>>(
      slug,
      id,
      user ?? undefined,
    );
    return document
      ? npSerializeCollectionDocumentWithDiagnostics<Record<string, unknown>>(
          document,
          getCollectionConfig(slug),
        )
      : null;
  };

  const saveCollectionDocument = async (
    slug: string,
    id: string | null,
    data: Record<string, unknown>,
    user: NpAuthUser,
    options?: NpSaveOptions,
  ): Promise<NpCollectionApiSaveResult> => {
    await ready();
    await helperOptions.validateSave?.(slug, data);
    const result = await coreSaveDocument(slug, id, data, user, options);
    return {
      ...result,
      doc: npSerializeCollectionDocumentWithDiagnostics<Record<string, unknown>>(
        result.doc,
        getCollectionConfig(slug),
      ),
    };
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
