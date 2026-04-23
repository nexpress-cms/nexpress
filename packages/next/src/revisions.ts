import {
  NxValidationError,
  type NxAuthUser,
  type NxRevision,
  type NxRevisionListOptions,
  type NxRevisionListResult,
  type NxSaveResult,
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
  ) => NxRevisionListOptions;
  readonly listDocumentRevisions: (
    this: void,
    collection: string,
    documentId: string,
    options: NxRevisionListOptions,
    user: NxAuthUser | null,
  ) => Promise<NxRevisionListResult>;
  readonly getDocumentRevision: (
    this: void,
    collection: string,
    documentId: string,
    revisionId: string,
    user: NxAuthUser | null,
  ) => Promise<NxRevision>;
  readonly restoreDocumentRevision: (
    this: void,
    collection: string,
    documentId: string,
    revisionId: string,
    user: NxAuthUser,
  ) => Promise<NxSaveResult>;
};

function parsePositiveInt(
  value: string | null,
  field: string,
  max?: number,
): number | undefined {
  if (value === null) return undefined;

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0 || (max !== undefined && parsed > max)) {
    throw new NxValidationError("Invalid query parameters", [
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

  const parseRevisionListOptions = (searchParams: URLSearchParams): NxRevisionListOptions => {
    return {
      limit: parsePositiveInt(searchParams.get("limit"), "limit", 100),
      offset: parsePositiveInt(searchParams.get("offset"), "offset"),
    };
  };

  const listDocumentRevisions = async (
    collection: string,
    documentId: string,
    opts: NxRevisionListOptions,
    user: NxAuthUser | null,
  ): Promise<NxRevisionListResult> => {
    await ready();
    return coreListRevisions(collection, documentId, opts, user);
  };

  const getDocumentRevision = async (
    collection: string,
    documentId: string,
    revisionId: string,
    user: NxAuthUser | null,
  ): Promise<NxRevision> => {
    await ready();
    return coreGetRevision(collection, documentId, revisionId, user);
  };

  const restoreDocumentRevision = async (
    collection: string,
    documentId: string,
    revisionId: string,
    user: NxAuthUser,
  ): Promise<NxSaveResult> => {
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
