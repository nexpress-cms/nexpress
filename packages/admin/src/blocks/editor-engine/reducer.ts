import type { NpBlockInstance, NpBlockMetadata } from "@nexpress/blocks";

import type { EditorAction } from "./types.js";
import { canAcceptChild } from "./contracts.js";
import {
  arrayMove,
  cloneBlockDeep,
  createBlockId,
  detachBlock,
  filterTree,
  findBlockInTreeFlat,
  isDescendantOf,
  locateBlock,
  mapTree,
  updateContainerChildren,
} from "./tree.js";

/**
 * Builds a new block instance from the metadata's defaults. Pure
 * data — the runtime renderer (`@nexpress/blocks`'s `renderBlocks`)
 * doesn't care which surface created the instance.
 *
 * Containers (`acceptsChildren: true`) get an empty `children: []`
 * array up-front so the editor's add-child UI has something to
 * push into without a null-check round-trip.
 */
export const createBlockInstance = (
  definition: NpBlockMetadata,
): NpBlockInstance => ({
  id: createBlockId(),
  type: definition.type,
  props: { ...definition.defaultProps },
  ...(definition.acceptsChildren ? { children: [] } : {}),
});

/**
 * Builds the page-builder reducer. The reducer is closure-bound
 * to `availableBlocks` so it can resolve metadata for type lookups
 * and contract checks without each action carrying it.
 *
 * Every action is contract-aware where applicable (`canAcceptChild`)
 * and tree-mutation-only — no DOM, no React, no dnd-kit. The form
 * editor wires `MOVE_WITHIN_PARENT` from drag events, the in-page
 * editor would wire it from its own drop handler. The reducer
 * doesn't care.
 */
