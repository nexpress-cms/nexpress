import { getLogger } from "../observability/logger.js";
import {
  npAnalyzePageTemplateRegistry,
  type NpPluginTemplateRegistration,
} from "./template-contract.js";

export interface NpRegisteredPluginTemplate {
  pluginId: string;
  collection: string;
  id: string;
  definition: NpPluginTemplateRegistration;
}

const registry = new Map<string, Map<string, NpRegisteredPluginTemplate>>();
const pluginRegistries = new Map<
  string,
  Record<string, Record<string, NpPluginTemplateRegistration>>
>();

function rebuildRegistry(): void {
  registry.clear();
  for (const [pluginId, templates] of pluginRegistries) {
    for (const [collection, definitions] of Object.entries(templates)) {
      const perCollection = registry.get(collection) ?? new Map();
      registry.set(collection, perCollection);
      for (const [id, definition] of Object.entries(definitions)) {
        perCollection.set(id, { pluginId, collection, id, definition });
      }
    }
  }
}

export function unregisterPluginTemplates(pluginId: string): void {
  pluginRegistries.delete(pluginId);
  rebuildRegistry();
}

export function registerPluginTemplates(
  pluginId: string,
  templates: Record<string, Record<string, NpPluginTemplateRegistration>>,
): void {
  const issue = npAnalyzePageTemplateRegistry(templates)[0];
  if (issue) throw new Error(`[plugin:${pluginId}] ${issue.message}`);

  const previousOwners = new Map(
    [...registry.entries()].flatMap(([collection, definitions]) =>
      [...definitions.entries()].map(([id, entry]) => [`${collection}:${id}`, entry.pluginId]),
    ),
  );
  pluginRegistries.delete(pluginId);
  pluginRegistries.set(
    pluginId,
    Object.fromEntries(
      Object.entries(templates).map(([collection, definitions]) => [
        collection,
        Object.fromEntries(
          Object.entries(definitions).map(([id, definition]) => [id, { ...definition }]),
        ),
      ]),
    ),
  );
  for (const [collection, definitions] of Object.entries(templates)) {
    for (const id of Object.keys(definitions)) {
      const previousPluginId = previousOwners.get(`${collection}:${id}`);
      if (previousPluginId && previousPluginId !== pluginId) {
        getLogger().warn("Plugin page template ownership changed", {
          collection,
          templateId: id,
          previousPluginId,
          pluginId,
          note: "Plugin template collisions use last-loaded-wins; namespace the template id to avoid load-order dependence.",
        });
      }
    }
  }
  rebuildRegistry();
}

export function resetPluginTemplates(): void {
  pluginRegistries.clear();
  registry.clear();
}

export function getPluginTemplatesForCollection(
  collection: string,
): Map<string, NpPluginTemplateRegistration> {
  return new Map(
    [...(registry.get(collection)?.entries() ?? [])].map(([id, entry]) => [
      id,
      { ...entry.definition },
    ]),
  );
}

export function getRegisteredPluginTemplates(): NpRegisteredPluginTemplate[] {
  return [...pluginRegistries.entries()].flatMap(([pluginId, collections]) =>
    Object.entries(collections).flatMap(([collection, templates]) =>
      Object.entries(templates).map(([id, definition]) => ({
        pluginId,
        collection,
        id,
        definition: { ...definition },
      })),
    ),
  );
}
