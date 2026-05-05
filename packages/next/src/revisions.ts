import {
  NpValidationError,
  type NpAuthUser,
  type NpRevision,
  type NpRevisionListOptions,
  type NpRevisionListResult,
  type NpSaveResult,
  listRevisions as coreListRevisions,
  getRevision as coreGetRevision,
  restoreRevision as coreRestoreRevision,
} from "@nexpress/core";

export interface RevisionHelpersOptions {
  /** Called before every revisions operation — wire DB/plugins here. */
  ensureReady(): void | Promise<void>;
}

export type RevisionHelpers = {
  readonly parseRevisionListOptions: (
    this: void,
    searchParams: URLSearchParams,
  ) => NpRevisionListOptions;
  readonly listDocumentRevisions: (
    this: void,
    collection: string,
    documentId: string,
    options: NpRevisionListOptions,
    user: NpAuthUser | null,
  ) => Promise<NpRevisionListResult>;
  readonly getDocumentRevision: (
    this: void,
    collection: string,
    documentId: string,
    revisionId: string,
    user: NpAuthUser | null,
  ) => Promise<NpRevision>;
  readonly restoreDocumentRevision: (
    this: void,
    collection: string,
    documentId: string,
    revisionId: string,
    user: NpAuthUser,
  ) => Promise<NpSaveResult>;
};

function parsePositiveInt(
  value: string | null,
  field: string,
  max?: number,
): number | undefined {
  if (value === null) return undefined;

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0 || (max !== undefined && parsed > max)) {
    throw new NpValidationError("Invalid query parameters", [
      {
        field,
        message:
          max === undefined
            ? "Must be a non-negative integer"
            : `Must be a non-negative integer no greater than ${max}`,
      },
    ]);
  }

  return parsed;
}

export function createRevisionHelpers(options: RevisionHelpersOptions): RevisionHelpers {
  async function ready(): Promise<void> {
    await options.ensureReady();
  }

  const parseRevisionListOptions = (searchParams: URLSearchParams): NpRevisionListOptions => {
    return {
      limit: parsePositiveInt(searchParams.get("limit"), "limit", 100),
      offset: parsePositiveInt(searchParams.get("offset"), "offset"),
    };
  };

  const listDocumentRevisions = async (
    collection: string,
    documentId: string,
    opts: NpRevisionListOptions,
    user: NpAuthUser | null,
  ): Promise<NpRevisionListResult> => {
    await ready();
    return coreListRevisions(collection, documentId, opts, user);
  };

  const getDocumentRevision = async (
    collection: string,
    documentId: string,
    revisionId: string,
    user: NpAuthUser | null,
  ): Promise<NpRevision> => {
    await ready();
    return coreGetRevision(collection, documentId, revisionId, user);
  };

  const restoreDocumentRevision = async (
    collection: string,
    documentId: string,
    revisionId: string,
    user: NpAuthUser,
  ): Promise<NpSaveResult> => {
    await ready();
    return coreRestoreRevision(collection, documentId, revisionId, user);
  };

  return {
    parseRevisionListOptions,
    listDocumentRevisions,
    getDocumentRevision,
    restoreDocumentRevision,
  };
}
