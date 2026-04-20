import { randomUUID } from "node:crypto";

import { eq, sql, desc, asc, count } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { AnyPgColumn, PgTable } from "drizzle-orm/pg-core";

import {
  type NxCollectionConfig,
  type NxFindOptions,
  type NxFindResult,
  type NxSaveResult,
  type NxAuthUser,
  type NxCollectionHook,
  type NxFieldConfig,
} from "../config/types.js";
import { NxForbiddenError, NxNotFoundError } from "../errors.js";
import { getCollectionZodSchema } from "./validation.js";
import {
  getCollectionConfig,
  getCollectionTable,
  getCollectionRegistration,
} from "./registry.js";
import { buildSearchVector } from "./search.js";
import { enqueueJob } from "../jobs/queue.js";
import { nxRevisions } from "../db/schema/system.js";
import { nxMediaRefs } from "../db/schema/media.js";

let dbInstance: NodePgDatabase<Record<string, unknown>> | null = null;

interface PreparedDocumentData {
  mainData: Record<string, unknown>;
  childRows: Record<string, Record<string, unknown>[]>;
  joinRows: Record<string, string[]>;
}

type QueryCondition = ReturnType<typeof sql>;

interface SelectQuery extends Promise<unknown[]> {
  where(condition: QueryCondition): SelectQuery;
  orderBy(order: QueryCondition): SelectQuery;
  limit(limit: number): SelectQuery;
  offset(offset: number): SelectQuery;
}

interface InsertValuesQuery extends Promise<unknown> {
  returning(): Promise<unknown[]>;
}

interface DrizzleTransactionLike {
  insert(table: PgTable): {
    values(values: Record<string, unknown> | Record<string, unknown>[]): InsertValuesQuery;
  };
  update(table: PgTable): {
    set(values: Record<string, unknown>): {
      where(condition: QueryCondition): {
        returning(): Promise<unknown[]>;
      };
    };
  };
  delete(table: PgTable): {
    where(condition: QueryCondition): Promise<unknown>;
  };
  select(selection?: Record<string, unknown>): {
    from(table: PgTable): SelectQuery;
  };
}

interface DrizzleDatabaseLike extends DrizzleTransactionLike {
  transaction<T>(callback: (tx: DrizzleTransactionLike) => Promise<T>): Promise<T>;
}

export function setDb(db: NodePgDatabase<Record<string, unknown>>): void {
  dbInstance = db;
}

export function getDb(): NodePgDatabase<Record<string, unknown>> {
  if (!dbInstance) {
    throw new Error("Database not initialized. Call setDb() first.");
  }

  return dbInstance;
}

export async function saveDocument(
  collection: string,
  docId: string | null,
  data: Record<string, unknown>,
  user: NxAuthUser,
): Promise<NxSaveResult> {
  const config = getCollectionConfig(collection);
  const registration = getCollectionRegistration(collection);
  const table = getCollectionTable(collection) as PgTable;
  const db = getDb() as unknown as DrizzleDatabaseLike;
  const validatedData = toRecord(getCollectionZodSchema(config).parse(data));
  const operation = docId ? "update" : "create";
  const originalDoc = docId ? await getDocumentByIdInternal(db, table, collection, docId) : null;

  await assertWriteAccess(config, collection, operation, user, validatedData, originalDoc);

  const hookData = await runHooks(
    operation === "create" ? config.hooks?.beforeCreate : config.hooks?.beforeUpdate,
    {
      data: validatedData,
      user,
      collection,
      originalDoc,
    },
  );

  const prepared = prepareDocumentData(config.fields, hookData);
  const now = new Date();
  const searchVector = buildSearchVector(config, hookData);

  const savedDoc = (await db.transaction(async (tx) => {
    const persistedDoc: Record<string, unknown> = operation === "update"
      ? await updateMainDocument(tx, table, collection, docId, prepared.mainData, searchVector, config, user, now)
      : await createMainDocument(tx, table, prepared.mainData, searchVector, config, user, now);
    const persistedDocId = getRecordId(persistedDoc);

    await syncChildTables(tx, registration.childTables, prepared.childRows, persistedDocId);
    await syncJoinTables(tx, registration.joinTables, prepared.joinRows, persistedDocId);
    await syncMediaRefsForDocument(tx, collection, persistedDocId, config.fields, hookData);

    if (config.versions) {
      await insertRevision(tx, collection, persistedDocId, operation, hookData, originalDoc, user);
    }

    return persistedDoc;
  })) as Record<string, unknown>;
  const savedDocId = getRecordId(savedDoc);

  await enqueueJob("content:afterSave", {
    collection,
    documentId: savedDocId,
    operation,
    userId: user.id,
  });

  return {
    doc: savedDoc,
    operation,
  };
}

