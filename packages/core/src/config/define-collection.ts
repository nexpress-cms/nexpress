import { type NpCollectionConfig } from "./types.js";
import { npAssertCollectionDefinition } from "./collection-definition-contract.js";

export function defineCollection(config: NpCollectionConfig): NpCollectionConfig {
  npAssertCollectionDefinition(config);
  return config;
}