export const createEditorReducer = (availableBlocks: NpBlockMetadata[]) => {
  const definitions = new Map(availableBlocks.map((block) => [block.type, block]));

  return (state: NpBlockInstance[], action: EditorAction): NpBlockInstance[] => {
    switch (action.type) {
      case "RESET":
        return action.blocks;
      case "ADD": {
        const definition = definitions.get(action.blockType);
        if (!definition) return state;
        const parentId = action.parentId ?? null;
        // Honor container contracts (#467) — reject when the
        // type isn't allowed or the cap is hit. Top-level adds
        // skip the check (no parent contract to honor).
        if (parentId !== null) {
          const parent = findBlockInTreeFlat(state, parentId);
          const parentDef = parent ? definitions.get(parent.type) : null;
          if (
            parentDef &&
            !canAcceptChild(
              parentDef,
              action.blockType,
              parent?.children?.length ?? 0,
            )
          ) {
            return state;
          }
        }
        const next = createBlockInstance(definition);
        return updateContainerChildren(state, parentId, (siblings) => [
          ...siblings,
          next,
        ]);
      }
      case "INSERT_BEFORE":
      case "INSERT_AFTER": {
        const definition = definitions.get(action.blockType);
        if (!definition) return state;
        const loc = locateBlock(state, action.targetId);
        if (!loc) return state;
        // Honor the parent container contract (#467 post-review).
        // Slot insertion inside a container with
        // `allowedChildTypes` / `maxChildren` previously bypassed
        // the gate the Add-block popover already respected.
        if (loc.parentId !== null) {
          const parent = findBlockInTreeFlat(state, loc.parentId);
          const parentDef = parent ? definitions.get(parent.type) : null;
          if (
            parentDef &&
            !canAcceptChild(
              parentDef,
              action.blockType,
              parent?.children?.length ?? 0,
            )
          ) {
            return state;
          }
        }
        const next = createBlockInstance(definition);
        const offset = action.type === "INSERT_AFTER" ? 1 : 0;
        return updateContainerChildren(state, loc.parentId, (siblings) => [
          ...siblings.slice(0, loc.index + offset),
          next,
          ...siblings.slice(loc.index + offset),
        ]);
      }
      case "DELETE":
        return filterTree(state, (block) => block.id !== action.id);
      case "DUPLICATE": {
        const loc = locateBlock(state, action.id);
        if (!loc) return state;
        return updateContainerChildren(state, loc.parentId, (siblings) => {
          const source = siblings[loc.index];
          if (!source) return siblings;
          const clone = cloneBlockDeep(source);
          return [
            ...siblings.slice(0, loc.index + 1),
            clone,
            ...siblings.slice(loc.index + 1),
          ];
        });
      }
      case "MOVE_WITHIN_PARENT": {
        return updateContainerChildren(state, action.parentId, (siblings) => {
          const fromIndex = siblings.findIndex((b) => b.id === action.fromId);
          const toIndex = siblings.findIndex((b) => b.id === action.toId);
          if (fromIndex === -1 || toIndex === -1 || fromIndex === toIndex) {
            return siblings;
          }
          return arrayMove(siblings, fromIndex, toIndex);
        });
      }
      case "MOVE_UP": {
        const loc = locateBlock(state, action.id);
        if (!loc || loc.index === 0) return state;
        return updateContainerChildren(state, loc.parentId, (siblings) =>
          arrayMove(siblings, loc.index, loc.index - 1),
        );
      }
      case "MOVE_DOWN": {
        const loc = locateBlock(state, action.id);
        if (!loc) return state;
        return updateContainerChildren(state, loc.parentId, (siblings) => {
          if (loc.index >= siblings.length - 1) return siblings;
          return arrayMove(siblings, loc.index, loc.index + 1);
        });
      }
      case "MOVE_INTO": {
        // Detach + append into target container. Reject the
        // self-into-self and into-descendant cases up front so the
        // tree can never form a cycle, and honor any
        // `allowedChildTypes` / `maxChildren` contract on the
        // target.
        if (action.id === action.targetParentId) return state;
        const sourceLoc = locateBlock(state, action.id);
        if (!sourceLoc) return state;
        const target = findBlockInTreeFlat(state, action.targetParentId);
        const targetDef = target ? definitions.get(target.type) : null;
        if (!targetDef?.acceptsChildren) return state;
        if (isDescendantOf(state, action.targetParentId, action.id)) {
          return state;
        }
        const source = findBlockInTreeFlat(state, action.id);
        if (
          source &&
          !canAcceptChild(
            targetDef,
            source.type,
            target?.children?.length ?? 0,
          )
        ) {
          return state;
        }
        const detached = detachBlock(state, action.id);
        if (!detached) return state;
        return updateContainerChildren(
          detached.tree,
          action.targetParentId,
          (siblings) => [...siblings, detached.removed],
        );
      }
      case "MOVE_OUT": {
        // Promote one level: drop into grandparent immediately
        // after the current parent. No-op at top-level (no
        // grandparent to receive the block).
        const sourceLoc = locateBlock(state, action.id);
        if (!sourceLoc || sourceLoc.parentId === null) return state;
        const parentId = sourceLoc.parentId;
        const parentLoc = locateBlock(state, parentId);
        if (!parentLoc) return state;
        const detached = detachBlock(state, action.id);
        if (!detached) return state;
        return updateContainerChildren(
          detached.tree,
          parentLoc.parentId,
          (siblings) => {
            const parentIndex = siblings.findIndex((s) => s.id === parentId);
            if (parentIndex === -1) {
              return [...siblings, detached.removed];
            }
            return [
              ...siblings.slice(0, parentIndex + 1),
              detached.removed,
              ...siblings.slice(parentIndex + 1),
            ];
          },
        );
      }
      case "WRAP_IN": {
        const containerDef = definitions.get(action.containerType);
        if (!containerDef || !containerDef.acceptsChildren) return state;
        const source = findBlockInTreeFlat(state, action.id);
        if (!source) return state;
        // Honor the wrapper's contract (#467 post-review). Wrapping
        // a `hero` in a container with `allowedChildTypes:
        // ["pricing-tier"]` would create an instantly-invalid tree
        // — fail closed instead.
        if (!canAcceptChild(containerDef, source.type, 0)) {
          return state;
        }
        return mapTree(state, (block) => {
          if (block.id !== action.id) return block;
          const wrapper = createBlockInstance(containerDef);
          return {
            ...wrapper,
            children: [block],
          };
        });
      }
      case "INSERT_PATTERN": {
        // Re-id every block in the pattern so each insertion is
        // independent. Filter unknown types defensively — a
        // pattern stored via "save current as pattern" might
        // outlive the plugin that contributed one of its blocks.
        let sanitized = action.pattern.blocks
          .filter((b) => definitions.has(b.type))
          .map(cloneBlockDeep);
        if (sanitized.length === 0) return state;
        const parentId = action.parentId ?? null;
        // Honor the parent container contract (#467 post-review).
        // Each top-level block in the pattern is checked against
        // `allowedChildTypes`, and the cap is enforced cumulatively
        // — a pattern that would push the count past `maxChildren`
        // truncates instead of overflowing the cap.
        if (parentId !== null) {
          const parent = findBlockInTreeFlat(state, parentId);
          const parentDef = parent ? definitions.get(parent.type) : null;
          if (parentDef) {
            const baseCount = parent?.children?.length ?? 0;
            const accepted: NpBlockInstance[] = [];
            let projectedCount = baseCount;
            for (const block of sanitized) {
              if (canAcceptChild(parentDef, block.type, projectedCount)) {
                accepted.push(block);
                projectedCount += 1;
              }
            }
            if (accepted.length === 0) return state;
            sanitized = accepted;
          }
        }
        return updateContainerChildren(state, parentId, (siblings) => [
          ...siblings,
          ...sanitized,
        ]);
      }
      case "DELETE_MANY": {
        if (action.ids.length === 0) return state;
        const idSet = new Set(action.ids);
        return filterTree(state, (block) => !idSet.has(block.id));
      }
      case "DUPLICATE_MANY": {
        if (action.ids.length === 0) return state;
        const rawSet = new Set(action.ids);
        // Drop any id whose ancestor is also selected — duplicating
        // both would clone the descendant *inside* the ancestor's
        // clone (because the ancestor's children already include the
        // descendant's clone from the recursive walk), producing 4×
        // the descendant + 2× the ancestor instead of the intended
        // 2× each. Pre-walking once to filter is O(N × depth) which
        // is fine for editor-scale trees.
        const idSet = new Set<string>();
        for (const id of rawSet) {
          let loc = locateBlock(state, id);
          let ancestorSelected = false;
          while (loc && loc.parentId !== null) {
            if (rawSet.has(loc.parentId)) {
              ancestorSelected = true;
              break;
            }
            loc = locateBlock(state, loc.parentId);
          }
          if (!ancestorSelected) idSet.add(id);
        }
        if (idSet.size === 0) return state;
        // Walk depth-first, recursing into children first so a
        // selection that spans depths still duplicates bottom-up
        // and the indices stay correct. Each selected block emits
        // its (post-recurse) self followed by a fresh-id clone.
        const walk = (siblings: NpBlockInstance[]): NpBlockInstance[] => {
          const out: NpBlockInstance[] = [];
          for (const block of siblings) {
            const transformed = block.children
              ? { ...block, children: walk(block.children) }
              : block;
            out.push(transformed);
            if (idSet.has(block.id)) {
              out.push(cloneBlockDeep(transformed));
            }
          }
          return out;
        };
        return walk(state);
      }
      case "WRAP_MANY": {
        if (action.ids.length === 0) return state;
        const containerDef = definitions.get(action.containerType);
        if (!containerDef || !containerDef.acceptsChildren) return state;
        // Resolve every id's location; require all to share a
        // parent AND be contiguous siblings — wrapping a non-
        // contiguous set would reorder the page, wrapping across
        // containers would split the selection.
        const locs = action.ids
          .map((id) => locateBlock(state, id))
          .filter(
            (l): l is { parentId: string | null; index: number } => l !== null,
          );
        if (locs.length !== action.ids.length) return state;
        const parentId = locs[0].parentId;
        if (locs.some((l) => l.parentId !== parentId)) return state;
        const indices = locs.map((l) => l.index).sort((a, b) => a - b);
        for (let i = 1; i < indices.length; i++) {
          if (indices[i] !== indices[i - 1] + 1) return state;
        }
        const start = indices[0];
        const end = indices[indices.length - 1];
        return updateContainerChildren(state, parentId, (siblings) => {
          const range = siblings.slice(start, end + 1);
          // Honor the wrapper's contract on each child + the
          // cumulative cap. Reject the whole wrap if any child
          // would be invalid — partial-wrap would leave the
          // selection in a confusing state.
          let projected = 0;
          for (const block of range) {
            if (!canAcceptChild(containerDef, block.type, projected)) {
              return siblings;
            }
            projected += 1;
          }
          const wrapper: NpBlockInstance = {
            ...createBlockInstance(containerDef),
            children: range,
          };
          return [
            ...siblings.slice(0, start),
            wrapper,
            ...siblings.slice(end + 1),
          ];
        });
      }
      case "UPDATE_PROPS":
        return mapTree(state, (block) =>
          block.id === action.id
            ? { ...block, props: { ...block.props, ...action.props } }
            : block,
        );
      case "REPLACE_PROPS":
        // JSON-edit dialog wants the operator to drop keys by
        // omitting them, so we replace rather than merge here.
        return mapTree(state, (block) =>
          block.id === action.id ? { ...block, props: action.props } : block,
        );
      default:
        return state;
    }
  };
};