export async function deleteDocument(
  collection: string,
  docId: string,
  user: NxAuthUser,
): Promise<void> {
  const config = getCollectionConfig(collection);
  const registration = getCollectionRegistration(collection);
  const table = getCollectionTable(collection) as PgTable;
  const db = getDb() as unknown as DrizzleDatabaseLike;
  const originalDoc = await getDocumentByIdInternal(db, table, collection, docId);

  if (config.access?.delete) {
    const allowed = await config.access.delete({ user, doc: originalDoc });
    if (!allowed) {
      throw new NxForbiddenError(collection, "delete");
    }
  }

  await runHooks(config.hooks?.beforeDelete, {
    data: originalDoc,
    user,
    collection,
    originalDoc,
  });

  await db.transaction(async (tx) => {
    await deleteChildTables(tx, registration.childTables, docId);
    await deleteJoinTables(tx, registration.joinTables, docId);
    await tx.delete(nxMediaRefs as unknown as PgTable).where(
      sql`${eq(getTableColumn(nxMediaRefs as unknown as PgTable, "collection"), collection)} and ${eq(getTableColumn(nxMediaRefs as unknown as PgTable, "documentId"), docId)}`,
    );
    await tx.delete(table).where(eq(getTableColumn(table, "id"), docId));
  });

  await enqueueJob("content:afterDelete", {
    collection,
    documentId: docId,
    userId: user.id,
  });
}

export async function findDocuments(
  collection: string,
  options: NxFindOptions,
  user?: NxAuthUser,
): Promise<NxFindResult> {
  const config = getCollectionConfig(collection);
  const table = getCollectionTable(collection) as PgTable;
  const db = getDb() as unknown as DrizzleDatabaseLike;
  const page = normalizePage(options.page);
  const limit = normalizeLimit(options.limit);
  const offset = (page - 1) * limit;

  await assertReadAccess(config, collection, user ?? null);

  const conditions = buildQueryConditions(table, options);
  const whereClause = combineConditions(conditions);

  const docs = await executeFindQuery(db, table, options, whereClause, limit, offset);
  const totalResult = (await (whereClause
    ? db.select({ total: count() }).from(table).where(whereClause)
    : db.select({ total: count() }).from(table).limit(1))) as Array<{ total: number | string }>;
  const totalDocs = Number(totalResult[0]?.total ?? 0);
  const totalPages = totalDocs === 0 ? 0 : Math.ceil(totalDocs / limit);

  return {
    docs: docs as Record<string, unknown>[],
    totalDocs,
    totalPages,
    page,
    limit,
    hasNextPage: page < totalPages,
    hasPrevPage: page > 1 && totalDocs > 0,
  };
}

export async function getDocumentById(
  collection: string,
  id: string,
  user?: NxAuthUser,
): Promise<Record<string, unknown> | null> {
  const config = getCollectionConfig(collection);
  const table = getCollectionTable(collection) as PgTable;
  const db = getDb() as unknown as DrizzleDatabaseLike;
  const doc = await getDocumentByIdOptional(db, table, id);

  if (!doc) {
    return null;
  }

  if (config.access?.read) {
    const allowed = await config.access.read({ user: user ?? null, doc });
    if (!allowed) {
      throw new NxForbiddenError(collection, "read");
    }
  }

  return doc;
}

async function assertWriteAccess(
  config: NxCollectionConfig,
  collection: string,
  operation: NxSaveResult["operation"],
  user: NxAuthUser,
  data: Record<string, unknown>,
  originalDoc: Record<string, unknown> | null,
): Promise<void> {
  const access = operation === "create" ? config.access?.create : config.access?.update;

  if (!access) {
    return;
  }

  const allowed = await access({ user, doc: originalDoc ?? undefined, data });

  if (!allowed) {
    throw new NxForbiddenError(collection, operation);
  }
}

async function assertReadAccess(
  config: NxCollectionConfig,
  collection: string,
  user: NxAuthUser | null,
): Promise<void> {
  if (!config.access?.read) {
    return;
  }

  const allowed = await config.access.read({ user });

  if (!allowed) {
    throw new NxForbiddenError(collection, "read");
  }
}

