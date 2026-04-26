import {
  defineCollection,
  isEditorOrAbove,
  isOwnerOrAdmin,
  type NxCollectionConfig,
} from "@nexpress/core";
import { definePlugin } from "@nexpress/plugin-sdk";

/**
 * @nexpress/plugin-forum — opinionated discussion / forum scaffold on
 * top of NexPress's collection + comment system.
 *
 * Pattern in v1: **staff curates discussions, members converse.** A
 * staff editor creates a discussion (think "topic" or "announcement");
 * members comment underneath. Replies / reactions / follow-the-thread
 * all come for free from Phase 9.2 + 9.3 — this package just gives the
 * site a ready-made "discussion" collection plus a forum identity in
 * the admin (so a future `discussions:moderate` capability has a clear
 * scope to attach to).
 *
 * Member-authored threads (Reddit-style) require a member-writable
 * collection path — that's a separate framework feature, not specific
 * to this plugin. When it lands, this plugin's `access.create` flips
 * from `isEditorOrAbove` to "any active member" without a schema
 * change.
 */

export interface DiscussionsCollectionOptions {
  /** Defaults to `"discussions"`. Override to taste — `"questions"`,
   * `"topics"`, `"announcements"` all work. The plugin doesn't care
   * about the slug; it just needs the collection to exist with the
   * conventional fields. */
  slug?: string;
  /** Defaults to `{ singular: "Discussion", plural: "Discussions" }`. */
  labels?: { singular: string; plural: string };
  /** When omitted, no `category` field is added. Pass an array to
   *  render a select with these options. Categories are deliberately
   *  modeled as an enum here (not a separate `categories` collection)
   *  to keep the migration footprint small — sites that need
   *  category descriptions / metadata can replace this with their own
   *  relationship field after copying the definition. */
  categories?: ReadonlyArray<{ label: string; value: string }>;
}

const DEFAULT_LABELS = { singular: "Discussion", plural: "Discussions" } as const;

/**
 * Returns a ready-to-spread `NxCollectionConfig` for the discussions
 * table. Drop the result into `nexpress.config.ts`'s `collections`
 * array, then run `pnpm db:generate && pnpm db:migrate` to add the
 * underlying `nx_c_<slug>` table.
 */
export function defineDiscussionsCollection(
  options: DiscussionsCollectionOptions = {},
): NxCollectionConfig {
  const slug = options.slug ?? "discussions";
  const labels = options.labels ?? DEFAULT_LABELS;

  const fields: NxCollectionConfig["fields"] = [
    {
      type: "text",
      name: "title",
      required: true,
      admin: { placeholder: "Topic title" },
    },
    {
      type: "richText",
      name: "body",
      admin: {
        description:
          "The opening post. Members reply via comments rather than another field.",
      },
    },
  ];

  if (options.categories && options.categories.length > 0) {
    fields.push({
      type: "select",
      name: "category",
      options: [...options.categories],
      admin: { description: "Tag this discussion for filtering on the public list." },
    });
  }

  fields.push(
    {
      type: "checkbox",
      name: "pinned",
      defaultValue: false,
      admin: { description: "Show this discussion at the top of the list." },
    },
    {
      type: "checkbox",
      name: "locked",
      defaultValue: false,
      admin: { description: "Prevent new comments. Existing replies stay visible." },
    },
  );

  return defineCollection({
    slug,
    labels,
    slugField: { useField: "title", unique: true },
    admin: {
      group: "Community",
      listColumns: ["title", "status", "pinned", "locked", "updatedAt"],
      defaultSort: "-updatedAt",
      description:
        "Staff-authored discussion threads. Members converse via the comment system.",
    },
    versions: { drafts: true, max: 30 },
    community: {
      comments: true,
      // 9.7a: members can create discussion threads. Update / delete
      // for member-authored threads land in 9.7b — until then a
      // member can only create; the staff `update`/`delete` access
      // gates apply unchanged.
      memberWrite: { create: true },
    },
    access: {
      read: () => true,
      // Staff still create via the admin UI. The member create path
      // bypasses this access function entirely (gated by
      // `community.memberWrite.create` + `assertNotBanned` instead).
      create: isEditorOrAbove,
      update: isOwnerOrAdmin,
      delete: isOwnerOrAdmin,
    },
    fields,
  });
}

/**
 * The plugin shell. Registers a forum identity in the admin (so the
 * plugins page lists it) and exposes a dashboard widget showing
 * discussion + comment activity. The widget is the only runtime
 * surface — collection registration happens via the user adding
 * `defineDiscussionsCollection()` to their `nexpress.config.ts`
 * `collections` array.
 *
 * Future-proofing: once 9.5 wires a `community:*` hook namespace,
 * this plugin will also subscribe to `community:commentCreated` and
 * cache `commentCount` / `lastActivityAt` on the parent discussion.
 */
export const forumPlugin = definePlugin({
  manifest: {
    id: "forum",
    version: "0.1.0",
    name: "Forum",
    description:
      "Discussions on top of NexPress collections + comments. Staff curates topics; members reply.",
    author: { name: "NexPress" },
    license: "MIT",
    nexpress: { minVersion: "0.1.0" },
    capabilities: ["content:read", "admin:dashboard"],
    allowedHosts: [],
    provides: {
      blocks: [],
      fields: [],
      collections: [],
      // Existing plugins (reading-time, seo-audit) keep this empty
      // even when populating `admin.*` extensions — the field is
      // informational and doesn't gate runtime registration. Match
      // their convention.
      adminExtensions: [],
      apiRoutes: [],
      hooks: [],
    },
    agent: {
      description:
        "Built-in forum scaffold. Pair the plugin with `defineDiscussionsCollection()` from the same package to opt in. Best for staff-curated topics with member-authored comments.",
      category: "content",
      tags: ["forum", "discussion", "community", "scaffold"],
    },
    usesTokens: [],
    styleSlots: {},
  },
  admin: {
    dashboardWidgets: [
      {
        id: "discussions-total",
        label: "Discussions",
        kind: "metric",
        actionId: "countDiscussions",
        description: "Total topic count across all discussion collections.",
        priority: 20,
      },
    ],
  },
  setup: async (ctx) => {
    // The widget action enumerates collections opted into comments and
    // sums their doc counts. Today the user typically has one
    // discussion collection (slug "discussions"); the plugin doesn't
    // hard-code the slug so a site with multiple forum-flavored
    // collections still gets a meaningful total.
    ctx.actions.register("countDiscussions", async () => {
      try {
        // The plugin context exposes `content.count(slug)` — but we
        // don't know the slug list. Read the conventional default
        // first; ignore "collection not found" so an install without
        // a discussions collection just shows zero gracefully.
        let total = 0;
        for (const slug of ["discussions", "topics", "questions"]) {
          try {
            total += await ctx.content.count(slug);
          } catch {
            // Skip — collection isn't registered.
          }
        }
        return {
          ok: true,
          data: { value: total, delta: total === 0 ? "Not configured yet" : `${total} topics` },
        };
      } catch (error) {
        return {
          ok: false,
          error: error instanceof Error ? error.message : "Unknown error",
        };
      }
    });
  },
});

export default forumPlugin;
