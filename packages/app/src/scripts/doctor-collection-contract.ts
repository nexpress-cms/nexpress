export function npIsCollectionMainTableName(tableName: string): boolean {
  return tableName.startsWith("np_c_") && !tableName.includes("__");
}

export function npIsCanonicalCollectionMainTableName(tableName: string): boolean {
  return /^np_c_[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u.test(tableName);
}