async function runHooks(
  hooks: NxCollectionHook[] | undefined,
  args: {
    data: Record<string, unknown>;
    user: NxAuthUser;
    collection: string;
    originalDoc?: Record<string, unknown> | null;
  },
): Promise<Record<string, unknown>> {
  let nextData = args.data;

  for (const hook of hooks ?? []) {
    nextData = await hook({
      ...args,
      data: nextData,
    });
  }

  return nextData;
}

async function createMainDocument(
  tx: DrizzleTransactionLike,
  table: PgTable,
  mainData: Record<string, unknown>,
  searchVector: string,
  config: NxCollectionConfig,
  user: NxAuthUser,
  now: Date,
): Promise<Record<string, unknown>> {
  const values: Record<string, unknown> = {
    id: randomUUID(),
    ...mainData,
    status: "published",
    createdBy: user.id,
    updatedBy: user.id,
    searchVector,
  };

  if (config.timestamps !== false) {
    values.createdAt = now;
    values.updatedAt = now;
  }

  const [created] = await tx.insert(table).values(values).returning();

  return toRecord(created);
}

async function updateMainDocument(
  tx: DrizzleTransactionLike,
  table: PgTable,
  collection: string,
  docId: string | null,
  mainData: Record<string, unknown>,
  searchVector: string,
  config: NxCollectionConfig,
  user: NxAuthUser,
  now: Date,
): Promise<Record<string, unknown>> {
  if (!docId) {
    throw new NxNotFoundError(collection, "unknown");
  }

  const values: Record<string, unknown> = {
    ...mainData,
    updatedBy: user.id,
    searchVector,
  };

  if (config.timestamps !== false) {
    values.updatedAt = now;
  }

  const [updated] = await tx
    .update(table)
    .set(values)
    .where(eq(getTableColumn(table, "id"), docId))
    .returning();

  if (!updated) {
    throw new NxNotFoundError(collection, docId);
  }

  return toRecord(updated);
}

async function syncChildTables(
  tx: DrizzleTransactionLike,
  childTables: Record<string, unknown> | undefined,
  childRows: Record<string, Record<string, unknown>[]>,
  documentId: string,
): Promise<void> {
  for (const [fieldPath, rows] of Object.entries(childRows)) {
    const table = resolveRelatedTable(childTables, fieldPath);

    if (!table) {
      continue;
    }

    const pgTable = table as PgTable;
    const parentColumnName = findParentColumnName(pgTable, ["parentId"]);
    await tx.delete(pgTable).where(eq(getTableColumn(pgTable, parentColumnName), documentId));

    if (rows.length === 0) {
      continue;
    }

    const values = rows.map((row, index) => ({
      id: randomUUID(),
      ...row,
      [parentColumnName]: documentId,
      order: index,
    }));

    await tx.insert(pgTable).values(values);
  }
}

async function syncJoinTables(
  tx: DrizzleTransactionLike,
  joinTables: Record<string, unknown> | undefined,
  joinRows: Record<string, string[]>,
  documentId: string,
): Promise<void> {
  for (const [fieldPath, ids] of Object.entries(joinRows)) {
    const table = resolveRelatedTable(joinTables, fieldPath);

    if (!table) {
      continue;
    }

    const pgTable = table as PgTable;
    const parentColumnName = findParentColumnName(pgTable, ["parentId"]);
    await tx.delete(pgTable).where(eq(getTableColumn(pgTable, parentColumnName), documentId));

    if (ids.length === 0) {
      continue;
    }

    const values = ids.map((targetId, index) => ({
      id: randomUUID(),
      [parentColumnName]: documentId,
      targetId,
      order: index,
    }));

    await tx.insert(pgTable).values(values);
  }
}

async function deleteChildTables(
  tx: DrizzleTransactionLike,
  childTables: Record<string, unknown> | undefined,
  documentId: string,
): Promise<void> {
  for (const table of Object.values(childTables ?? {})) {
    const pgTable = table as PgTable;
    const parentColumnName = findParentColumnName(pgTable, ["parentId"]);
    await tx.delete(pgTable).where(eq(getTableColumn(pgTable, parentColumnName), documentId));
  }
}

async function deleteJoinTables(
  tx: DrizzleTransactionLike,
  joinTables: Record<string, unknown> | undefined,
  documentId: string,
): Promise<void> {
  for (const table of Object.values(joinTables ?? {})) {
    const pgTable = table as PgTable;
    const parentColumnName = findParentColumnName(pgTable, ["parentId"]);
    await tx.delete(pgTable).where(eq(getTableColumn(pgTable, parentColumnName), documentId));
  }
}

