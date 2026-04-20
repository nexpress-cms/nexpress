declare module "@nexpress/core" {
  export type NxUserRole = "admin" | "editor" | "author" | "viewer";

  export interface NxAuthUser {
    id: string;
    email: string;
    name: string;
    role: NxUserRole;
    tokenVersion: number;
  }

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

  export class NxError extends Error {
    readonly code: string;
    readonly statusCode: number;
    constructor(message: string, code: string, statusCode?: number);
  }

  export class NxForbiddenError extends NxError {
    constructor(collection: string, operation: string);
  }

  export class NxNotFoundError extends NxError {
    constructor(collection: string, id: string);
  }

  export class NxValidationError extends NxError {
    readonly errors: Array<{ field: string; message: string }>;
    constructor(message: string, errors: Array<{ field: string; message: string }>);
  }

  export class NxAuthError extends NxError {
    constructor(message?: string);
  }

  export interface NxDbConnection {
    query: {
      nxUsers: {
        findFirst(args: {
          columns: Record<string, boolean>;
          where: unknown;
        }): Promise<Record<string, unknown> | undefined>;
      };
    };
    $client: {
      query<Row extends Record<string, unknown> = Record<string, unknown>>(
        text: string,
        values?: ReadonlyArray<unknown>,
      ): Promise<{ rows: Row[] }>;
    };
  }

  export function createDbConnection(config: { connectionString: string }): NxDbConnection;

  export function signToken(
    user: { id: string; role: NxUserRole; tokenVersion: number },
    secret: string,
    expirationSeconds?: number,
  ): Promise<string>;

  export function verifyPassword(passwordHash: string, password: string): Promise<boolean>;
  export function hashPassword(password: string): Promise<string>;
  export function verifyCsrf(
    method: string,
    cookieToken: string | undefined,
    headerToken: string | undefined,
  ): boolean;
  export function verifyTokenFull(
    token: string,
    secret: string,
    db: NxDbConnection,
  ): Promise<NxAuthUser | null>;
  export function invalidateAllSessions(userId: string, db: NxDbConnection): Promise<void>;
  export function findDocuments(
    slug: string,
    options: NxFindOptions,
    user: NxAuthUser | null,
  ): Promise<NxFindResult>;
  export function getDocumentById(
    slug: string,
    id: string,
    user: NxAuthUser | null,
  ): Promise<Record<string, unknown> | null>;
  export function saveDocument(
    slug: string,
    id: string | null,
    data: Record<string, unknown>,
    user: NxAuthUser,
  ): Promise<NxSaveResult>;
  export function deleteDocument(slug: string, id: string, user: NxAuthUser): Promise<void>;
}
