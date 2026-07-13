import {
  NpValidationError,
  type NpAuthUser,
  type NpRevisionListOptions,
  type NpSaveResult,
  listRevisions as coreListRevisions,
  getRevision as coreGetRevision,
  restoreRevision as coreRestoreRevision,
} from "@nexpress/core";
import {
  npSerializeRevision,
  npSerializeRevisionSummary,
  type NpRevisionSnapshot,
  type NpRevisionWire,
  type NpRevisionWireList,
} from "@nexpress/core/revisions";

export interface RevisionHelpersOptions {
  /** Called before every revisions operation — wire DB/plugins here. */
  ensureReady(): void | Promise<void>;
  /** App-owned validation for definition-aware block content. */
  validateSnapshot?(
    this: void,
    collection: string,
    snapshot: NpRevisionSnapshot,
  ): void | Promise<void>;
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
  ) => Promise<NpRevisionWireList>;
  readonly getDocumentRevision: (
    this: void,
    collection: string,
    documentId: string,
    revisionId: string,
    user: NpAuthUser | null,
  ) => Promise<NpRevisionWire>;
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
  min = 0,
): number | undefined {
  if (value === null) return undefined;

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || (max !== undefined && parsed > max)) {
    throw new NpValidationError("Invalid query parameters", [
      {
        field,
        message:
          max === undefined
            ? `Must be an integer no smaller than ${min}`
            : `Must be an integer between ${min} and ${max}`,
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
      limit: parsePositiveInt(searchParams.get("limit"), "limit", 100, 1),
      offset: parsePositiveInt(searchParams.get("offset"), "offset"),
    };
  };

  const listDocumentRevisions = async (
    collection: string,
    documentId: string,
    opts: NpRevisionListOptions,
    user: NpAuthUser | null,
  ): Promise<NpRevisionWireList> => {
    await ready();
    const result = await coreListRevisions(collection, documentId, opts, user);
    return {
      revisions: result.revisions.map(npSerializeRevisionSummary),
      total: result.total,
    };
  };

  const getDocumentRevision = async (
    collection: string,
    documentId: string,
    revisionId: string,
    user: NpAuthUser | null,
  ): Promise<NpRevisionWire> => {
    await ready();
    const revision = await coreGetRevision(collection, documentId, revisionId, user);
    await options.validateSnapshot?.(collection, revision.snapshot);
    return npSerializeRevision(revision);
  };

  const restoreDocumentRevision = async (
    collection: string,
    documentId: string,
    revisionId: string,
    user: NpAuthUser,
  ): Promise<NpSaveResult> => {
    await ready();
    return coreRestoreRevision(collection, documentId, revisionId, user, options.validateSnapshot);
  };

  return {
    parseRevisionListOptions,
    listDocumentRevisions,
    getDocumentRevision,
    restoreDocumentRevision,
  };
}