async function insertRevision(
  tx: DrizzleTransactionLike,
  collection: string,
  documentId: string,
  operation: NxSaveResult["operation"],
  data: Record<string, unknown>,
  originalDoc: Record<string, unknown> | null,
  user: NxAuthUser,
): Promise<void> {
  const revisionConditions = sql`${eq(nxRevisions.collection, collection)} and ${eq(nxRevisions.documentId, documentId)}`;
  const [revisionCount] = ((await tx
    .select({ total: count() })
    .from(nxRevisions)
    .where(revisionConditions)) as Array<{ total: number | string }>);

  await tx.insert(nxRevisions).values({
    collection,
    documentId,
    version: Number(revisionCount?.total ?? 0) + 1,
    status: "published",
    snapshot: data,
    changedFields: getChangedFields(data, originalDoc, operation),
    authorId: user.id,
    createdAt: new Date(),
  });
}

function buildQueryConditions(table: PgTable, options: NxFindOptions): QueryCondition[] {
  const conditions: QueryCondition[] = [];

  if (options.where) {
    for (const [field, value] of Object.entries(options.where)) {
      if (value === undefined) {
        continue;
      }

      conditions.push(eq(getTableColumn(table, field), value));
    }
  }

  if (options.search) {
    conditions.push(
      sql`${getTableColumn(table, "searchVector")} @@ plainto_tsquery('english', ${options.search})`,
    );
  }

  return conditions;
}

async function executeFindQuery(
  db: DrizzleDatabaseLike,
  table: PgTable,
  options: NxFindOptions,
  whereClause: ReturnType<typeof sql> | undefined,
  limit: number,
  offset: number,
): Promise<Record<string, unknown>[]> {
  if (options.search) {
    const query = whereClause
      ? db
          .select()
          .from(table)
          .where(whereClause)
          .orderBy(
            sql`ts_rank(${getTableColumn(table, "searchVector")}, plainto_tsquery('english', ${options.search})) DESC`,
          )
          .limit(limit)
          .offset(offset)
      : db
          .select()
          .from(table)
          .orderBy(
            sql`ts_rank(${getTableColumn(table, "searchVector")}, plainto_tsquery('english', ${options.search})) DESC`,
          )
          .limit(limit)
          .offset(offset);

    return (await query) as Record<string, unknown>[];
  }

  const orderClause = getSortOrderClause(table, options.sort);

  if (whereClause && orderClause) {
    return await (db
      .select()
      .from(table)
      .where(whereClause)
      .orderBy(orderClause)
      .limit(limit)
      .offset(offset)) as Record<string, unknown>[];
  }

  if (whereClause) {
    return await (db
      .select()
      .from(table)
      .where(whereClause)
      .limit(limit)
      .offset(offset)) as Record<string, unknown>[];
  }

  if (orderClause) {
    return await (db
      .select()
      .from(table)
      .orderBy(orderClause)
      .limit(limit)
      .offset(offset)) as Record<string, unknown>[];
  }

  return (await db.select().from(table).limit(limit).offset(offset)) as Record<string, unknown>[];
}

function getSortOrderClause(
  table: PgTable,
  sortValue: string | undefined,
): ReturnType<typeof sql> | undefined {
  const sort = sortValue?.trim();

  if (!sort) {
    return undefined;
  }

  const isDescending = sort.startsWith("-");
  const field = isDescending ? sort.slice(1) : sort;
  const column = getTableColumn(table, field);

  return isDescending ? desc(column) : asc(column);
}

async function getDocumentByIdInternal(
  db: DrizzleDatabaseLike,
  table: PgTable,
  collection: string,
  id: string,
): Promise<Record<string, unknown>> {
  const doc = await getDocumentByIdOptional(db, table, id);

  if (!doc) {
    throw new NxNotFoundError(collection, id);
  }

  return doc;
}

async function getDocumentByIdOptional(
  db: DrizzleDatabaseLike,
  table: PgTable,
  id: string,
): Promise<Record<string, unknown> | null> {
  const [doc] = await db.select().from(table).where(eq(getTableColumn(table, "id"), id)).limit(1);
  return doc ? toRecord(doc) : null;
}

function prepareDocumentData(
  fields: NxFieldConfig[],
  data: Record<string, unknown>,
): PreparedDocumentData {
  const prepared: PreparedDocumentData = {
    mainData: {},
    childRows: {},
    joinRows: {},
  };

  collectPreparedDocumentData(fields, data, prepared, []);

  return prepared;
}

