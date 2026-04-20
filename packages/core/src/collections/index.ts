export { buildSearchVector } from "./search.js";
export {
  registerCollection,
  getCollectionConfig,
  getCollectionTable,
  getCollectionRegistration,
  getAllCollectionSlugs,
} from "./registry.js";
export {
  setDb,
  saveDocument,
  deleteDocument,
  findDocuments,
  getDocumentById,
} from "./pipeline.js";
export { buildZodSchema, getCollectionZodSchema } from "./validation.js";