function collectPreparedDocumentData(
  fields: NxFieldConfig[],
  data: Record<string, unknown>,
  prepared: PreparedDocumentData,
  prefix: string[],
): void {
  for (const field of fields) {
    if (field.type === "row" || field.type === "collapsible") {
      collectPreparedDocumentData(field.fields, data, prepared, prefix);
      continue;
    }

    if (field.type === "group") {
      const groupValue = toOptionalRecord(data[field.name]);
      if (groupValue) {
        collectPreparedDocumentData(field.fields, groupValue, prepared, [...prefix, field.name]);
      }
      continue;
    }

    const fieldPath = [...prefix, field.name];
    const fieldKey = fieldPath.join(".");
    const value = data[field.name];

    if (field.type === "array") {
      prepared.childRows[fieldKey] = normalizeChildRows(field.fields, value);
      continue;
    }

    if (field.type === "relationship" && field.hasMany) {
      prepared.joinRows[fieldKey] = normalizeJoinIds(value);
      continue;
    }

    prepared.mainData[getFlattenedFieldName(prefix, field.name)] = value ?? null;
  }
}

function normalizeChildRows(
  fields: NxFieldConfig[],
  value: unknown,
): Record<string, unknown>[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map((item) => {
    const row = toOptionalRecord(item) ?? {};
    const prepared: PreparedDocumentData = {
      mainData: {},
      childRows: {},
      joinRows: {},
    };

    collectPreparedDocumentData(fields, row, prepared, []);
    return prepared.mainData;
  });
}

function normalizeJoinIds(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((item): item is string => typeof item === "string");
}

async function syncMediaRefsForDocument(
  tx: DrizzleTransactionLike,
  collection: string,
  documentId: string,
  fields: NxFieldConfig[],
  data: Record<string, unknown>,
): Promise<void> {
  const refs = extractMediaIdsFromFields(fields, data, []);

  if (refs.length === 0) {
    await tx.delete(nxMediaRefs as unknown as PgTable).where(
      sql`${eq(getTableColumn(nxMediaRefs as unknown as PgTable, "collection"), collection)} and ${eq(getTableColumn(nxMediaRefs as unknown as PgTable, "documentId"), documentId)}`,
    );
    return;
  }

  await tx.delete(nxMediaRefs as unknown as PgTable).where(
    sql`${eq(getTableColumn(nxMediaRefs as unknown as PgTable, "collection"), collection)} and ${eq(getTableColumn(nxMediaRefs as unknown as PgTable, "documentId"), documentId)}`,
  );

  const values = refs.map((ref) => ({
    id: randomUUID(),
    mediaId: ref.mediaId,
    collection,
    documentId,
    field: ref.field,
  }));

  await tx.insert(nxMediaRefs as unknown as PgTable).values(values);
}

function extractMediaIdsFromFields(
  fields: NxFieldConfig[],
  data: Record<string, unknown>,
  prefix: string[],
): Array<{ mediaId: string; field: string }> {
  const refs: Array<{ mediaId: string; field: string }> = [];

  for (const field of fields) {
    if (field.type === "row" || field.type === "collapsible") {
      refs.push(...extractMediaIdsFromFields(field.fields, data, prefix));
      continue;
    }

    if (field.type === "group") {
      const groupData = toOptionalRecord(data[field.name]);
      if (groupData) {
        refs.push(...extractMediaIdsFromFields(field.fields, groupData, [...prefix, field.name]));
      }
      continue;
    }

    const fieldPath = [...prefix, field.name].join(".");

    if (field.type === "upload") {
      const mediaId = data[field.name];
      if (typeof mediaId === "string" && mediaId.length > 0) {
        refs.push({ mediaId, field: fieldPath });
      }
      continue;
    }

    if (field.type === "richText") {
      const richTextValue = data[field.name];
      if (richTextValue && typeof richTextValue === "object") {
        refs.push(...extractMediaIdsFromLexicalJson(richTextValue, fieldPath));
      }
      continue;
    }

    if (field.type === "array") {
      const arrayValue = data[field.name];
      if (Array.isArray(arrayValue)) {
        for (const item of arrayValue) {
          const itemRecord = toOptionalRecord(item);
          if (itemRecord) {
            refs.push(...extractMediaIdsFromFields(field.fields, itemRecord, [...prefix, field.name]));
          }
        }
      }
      continue;
    }

    if (field.type === "blocks") {
      const blocksValue = data[field.name];
      if (Array.isArray(blocksValue)) {
        for (const block of blocksValue) {
          const blockRecord = toOptionalRecord(block);
          if (blockRecord) {
            extractBlockMediaIds(blockRecord, fieldPath, refs);
          }
        }
      }
      continue;
    }
  }

  return refs;
}

function extractMediaIdsFromLexicalJson(
  node: unknown,
  fieldPath: string,
): Array<{ mediaId: string; field: string }> {
  const refs: Array<{ mediaId: string; field: string }> = [];

  if (!node || typeof node !== "object") {
    return refs;
  }

  const record = node as Record<string, unknown>;

  if (record.type === "image" || record.type === "upload") {
    const mediaId = record.mediaId ?? record.value;
    if (typeof mediaId === "string" && mediaId.length > 0) {
      refs.push({ mediaId, field: fieldPath });
    }
  }

  const children = record.children ?? (toOptionalRecord(record.root) as Record<string, unknown> | null)?.children;
  if (Array.isArray(children)) {
    for (const child of children) {
      refs.push(...extractMediaIdsFromLexicalJson(child, fieldPath));
    }
  }

  return refs;
}

function extractBlockMediaIds(
  block: Record<string, unknown>,
  fieldPath: string,
  refs: Array<{ mediaId: string; field: string }>,
): void {
  for (const [key, value] of Object.entries(block)) {
    if (key === "blockType" || key === "id") {
      continue;
    }

    if (typeof value === "string" && isUuid(value)) {
      refs.push({ mediaId: value, field: `${fieldPath}.${key}` });
    }
  }
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

function getChangedFields(
  data: Record<string, unknown>,
  originalDoc: Record<string, unknown> | null,
  operation: NxSaveResult["operation"],
): string[] {
  if (operation === "create" || !originalDoc) {
    return Object.keys(data);
  }

  return Object.keys(data).filter((field) => !Object.is(data[field], originalDoc[field]));
}

function combineConditions(
  conditions: QueryCondition[],
): ReturnType<typeof sql> | undefined {
  if (conditions.length === 0) {
    return undefined;
  }

  return sql`${sql.join(conditions, sql` and `)}`;
}

function resolveRelatedTable(
  tables: Record<string, unknown> | undefined,
  fieldPath: string,
): unknown {
  return tables?.[fieldPath] ?? tables?.[fieldPath.split(".").at(-1) ?? fieldPath];
}

function findParentColumnName(table: PgTable, preferred: string[]): string {
  const keys = Object.keys(table as unknown as Record<string, unknown>);

  for (const key of preferred) {
    if (keys.includes(key)) {
      return key;
    }
  }

  const derived = keys.find(
    (key) => key !== "id" && key !== "targetId" && key !== "order" && key.endsWith("Id"),
    );

  if (!derived) {
    throw new Error("Unable to resolve parent column for related table.");
  }

  return derived;
}

function getTableColumn(table: PgTable, key: string): AnyPgColumn {
  const column = (table as unknown as Record<string, unknown>)[key];

  if (!column) {
    throw new Error(`Column '${key}' not found on table.`);
  }

  return column as AnyPgColumn;
}

function getRecordId(record: Record<string, unknown>): string {
  const id = record.id;

  if (typeof id !== "string") {
    throw new Error("Expected saved document to include a string id.");
  }

  return id;
}

function toRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Expected object record.");
  }

  return value as Record<string, unknown>;
}

function toOptionalRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  return value as Record<string, unknown>;
}

function normalizePage(page?: number): number {
  if (!page || page < 1) {
    return 1;
  }

  return Math.floor(page);
}

function normalizeLimit(limit?: number): number {
  if (!limit || limit < 1) {
    return 10;
  }

  return Math.floor(limit);
}

function getFlattenedFieldName(prefix: string[], name: string): string {
  if (prefix.length === 0) {
    return toCamelCase(name);
  }

  return `${prefix.map(toPascalCase).join("")}${toPascalCase(name)}`.replace(
    /^./u,
    (char) => char.toLowerCase(),
  );
}

function toCamelCase(value: string): string {
  const parts = splitName(value);
  const [first = "", ...rest] = parts;
  return `${first}${rest.map(toPascalCase).join("")}`;
}

function toPascalCase(value: string): string {
  return splitName(value).map(capitalize).join("");
}

function splitName(value: string): string[] {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[^a-zA-Z0-9]+/)
    .map((part) => part.toLowerCase())
    .filter(Boolean);
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
