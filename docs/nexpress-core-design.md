# NexPress Core System Design

> Version: 0.1 (Draft)
> Date: 2026-04-17
> Status: Design phase — no code written yet
> Companion: plugin-system-design.md (plugin/sandbox architecture)

---

## Table of Contents

A. [Database Schema](#a-database-schema)
B. [Content Modeling System](#b-content-modeling-system)
C. [Authentication & Authorization](#c-authentication--authorization)
D. [Rendering Layer](#d-rendering-layer)
E. [Admin UI Architecture](#e-admin-ui-architecture)
F. [Editor System](#f-editor-system)
G. [Media System](#g-media-system)
H. [Theme Engine](#h-theme-engine)
I. [Agent Interface](#i-agent-interface)
J. [CLI & Project Structure](#j-cli--project-structure)
K. [Routing Contract](#k-routing-contract-cb-3)
L. [Write Pipeline & Access Control](#l-write-pipeline--access-control-cb-5-cb-6)
M. [Background Jobs & Worker](#m-background-jobs--worker-cb-4)
N. [Platform Policies](#n-platform-policies-hs-8-ms-3-ms-7-hs-6-ms-1-ms-2-ms-4-ms-6)
O. [Schema Evolution & Validation](#o-schema-evolution--validation-hs-1-hs-3-hs-4)
P. [Search](#p-search-hs-7)
[Appendix: QA Scenarios](#appendix-qa-scenarios) (A–P)

---

## F. Editor System

### F.1 Overview

NexPress uses two editing modes:

1. **Rich Text Editor** — Lexical-based, for long-form content (blog posts, articles)
2. **Block Page Editor** — Visual block arranger for pages (hero, features, pricing, etc.)

Both share the same storage format and are interoperable where appropriate.

### F.2 Lexical Rich Text Editor

**Package**: `@nexpress/editor` (wraps `@lexical/react`)

```typescript
/**
 * NexPress Lexical editor configuration.
 * Provides CMS-specific features on top of base Lexical.
 */
export interface NxEditorConfig {
  /** Enable/disable specific features */
  features?: NxEditorFeature[];
  /** Custom blocks available inside the editor */
  blocks?: NxEditorBlock[];
  /**
   * Image upload handler.
   * Returns a media identity immediately after the original is persisted. The
   * editor inserts a temporary image node and resolves the final URL/variants
   * when processing completes.
   */
  onUploadImage?: (file: File) => Promise<NxEditorImageUploadResult>;
  /** Link resolver (for internal content links) */
  onResolveLink?: (collection: string, id: string) => Promise<{ url: string; title: string }>;
  /** Placeholder text */
  placeholder?: string;
  /** Read-only mode */
  readOnly?: boolean;
}

export interface NxEditorImageUploadResult {
  /** Media item ID used for persistence and polling */
  id: string;
  /** Current media status from the upload API */
  status: "processing" | "ready" | "error";
  /** Original URL is available immediately when the storage adapter can serve it */
  originalUrl?: string;
  /** Author-provided or filename-derived alt text */
  alt?: string;
}

/**
 * Editor features — modular toolbar/behavior plugins.
 */
export type NxEditorFeature =
  | "heading" // H1-H4
  | "bold"
  | "italic"
  | "underline"
  | "strikethrough"
  | "code" // inline code
  | "codeBlock" // fenced code block with language
  | "link" // internal + external links
  | "image" // inline image upload
  | "list" // ordered + unordered
  | "quote" // blockquote
  | "horizontalRule"
  | "table" // basic table
  | "alignment" // text alignment
  | "indent"
  | "superscript"
  | "subscript"
  | "emoji"
  | "blocks"; // enable inline block insertion

/**
 * Default feature set for blog/article editing.
 */
export const DEFAULT_FEATURES: NxEditorFeature[] = [
  "heading",
  "bold",
  "italic",
  "underline",
  "code",
  "codeBlock",
  "link",
  "image",
  "list",
  "quote",
  "horizontalRule",
  "alignment",
];
```

**Lexical storage format**: Content is stored as Lexical's JSON serialization format (not HTML):

```typescript
/**
 * Stored rich text content (DB column type: jsonb).
 * This is Lexical's native JSON format.
 */
export interface NxRichTextContent {
  root: {
    type: "root";
    children: LexicalNode[];
    direction: "ltr" | "rtl" | null;
    format: string;
    indent: number;
    version: number;
  };
}

// Example stored value:
// {
//   "root": {
//     "type": "root",
//     "children": [
//       { "type": "paragraph", "children": [{ "type": "text", "text": "Hello world" }] },
//       { "type": "heading", "tag": "h2", "children": [{ "type": "text", "text": "Section" }] }
//     ]
//   }
// }
```

**Server-side rendering of rich text** (for SSR/RSC):

```typescript
/**
 * Render Lexical JSON to React elements for server-side rendering.
 * Used in RSC pages to render blog post content.
 *
 * Does NOT use Lexical runtime — pure JSON → React transformation.
 * This keeps the public site bundle free of Lexical's ~100KB.
 */
export function renderRichText(content: NxRichTextContent): React.ReactElement;

// Implementation maps each Lexical node type to a React component:
// "paragraph" → <p>
// "heading"   → <h1>-<h4>
// "list"      → <ul>/<ol>
// "listitem"  → <li>
// "link"      → <a>
// "image"     → <NxImage> (Next.js Image optimization)
// "code"      → <pre><code>
// "quote"     → <blockquote>
// "block"     → <BlockResolver> (embedded block components)
```

### F.3 Block Page Editor

For page-level editing (homepage, landing pages), NexPress uses a separate block editor that arranges pre-built React block components.

```typescript
/**
 * Block page editor state.
 * Stored as JSON array in the `blocks` column.
 */
export interface NxPageBlocks {
  blocks: NxBlockInstance[];
}

export interface NxBlockInstance {
  /** Unique instance ID (for React keys and reordering) */
  id: string;
  /** Block type (maps to Block Registry) */
  type: string;
  /** Block props (validated against block's propsSchema) */
  props: Record<string, unknown>;
  /** Data binding (dynamic content from collections) */
  dataBinding?: Record<string, NxDataBinding>;
}

export interface NxDataBinding {
  /** Source collection */
  collection: string;
  /** Query filter */
  where?: Record<string, unknown>;
  /** Fields to select */
  select?: string[];
  /** Sort */
  sort?: string;
  /** Limit */
  limit?: number;
}
```

**Block editor UI components**:

```
┌─────────────────────────────────────────────────┐
│  Page Editor                              [Save] │
├─────────────────────────────────────────────────┤
│                                                  │
│  ┌────────────────────────────────────────┐     │
│  │ [≡] Hero Block               [⚙][✕]  │     │
│  │     title: "Welcome to..."             │     │
│  │     subtitle: "Modern CMS"             │     │
│  │     ctaText: "Get Started"             │     │
│  └────────────────────────────────────────┘     │
│               ↕ drag handle                      │
│  ┌────────────────────────────────────────┐     │
│  │ [≡] Feature Grid Block       [⚙][✕]  │     │
│  │     columns: 3                         │     │
│  │     dataBinding: features (6 items)    │     │
│  └────────────────────────────────────────┘     │
│               ↕ drag handle                      │
│  ┌────────────────────────────────────────┐     │
│  │ [≡] Rich Text Block          [⚙][✕]  │     │
│  │     (Lexical editor embedded)          │     │
│  └────────────────────────────────────────┘     │
│                                                  │
│  [+ Add Block]                                   │
│                                                  │
│  Block Palette:                                  │
│  ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐          │
│  │ Hero │ │Feature│ │ FAQ  │ │ Rich │          │
│  │      │ │ Grid │ │      │ │ Text │          │
│  └──────┘ └──────┘ └──────┘ └──────┘          │
│  ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐          │
│  │Pricing│ │CTA   │ │Contact│ │Image │          │
│  │      │ │      │ │ Form │ │Gallery│          │
│  └──────┘ └──────┘ └──────┘ └──────┘          │
└─────────────────────────────────────────────────┘
```

**Drag & Drop**: `@dnd-kit/core` + `@dnd-kit/sortable`

```typescript
// packages/editor/src/block-editor/BlockEditor.tsx
"use client";

import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
  arrayMove,
} from "@dnd-kit/sortable";

interface BlockEditorProps {
  blocks: NxBlockInstance[];
  onChange: (blocks: NxBlockInstance[]) => void;
  availableBlocks: NxBlockRegistration[];
}

export function BlockEditor({ blocks, onChange, availableBlocks }: BlockEditorProps) {
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor)
  );

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      const oldIndex = blocks.findIndex((b) => b.id === active.id);
      const newIndex = blocks.findIndex((b) => b.id === over.id);
      onChange(arrayMove(blocks, oldIndex, newIndex));
    }
  }

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <SortableContext items={blocks.map((b) => b.id)} strategy={verticalListSortingStrategy}>
        {blocks.map((block) => (
          <SortableBlockItem
            key={block.id}
            block={block}
            onUpdate={(props) => updateBlock(block.id, props)}
            onRemove={() => removeBlock(block.id)}
          />
        ))}
      </SortableContext>
      <BlockPalette availableBlocks={availableBlocks} onAdd={addBlock} />
    </DndContext>
  );
}
```

**Block props editor** — Auto-generated from JSON Schema:

```typescript
/**
 * Generate admin form from block's propsSchema.
 * Maps JSON Schema types → shadcn/ui form components.
 */
export function BlockPropsEditor({
  schema,
  values,
  onChange,
}: {
  schema: Record<string, unknown>; // JSON Schema
  values: Record<string, unknown>;
  onChange: (values: Record<string, unknown>) => void;
}) {
  // JSON Schema type → component mapping:
  // "string"  → <Input />
  // "number"  → <Input type="number" />
  // "boolean" → <Switch />
  // "string" + enum → <Select />
  // "string" + format:"uri" → <Input type="url" />
  // "object"  → recursive <BlockPropsEditor />
  // "array"   → <ArrayFieldEditor /> (add/remove/reorder items)
}
```

### F.4 Editor Integration with Content Model

```typescript
// Collection field definitions reference the editor:
defineCollection({
  slug: "posts",
  fields: [
    {
      name: "content",
      type: "richText",
      editor: {
        features: [...DEFAULT_FEATURES, "blocks", "table"],
        blocks: ["banner", "code", "media"], // blocks embeddable in rich text
      },
    },
  ],
});

// Page collection uses block editor:
defineCollection({
  slug: "pages",
  fields: [
    {
      name: "blocks",
      type: "blocks",
      allowedBlocks: ["hero", "feature-grid", "faq", "rich-text", "pricing", "cta"],
    },
  ],
});
```

---

## G. Media System

### G.1 Overview

NexPress provides a unified media management system with:

- File upload (images, documents, videos)
- Image optimization via `sharp`
- Configurable image sizes (responsive srcset)
- Storage abstraction (local filesystem / S3-compatible)
- Media library admin UI

### G.2 Storage Adapter Interface

```typescript
/**
 * Storage adapter — abstracts file storage behind a common interface.
 * NexPress ships with LocalAdapter and S3Adapter.
 */
export interface NxStorageAdapter {
  /** Upload a file */
  upload(key: string, data: Buffer | ReadableStream, metadata: NxFileMetadata): Promise<void>;

  /** Get a readable stream for a file */
  getStream(key: string): Promise<ReadableStream>;

  /** Get a signed/public URL for a file */
  getUrl(key: string, options?: NxUrlOptions): Promise<string>;

  /** Delete a file */
  delete(key: string): Promise<void>;

  /** Check if a file exists */
  exists(key: string): Promise<boolean>;

  /** List files by prefix */
  list(prefix: string, options?: NxListOptions): Promise<NxStorageEntry[]>;
}

export interface NxFileMetadata {
  contentType: string;
  contentLength: number;
  originalFilename: string;
}

export interface NxUrlOptions {
  /** URL expiration time in seconds (for signed URLs) */
  expiresIn?: number;
  /** Image transformation (only for image files) */
  transform?: NxImageTransform;
}

export interface NxImageTransform {
  width?: number;
  height?: number;
  fit?: "cover" | "contain" | "fill" | "inside" | "outside";
  quality?: number;
  format?: "webp" | "avif" | "jpeg" | "png";
}

export interface NxStorageEntry {
  key: string;
  size: number;
  lastModified: Date;
}

export interface NxListOptions {
  limit?: number;
  cursor?: string;
}
```

### G.3 Built-in Storage Adapters

```typescript
// Local filesystem adapter (development / simple self-hosted)
export class LocalStorageAdapter implements NxStorageAdapter {
  constructor(
    private config: {
      /** Base directory for file storage */
      directory: string; // e.g., "./public/media"
      /** Base URL for serving files */
      baseUrl: string; // e.g., "/media"
    },
  ) {}
  // Files stored at: {directory}/{key}
  // URLs: {baseUrl}/{key}
}

// S3-compatible adapter (production)
export class S3StorageAdapter implements NxStorageAdapter {
  constructor(
    private config: {
      /** S3 bucket name */
      bucket: string;
      /** AWS region */
      region: string;
      /** Custom endpoint (for MinIO, R2, etc.) */
      endpoint?: string;
      /** Access credentials */
      credentials?: { accessKeyId: string; secretAccessKey: string };
      /** URL prefix for public access */
      publicUrlPrefix?: string;
      /** Use pre-signed URLs */
      useSignedUrls?: boolean;
      /** Signed URL expiration (seconds) */
      signedUrlExpiration?: number;
    },
  ) {}
  // Uses @aws-sdk/client-s3
}
```

### G.4 Image Processing Pipeline

```typescript
/**
 * Image processing configuration.
 * Applied on upload — generates optimized variants.
 */
export interface NxImageConfig {
  /** Maximum upload dimensions (resize if larger) */
  maxDimensions?: { width: number; height: number };
  /** Image sizes to generate (for responsive images) */
  sizes: NxImageSize[];
  /** Default output format */
  format?: "webp" | "avif" | "original";
  /** Default quality (1-100) */
  quality?: number;
  /** Enable focal point cropping */
  focalPoint?: boolean;
}

export interface NxImageSize {
  /** Size name (used in URLs and srcset) */
  name: string;
  /** Target width */
  width: number;
  /** Target height (optional — maintains aspect ratio if omitted) */
  height?: number;
  /** Crop mode */
  crop?: "center" | "top" | "bottom" | "left" | "right" | "focalpoint";
}

/**
 * Default image sizes (matches Payload pattern).
 */
export const DEFAULT_IMAGE_SIZES: NxImageSize[] = [
  { name: "thumbnail", width: 300 },
  { name: "small", width: 600 },
  { name: "medium", width: 900 },
  { name: "large", width: 1400 },
  { name: "xlarge", width: 1920 },
  { name: "og", width: 1200, height: 630, crop: "center" },
];
```

**Upload flow (async — see M.3 for details)**:

```
┌──────────┐     ┌───────────┐     ┌──────────────┐     ┌─────────────┐
│  Client   │────▶│  Upload   │────▶│  Storage     │     │  Job Queue  │
│  (Admin)  │     │  Handler  │     │  (original)  │     │  (pg-boss)  │
└──────────┘     └───────────┘     └──────────────┘     └─────────────┘
                       │                                       │
                       ├── Save original → storage/{id}/original.{ext}
                       ├── Insert DB record (status: "processing")
                       ├── Enqueue "media:processImage" job ───┘
                       └── Return 202 { id, status: "processing" }

                 ┌─── Worker picks up job ───┐
                 │  sharp pipeline:           │
                 │  ├── thumbnail.webp (300w) │
                 │  ├── small.webp (600w)     │
                 │  ├── medium.webp (900w)    │
                 │  ├── large.webp (1400w)    │
                 │  └── og.webp (1200x630)    │
                 └────────────────────────────┘
                       │
                       ▼
                 ┌───────────┐
                 │  DB Update │  status: "ready", sizes: {...}
                 └───────────┘
```

### G.5 Media DB Schema

```typescript
// (Drizzle ORM)
export const media = pgTable(
  "nx_media",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    filename: text("filename").notNull(),
    originalFilename: text("original_filename").notNull(),
    mimeType: text("mime_type").notNull(),
    filesize: integer("filesize").notNull(),
    width: integer("width"),
    height: integer("height"),
    alt: text("alt"),
    caption: jsonb("caption").$type<NxRichTextContent>(), // Lexical JSON
    focalPoint: jsonb("focal_point").$type<{ x: number; y: number }>(),
    sizes:
      jsonb("sizes").$type<Record<string, { width: number; height: number; filesize: number }>>(),
    storageKey: text("storage_key").notNull(), // path in storage adapter
    hash: text("hash").notNull(), // sha256 of original file (used for import matching & dedup)
    status: text("status", { enum: ["processing", "ready", "error"] })
      .notNull()
      .default("processing"),
    folderId: uuid("folder_id").references(() => mediaFolders.id),
    uploadedBy: uuid("uploaded_by").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }), // soft delete — hard-deleted by media:cleanup job after 30 days
  },
  (table) => ({
    hashIdx: index("nx_media_hash").on(table.hash),
    statusIdx: index("nx_media_status").on(table.status),
  }),
);

export const mediaFolders = pgTable("nx_media_folders", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  parentId: uuid("parent_id").references((): AnyPgColumn => mediaFolders.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
```

### G.6 Media API (Next.js Route Handlers)

```typescript
// app/api/media/upload/route.ts
export async function POST(request: NextRequest) {
  const user = await requireAuth(request);

  // 1. Parse multipart form data
  // 2. Validate file type against allowedMimeTypes & size against maxFileSize
  // 3. Compute sha256 hash of original file
  // 4. Save ORIGINAL file to storage adapter (no processing yet)
  // 5. Insert DB record with status: "processing", hash, basic metadata
  // 6. Enqueue "media:processImage" job (sharp pipeline runs async)
  // 7. Return 202 { id, filename, mimeType, status: "processing" }
  //
  // See Section M.3 for the full async upload flow.
}

// app/api/media/[id]/route.ts
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  // Return media metadata (includes status, sizes when ready)
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await requireAuth(request);

  // 1. Check nxMediaRefs for active references (see Section O.3)
  // 2. If references exist → 409 { error: { code: "MEDIA_IN_USE", references: [...] } }
  // 3. If no references → soft-delete: SET deleted_at = now()
  // 4. Return 200 { deleted: true }
  // 5. Hard deletion of storage files handled by "media:cleanup" job after 30 days
}
```

---

## H. Theme Engine

### H.1 Architecture (from planning doc v3)

```
Layer 3: Block Overrides — className slots (advanced, optional)
Layer 2: Site Theme     — CSS Custom Properties override
Layer 1: Token Contract — --nx-color-*, --nx-font-*, --nx-radius-*

@layer nx-base, nx-blocks, nx-theme, nx-overrides;
```

### H.2 Design Token Contract

```typescript
/**
 * Complete NexPress design token set.
 * All plugin blocks MUST reference these variables only.
 */
export interface NxThemeTokens {
  colors: {
    primary: string; // --nx-color-primary
    primaryForeground: string; // --nx-color-primary-foreground
    secondary: string; // --nx-color-secondary
    secondaryForeground: string;
    accent: string; // --nx-color-accent
    accentForeground: string;
    background: string; // --nx-color-background
    foreground: string; // --nx-color-foreground
    muted: string; // --nx-color-muted
    mutedForeground: string;
    border: string; // --nx-color-border
    input: string; // --nx-color-input
    ring: string; // --nx-color-ring
    destructive: string; // --nx-color-destructive
    destructiveForeground: string;
    card: string; // --nx-color-card
    cardForeground: string;
  };
  typography: {
    headingFont: string; // --nx-font-heading
    bodyFont: string; // --nx-font-body
    monoFont: string; // --nx-font-mono
    baseFontSize: string; // --nx-font-size-base (e.g., "16px")
    lineHeight: string; // --nx-line-height (e.g., "1.6")
    fontSizeScale: {
      // --nx-font-size-sm through --nx-font-size-4xl
      sm: string;
      base: string;
      lg: string;
      xl: string;
      "2xl": string;
      "3xl": string;
      "4xl": string;
    };
  };
  shape: {
    radiusSm: string; // --nx-radius-sm
    radiusMd: string; // --nx-radius-md
    radiusLg: string; // --nx-radius-lg
    radiusFull: string; // --nx-radius-full
    shadowSm: string; // --nx-shadow-sm
    shadowMd: string; // --nx-shadow-md
    shadowLg: string; // --nx-shadow-lg
  };
  darkMode?: {
    enabled: boolean;
    colors: Partial<NxThemeTokens["colors"]>;
  };
}
```

### H.3 Theme JSON → CSS Conversion (Server Component)

```typescript
// packages/theme/src/ThemeProvider.tsx
// This is a SERVER COMPONENT — zero client JS

import type { NxThemeTokens } from "./types";

export function NxThemeStyle({ theme }: { theme: NxThemeTokens }) {
  const css = generateThemeCss(theme);
  return <style dangerouslySetInnerHTML={{ __html: css }} />;
}

function generateThemeCss(theme: NxThemeTokens): string {
  const lines: string[] = ["@layer nx-theme {", ":root {"];

  // Colors
  for (const [key, value] of Object.entries(theme.colors)) {
    const cssVar = `--nx-color-${camelToKebab(key)}`;
    lines.push(`  ${cssVar}: ${value};`);
  }

  // Typography
  lines.push(`  --nx-font-heading: ${theme.typography.headingFont};`);
  lines.push(`  --nx-font-body: ${theme.typography.bodyFont};`);
  lines.push(`  --nx-font-mono: ${theme.typography.monoFont};`);
  lines.push(`  --nx-font-size-base: ${theme.typography.baseFontSize};`);
  lines.push(`  --nx-line-height: ${theme.typography.lineHeight};`);
  for (const [size, value] of Object.entries(theme.typography.fontSizeScale)) {
    lines.push(`  --nx-font-size-${size}: ${value};`);
  }

  // Shape
  for (const [key, value] of Object.entries(theme.shape)) {
    const cssVar = `--nx-${camelToKebab(key)}`;
    lines.push(`  ${cssVar}: ${value};`);
  }

  lines.push("}", "}"); // close :root and @layer

  // Dark mode
  if (theme.darkMode?.enabled && theme.darkMode.colors) {
    lines.push("@layer nx-theme {", '[data-theme="dark"] {');
    for (const [key, value] of Object.entries(theme.darkMode.colors)) {
      const cssVar = `--nx-color-${camelToKebab(key)}`;
      lines.push(`  ${cssVar}: ${value};`);
    }
    lines.push("}", "}");
  }

  return lines.join("\n");
}

function camelToKebab(str: string): string {
  return str.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);
}
```

### H.4 Tailwind CSS v4 Integration

```css
/* packages/theme/src/base.css */
@import "tailwindcss";

@layer nx-base {
  /* NexPress base reset */
  *,
  *::before,
  *::after {
    box-sizing: border-box;
  }

  body {
    font-family: var(--nx-font-body);
    font-size: var(--nx-font-size-base);
    line-height: var(--nx-line-height);
    color: var(--nx-color-foreground);
    background: var(--nx-color-background);
  }
}

@theme {
  /* Map NexPress tokens to Tailwind v4 theme */
  --color-primary: var(--nx-color-primary);
  --color-primary-foreground: var(--nx-color-primary-foreground);
  --color-secondary: var(--nx-color-secondary);
  --color-accent: var(--nx-color-accent);
  --color-background: var(--nx-color-background);
  --color-foreground: var(--nx-color-foreground);
  --color-muted: var(--nx-color-muted);
  --color-border: var(--nx-color-border);
  --color-destructive: var(--nx-color-destructive);
  --color-card: var(--nx-color-card);

  --font-heading: var(--nx-font-heading);
  --font-body: var(--nx-font-body);
  --font-mono: var(--nx-font-mono);

  --radius-sm: var(--nx-radius-sm);
  --radius-md: var(--nx-radius-md);
  --radius-lg: var(--nx-radius-lg);
}
```

### H.5 Theme Admin UI

```typescript
// Theme settings admin panel — saves to DB, applied via NxThemeStyle RSC
interface ThemeSettingsPanel {
  // Color pickers for each semantic color
  // Font family selectors (Google Fonts + system fonts)
  // Radius/shadow sliders
  // Dark mode toggle + dark color overrides
  // Live preview (iframe with current site)
  // Export/import theme JSON
  // Reset to defaults
}

// Admin route: /admin/settings/theme
// Data flow:
// 1. Admin edits theme → saves to settings table (JSON)
// 2. Site layout RSC reads theme from DB → NxThemeStyle generates CSS
// 3. All pages get updated CSS vars on next request
// 4. For ISR pages: revalidateTag("nx:theme") triggers rebuild
```

### H.6 Default Theme

```typescript
export const DEFAULT_THEME: NxThemeTokens = {
  colors: {
    primary: "oklch(0.55 0.20 250)",
    primaryForeground: "oklch(0.98 0.00 0)",
    secondary: "oklch(0.75 0.05 250)",
    secondaryForeground: "oklch(0.15 0.02 260)",
    accent: "oklch(0.65 0.15 200)",
    accentForeground: "oklch(0.15 0.02 260)",
    background: "oklch(0.99 0.00 0)",
    foreground: "oklch(0.15 0.02 260)",
    muted: "oklch(0.95 0.01 260)",
    mutedForeground: "oklch(0.45 0.02 260)",
    border: "oklch(0.90 0.01 260)",
    input: "oklch(0.90 0.01 260)",
    ring: "oklch(0.55 0.20 250)",
    destructive: "oklch(0.55 0.25 25)",
    destructiveForeground: "oklch(0.98 0.00 0)",
    card: "oklch(0.99 0.00 0)",
    cardForeground: "oklch(0.15 0.02 260)",
  },
  typography: {
    headingFont: '"Inter", system-ui, sans-serif',
    bodyFont: '"Inter", system-ui, sans-serif',
    monoFont: '"JetBrains Mono", monospace',
    baseFontSize: "16px",
    lineHeight: "1.6",
    fontSizeScale: {
      sm: "0.875rem",
      base: "1rem",
      lg: "1.125rem",
      xl: "1.25rem",
      "2xl": "1.5rem",
      "3xl": "1.875rem",
      "4xl": "2.25rem",
    },
  },
  shape: {
    radiusSm: "0.25rem",
    radiusMd: "0.5rem",
    radiusLg: "0.75rem",
    radiusFull: "9999px",
    shadowSm: "0 1px 2px 0 rgb(0 0 0 / 0.05)",
    shadowMd: "0 4px 6px -1px rgb(0 0 0 / 0.1)",
    shadowLg: "0 10px 15px -3px rgb(0 0 0 / 0.1)",
  },
  darkMode: {
    enabled: true,
    colors: {
      background: "oklch(0.15 0.02 260)",
      foreground: "oklch(0.95 0.01 260)",
      muted: "oklch(0.25 0.02 260)",
      mutedForeground: "oklch(0.65 0.02 260)",
      border: "oklch(0.30 0.02 260)",
      input: "oklch(0.30 0.02 260)",
      card: "oklch(0.18 0.02 260)",
      cardForeground: "oklch(0.95 0.01 260)",
    },
  },
};
```

---

## I. Agent Interface

### I.1 nexpress.config.json — Declarative Site Configuration

```typescript
/**
 * Complete site configuration — exportable/importable as a single JSON file.
 * An AI agent can generate this to assemble an entire site.
 *
 * This is intentionally distinct from the code-first runtime config. Runtime
 * collection config may contain executable callbacks for access control, hooks,
 * validators, admin conditions, and custom components; the site config format
 * is JSON-safe and may only contain serializable data.
 */
export interface NxSiteConfig {
  /** Config format version */
  version: "1.0";

  /** Site metadata */
  site: {
    name: string;
    description: string;
    url: string;
    locale: string;
    favicon?: string;
  };

  /** Theme tokens */
  theme: NxThemeTokens;

  /** Collections (JSON-safe content model definitions) */
  collections: NxCollectionSpec[];

  /** Pages (block tree structures) */
  pages: Array<{
    slug: string;
    title: string;
    blocks: NxBlockInstance[];
    seo?: { title: string; description: string; ogImage?: string };
  }>;

  /** Navigation menus */
  navigation: {
    header: NxNavItem[];
    footer: NxNavItem[];
  };

  /** Active plugins and their configs */
  plugins: Array<{
    id: string;
    enabled: boolean;
    config: Record<string, unknown>;
  }>;

  /** Site settings */
  settings: {
    postsPerPage: number;
    dateFormat: string;
    commentSystem?: "none" | "builtin" | "disqus";
    analytics?: { provider: string; trackingId: string };
  };
}

export interface NxNavItem {
  label: string;
  href: string;
  children?: NxNavItem[];
}

export interface NxCollectionSpec {
  slug: string;
  labels: { singular: string; plural: string };
  description?: string;
  fields: NxFieldSchema[];
  timestamps?: boolean;
  drafts?: boolean;
  upload?: NxUploadSpec;
  admin?: {
    group?: string;
    defaultColumns?: string[];
  };
}

export interface NxUploadSpec {
  mimeTypes?: string[];
  maxFileSize?: number;
  imageSizes?: Array<{
    name: string;
    width: number;
    height?: number;
    format?: "webp" | "avif" | "jpeg" | "png";
  }>;
}

// Code-only behavior is omitted from NxSiteConfig exports. Importers can map
// NxCollectionSpec to defineCollection() defaults, but executable policies must
// be supplied by project code or plugin code.
```

### I.2 Block/Plugin Manifest API

```typescript
// GET /api/manifest/blocks
// Returns all registered blocks with JSON Schema for props
export interface BlockManifestResponse {
  blocks: Array<{
    type: string;
    label: string;
    description: string; // Natural language for AI agents
    propsSchema: object; // JSON Schema
    defaultProps: Record<string, unknown>;
    thumbnail?: string;
    pluginId?: string; // Which plugin provides this block
    usesTokens: string[]; // Design tokens used
    category: string; // "hero" | "content" | "navigation" | "media" | etc.
  }>;
}

// GET /api/manifest/collections
// Returns all collections with field schemas
export interface CollectionManifestResponse {
  collections: Array<{
    slug: string;
    labels: { singular: string; plural: string };
    description: string;
    fields: NxFieldSchema[]; // Full field descriptions
    access: { create: boolean; read: boolean; update: boolean; delete: boolean };
    timestamps: boolean;
    drafts: boolean;
  }>;
}

// GET /api/manifest/plugins
export interface PluginManifestResponse {
  plugins: Array<{
    id: string;
    name: string;
    description: string;
    agent: { description: string; category: string; tags: string[] };
    capabilities: string[];
    provides: { blocks: string[]; fields: string[]; hooks: string[] };
    configSchema?: object;
  }>;
}
```

### I.3 OpenAPI Spec Auto-generation

```typescript
/**
 * NexPress auto-generates OpenAPI 3.1 spec from:
 * 1. Collection definitions → CRUD endpoints
 * 2. Plugin routes → custom endpoints
 * 3. Core APIs (auth, media, settings, manifest)
 *
 * Available at: GET /api/openapi.json
 */

// Generated endpoints per collection:
// GET    /api/collections/{slug}         — List/query
// POST   /api/collections/{slug}         — Create
// GET    /api/collections/{slug}/{id}    — Get one
// PATCH  /api/collections/{slug}/{id}    — Update
// DELETE /api/collections/{slug}/{id}    — Delete

// Core endpoints:
// POST   /api/auth/login                 — Login
// POST   /api/auth/logout                — Logout
// POST   /api/auth/refresh               — Refresh access token (rotation)
// GET    /api/auth/me                    — Current user
// PATCH  /api/auth/change-password       — Change password (invalidates all sessions)
// POST   /api/media/upload               — Upload file
// GET    /api/media                      — List media
// GET    /api/settings                   — Get site settings
// PUT    /api/settings                   — Update site settings
// GET    /api/manifest/blocks            — Block manifest
// GET    /api/manifest/collections       — Collection manifest
// GET    /api/manifest/plugins           — Plugin manifest
// POST   /api/import                     — Import site config
// GET    /api/export                     — Export site config
```

### I.4 Import/Export API

```typescript
// ═══════════════════════════════════════════════════════
// POST /api/import
// Body: NxSiteConfig JSON
// Auth: Tier 2 (requireAuth), role: admin only
// Rate limit: 5 requests / minute
// ═══════════════════════════════════════════════════════

// ── Phase 0: Preflight Validation ────────────────────
// Before any writes, the import endpoint validates compatibility
// with the running NexPress instance:
//
// 0a. Parse body against NxSiteConfig Zod schema → 400 if invalid
// 0b. Check all referenced collection slugs exist in nexpress.config.ts
//     → Report unrecognized slugs in response.skipped[]
// 0c. For each page: validate that referenced block types exist
//     in the registered block registry
// 0d. For relationships: verify target collection exists
//     → Fail fast with detailed report, NOT partial writes
//
// If preflight finds ANY structural incompatibility (missing collection,
// unknown block type), the entire import is rejected with 422:
// { error: { code: "IMPORT_PREFLIGHT_FAILED", details: [...incompatibilities] } }

// ── Phase 1: ID Mapping ─────────────────────────────
// UUIDs from the source environment will collide with the target.
// Strategy: slug-based upsert (NOT UUID-based).
//
// - Pages:        upsert by slug (unique per site)
// - Navigation:   upsert by key (e.g., "main", "footer")
// - Settings:     upsert by key
// - Plugin config: upsert by pluginId
// - Theme:        overwrite (single record)
//
// Source UUIDs in the payload are IGNORED for primary keys.
// New UUIDs are generated on create, existing records matched by slug/key.
//
// Relationship references in page block data:
// - Media refs: matched by filename + hash (not UUID)
// - Collection doc refs: matched by slug (if available) or SKIPPED with warning
// - Unresolvable refs are nullified and reported in response.warnings[]

// ── Phase 2: Media Handling ──────────────────────────
// Import payload contains media REFERENCES only (not binary files).
// Each media reference includes: { filename, hash, mimeType, altText }.
//
// Resolution strategy:
// a. Match by sha256 hash in nx_media → reuse existing media
// b. If no match by hash, match by filename → reuse with WARNING
// c. If no match at all → nullify the reference, add to response.warnings[]
//
// Binary media import is NOT supported via this endpoint.
// For full site migration including media files, use CLI:
//   nexpress import --file site-export.json --media ./media-dump/

// ── Phase 3: Transactional Write ─────────────────────
// ALL writes happen in a SINGLE database transaction.
// If any step fails, the ENTIRE import rolls back.
//
// Write order (inside transaction):
// 1. Theme tokens → nx_settings
// 2. Site settings → nx_settings
// 3. Navigation items → nx_navigation (delete + insert)
// 4. Plugin configs → nx_plugins (upsert by pluginId)
// 5. Pages with blocks → nx_c_pages (upsert by slug)
//    - For each page, update nxMediaRefs tracking
//
// Returns: {
//   success: boolean;
//   created: number;
//   updated: number;
//   skipped: string[];     // Pages/items referencing unknown blocks/collections
//   warnings: string[];    // Non-fatal: unresolved media refs, slug mismatches
//   errors: string[];      // Only populated if success: false
// }

// ── Idempotency ──────────────────────────────────────
// The import is idempotent: running the same payload twice produces
// the same result (slug-based upsert). No duplicate records created.
// This enables safe retry on network failure.

// GET /api/export
// Auth: Tier 2 (requireAuth), role: admin only
// Returns: Complete NxSiteConfig JSON for the current site
// Includes: collection schemas (read-only reference), pages (with blocks),
//           theme, navigation, plugin configs, settings
// Excludes: User data, media binaries (references with hash only), secrets/API keys
// Media references include { id, filename, hash, mimeType } for import matching
```

---

## J. CLI & Project Structure

### J.1 create-nexpress CLI

```bash
# Installation:
npx create-nexpress my-site

# Interactive prompts:
# ✓ Project name: my-site
# ✓ Database: PostgreSQL (local Docker) / PostgreSQL (remote URL)
# ✓ Storage: Local filesystem / S3 / MinIO
# ✓ Include example content? Yes / No
# ✓ Docker setup? Yes / No
# ✓ Package manager: pnpm / npm / yarn
```

**Scaffolded structure**:

```
my-site/
├── src/
│   ├── collections/
│   │   ├── Posts.ts          # defineCollection({ slug: "posts", ... })
│   │   ├── Pages.ts          # defineCollection({ slug: "pages", ... })
│   │   ├── Users.ts          # defineCollection({ slug: "users", ... })
│   │   ├── Media.ts          # defineCollection({ slug: "media", ... })
│   │   └── Categories.ts
│   ├── blocks/
│   │   ├── Hero.tsx           # Default hero block
│   │   ├── FeatureGrid.tsx
│   │   ├── RichTextBlock.tsx
│   │   └── index.ts           # Block registry
│   ├── access/
│   │   ├── authenticated.ts   # Access control functions
│   │   └── roles.ts
│   ├── app/
│   │   ├── (site)/
│   │   │   ├── [...slug]/
│   │   │   │   └── page.tsx   # Catch-all site renderer
│   │   │   ├── blog/
│   │   │   │   ├── [slug]/
│   │   │   │   │   └── page.tsx
│   │   │   │   └── page.tsx
│   │   │   └── layout.tsx
│   │   ├── (admin)/
│   │   │   └── admin/
│   │   │       ├── [...path]/
│   │   │       │   └── page.tsx  # Admin catch-all
│   │   │       └── layout.tsx
│   │   ├── api/
│   │   │   ├── collections/
│   │   │   │   └── [...path]/
│   │   │   │       └── route.ts
│   │   │   ├── auth/
│   │   │   │   ├── login/route.ts
│   │   │   │   └── logout/route.ts
│   │   │   ├── media/
│   │   │   │   └── upload/route.ts
│   │   │   └── manifest/
│   │   │       └── [...path]/route.ts
│   │   ├── layout.tsx
│   │   └── globals.css
│   ├── nexpress.config.ts     # Main NexPress configuration
│   └── nexpress-types.ts       # Auto-generated types (gitignored)
├── public/
│   └── media/                 # Local media storage (dev)
├── docker/
│   ├── Dockerfile
│   └── docker-compose.yml
├── drizzle/
│   └── migrations/            # Auto-generated Drizzle migrations
├── .env                       # DATABASE_URL, NX_SECRET, S3_*, etc.
├── .env.example
├── next.config.ts
├── tsconfig.json
├── tailwind.config.ts
├── package.json
└── README.md
```

### J.2 nexpress.config.ts (Main Configuration)

```typescript
// src/nexpress.config.ts
import { defineConfig } from "@nexpress/core";
import { Posts } from "./collections/Posts";
import { Pages } from "./collections/Pages";
import { Users } from "./collections/Users";
import { Media } from "./collections/Media";
import { Categories } from "./collections/Categories";
import { Hero, FeatureGrid, RichTextBlock } from "./blocks";

export default defineConfig({
  /** Site metadata */
  site: {
    name: "My Site",
    url: process.env.SITE_URL || "http://localhost:3000",
  },

  /** Database */
  db: {
    connectionString: process.env.DATABASE_URL!,
    // Drizzle options
    pool: { max: 10 },
  },

  /** Storage */
  storage: {
    adapter: "local", // or "s3"
    local: { directory: "./public/media", baseUrl: "/media" },
    // s3: { bucket: "...", region: "...", endpoint: "..." },
  },

  /** Collections */
  collections: [Posts, Pages, Users, Media, Categories],

  /** Blocks */
  blocks: [Hero, FeatureGrid, RichTextBlock],

  /** Editor configuration */
  editor: {
    features: [
      "heading",
      "bold",
      "italic",
      "link",
      "image",
      "list",
      "quote",
      "codeBlock",
      "blocks",
    ],
  },

  /** Image processing */
  images: {
    sizes: [
      { name: "thumbnail", width: 300 },
      { name: "small", width: 600 },
      { name: "medium", width: 900 },
      { name: "large", width: 1400 },
      { name: "og", width: 1200, height: 630, crop: "center" },
    ],
    format: "webp",
    quality: 85,
  },

  /** Authentication */
  auth: {
    secret: process.env.NX_SECRET!,
    tokenExpiration: 7200, // 2 hours
    refreshTokenExpiration: 2592000, // 30 days
    maxLoginAttempts: 5,
    lockoutDuration: 300, // 5 minutes
  },

  /** Plugins */
  plugins: [
    // nxSeoPlugin({ siteTitle: "My Site" }),
    // nxAnalyticsPlugin({ trackingId: "G-XXX" }),
  ],

  /** Type generation output */
  typescript: {
    outputFile: "./src/nexpress-types.ts",
  },
});
```

### J.3 Monorepo Structure (packages/)

```
nexpress/                          # The open-source project repo
├── packages/
│   ├── core/                      # @nexpress/core
│   │   ├── src/
│   │   │   ├── config/            # defineConfig, defineCollection
│   │   │   ├── db/                # Drizzle schema generation, migrations
│   │   │   ├── auth/              # JWT, bcrypt, RBAC, sessions
│   │   │   ├── collections/       # Collection runtime (CRUD, hooks, access)
│   │   │   ├── api/               # Route handler factories
│   │   │   ├── media/             # Upload, processing, storage adapters
│   │   │   ├── plugins/           # Plugin host, registry, bridge
│   │   │   └── types/             # Shared type definitions
│   │   └── package.json
│   │
│   ├── admin/                     # @nexpress/admin
│   │   ├── src/
│   │   │   ├── components/        # Admin UI components (shadcn/ui based)
│   │   │   │   ├── collections/   # List, Edit, Create views
│   │   │   │   ├── dashboard/     # Dashboard widgets
│   │   │   │   ├── media/         # Media library
│   │   │   │   ├── settings/      # Settings panels
│   │   │   │   └── layout/        # Admin layout, sidebar, topbar
│   │   │   ├── contexts/          # Auth context, config context
│   │   │   ├── hooks/             # Admin-specific React hooks
│   │   │   └── lib/               # Admin utilities
│   │   └── package.json
│   │
│   ├── editor/                    # @nexpress/editor
│   │   ├── src/
│   │   │   ├── rich-text/         # Lexical editor wrapper
│   │   │   ├── block-editor/      # Block page editor (dnd-kit)
│   │   │   ├── renderer/          # SSR rich text renderer
│   │   │   └── features/          # Lexical feature plugins
│   │   └── package.json
│   │
│   ├── blocks/                    # @nexpress/blocks
│   │   ├── src/
│   │   │   ├── Hero.tsx
│   │   │   ├── FeatureGrid.tsx
│   │   │   ├── FAQ.tsx
│   │   │   ├── Pricing.tsx
│   │   │   ├── CTA.tsx
│   │   │   ├── RichText.tsx
│   │   │   ├── ContactForm.tsx
│   │   │   └── ImageGallery.tsx
│   │   └── package.json
│   │
│   ├── theme/                     # @nexpress/theme
│   │   ├── src/
│   │   │   ├── ThemeProvider.tsx   # RSC theme CSS generator
│   │   │   ├── tokens.ts          # Default tokens
│   │   │   ├── base.css           # Base layer CSS
│   │   │   └── types.ts           # NxThemeTokens type
│   │   └── package.json
│   │
│   ├── plugin-sdk/                # @nexpress/plugin-sdk
│   │   ├── src/                   # (see plugin-system-design.md)
│   │   └── package.json
│   │
│   └── cli/                       # create-nexpress
│       ├── src/
│       │   ├── index.ts           # CLI entry
│       │   ├── prompts.ts         # Interactive prompts
│       │   ├── scaffold.ts        # File generation
│       │   └── templates/         # Template files
│       └── package.json
│
├── apps/
│   └── web/                       # Reference site (dog-food app)
│       ├── src/
│       │   ├── collections/
│       │   ├── blocks/
│       │   ├── app/
│       │   └── nexpress.config.ts
│       └── package.json
│
├── docker/
│   ├── Dockerfile
│   └── docker-compose.yml
├── turbo.json
├── pnpm-workspace.yaml
└── package.json
```

### J.4 Docker Configuration

```dockerfile
# docker/Dockerfile
FROM node:20-alpine AS base
RUN corepack enable pnpm

FROM base AS builder
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm build
# Generate Drizzle migrations
RUN pnpm db:generate

FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
# Required for isolated-vm (Stage 3 plugin sandbox)
ENV NODE_OPTIONS="--no-node-snapshot"

# Copy standalone output
COPY --from=builder /app/apps/web/.next/standalone ./
COPY --from=builder /app/apps/web/.next/static ./.next/static
COPY --from=builder /app/apps/web/public ./public
COPY --from=builder /app/drizzle ./drizzle

EXPOSE 3000
CMD ["node", "server.js"]
```

```yaml
# docker/docker-compose.yml
services:
  nexpress:
    build:
      context: ..
      dockerfile: docker/Dockerfile
    ports:
      - "3000:3000"
    environment:
      DATABASE_URL: postgres://nexpress:nexpress@db:5432/nexpress
      NX_SECRET: ${NX_SECRET:-change-me-in-production}
      SITE_URL: ${SITE_URL:-http://localhost:3000}
    depends_on:
      db:
        condition: service_healthy
    restart: unless-stopped

  db:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: nexpress
      POSTGRES_USER: nexpress
      POSTGRES_PASSWORD: nexpress
    volumes:
      - pgdata:/var/lib/postgresql/data
    ports:
      - "5432:5432"
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U nexpress"]
      interval: 5s
      timeout: 5s
      retries: 5

  # Optional: MinIO for S3-compatible storage
  minio:
    image: minio/minio
    command: server /data --console-address ":9001"
    environment:
      MINIO_ROOT_USER: nexpress
      MINIO_ROOT_PASSWORD: nexpress123
    ports:
      - "9000:9000"
      - "9001:9001"
    volumes:
      - minio-data:/data
    profiles:
      - s3

volumes:
  pgdata:
  minio-data:
```

### J.5 turbo.json

```json
{
  "$schema": "https://turbo.build/schema.json",
  "tasks": {
    "build": {
      "dependsOn": ["^build"],
      "outputs": [".next/**", "dist/**"]
    },
    "dev": {
      "cache": false,
      "persistent": true
    },
    "lint": {
      "dependsOn": ["^build"]
    },
    "test": {
      "dependsOn": ["^build"]
    },
    "db:generate": {
      "cache": false
    },
    "db:migrate": {
      "cache": false
    },
    "generate:types": {
      "dependsOn": ["^build"],
      "outputs": ["src/nexpress-types.ts"]
    }
  }
}
```

---

## A. Database Schema

### A.1 Architecture Decision

**Strategy: Generated Drizzle tables per collection.**

Collections are code-defined (static), not runtime-defined. This justifies paying the schema-generation cost because a CMS lives on filtering, sorting, relationships, slugs, publish states, uniqueness, and admin queries — all of which are dramatically better with normal SQL columns than JSONB.

JSONB is reserved for two use cases only:

1. **Revisions** — append-only history, queried by document ID / version, not cross-field.
2. **Opaque payloads** — Lexical rich text content, block page data, plugin settings — things you display but never filter/sort on.

**Migration flow:**

```
nexpress.config.ts (collection config)
  → pnpm db:generate (CLI step — deterministic codegen)
    → drizzle/schema.generated.ts (reviewable artifact, gitignored or committed per team choice)
      → drizzle-kit generate (diff against current DB)
        → drizzle/migrations/XXXX_migration.sql
          → pnpm db:migrate (apply on deploy)
```

### A.2 Table Naming & Conventions

```typescript
/**
 * All NexPress system tables use `nx_` prefix.
 * Generated collection tables use `nx_c_` prefix.
 * This avoids collisions with user's own tables.
 */

// System tables:     nx_users, nx_sessions, nx_settings, nx_media, nx_media_folders,
//                    nx_revisions, nx_navigation, nx_plugins
// Collection tables: nx_c_posts, nx_c_pages, nx_c_categories, nx_c_{slug}
// Join tables:       nx_c_{slug}__{field} (for array/repeatable fields)
```

### A.3 Common Column Pattern

Every generated collection table includes these system columns:

```typescript
import { uuid, timestamp, text, boolean, integer, pgTable } from "drizzle-orm/pg-core";

/**
 * Shared columns injected into every generated collection table.
 * User-defined fields are appended after these.
 */
function nxBaseColumns() {
  return {
    id: uuid("id").primaryKey().defaultRandom(),
    status: text("status", { enum: ["draft", "published", "archived"] })
      .notNull()
      .default("draft"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid("created_by").references(() => nxUsers.id),
    updatedBy: uuid("updated_by").references(() => nxUsers.id),
  };
}

// Collections with `slug` enabled also get:
//   slug: text("slug").notNull().unique(),
// Collections with `versions.drafts` enabled also get:
//   _status: text("_status", { enum: ["draft", "published"] }).notNull().default("draft"),
```

### A.4 Core System Tables

```typescript
// ─── Users ───────────────────────────────────────────────────────
export const nxUsers = pgTable("nx_users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  password: text("password").notNull(), // argon2 hash
  name: text("name").notNull(),
  role: text("role", { enum: ["admin", "editor", "author", "viewer"] })
    .notNull()
    .default("author"),
  avatar: uuid("avatar").references(() => nxMedia.id),
  loginAttempts: integer("login_attempts").notNull().default(0),
  lockUntil: timestamp("lock_until", { withTimezone: true }),
  tokenVersion: integer("token_version").notNull().default(0), // bump to invalidate all sessions
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// ─── Sessions ────────────────────────────────────────────────────
export const nxSessions = pgTable("nx_sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => nxUsers.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull(), // SHA-256 of the refresh token
  userAgent: text("user_agent"),
  ip: text("ip"),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ─── Revisions (single table, JSONB snapshots) ──────────────────
export const nxRevisions = pgTable(
  "nx_revisions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    collection: text("collection").notNull(), // e.g., "posts"
    documentId: uuid("document_id").notNull(), // FK to any collection's id
    version: integer("version").notNull(), // monotonically increasing per document
    status: text("status", { enum: ["draft", "published", "autosave"] }).notNull(),
    snapshot: jsonb("snapshot").notNull(), // full document JSON at this version
    changedFields: text("changed_fields").array(), // which fields changed from previous version
    authorId: uuid("author_id").references(() => nxUsers.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    docVersionIdx: uniqueIndex("nx_rev_doc_version").on(table.documentId, table.version),
    collectionIdx: index("nx_rev_collection").on(table.collection),
    docIdx: index("nx_rev_document").on(table.documentId),
  }),
);

// ─── Settings (key-value JSON store) ─────────────────────────────
export const nxSettings = pgTable("nx_settings", {
  key: text("key").primaryKey(), // e.g., "theme", "navigation", "site"
  value: jsonb("value").notNull(), // JSON blob
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  updatedBy: uuid("updated_by").references(() => nxUsers.id),
});

// ─── Navigation ──────────────────────────────────────────────────
export const nxNavigation = pgTable("nx_navigation", {
  id: uuid("id").primaryKey().defaultRandom(),
  location: text("location").notNull().unique(), // "header" | "footer" | custom
  items: jsonb("items").notNull().$type<NxNavItem[]>(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  updatedBy: uuid("updated_by").references(() => nxUsers.id),
});

// ─── Plugin State ────────────────────────────────────────────────
export const nxPlugins = pgTable("nx_plugins", {
  id: text("id").primaryKey(), // plugin manifest id
  enabled: boolean("enabled").notNull().default(true),
  config: jsonb("config").$type<Record<string, unknown>>(),
  installedAt: timestamp("installed_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// Media tables: see Section G.5 (nx_media, nx_media_folders)
```

### A.5 Generated Collection Table Example

Given this collection config:

```typescript
defineCollection({
  slug: "posts",
  labels: { singular: "Post", plural: "Posts" },
  slugField: true,
  versions: { drafts: true, max: 20 },
  fields: [
    { name: "title", type: "text", required: true, localized: false },
    { name: "excerpt", type: "textarea" },
    { name: "content", type: "richText" },
    { name: "coverImage", type: "upload", relationTo: "media" },
    { name: "author", type: "relationship", relationTo: "users" },
    { name: "categories", type: "relationship", relationTo: "categories", hasMany: true },
    { name: "tags", type: "array", fields: [{ name: "tag", type: "text" }] },
    { name: "publishedAt", type: "date" },
    { name: "featured", type: "checkbox", defaultValue: false },
    {
      name: "seo",
      type: "group",
      fields: [
        { name: "metaTitle", type: "text" },
        { name: "metaDescription", type: "textarea" },
        { name: "ogImage", type: "upload", relationTo: "media" },
      ],
    },
  ],
});
```

The generator produces:

```typescript
// drizzle/schema.generated.ts (auto-generated — do not edit manually)

export const nxCPosts = pgTable(
  "nx_c_posts",
  {
    // ── Base columns ──
    id: uuid("id").primaryKey().defaultRandom(),
    status: text("status", { enum: ["draft", "published", "archived"] })
      .notNull()
      .default("draft"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid("created_by").references(() => nxUsers.id),
    updatedBy: uuid("updated_by").references(() => nxUsers.id),
    slug: text("slug").notNull().unique(),
    _status: text("_status", { enum: ["draft", "published"] })
      .notNull()
      .default("draft"),

    // ── User-defined scalar fields ──
    title: text("title").notNull(),
    excerpt: text("excerpt"),
    content: jsonb("content").$type<NxRichTextContent>(), // opaque Lexical JSON
    coverImage: uuid("cover_image").references(() => nxMedia.id),
    author: uuid("author").references(() => nxUsers.id),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    featured: boolean("featured").notNull().default(false),

    // ── Group fields (flattened with prefix) ──
    seoMetaTitle: text("seo_meta_title"),
    seoMetaDescription: text("seo_meta_description"),
    seoOgImage: uuid("seo_og_image").references(() => nxMedia.id),
  },
  (table) => ({
    statusIdx: index("nx_c_posts_status").on(table.status),
    slugIdx: index("nx_c_posts_slug").on(table.slug),
    publishedAtIdx: index("nx_c_posts_published_at").on(table.publishedAt),
    featuredIdx: index("nx_c_posts_featured").on(table.featured),
  }),
);

// ── Many-to-many: posts ↔ categories ──
export const nxCPostsCategories = pgTable(
  "nx_c_posts__categories",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    postId: uuid("post_id")
      .notNull()
      .references(() => nxCPosts.id, { onDelete: "cascade" }),
    categoryId: uuid("category_id")
      .notNull()
      .references(() => nxCCategories.id, { onDelete: "cascade" }),
    order: integer("order").notNull().default(0),
  },
  (table) => ({
    postIdx: index("nx_c_posts__categories_post").on(table.postId),
    uniqueRel: uniqueIndex("nx_c_posts__categories_unique").on(table.postId, table.categoryId),
  }),
);

// ── Array field: posts.tags ──
export const nxCPostsTags = pgTable(
  "nx_c_posts__tags",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    parentId: uuid("parent_id")
      .notNull()
      .references(() => nxCPosts.id, { onDelete: "cascade" }),
    order: integer("order").notNull().default(0),
    tag: text("tag"),
  },
  (table) => ({
    parentIdx: index("nx_c_posts__tags_parent").on(table.parentId),
  }),
);

// ── Drizzle relations ──
export const nxCPostsRelations = relations(nxCPosts, ({ one, many }) => ({
  coverImageRel: one(nxMedia, { fields: [nxCPosts.coverImage], references: [nxMedia.id] }),
  authorRel: one(nxUsers, { fields: [nxCPosts.author], references: [nxUsers.id] }),
  categories: many(nxCPostsCategories),
  tags: many(nxCPostsTags),
}));
```

### A.6 Field Type → Column Type Mapping

| Collection Field Type    | Drizzle Column Type                   | Notes                          |
| ------------------------ | ------------------------------------- | ------------------------------ |
| `text`                   | `text()`                              |                                |
| `textarea`               | `text()`                              |                                |
| `number`                 | `doublePrecision()` or `integer()`    | Based on `integerOnly` flag    |
| `richText`               | `jsonb().$type<NxRichTextContent>()`  | Opaque Lexical JSON            |
| `blocks`                 | `jsonb().$type<NxBlockInstance[]>()`  | Opaque block array             |
| `checkbox`               | `boolean()`                           |                                |
| `date`                   | `timestamp({ withTimezone: true })`   |                                |
| `upload`                 | `uuid().references(() => nxMedia.id)` | FK to media                    |
| `relationship` (hasOne)  | `uuid().references(() => target.id)`  | FK to target collection        |
| `relationship` (hasMany) | join table `{slug}__{field}`          | Separate table                 |
| `select`                 | `text({ enum: [...] })`               | Drizzle pgEnum for reuse       |
| `radio`                  | `text({ enum: [...] })`               | Same as select                 |
| `email`                  | `text()`                              | Validated at application layer |
| `json`                   | `jsonb()`                             | Arbitrary JSON                 |
| `array`                  | child table `{slug}__{field}`         | Repeatable rows                |
| `group`                  | prefix-flattened columns              | `{groupName}{FieldName}`       |
| `row` / `collapsible`    | N/A (layout only)                     | No DB representation           |

---

## B. Content Modeling System

### B.1 Overview

Collection config is the **single source of truth** for the entire CMS. It drives:

1. Database schema generation (Section A)
2. Admin UI form rendering (Section E)
3. API endpoint behavior (Section I)
4. Validation rules
5. Access control
6. Type generation

### B.2 defineCollection() API

```typescript
import { z } from "zod";

/**
 * Core collection config — the primary authoring surface.
 * Everything else (DB, forms, API) is derived from this.
 */
export interface NxCollectionConfig {
  /** URL-safe identifier. Becomes table name: nx_c_{slug} */
  slug: string;

  /** Human-readable labels */
  labels: { singular: string; plural: string };

  /** Enable URL slug field */
  slugField?:
    | boolean
    | {
        /** Field to generate slug from */
        useField?: string; // default: "title"
        /** Unique within collection */
        unique?: boolean; // default: true
      };

  /** Field definitions */
  fields: NxFieldConfig[];

  /** Access control */
  access?: {
    create?: NxAccessFunction;
    read?: NxAccessFunction;
    update?: NxAccessFunction;
    delete?: NxAccessFunction;
  };

  /** Hooks */
  hooks?: {
    beforeCreate?: NxCollectionHook[];
    afterCreate?: NxCollectionHook[];
    beforeUpdate?: NxCollectionHook[];
    afterUpdate?: NxCollectionHook[];
    beforeDelete?: NxCollectionHook[];
    afterDelete?: NxCollectionHook[];
    beforeRead?: NxCollectionHook[];
    afterRead?: NxCollectionHook[];
  };

  /** Versioning / drafts */
  versions?: {
    drafts?: boolean | { autosave?: boolean; autosaveInterval?: number };
    /** Max versions to retain per document (0 = unlimited) */
    max?: number;
  };

  /** Timestamps (createdAt, updatedAt) — default: true */
  timestamps?: boolean;

  /** Admin UI overrides */
  admin?: {
    /** Default columns in list view */
    listColumns?: string[];
    /** Default sort field */
    defaultSort?: string;
    /** Group in sidebar */
    group?: string;
    /** Hide from sidebar */
    hidden?: boolean;
    /** Custom description */
    description?: string;
    /** Use custom list/edit components (path string references) */
    components?: {
      listView?: string; // e.g., "@/components/PostListView"
      editView?: string;
      createView?: string;
    };
  };

  /** Enable upload behavior (makes this a media collection) */
  upload?: NxUploadConfig;
}

/**
 * Type-safe collection definition.
 */
export function defineCollection(config: NxCollectionConfig): NxCollectionConfig {
  // Validate at build time via Zod (see B.4)
  return config;
}
```

### B.3 Field Types

```typescript
/**
 * Field config — exhaustive union of all supported field types.
 */
export type NxFieldConfig =
  | NxTextField
  | NxTextareaField
  | NxNumberField
  | NxRichTextField
  | NxBlocksField
  | NxCheckboxField
  | NxDateField
  | NxUploadField
  | NxRelationshipField
  | NxSelectField
  | NxRadioField
  | NxEmailField
  | NxJsonField
  | NxArrayField
  | NxGroupField
  | NxRowField
  | NxCollapsibleField;

/**
 * Base properties shared by all field types.
 */
interface NxFieldBase {
  name: string;
  label?: string; // defaults to titleCase(name)
  required?: boolean;
  defaultValue?: unknown;
  hidden?: boolean; // hide from admin UI
  admin?: {
    description?: string;
    placeholder?: string;
    readOnly?: boolean;
    condition?: NxFieldCondition; // show/hide based on sibling values
    width?: string; // CSS width in form grid
  };
  validate?: NxFieldValidator;
}

interface NxTextField extends NxFieldBase {
  type: "text";
  minLength?: number;
  maxLength?: number;
  unique?: boolean;
}

interface NxTextareaField extends NxFieldBase {
  type: "textarea";
  minLength?: number;
  maxLength?: number;
  rows?: number;
}

interface NxNumberField extends NxFieldBase {
  type: "number";
  min?: number;
  max?: number;
  step?: number;
  integerOnly?: boolean;
}

interface NxRichTextField extends NxFieldBase {
  type: "richText";
  editor?: NxEditorConfig;
}

interface NxBlocksField extends NxFieldBase {
  type: "blocks";
  allowedBlocks?: string[]; // block type names, or all if omitted
  minRows?: number;
  maxRows?: number;
}

interface NxCheckboxField extends NxFieldBase {
  type: "checkbox";
  defaultValue?: boolean;
}

interface NxDateField extends NxFieldBase {
  type: "date";
  /** Admin UI date picker config */
  pickerOptions?: {
    format?: string;
    includeTime?: boolean;
  };
}

interface NxUploadField extends NxFieldBase {
  type: "upload";
  relationTo: string; // slug of a collection with upload: true
}

interface NxRelationshipField extends NxFieldBase {
  type: "relationship";
  relationTo: string | string[]; // single or polymorphic
  hasMany?: boolean;
  /** Restrict selectable documents */
  filterOptions?: Record<string, unknown>;
}

interface NxSelectField extends NxFieldBase {
  type: "select";
  options: Array<{ label: string; value: string }>;
  hasMany?: boolean;
}

interface NxRadioField extends NxFieldBase {
  type: "radio";
  options: Array<{ label: string; value: string }>;
}

interface NxEmailField extends NxFieldBase {
  type: "email";
}

interface NxJsonField extends NxFieldBase {
  type: "json";
}

interface NxArrayField extends NxFieldBase {
  type: "array";
  fields: NxFieldConfig[]; // sub-fields for each row
  minRows?: number;
  maxRows?: number;
}

interface NxGroupField extends NxFieldBase {
  type: "group";
  fields: NxFieldConfig[]; // flattened into parent table with prefix
}

interface NxRowField {
  type: "row";
  fields: NxFieldConfig[]; // layout-only: side-by-side fields
}

interface NxCollapsibleField {
  type: "collapsible";
  label: string;
  fields: NxFieldConfig[]; // layout-only: collapsible section
}
```

### B.4 Config Validation (Build-time)

```typescript
/**
 * Zod schema for collection config validation.
 * Runs at build time during schema generation.
 * Catches config errors before they hit the DB.
 */
export const collectionConfigSchema = z.object({
  slug: z
    .string()
    .min(1)
    .max(63) // PostgreSQL identifier limit
    .regex(/^[a-z][a-z0-9-]*$/, "Slug must be lowercase alphanumeric with hyphens"),
  labels: z.object({
    singular: z.string().min(1),
    plural: z.string().min(1),
  }),
  fields: z.array(fieldConfigSchema).min(1),
  // ...rest of config validated similarly
});

// Validation errors are surfaced by the CLI:
// $ pnpm db:generate
// ✗ Collection "posts": field "title" — maxLength (5) is less than minLength (10)
// ✗ Collection "events": field "location" — relationship target "venues" does not exist
// ✗ Collection "products": slug "products" conflicts with reserved name
```

### B.5 Schema Generation Pipeline

```typescript
/**
 * packages/core/src/db/generator.ts
 *
 * Deterministic: same config always produces same output.
 * Pure function: no side effects, no DB access.
 */
export function generateDrizzleSchema(collections: NxCollectionConfig[]): GeneratedSchema {
  const tables: TableDefinition[] = [];
  const relations: RelationDefinition[] = [];

  for (const collection of collections) {
    // 1. Validate config
    const parsed = collectionConfigSchema.parse(collection);

    // 2. Generate primary table
    const primaryTable = generatePrimaryTable(parsed);
    tables.push(primaryTable);

    // 3. Generate child tables (array fields, hasMany relationships)
    for (const field of parsed.fields) {
      if (field.type === "array") {
        tables.push(generateArrayTable(parsed.slug, field));
      }
      if (field.type === "relationship" && field.hasMany) {
        tables.push(generateJoinTable(parsed.slug, field));
      }
    }

    // 4. Generate Drizzle relation definitions
    relations.push(generateRelations(parsed));
  }

  return { tables, relations };
}

/**
 * CLI command that writes the generated schema to disk.
 */
// packages/cli/src/commands/db-generate.ts
// 1. Load nexpress.config.ts
// 2. Call generateDrizzleSchema(config.collections)
// 3. Write to drizzle/schema.generated.ts
// 4. Run drizzle-kit generate to create SQL migration
// 5. Print summary: "Generated 5 tables, 3 join tables, 1 migration file"
```

### B.6 Type Generation

```typescript
/**
 * Auto-generates TypeScript types from collection config.
 * Output: src/nexpress-types.ts
 *
 * Developer can import these for type-safe data access.
 */

// Generated output example:
export interface Post {
  id: string;
  status: "draft" | "published" | "archived";
  slug: string;
  title: string;
  excerpt: string | null;
  content: NxRichTextContent | null;
  coverImage: string | null; // media ID
  author: string | null; // user ID
  categories: string[]; // category IDs
  tags: Array<{ tag: string | null }>;
  publishedAt: Date | null;
  featured: boolean;
  seo: {
    metaTitle: string | null;
    metaDescription: string | null;
    ogImage: string | null;
  };
  createdAt: Date;
  updatedAt: Date;
  createdBy: string | null;
  updatedBy: string | null;
}

// Usage:
// import type { Post, Page, Category } from "@/nexpress-types";
// const posts: Post[] = await nx.find("posts", { where: { featured: true } });
```

---

## C. Authentication & Authorization

### C.1 Architecture Decision

**Self-implemented auth** with `jose` (JWT in httpOnly cookies) + `argon2` password hashing.

Rationale: For a self-hosted CMS admin, local auth is the right default. It's simpler to reason about, easier to secure for this exact use case, and avoids coupling the CMS auth model to Auth.js abstractions before OAuth/SSO is actually needed.

**Escalation trigger**: Revisit when enterprise OAuth/SSO becomes a first-class product requirement.

### C.2 Auth Flow

```
┌─────────┐   POST /api/auth/login   ┌──────────┐
│  Admin   │─────────────────────────▶│  Server   │
│  Login   │  { email, password }     │  Handler  │
│  Form    │                          │           │
│          │◀─────────────────────────│  1. Verify password (argon2)
│          │  Set-Cookie:             │  2. Check lockout
│          │    nx-session=<JWT>      │  3. Create session record
│          │    HttpOnly; Secure;     │  4. Sign JWT (jose)
│          │    SameSite=Lax;         │  5. Set httpOnly cookie
│          │    Path=/;               │  6. Return user info
│          │    Max-Age=7200          │
└─────────┘                          └──────────┘

Subsequent requests:
┌─────────┐   Any /admin/* or /api/* request   ┌──────────────┐
│  Browser │──────────────────────────────────▶│  Middleware   │
│          │  Cookie: nx-session=<JWT>          │  (Tier 1)    │
│          │                                    │              │
│          │                                    │  1. Extract JWT from cookie
│          │                                    │  2. Verify signature + expiration (jose)
│          │                                    │  3. Attach decoded payload to headers
│          │                                    │  4. Continue to handler
│          │                                    │  (NO DB query — see C.12 for tier details)
└─────────┘                                    └──────────────┘
```

### C.3 Token Design

```typescript
import * as jose from "jose";

/**
 * JWT payload stored in the httpOnly cookie.
 * Short-lived (2h default). Refresh via session table.
 */
export interface NxTokenPayload {
  /** User ID */
  sub: string;
  /** User role */
  role: NxUserRole;
  /** Token version (for server-side invalidation) */
  ver: number;
  /** Issued at */
  iat: number;
  /** Expiration */
  exp: number;
}

export type NxUserRole = "admin" | "editor" | "author" | "viewer";

/**
 * Sign a new access token.
 */
export async function signToken(
  user: { id: string; role: NxUserRole; tokenVersion: number },
  secret: string,
  expirationSeconds: number = 7200,
): Promise<string> {
  const secretKey = new TextEncoder().encode(secret);
  return new jose.SignJWT({
    sub: user.id,
    role: user.role,
    ver: user.tokenVersion,
  } satisfies Omit<NxTokenPayload, "iat" | "exp">)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${expirationSeconds}s`)
    .sign(secretKey);
}

/**
 * Verify and decode a token.
 */
export async function verifyToken(token: string, secret: string): Promise<NxTokenPayload> {
  const secretKey = new TextEncoder().encode(secret);
  const { payload } = await jose.jwtVerify(token, secretKey);
  return payload as unknown as NxTokenPayload;
}
```

### C.4 Password Handling

```typescript
import { hash, verify } from "@node-rs/argon2";

/**
 * Argon2id configuration — OWASP recommended defaults.
 */
const ARGON2_OPTIONS = {
  memoryCost: 19456, // 19 MiB
  timeCost: 2,
  outputLen: 32,
  parallelism: 1,
} as const;

export async function hashPassword(password: string): Promise<string> {
  return hash(password, ARGON2_OPTIONS);
}

export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  return verify(hash, password, ARGON2_OPTIONS);
}
```

### C.5 Login / Logout Handlers

```typescript
// app/api/auth/login/route.ts
export async function POST(request: NextRequest) {
  const { email, password } = await request.json();

  // 1. Find user
  const user = await db.query.nxUsers.findFirst({ where: eq(nxUsers.email, email) });
  if (!user) return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });

  // 2. Check lockout
  if (user.lockUntil && user.lockUntil > new Date()) {
    return NextResponse.json({ error: "Account locked. Try again later." }, { status: 429 });
  }

  // 3. Verify password
  const valid = await verifyPassword(user.password, password);
  if (!valid) {
    // Increment login attempts
    const attempts = user.loginAttempts + 1;
    const lockUntil =
      attempts >= MAX_LOGIN_ATTEMPTS ? new Date(Date.now() + LOCKOUT_DURATION_MS) : null;
    await db
      .update(nxUsers)
      .set({ loginAttempts: attempts, lockUntil })
      .where(eq(nxUsers.id, user.id));
    return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
  }

  // 4. Reset login attempts on success
  await db
    .update(nxUsers)
    .set({ loginAttempts: 0, lockUntil: null })
    .where(eq(nxUsers.id, user.id));

  // 5. Create session record
  const refreshToken = crypto.randomUUID();
  await db.insert(nxSessions).values({
    userId: user.id,
    tokenHash: await sha256(refreshToken),
    userAgent: request.headers.get("user-agent"),
    ip: request.headers.get("x-forwarded-for"),
    expiresAt: new Date(Date.now() + REFRESH_TOKEN_EXPIRATION_MS),
  });

  // 6. Sign JWT
  const token = await signToken(user, process.env.NX_SECRET!);

  // 7. Set cookie and return
  const response = NextResponse.json({
    user: { id: user.id, email: user.email, name: user.name, role: user.role },
  });
  response.cookies.set("nx-session", token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 7200,
  });
  response.cookies.set("nx-refresh", refreshToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/api/auth",
    maxAge: 2592000, // 30 days
  });
  return response;
}

// app/api/auth/logout/route.ts
export async function POST(request: NextRequest) {
  const refreshToken = request.cookies.get("nx-refresh")?.value;
  if (refreshToken) {
    // Delete session from DB
    await db.delete(nxSessions).where(eq(nxSessions.tokenHash, await sha256(refreshToken)));
  }

  const response = NextResponse.json({ success: true });
  response.cookies.delete("nx-session");
  response.cookies.delete("nx-refresh");
  return response;
}
```

### C.6 Auth Middleware

```typescript
// packages/core/src/auth/middleware.ts
import { NextRequest, NextResponse } from "next/server";

/**
 * Next.js middleware for auth-protected routes.
 * Runs on edge — lightweight JWT verification only.
 */
export async function nxAuthMiddleware(request: NextRequest): Promise<NextResponse | null> {
  const token = request.cookies.get("nx-session")?.value;
  if (!token) return redirectToLogin(request);

  try {
    const payload = await verifyToken(token, process.env.NX_SECRET!);

    // Inject user info into request headers for downstream handlers
    const headers = new Headers(request.headers);
    headers.set("x-nx-user-id", payload.sub);
    headers.set("x-nx-user-role", payload.role);

    return NextResponse.next({ request: { headers } });
  } catch {
    // Token expired or invalid — try refresh
    return redirectToLogin(request);
  }
}

function redirectToLogin(request: NextRequest): NextResponse {
  const loginUrl = new URL("/admin/login", request.url);
  loginUrl.searchParams.set("redirect", request.nextUrl.pathname);
  return NextResponse.redirect(loginUrl);
}
```

### C.7 Role-Based Access Control (RBAC)

```typescript
/**
 * Access control function signature.
 * Returns true to allow, false to deny.
 */
export type NxAccessFunction = (args: {
  user: NxAuthUser | null;
  /** The document being accessed (for update/delete) */
  doc?: Record<string, unknown>;
  /** The request data (for create) */
  data?: Record<string, unknown>;
}) => boolean | Promise<boolean>;

/**
 * Built-in access control helpers.
 */

/** Only authenticated users */
export const authenticated: NxAccessFunction = ({ user }) => !!user;

/** Only admins */
export const isAdmin: NxAccessFunction = ({ user }) => user?.role === "admin";

/** Admins or editors */
export const isEditorOrAbove: NxAccessFunction = ({ user }) =>
  !!user && ["admin", "editor"].includes(user.role);

/** Owner or admin */
export const isOwnerOrAdmin: NxAccessFunction = ({ user, doc }) =>
  user?.role === "admin" || doc?.createdBy === user?.id;

// Usage in collection config:
defineCollection({
  slug: "posts",
  access: {
    create: isEditorOrAbove,
    read: () => true, // Public read
    update: isOwnerOrAdmin,
    delete: isAdmin,
  },
  fields: [
    /* ... */
  ],
});

/**
 * Role hierarchy for permission checks.
 */
export const ROLE_HIERARCHY: Record<NxUserRole, number> = {
  viewer: 0,
  author: 1,
  editor: 2,
  admin: 3,
};

/** Check if user has at least the given role level */
export function hasRole(user: NxAuthUser, minRole: NxUserRole): boolean {
  return ROLE_HIERARCHY[user.role] >= ROLE_HIERARCHY[minRole];
}
```

### C.8 Server-Side Invalidation

```typescript
/**
 * Invalidate all sessions for a user by bumping tokenVersion.
 * Used when: password change, role change, admin force-logout.
 */
export async function invalidateAllSessions(userId: string): Promise<void> {
  await db.transaction(async (tx) => {
    // 1. Bump token version — makes all existing JWTs invalid
    await tx
      .update(nxUsers)
      .set({ tokenVersion: sql`${nxUsers.tokenVersion} + 1` })
      .where(eq(nxUsers.id, userId));

    // 2. Delete all session records
    await tx.delete(nxSessions).where(eq(nxSessions.userId, userId));
  });
}

/**
 * Full verification (used in API handlers, not middleware).
 * Checks tokenVersion against DB to catch invalidated tokens.
 */
export async function verifyTokenFull(token: string): Promise<NxAuthUser | null> {
  try {
    const payload = await verifyToken(token, process.env.NX_SECRET!);
    const user = await db.query.nxUsers.findFirst({
      where: eq(nxUsers.id, payload.sub),
      columns: { id: true, email: true, name: true, role: true, tokenVersion: true },
    });
    if (!user || user.tokenVersion !== payload.ver) return null;
    return user;
  } catch {
    return null;
  }
}
```

### C.9 Change Password Endpoint

```typescript
// app/api/auth/change-password/route.ts
export async function PATCH(request: NextRequest) {
  // 1. Verify current user
  const user = await verifyTokenFull(request.cookies.get("nx-session")?.value || "");
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { currentPassword, newPassword } = await request.json();

  // 2. Validate input
  if (!currentPassword || !newPassword || newPassword.length < 8) {
    return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  }

  // 3. Verify current password
  const fullUser = await db.query.nxUsers.findFirst({
    where: eq(nxUsers.id, user.id),
    columns: { id: true, password: true },
  });
  if (!fullUser) return NextResponse.json({ error: "User not found" }, { status: 404 });

  const valid = await verifyPassword(fullUser.password, currentPassword);
  if (!valid) return NextResponse.json({ error: "Current password is incorrect" }, { status: 401 });

  // 4. Hash new password and save
  const hashed = await hashPassword(newPassword);
  await db.update(nxUsers).set({ password: hashed }).where(eq(nxUsers.id, user.id));

  // 5. Invalidate all sessions (force re-login everywhere)
  await invalidateAllSessions(user.id);

  // 6. Create new session + sign new token for current session
  const updatedUser = await db.query.nxUsers.findFirst({
    where: eq(nxUsers.id, user.id),
    columns: { id: true, email: true, name: true, role: true, tokenVersion: true },
  });
  const token = await signToken(updatedUser!, process.env.NX_SECRET!);
  const refreshToken = crypto.randomUUID();
  await db.insert(nxSessions).values({
    userId: user.id,
    tokenHash: await sha256(refreshToken),
    userAgent: request.headers.get("user-agent"),
    ip: request.headers.get("x-forwarded-for"),
    expiresAt: new Date(Date.now() + REFRESH_TOKEN_EXPIRATION_MS),
  });

  const response = NextResponse.json({ success: true });
  response.cookies.set("nx-session", token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 7200,
  });
  response.cookies.set("nx-refresh", refreshToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/api/auth",
    maxAge: 2592000,
  });
  return response;
}
```

### C.10 Token Refresh Endpoint

```typescript
// app/api/auth/refresh/route.ts

/**
 * Consumes the nx-refresh cookie (UUID) to issue a new access token.
 * Implements refresh token rotation: old token is deleted, new one issued.
 */
export async function POST(request: NextRequest) {
  const refreshToken = request.cookies.get("nx-refresh")?.value;
  if (!refreshToken) {
    return NextResponse.json({ error: "No refresh token" }, { status: 401 });
  }

  const tokenHash = await sha256(refreshToken);

  // 1. Find and validate session
  const session = await db.query.nxSessions.findFirst({
    where: eq(nxSessions.tokenHash, tokenHash),
  });
  if (!session || session.expiresAt < new Date()) {
    // Invalid or expired — delete stale session if exists, clear cookies
    if (session) {
      await db.delete(nxSessions).where(eq(nxSessions.id, session.id));
    }
    const response = NextResponse.json({ error: "Session expired" }, { status: 401 });
    response.cookies.delete("nx-session");
    response.cookies.delete("nx-refresh");
    return response;
  }

  // 2. Load user and verify tokenVersion
  const user = await db.query.nxUsers.findFirst({
    where: eq(nxUsers.id, session.userId),
    columns: { id: true, email: true, name: true, role: true, tokenVersion: true },
  });
  if (!user) {
    await db.delete(nxSessions).where(eq(nxSessions.id, session.id));
    return NextResponse.json({ error: "User not found" }, { status: 401 });
  }

  // 3. Rotate refresh token (delete old, create new)
  const newRefreshToken = crypto.randomUUID();
  await db.transaction(async (tx) => {
    await tx.delete(nxSessions).where(eq(nxSessions.id, session.id));
    await tx.insert(nxSessions).values({
      userId: user.id,
      tokenHash: await sha256(newRefreshToken),
      userAgent: request.headers.get("user-agent"),
      ip: request.headers.get("x-forwarded-for"),
      expiresAt: new Date(Date.now() + REFRESH_TOKEN_EXPIRATION_MS),
    });
  });

  // 4. Issue new access token
  const token = await signToken(user, process.env.NX_SECRET!);

  const response = NextResponse.json({
    user: { id: user.id, email: user.email, name: user.name, role: user.role },
  });
  response.cookies.set("nx-session", token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 7200,
  });
  response.cookies.set("nx-refresh", newRefreshToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/api/auth",
    maxAge: 2592000,
  });
  return response;
}
```

### C.11 CSRF Protection

```typescript
/**
 * Cookie-based auth requires CSRF protection.
 * Strategy: double-submit cookie pattern.
 *
 * 1. On login, server sets a non-httpOnly CSRF cookie: `nx-csrf=<random>`
 * 2. Client reads this cookie and sends it as `X-CSRF-Token` header on mutations
 * 3. Server middleware compares cookie value to header value
 * 4. Mismatch → 403
 *
 * This works because:
 * - SameSite=Lax prevents cookie from being sent on cross-origin POST
 * - The CSRF token is NOT httpOnly, so JS can read it
 * - An attacker cannot read the cookie from another origin
 */

// In login/refresh handlers, add after setting session cookies:
response.cookies.set("nx-csrf", crypto.randomUUID(), {
  httpOnly: false, // JS must read this
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax",
  path: "/",
  maxAge: 2592000,
});

// Middleware check for mutation requests:
function verifyCsrf(request: NextRequest): boolean {
  if (["GET", "HEAD", "OPTIONS"].includes(request.method)) return true;
  const cookieToken = request.cookies.get("nx-csrf")?.value;
  const headerToken = request.headers.get("x-csrf-token");
  return !!cookieToken && cookieToken === headerToken;
}

// In nxAuthMiddleware, add before continuing:
// if (!verifyCsrf(request)) return NextResponse.json({ error: "CSRF validation failed" }, { status: 403 });
```

### C.12 Auth Verification Strategy

```
Three auth verification tiers, used in different contexts:

┌─────────────────────────────────────────────────────────────────────┐
│ Tier 1: Edge Middleware (fast, no DB)                               │
│ Used for: All /admin/* and /api/* routes                           │
│ Checks: JWT signature + expiration only                            │
│ Cost: ~0.1ms                                                       │
│ Gap: Up to 2h stale after invalidation. Acceptable because:        │
│   - Admin-only CMS, not public-facing auth                         │
│   - All mutations go through Tier 2 which catches invalidation     │
│   - Worst case: stale user sees admin pages but can't write        │
├─────────────────────────────────────────────────────────────────────┤
│ Tier 2: API Handler (full, with DB)                                │
│ Used for: All mutation endpoints (POST/PATCH/DELETE)                │
│ Checks: JWT signature + expiration + tokenVersion against DB       │
│ Cost: 1 SELECT query                                               │
│ Guarantee: No stale writes. Invalidated tokens rejected.           │
├─────────────────────────────────────────────────────────────────────┤
│ Tier 3: RSC Server Component                                       │
│ Used for: Admin pages that show user-specific data                 │
│ Checks: Same as Tier 2 (call verifyTokenFull)                      │
│ When: Only when the component needs the current user object        │
│ Note: Layout already gates on Tier 2; most child pages can trust   │
│       headers set by middleware                                    │
└─────────────────────────────────────────────────────────────────────┘

Auto-refresh flow (client-side):
1. Admin shell includes <AuthProvider> client component
2. AuthProvider sets a timer for (tokenExpiry - 5min)
3. On timer: POST /api/auth/refresh
4. On 401 from any fetch: attempt refresh once, then redirect to login
```

### C.13 End-to-End Auth Sequences

```
═══════════════════════════════════════════════════════════
  1. LOGIN
═══════════════════════════════════════════════════════════

  Client              Server (C.5)             DB
    │ POST /api/auth/login  │                    │
    │ {email, password}     │                    │
    │──────────────────────▶│                    │
    │                       │ findUser(email)    │
    │                       │───────────────────▶│
    │                       │◀───────────────────│ user row
    │                       │ verify argon2      │
    │                       │ check lockout      │
    │                       │ reset login_attempts│
    │                       │───────────────────▶│ UPDATE
    │                       │ insert nx_sessions │
    │                       │───────────────────▶│ INSERT (tokenHash, expiresAt)
    │                       │ signToken(user)    │
    │  Set-Cookie:          │                    │
    │    nx-session=<JWT>   │                    │
    │    nx-refresh=<UUID>  │                    │
    │    nx-csrf=<UUID>     │                    │
    │◀──────────────────────│                    │
    │  200 { user }         │                    │

═══════════════════════════════════════════════════════════
  2. AUTHENTICATED REQUEST (Read — Tier 1 only)
═══════════════════════════════════════════════════════════

  Client              Middleware (Tier 1)       API Handler
    │ GET /admin/...        │                    │
    │ Cookie: nx-session    │                    │
    │──────────────────────▶│                    │
    │                       │ verify JWT sig+exp │
    │                       │ (NO DB query)      │
    │                       │ attach payload to  │
    │                       │ x-nx-user header   │
    │                       │───────────────────▶│ render page
    │◀──────────────────────────────────────────│ 200

═══════════════════════════════════════════════════════════
  3. AUTHENTICATED REQUEST (Write — Tier 1 + Tier 2)
═══════════════════════════════════════════════════════════

  Client              Middleware (Tier 1)       API Handler (Tier 2)    DB
    │ POST /api/collections │                    │                      │
    │ Cookie: nx-session    │                    │                      │
    │ X-CSRF-Token: <csrf>  │                    │                      │
    │──────────────────────▶│                    │                      │
    │                       │ verify JWT sig+exp │                      │
    │                       │ verify CSRF match  │                      │
    │                       │───────────────────▶│                      │
    │                       │                    │ verifyTokenFull()    │
    │                       │                    │─────────────────────▶│ SELECT user
    │                       │                    │◀─────────────────────│ check tokenVersion
    │                       │                    │ saveDocument(...)    │
    │◀──────────────────────────────────────────│ 201 / 403 / 400     │

═══════════════════════════════════════════════════════════
  4. TOKEN REFRESH (C.10 — silent, before JWT expires)
═══════════════════════════════════════════════════════════

  Client (AuthProvider)   Server (C.10)            DB
    │ POST /api/auth/refresh │                      │
    │ Cookie: nx-refresh     │                      │
    │───────────────────────▶│                      │
    │                        │ sha256(refreshToken) │
    │                        │ find nx_sessions     │
    │                        │─────────────────────▶│ SELECT by tokenHash
    │                        │◀─────────────────────│ session row
    │                        │ check expiresAt      │
    │                        │ load user + verify   │
    │                        │   tokenVersion       │
    │                        │─────────────────────▶│ SELECT user
    │                        │                      │
    │                        │ ── ROTATE (in tx) ── │
    │                        │ DELETE old session   │
    │                        │─────────────────────▶│ DELETE
    │                        │ INSERT new session   │
    │                        │   (new tokenHash)    │
    │                        │─────────────────────▶│ INSERT
    │                        │ signToken(user)      │
    │  Set-Cookie:           │                      │
    │    nx-session=<newJWT> │                      │
    │    nx-refresh=<newUUID>│                      │
    │    nx-csrf=<newUUID>   │                      │
    │◀───────────────────────│                      │
    │  200 { user }          │                      │

  Replay defense: old refresh token is DELETED in the same tx.
  If an attacker replays the old token → session not found → 401.
  All cookies rotated together (access + refresh + CSRF).

═══════════════════════════════════════════════════════════
  5. PASSWORD CHANGE (C.9)
═══════════════════════════════════════════════════════════

  Client              Server (C.9)             DB
    │ PATCH /api/auth/      │                    │
    │   change-password     │                    │
    │ {currentPassword,     │                    │
    │  newPassword}         │                    │
    │──────────────────────▶│                    │
    │                       │ verifyTokenFull()  │
    │                       │───────────────────▶│ verify tokenVersion
    │                       │ verify current pwd │
    │                       │───────────────────▶│ SELECT password
    │                       │ hash new password  │
    │                       │───────────────────▶│ UPDATE password
    │                       │                    │
    │                       │ invalidateAllSessions(userId)
    │                       │───────────────────▶│ bump tokenVersion (+1)
    │                       │                    │ DELETE all nx_sessions
    │                       │                    │
    │                       │ create NEW session │
    │                       │   for current client│
    │                       │───────────────────▶│ INSERT nx_sessions
    │                       │ signToken(updated) │
    │  Set-Cookie:          │                    │
    │    nx-session=<newJWT>│                    │
    │    nx-refresh=<newUUID>│                   │
    │    nx-csrf=<newUUID>  │                    │
    │◀──────────────────────│                    │
    │  200 { success }      │                    │

  Result: All other sessions invalidated.
  Current client gets fresh tokens. Other clients get 401 on next request.

═══════════════════════════════════════════════════════════
  6. LOGOUT (C.5)
═══════════════════════════════════════════════════════════

  Client              Server (C.5)             DB
    │ POST /api/auth/logout │                    │
    │ Cookie: nx-refresh    │                    │
    │──────────────────────▶│                    │
    │                       │ sha256(refreshToken)│
    │                       │ DELETE nx_sessions │
    │                       │───────────────────▶│ DELETE by tokenHash
    │  Clear-Cookie:        │                    │
    │    nx-session          │                    │
    │    nx-refresh          │                    │
    │    nx-csrf             │                    │
    │◀──────────────────────│                    │
    │  200 { success }      │                    │

  Note: JWT (nx-session) remains valid until expiry (max 2h),
  but without the refresh token, the client cannot renew.
  Tier 2 checks will reject the JWT once tokenVersion is bumped
  (only if admin force-invalidates; normal logout does not bump).

═══════════════════════════════════════════════════════════
  7. ADMIN FORCE-INVALIDATION
═══════════════════════════════════════════════════════════

  Admin               Server                   DB
    │ POST /api/auth/       │                    │
    │   invalidate/{userId} │                    │
    │──────────────────────▶│                    │
    │                       │ requireAuth(admin) │
    │                       │ invalidateAllSessions(userId)
    │                       │───────────────────▶│ bump tokenVersion
    │                       │                    │ DELETE all sessions
    │◀──────────────────────│                    │
    │  200 { success }      │                    │

  Target user's JWTs become stale:
  - Tier 1 (Edge): still passes for up to 2h (known gap — reads only)
  - Tier 2 (API):  rejected immediately (tokenVersion mismatch)
  - Tier 3 (RSC):  rejected immediately
```

---

## D. Rendering Layer

### D.1 Architecture Decision

**Same Next.js app** with route groups for isolation.

```
app/
├── (site)/          # Public site — SSR/SSG/ISR
│   └── layout.tsx   # Public layout (theme, nav, footer)
├── (admin)/         # Admin panel — client-heavy
│   └── layout.tsx   # Admin layout (sidebar, topbar)
├── api/             # Shared API routes
└── layout.tsx       # Root layout (html, body, fonts)
```

**Hard rule**: Public routes (`(site)/*`) NEVER import from `@nexpress/admin` or any admin client components. Enforced via ESLint import boundaries.

### D.2 Route Group: (site) — Public Site

```typescript
// app/(site)/layout.tsx
import { NxThemeStyle } from "@nexpress/theme";
import { getTheme, getNavigation } from "@nexpress/core";

export default async function SiteLayout({ children }: { children: React.ReactNode }) {
  const theme = await getTheme();        // reads from nx_settings
  const nav = await getNavigation();     // reads from nx_navigation

  return (
    <>
      <NxThemeStyle theme={theme} />
      <header>
        <SiteNav items={nav.header} />
      </header>
      <main>{children}</main>
      <footer>
        <SiteFooter items={nav.footer} />
      </footer>
    </>
  );
}

// app/(site)/[...slug]/page.tsx — Catch-all page renderer
import { getPageBySlug, getCollectionEntryBySlug } from "@nexpress/core";
import { renderBlocks } from "@nexpress/blocks";
import { notFound } from "next/navigation";

interface PageProps {
  params: Promise<{ slug: string[] }>;
}

export default async function CatchAllPage({ params }: PageProps) {
  const { slug } = await params;
  const path = slug.join("/");

  // 1. Try page collection first
  const page = await getPageBySlug(path);
  if (page) {
    return renderBlocks(page.blocks);
  }

  // 2. Fall through to 404
  notFound();
}

// Static generation for known pages
export async function generateStaticParams() {
  const pages = await getAllPages();
  return pages.map((p) => ({ slug: p.slug.split("/") }));
}
```

### D.3 Blog Routes

```typescript
// app/(site)/blog/page.tsx — Blog listing
import { findPosts } from "@nexpress/core";

interface BlogPageProps {
  searchParams: Promise<{ page?: string }>;
}

export default async function BlogPage({ searchParams }: BlogPageProps) {
  const { page } = await searchParams;
  const pageNum = parseInt(page || "1", 10);
  const { docs, totalPages } = await findPosts({
    where: { status: "published" },
    sort: "-publishedAt",
    page: pageNum,
    limit: 10,
  });

  return (
    <div>
      <h1>Blog</h1>
      {docs.map((post) => (
        <PostCard key={post.id} post={post} />
      ))}
      <Pagination current={pageNum} total={totalPages} />
    </div>
  );
}

// app/(site)/blog/[slug]/page.tsx — Single post
import { getPostBySlug } from "@nexpress/core";
import { renderRichText } from "@nexpress/editor/renderer";
import { notFound } from "next/navigation";

export default async function PostPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const post = await getPostBySlug(slug);
  if (!post) notFound();

  return (
    <article>
      <h1>{post.title}</h1>
      <time dateTime={post.publishedAt?.toISOString()}>{formatDate(post.publishedAt)}</time>
      {post.coverImage && <NxImage media={post.coverImage} size="large" />}
      <div className="prose">{renderRichText(post.content)}</div>
    </article>
  );
}

export async function generateStaticParams() {
  const posts = await findPosts({ where: { status: "published" }, limit: 1000 });
  return posts.docs.map((p) => ({ slug: p.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const post = await getPostBySlug(slug);
  if (!post) return {};
  return {
    title: post.seo?.metaTitle || post.title,
    description: post.seo?.metaDescription || post.excerpt,
    openGraph: {
      images: post.seo?.ogImage ? [{ url: getMediaUrl(post.seo.ogImage, "og") }] : [],
    },
  };
}
```

### D.4 Draft Mode (Preview)

```typescript
// app/api/preview/route.ts
import { draftMode } from "next/headers";

export async function GET(request: NextRequest) {
  // 1. Verify admin is authenticated
  const user = await verifyTokenFull(request.cookies.get("nx-session")?.value || "");
  if (!user || !hasRole(user, "editor")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // 2. Enable draft mode
  const draft = await draftMode();
  draft.enable();

  // 3. Redirect to the requested page
  const redirectTo = request.nextUrl.searchParams.get("path") || "/";
  return NextResponse.redirect(new URL(redirectTo, request.url));
}

// app/api/preview/exit/route.ts
export async function GET(request: NextRequest) {
  const draft = await draftMode();
  draft.disable();
  return NextResponse.redirect(new URL("/", request.url));
}

// In page components, check draft mode:
import { draftMode } from "next/headers";

export default async function PostPage({ params }: PostPageProps) {
  const { isEnabled: isDraft } = await draftMode();
  const post = await getPostBySlug(slug, { draft: isDraft });

  return (
    <>
      {isDraft && <DraftBanner />}
      <article>{/* ... */}</article>
    </>
  );
}
```

### D.5 ISR & Revalidation

```typescript
/**
 * NexPress uses Next.js tag-based revalidation.
 * When content changes, revalidate only affected pages.
 */

// Data access functions tag their cache:
import { unstable_cache } from "next/cache";

export const getPostBySlug = unstable_cache(
  async (slug: string, options?: { draft?: boolean }) => {
    return db.query.nxCPosts.findFirst({
      where: options?.draft
        ? eq(nxCPosts.slug, slug)
        : and(eq(nxCPosts.slug, slug), eq(nxCPosts.status, "published")),
      with: { coverImageRel: true, authorRel: true, categories: true },
    });
  },
  ["post"],
  { tags: ["nx:posts"], revalidate: 3600 }, // 1 hour default, or on-demand
);

// When content is updated via admin/API:
import { revalidateTag } from "next/cache";

export async function onContentUpdate(collection: string, docId: string) {
  revalidateTag(`nx:${collection}`); // revalidate all pages using this collection
  revalidateTag(`nx:${collection}:${docId}`); // specific document cache
}

// Example revalidation triggers:
// POST/PATCH /api/collections/posts/{id} → revalidateTag("nx:posts")
// PUT /api/settings (theme change)       → revalidateTag("nx:theme")
// POST /api/media/upload                 → revalidateTag("nx:media")
// PUT /api/navigation                    → revalidateTag("nx:navigation")
```

### D.6 NxImage Component (Optimized Media Rendering)

```typescript
// packages/core/src/components/NxImage.tsx
import Image from "next/image";

interface NxImageProps {
  /** Media record or ID */
  media: NxMediaRecord | string;
  /** Which size to use (from image config) */
  size?: string;
  /** Image alt text (overrides media.alt) */
  alt?: string;
  /** Additional className */
  className?: string;
  /** Priority loading (for LCP images) */
  priority?: boolean;
}

export async function NxImage({ media, size = "medium", alt, className, priority }: NxImageProps) {
  const record = typeof media === "string" ? await getMediaById(media) : media;
  if (!record) return null;

  const sizeData = record.sizes?.[size];
  const src = getMediaUrl(record.storageKey, size);

  return (
    <Image
      src={src}
      width={sizeData?.width || record.width || 800}
      height={sizeData?.height || record.height || 600}
      alt={alt || record.alt || record.originalFilename}
      className={className}
      priority={priority}
    />
  );
}
```

---

## E. Admin UI Architecture

### E.1 Architecture Decision

**Same Next.js app**, under `(admin)` route group. Admin components live in `@nexpress/admin` package, imported only by admin routes. Hard isolation boundary prevents admin client code from leaking into public site bundles.

### E.2 Admin Route Structure

```
app/(admin)/admin/
├── layout.tsx               # Admin shell (sidebar, topbar, auth gate)
├── page.tsx                 # Dashboard
├── login/
│   └── page.tsx             # Login form (no admin layout)
├── collections/
│   └── [collection]/
│       ├── page.tsx         # List view
│       ├── create/
│       │   └── page.tsx     # Create view
│       └── [id]/
│           └── page.tsx     # Edit view
├── media/
│   └── page.tsx             # Media library
├── settings/
│   ├── page.tsx             # General settings
│   └── theme/
│       └── page.tsx         # Theme editor
├── plugins/
│   └── page.tsx             # Plugin management
└── [...path]/
    └── page.tsx             # Plugin-provided admin pages
```

### E.3 Admin Layout (Server Component)

```typescript
// app/(admin)/admin/layout.tsx
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { verifyTokenFull } from "@nexpress/core/auth";
import { AdminShell } from "@nexpress/admin/layout";
import { getCollectionConfigs } from "@nexpress/core/config";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  // Auth gate — redirect to login if not authenticated
  const cookieStore = await cookies();
  const token = cookieStore.get("nx-session")?.value;
  if (!token) redirect("/admin/login");

  const user = await verifyTokenFull(token);
  if (!user) redirect("/admin/login");

  // Load config for sidebar generation
  const collections = getCollectionConfigs();

  return (
    <AdminShell user={user} collections={collections}>
      {children}
    </AdminShell>
  );
}
```

### E.4 Admin Shell Component

```typescript
// packages/admin/src/layout/AdminShell.tsx
"use client";

import { SidebarProvider, Sidebar, SidebarContent, SidebarGroup, SidebarMenu,
         SidebarMenuItem, SidebarMenuButton } from "@/components/ui/sidebar";
import { LayoutDashboard, FileText, Image, Settings, Puzzle, LogOut } from "lucide-react";

interface AdminShellProps {
  user: NxAuthUser;
  collections: NxCollectionConfig[];
  children: React.ReactNode;
}

export function AdminShell({ user, collections, children }: AdminShellProps) {
  // Group collections by admin.group
  const groups = groupCollections(collections);

  return (
    <SidebarProvider>
      <Sidebar>
        <SidebarContent>
          {/* Logo / brand */}
          <div className="px-4 py-3 font-bold text-lg">NexPress</div>

          {/* Dashboard */}
          <SidebarGroup>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton asChild>
                  <a href="/admin"><LayoutDashboard className="size-4" /> Dashboard</a>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroup>

          {/* Collections — grouped */}
          {Object.entries(groups).map(([group, cols]) => (
            <SidebarGroup key={group} label={group}>
              <SidebarMenu>
                {cols.map((col) => (
                  <SidebarMenuItem key={col.slug}>
                    <SidebarMenuButton asChild>
                      <a href={`/admin/collections/${col.slug}`}>
                        <FileText className="size-4" />
                        {col.labels.plural}
                      </a>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroup>
          ))}

          {/* System */}
          <SidebarGroup label="System">
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton asChild>
                  <a href="/admin/media"><Image className="size-4" /> Media</a>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton asChild>
                  <a href="/admin/plugins"><Puzzle className="size-4" /> Plugins</a>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton asChild>
                  <a href="/admin/settings"><Settings className="size-4" /> Settings</a>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroup>
        </SidebarContent>
      </Sidebar>

      <main className="flex-1 overflow-auto">
        <AdminTopbar user={user} />
        <div className="p-6">{children}</div>
      </main>
    </SidebarProvider>
  );
}
```

### E.5 Collection List View

```typescript
// app/(admin)/admin/collections/[collection]/page.tsx
import { getCollectionConfig, findDocuments } from "@nexpress/core";
import { CollectionListView } from "@nexpress/admin/collections";
import { notFound } from "next/navigation";

interface Props {
  params: Promise<{ collection: string }>;
  searchParams: Promise<{ page?: string; sort?: string; search?: string }>;
}

export default async function CollectionListPage({ params, searchParams }: Props) {
  const { collection } = await params;
  const config = getCollectionConfig(collection);
  if (!config) notFound();

  const { page, sort, search } = await searchParams;

  const result = await findDocuments(collection, {
    page: parseInt(page || "1", 10),
    limit: 25,
    sort: sort || config.admin?.defaultSort || "-createdAt",
    search,
  });

  return (
    <CollectionListView
      config={config}
      docs={result.docs}
      totalDocs={result.totalDocs}
      totalPages={result.totalPages}
      currentPage={result.page}
    />
  );
}
```

```typescript
// packages/admin/src/collections/CollectionListView.tsx
"use client";

import { DataTable } from "@/components/ui/data-table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Plus, Search } from "lucide-react";

interface CollectionListViewProps {
  config: NxCollectionConfig;
  docs: Record<string, unknown>[];
  totalDocs: number;
  totalPages: number;
  currentPage: number;
}

export function CollectionListView({ config, docs, totalDocs, totalPages, currentPage }: CollectionListViewProps) {
  // Generate columns from config.admin.listColumns or default field names
  const columns = generateColumns(config);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">{config.labels.plural}</h1>
        <Button asChild>
          <a href={`/admin/collections/${config.slug}/create`}>
            <Plus className="size-4 mr-2" /> Create {config.labels.singular}
          </a>
        </Button>
      </div>

      <div className="flex items-center gap-2">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <Input placeholder={`Search ${config.labels.plural.toLowerCase()}...`} className="pl-9" />
        </div>
      </div>

      <DataTable
        columns={columns}
        data={docs}
        pageCount={totalPages}
        currentPage={currentPage}
      />

      <p className="text-sm text-muted-foreground">{totalDocs} total {config.labels.plural.toLowerCase()}</p>
    </div>
  );
}
```

### E.6 Collection Edit View (Auto-generated Form)

```typescript
// packages/admin/src/collections/CollectionEditView.tsx
"use client";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Form, FormField, FormItem, FormLabel, FormControl, FormMessage } from "@/components/ui/form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Save, Eye, Trash2 } from "lucide-react";

/**
 * Auto-generates a form from collection field config.
 * Maps NxFieldConfig types → shadcn/ui form components.
 */
export function CollectionEditView({
  config,
  doc,
  onSave,
  onDelete,
}: {
  config: NxCollectionConfig;
  doc?: Record<string, unknown>;
  onSave: (data: Record<string, unknown>) => Promise<void>;
  onDelete?: () => Promise<void>;
}) {
  const schema = generateZodSchema(config.fields);
  const form = useForm({
    resolver: zodResolver(schema),
    defaultValues: doc || generateDefaults(config.fields),
  });

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSave)} className="space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold">
            {doc ? `Edit ${config.labels.singular}` : `Create ${config.labels.singular}`}
          </h1>
          <div className="flex gap-2">
            {doc && (
              <Button variant="outline" type="button" asChild>
                <a href={`/api/preview?path=/${config.slug}/${doc.slug}`} target="_blank">
                  <Eye className="size-4 mr-2" /> Preview
                </a>
              </Button>
            )}
            <Button type="submit" disabled={form.formState.isSubmitting}>
              <Save className="size-4 mr-2" /> Save
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-12 gap-6">
          {/* Main content area (8 cols) */}
          <div className="col-span-8 space-y-4">
            {config.fields
              .filter((f) => !isSidebarField(f))
              .map((field) => (
                <FieldRenderer key={field.name} field={field} form={form} />
              ))}
          </div>

          {/* Sidebar (4 cols) — status, dates, metadata */}
          <div className="col-span-4 space-y-4">
            <StatusCard form={form} config={config} />
            {config.fields
              .filter((f) => isSidebarField(f))
              .map((field) => (
                <FieldRenderer key={field.name} field={field} form={form} />
              ))}
            {doc && onDelete && (
              <Button variant="destructive" type="button" onClick={onDelete} className="w-full">
                <Trash2 className="size-4 mr-2" /> Delete
              </Button>
            )}
          </div>
        </div>
      </form>
    </Form>
  );
}

/**
 * Field type → component mapping.
 */
function FieldRenderer({ field, form }: { field: NxFieldConfig; form: UseFormReturn }) {
  switch (field.type) {
    case "text":
      return (
        <FormField control={form.control} name={field.name} render={({ field: f }) => (
          <FormItem>
            <FormLabel>{field.label || titleCase(field.name)}</FormLabel>
            <FormControl><Input {...f} placeholder={field.admin?.placeholder} /></FormControl>
            <FormMessage />
          </FormItem>
        )} />
      );
    case "textarea":
      return (
        <FormField control={form.control} name={field.name} render={({ field: f }) => (
          <FormItem>
            <FormLabel>{field.label || titleCase(field.name)}</FormLabel>
            <FormControl><Textarea {...f} rows={field.rows || 4} /></FormControl>
            <FormMessage />
          </FormItem>
        )} />
      );
    case "richText":
      return (
        <FormField control={form.control} name={field.name} render={({ field: f }) => (
          <FormItem>
            <FormLabel>{field.label || titleCase(field.name)}</FormLabel>
            <FormControl>
              <NxRichTextEditor value={f.value} onChange={f.onChange} config={field.editor} />
            </FormControl>
            <FormMessage />
          </FormItem>
        )} />
      );
    case "blocks":
      return (
        <FormField control={form.control} name={field.name} render={({ field: f }) => (
          <FormItem>
            <FormLabel>{field.label || titleCase(field.name)}</FormLabel>
            <FormControl>
              <BlockEditor blocks={f.value || []} onChange={f.onChange} allowedBlocks={field.allowedBlocks} />
            </FormControl>
            <FormMessage />
          </FormItem>
        )} />
      );
    case "checkbox":
      return (
        <FormField control={form.control} name={field.name} render={({ field: f }) => (
          <FormItem className="flex items-center gap-2">
            <FormControl><Switch checked={f.value} onCheckedChange={f.onChange} /></FormControl>
            <FormLabel>{field.label || titleCase(field.name)}</FormLabel>
            <FormMessage />
          </FormItem>
        )} />
      );
    case "select":
      return (
        <FormField control={form.control} name={field.name} render={({ field: f }) => (
          <FormItem>
            <FormLabel>{field.label || titleCase(field.name)}</FormLabel>
            <Select value={f.value} onValueChange={f.onChange}>
              <FormControl>
                <SelectTrigger><SelectValue /></SelectTrigger>
              </FormControl>
              <SelectContent>
                {field.options.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <FormMessage />
          </FormItem>
        )} />
      );
    case "upload":
      return <MediaPickerField field={field} form={form} />;
    case "relationship":
      return <RelationshipField field={field} form={form} />;
    case "date":
      return <DatePickerField field={field} form={form} />;
    case "group":
      return (
        <fieldset className="border p-4 rounded-lg space-y-4">
          <legend className="font-medium">{field.label || titleCase(field.name)}</legend>
          {field.fields.map((subField) => (
            <FieldRenderer
              key={subField.name}
              field={{ ...subField, name: `${field.name}.${subField.name}` }}
              form={form}
            />
          ))}
        </fieldset>
      );
    case "array":
      return <ArrayFieldEditor field={field} form={form} />;
    case "row":
      return (
        <div className="grid grid-cols-2 gap-4">
          {field.fields.map((f) => <FieldRenderer key={f.name} field={f} form={form} />)}
        </div>
      );
    case "collapsible":
      return <CollapsibleFieldGroup field={field} form={form} />;
    default:
      return null;
  }
}
```

### E.7 Dashboard

```typescript
// app/(admin)/admin/page.tsx
import { getDashboardStats } from "@nexpress/core";
import { DashboardView } from "@nexpress/admin/dashboard";

export default async function DashboardPage() {
  const stats = await getDashboardStats();
  return <DashboardView stats={stats} />;
}

// Dashboard displays:
// - Total documents per collection
// - Recent activity (last 10 creates/updates across all collections)
// - Draft count (items pending review)
// - Media usage (storage used)
// - Quick actions: "Create Post", "Upload Media", "View Site"
```

### E.8 Import Isolation Enforcement

```typescript
// .eslintrc.js — enforce admin/site boundary
module.exports = {
  rules: {
    "import/no-restricted-paths": [
      "error",
      {
        zones: [
          // Public site routes cannot import admin components
          {
            target: "./app/(site)/**",
            from: "./node_modules/@nexpress/admin/**",
            message: "Public site routes must not import admin components (bundle bloat).",
          },
          {
            target: "./app/(site)/**",
            from: "./app/(admin)/**",
            message: "Public site routes must not import from admin routes.",
          },
        ],
      },
    ],
  },
};
```

---

## K. Routing Contract (CB-3)

### K.1 Reserved Paths

```typescript
/**
 * These paths are reserved by NexPress and cannot be used as page/collection slugs.
 * Enforced at build time by the config validator.
 */
export const NX_RESERVED_PATHS = [
  "admin", // Admin UI
  "api", // API routes
  "media", // Media serving (if local storage)
  "_next", // Next.js internals
  "sitemap.xml", // SEO
  "robots.txt", // SEO
  "favicon.ico", // Browser default
  "manifest.json", // PWA manifest
] as const;

// Validated in collectionConfigSchema:
// slug: z.string().refine(s => !NX_RESERVED_PATHS.includes(s), "Slug conflicts with reserved path")
```

### K.2 Route Resolution Priority

```
Route resolution order (highest to lowest priority):

1. Static Next.js routes (exact file matches)
   app/(admin)/admin/...  → Admin UI
   app/api/...            → API handlers
   app/sitemap.xml/...    → Sitemap (generated)
   app/robots.txt/...     → Robots (generated)

2. Plugin site routes (root-level, via next.config.js rewrites)
   /sitemap.xml   → rewrite to /api/plugins/{plugin-id}/sitemap.xml
   /feed.xml      → rewrite to /api/plugins/{plugin-id}/feed.xml
   Registered via manifest.routes[].kind: "site"

3. Collection-specific static routes
   app/(site)/blog/[slug] → Blog post pages
   (Developer defines these explicitly in their app/ directory)

4. Catch-all page routes (lowest priority)
   app/(site)/[[...slug]] → Pages collection (optional catch-all)

Collision rule: If a page slug, collection route, or plugin site route matches
a reserved path or an existing static route without an explicit built-in
override, the config validator fails the build. Unreachable content is a hard
configuration error, not a warning.
```

### K.3 Plugin Root-Level Routes

```typescript
/**
 * Plugins that need root-level routes (e.g., /sitemap.xml) declare site routes
 * in their manifest. The host validates collisions and generates next.config.js
 * rewrites for accepted routes.
 */

// In plugin manifest:
routes: [
  {
    path: "/sitemap.xml",
    handler: "handlers/sitemap",
    kind: "site",
    exposeAt: "/sitemap.xml",  // serve at site root, not /api/plugins/{id}/
    overridesBuiltIn: "sitemap.xml",
  },
]

// Generated in next.config.js at build time:
async rewrites() {
  return [
    // Auto-generated from plugin manifests with kind: "site"
    { source: "/sitemap.xml", destination: "/api/plugins/seo/sitemap.xml" },
    { source: "/feed.xml", destination: "/api/plugins/rss/feed.xml" },
  ];
}
```

Plugin site routes may only replace built-in generated routes such as
`sitemap.xml` or `robots.txt` when the manifest declares the matching
`overridesBuiltIn` value. Collisions with admin routes, API routes, media
serving, Next.js internals, collection static routes, or another plugin site
route are hard validation errors.

### K.4 Catch-All Route Fix

```typescript
// app/(site)/[[...slug]]/page.tsx — Optional catch-all (not [...slug])
// [[...slug]] matches "/" (homepage) AND "/about" AND "/nested/path"
// [...slug] would NOT match "/" — homepage would 404

export default async function CatchAllPage({ params }: { params: Promise<{ slug?: string[] }> }) {
  const { slug } = await params;
  const path = slug?.join("/") || ""; // "" = homepage

  const page = await getPageBySlug(path || "/");
  if (page) return renderBlocks(page.blocks);

  notFound();
}
```

---

## L. Write Pipeline & Access Control (CB-5, CB-6)

### L.1 Transaction Boundaries

```typescript
/**
 * Every content mutation follows this pipeline.
 * DB operations are atomic (single transaction).
 * Side effects are async (job queue).
 */
export async function saveDocument(
  collection: string,
  docId: string | null, // null = create
  data: Record<string, unknown>,
  user: NxAuthUser,
): Promise<SaveResult> {
  const config = getCollectionConfig(collection);

  // ── Phase 1: Validate ──────────────────────────────
  // 1a. Runtime Zod validation (generated from field config)
  const schema = getCollectionZodSchema(collection);
  const validated = schema.parse(data);

  // 1b. Access control check
  const operation = docId ? "update" : "create";
  const accessFn = config.access?.[operation];
  if (accessFn) {
    const existingDoc = docId
      ? await db.query[getTableName(collection)].findFirst({ where: eq(table.id, docId) })
      : undefined;
    const allowed = await accessFn({ user, doc: existingDoc, data: validated });
    if (!allowed) throw new NxForbiddenError(collection, operation);
  }

  // ── Phase 2: Hooks (sync, can abort) ───────────────
  let hookData = validated;
  for (const hook of config.hooks?.[`before${capitalize(operation)}`] || []) {
    hookData = await hook({ data: hookData, user, collection, originalDoc: null });
  }

  // ── Phase 3: DB Transaction (atomic) ───────────────
  const result = await db.transaction(async (tx) => {
    let doc: Record<string, unknown>;

    if (docId) {
      // Update
      doc = await updateDocument(tx, collection, docId, hookData, user);
    } else {
      // Create
      doc = await createDocument(tx, collection, hookData, user);
    }

    // Upsert relationship/array join tables
    await syncRelationships(tx, collection, doc.id as string, hookData);

    // Create revision (if versioning enabled)
    if (config.versions) {
      await createRevision(tx, collection, doc.id as string, doc, user, operation);
    }

    return doc;
  });

  // ── Phase 4: Async side effects (non-blocking) ─────
  // These run OUTSIDE the transaction via job queue.
  // Failure here does NOT roll back the save.
  await enqueueJob("content:afterSave", {
    collection,
    documentId: result.id,
    operation,
    userId: user.id,
  });
  // The job handler will:
  // - revalidateTag(`nx:${collection}`)
  // - Run afterCreate/afterUpdate hooks
  // - Trigger webhooks
  // - Update search index

  return { doc: result, operation };
}
```

### L.2 Access Control Enforcement in API

```typescript
// app/api/collections/[collection]/route.ts

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ collection: string }> },
) {
  const { collection } = await params;
  const user = await requireAuth(request); // Tier 2: verifyTokenFull, throws 401

  // CSRF check (handled by middleware, but belt-and-suspenders)
  const data = await request.json();

  try {
    const result = await saveDocument(collection, null, data, user);
    return NextResponse.json(result.doc, { status: 201 });
  } catch (e) {
    if (e instanceof NxForbiddenError) return nxErrorResponse(e, 403);
    if (e instanceof z.ZodError) return nxErrorResponse(e, 400);
    throw e;
  }
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ collection: string }> },
) {
  const { collection } = await params;
  const config = getCollectionConfig(collection);

  // Read access can be public or authenticated
  const user = await optionalAuth(request);
  const readAccess = config.access?.read;
  if (readAccess) {
    const allowed = await readAccess({ user });
    if (!allowed) return nxErrorResponse(new NxForbiddenError(collection, "read"), 403);
  }

  const { searchParams } = request.nextUrl;
  const result = await findDocuments(collection, {
    page: parseInt(searchParams.get("page") || "1", 10),
    limit: Math.min(parseInt(searchParams.get("limit") || "25", 10), 100),
    sort: searchParams.get("sort") || "-createdAt",
    search: searchParams.get("search") || undefined,
  });

  return NextResponse.json(result);
}
```

---

## M. Background Jobs & Worker (CB-4)

### M.1 Architecture

```
v1 strategy: pg-boss (PostgreSQL-native job queue).

Why pg-boss:
- No additional infrastructure (Redis not needed)
- Uses PostgreSQL SKIP LOCKED for reliable job claiming
- Supports cron schedules, retries, dead letter queue
- Single-node safe, multi-node safe (advisory locks)
- Aligns with "self-hosted, Docker, PostgreSQL" stack

┌─────────────┐     enqueue      ┌──────────────┐    pg LISTEN/    ┌─────────────┐
│  API Route   │────────────────▶│  nx_jobs      │    NOTIFY        │   Worker     │
│  (save doc)  │                 │  (pg-boss     │───────────────▶ │  (same       │
│              │                 │   tables)     │                  │   process    │
└─────────────┘                 └──────────────┘                  │   or separate│
                                                                   │   if needed) │
                                                                   └─────────────┘
v1: Worker runs in the same Next.js process (instrument.ts or custom server).
    Adequate for single-node self-hosted. No separate worker binary needed.

Escalation: Multi-node → separate worker process, shared pg-boss queue.
```

### M.2 Job Types

```typescript
/**
 * All async work goes through the job queue.
 */
export type NxJobType =
  // Content lifecycle
  | "content:afterSave" // Post-save hooks, webhooks, cache invalidation, search indexing
  | "content:afterDelete" // Post-delete cleanup

  // Media processing
  | "media:processImage" // Sharp resize pipeline (decoupled from upload request)
  | "media:cleanup" // Delete orphaned storage files

  // Plugin
  | "plugin:scheduledTask" // Cron-scheduled plugin tasks

  // System
  | "system:revisionPrune" // Prune old revisions per retention policy
  | "system:sessionCleanup"; // Delete expired sessions

/**
 * Job handler registry.
 */
const jobHandlers: Record<NxJobType, (data: unknown) => Promise<void>> = {
  "content:afterSave": async (data) => {
    const { collection, documentId, operation, userId } = data as ContentJobData;
    // 1. Cache invalidation
    revalidateTag(`nx:${collection}`);
    revalidateTag(`nx:${collection}:${documentId}`);
    // 2. Run after hooks
    const config = getCollectionConfig(collection);
    const doc = await getDocumentById(collection, documentId);
    const user = await getUserById(userId);
    for (const hook of config.hooks?.[`after${capitalize(operation)}`] || []) {
      await hook({ data: doc, user, collection });
    }
    // 3. Update search index
    await updateSearchIndex(collection, documentId);
    // 4. Fire webhooks (if configured)
    await fireWebhooks(collection, operation, doc);
  },

  "media:processImage": async (data) => {
    const { mediaId, storagePath, config } = data as MediaJobData;
    // Sharp pipeline runs here, NOT in the upload request handler
    const sizes = await generateImageSizes(storagePath, config);
    await db.update(nxMedia).set({ sizes, status: "ready" }).where(eq(nxMedia.id, mediaId));
  },

  // ...other handlers
};
```

### M.3 Upload Flow (Fixed)

```
Before (CB-4 issue): Upload → sharp inline → respond (slow, timeout risk)
After:

1. POST /api/media/upload
   → Save original file to storage
   → Insert nx_media row with status: "processing"
   → Enqueue "media:processImage" job
   → Return 202 { id, status: "processing" }

2. Worker picks up "media:processImage"
   → Run sharp pipeline (thumbnail, small, medium, large, og)
   → Update nx_media row: status: "ready", sizes: {...}

3. Client polls or receives SSE notification when ready
   (Or: Admin UI shows placeholder until processing completes)
```

### M.4 Rich-Text Image Insertion Contract

The editor image feature uses the same async media pipeline as direct media
uploads. `onUploadImage()` calls `POST /api/media/upload`; the API saves the
original file, inserts the media row, enqueues processing, and returns `202`
with `{ id, status: "processing", originalUrl? }`.

The editor persists image nodes by `mediaId`, not by generated variant URL. When
status is `"processing"`, the node renders a placeholder and may use
`originalUrl` for an immediate preview if the storage adapter exposes it. The
admin UI polls `/api/media/{id}` or subscribes to SSE until the media row becomes
`"ready"`, then updates node metadata with generated `sizes`. Saved rich-text
content remains valid throughout the processing window because rendering can
resolve `mediaId` at request time and fall back to the original asset or a
placeholder when variants are not ready.

---

## N. Platform Policies (HS-8, MS-3, MS-7, HS-6, MS-1, MS-2, MS-4, MS-6)

### N.1 Standard API Error Format

```typescript
/**
 * All NexPress API endpoints return errors in this format.
 * No ad-hoc { error: "..." } responses.
 */
export interface NxApiError {
  error: {
    code: string; // Machine-readable: "VALIDATION_ERROR", "FORBIDDEN", "NOT_FOUND"
    message: string; // Human-readable message
    details?: unknown; // Zod issues, field-level errors, etc.
  };
  status: number;
}

export function nxErrorResponse(error: Error, status: number): NextResponse<NxApiError> {
  if (error instanceof z.ZodError) {
    return NextResponse.json(
      {
        error: { code: "VALIDATION_ERROR", message: "Invalid input", details: error.issues },
        status: 400,
      },
      { status: 400 },
    );
  }
  if (error instanceof NxForbiddenError) {
    return NextResponse.json(
      {
        error: { code: "FORBIDDEN", message: error.message },
        status: 403,
      },
      { status: 403 },
    );
  }
  return NextResponse.json(
    {
      error: { code: "INTERNAL_ERROR", message: "An unexpected error occurred" },
      status: 500,
    },
    { status: 500 },
  );
}

// Standard error codes:
// VALIDATION_ERROR — 400: Request body failed Zod validation
// UNAUTHORIZED    — 401: Missing or invalid authentication
// FORBIDDEN       — 403: Authenticated but insufficient permissions
// NOT_FOUND       — 404: Resource not found
// CONFLICT        — 409: Version conflict (optimistic locking)
// RATE_LIMITED    — 429: Too many requests
// INTERNAL_ERROR  — 500: Unexpected server error
```

### N.2 Security Headers & Rate Limiting

```typescript
// middleware.ts — applied to all routes

const SECURITY_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "X-XSS-Protection": "0", // Rely on CSP instead
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Content-Security-Policy": [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline'", // Next.js requires unsafe-inline
    "style-src 'self' 'unsafe-inline'", // Tailwind requires unsafe-inline
    "img-src 'self' data: blob:",
    "font-src 'self'",
    "connect-src 'self'",
    "frame-ancestors 'none'",
  ].join("; "),
};

// Rate limiting: Use middleware with in-memory sliding window for v1.
// Keys: IP + route pattern. Limits:
// - /api/auth/*: 10 requests / minute (brute force protection)
// - /api/collections/*: 100 requests / minute
// - /api/media/upload: 20 requests / minute
// - /api/import: 5 requests / minute
// Escalation: Multi-node → Redis-backed rate limiter.

// CORS: Admin API is same-origin only (no CORS headers needed).
// Agent API (/api/manifest/*, /api/openapi.json): If exposed externally,
// configure allowed origins in nexpress.config.ts:
//   api: { cors: { origins: ["https://agent.example.com"] } }
```

### N.3 Theme CSS Sanitization (MS-3)

```typescript
/**
 * Theme token values are sanitized before CSS injection.
 * Prevents CSS injection via malicious admin input.
 */
function sanitizeTokenValue(value: string): string {
  // Strip anything that could break out of a CSS value context
  return value
    .replace(/[;{}]/g, "") // No statement/block terminators
    .replace(/url\s*\(/gi, "") // No url() — prevents resource injection
    .replace(/expression\s*\(/gi, "") // No expression() (legacy IE)
    .replace(/@import/gi, "") // No @import
    .slice(0, 200); // Length limit
}

// Applied in generateThemeCss() for every token value:
// --nx-color-primary: ${sanitizeTokenValue(theme.colors.primary)};
```

### N.4 v1 Deployment & Cache Constraints

```
v1 deployment model: SINGLE NODE.

This is explicitly scoped. The following are single-node only:
- Next.js ISR cache (revalidateTag) — file-based, not shared
- In-memory rate limiter
- pg-boss worker (runs in-process)
- LocalStorageAdapter (filesystem media)

For production multi-node:
- Use S3/MinIO for media storage (S3StorageAdapter)
- Use a custom Next.js cache handler (Redis, or Vercel-managed)
- Run pg-boss worker as a separate process (same pg-boss queue, advisory locks)
- Use Redis-backed rate limiter

Escalation trigger: When someone reports "updates don't show on other instances".
This is NOT a v1 blocker — self-hosted CMS default = single Docker container.
```

### N.5 Revision Pruning (MS-1)

```typescript
/**
 * Revision retention policy. Enforced by system:revisionPrune job.
 */
export interface NxRevisionPolicy {
  /** Max published revisions per document (0 = unlimited) */
  maxPublished: number; // default: 20
  /** Max autosave revisions per document */
  maxAutosave: number; // default: 5
  /** Delete autosaves older than N days */
  autosaveMaxAgeDays: number; // default: 7
}

// Runs daily via pg-boss cron:
// Job "system:revisionPrune" — deletes excess revisions per policy.
// Always keeps: the latest published revision and the current draft.
```

### N.6 Cache Abstraction (MS-4)

```typescript
/**
 * Wrap Next.js cache APIs behind a NexPress abstraction.
 * If `unstable_cache` is removed/renamed, only this file changes.
 */
import { unstable_cache as nextCache } from "next/cache";
import { revalidateTag as nextRevalidateTag } from "next/cache";

export function nxCache<T>(
  fn: (...args: unknown[]) => Promise<T>,
  keyParts: string[],
  options: { tags: string[]; revalidate?: number },
): (...args: unknown[]) => Promise<T> {
  return nextCache(fn, keyParts, options);
}

export function nxRevalidateTag(tag: string): void {
  nextRevalidateTag(tag);
}

// All data access functions use nxCache/nxRevalidateTag, never import from next/cache directly.
```

### N.7 Draft Cache Isolation (MS-6)

```typescript
/**
 * Draft content MUST NOT pollute the public cache.
 * Rules:
 * 1. Data fetching with { draft: true } MUST bypass nxCache entirely
 * 2. Draft mode pages set Cache-Control: no-store
 * 3. The __prerender_bypass cookie set by draftMode() prevents ISR caching
 */

export async function getContentBySlug(
  collection: string,
  slug: string,
  options?: { draft?: boolean },
) {
  if (options?.draft) {
    // NO CACHING for draft content — always fresh from DB
    return db.query[getTableName(collection)].findFirst({
      where: eq(table.slug, slug),
    });
  }

  // Public content — cached and tagged for revalidation
  return nxCache(
    async () =>
      db.query[getTableName(collection)].findFirst({
        where: and(eq(table.slug, slug), eq(table.status, "published")),
      }),
    [collection, slug],
    { tags: [`nx:${collection}`, `nx:${collection}:${slug}`], revalidate: 3600 },
  )();
}
```

### N.8 Local Storage Limitation (MS-2)

```typescript
/**
 * LocalStorageAdapter: development and single-node production only.
 * Multi-node deployments MUST use S3StorageAdapter.
 * This is enforced via a startup warning, not a hard block:
 */
// On startup:
// if (config.storage.adapter === "local" && process.env.NX_MULTI_NODE === "true") {
//   console.warn("[NexPress] LocalStorageAdapter is not compatible with multi-node deployments. Use S3.");
// }
```

---

## O. Schema Evolution & Validation (HS-1, HS-3, HS-4)

### O.1 Runtime Validation (HS-1)

```typescript
/**
 * Zod schemas generated from collection config are used at BOTH:
 * - Build time: config validation in `pnpm db:generate`
 * - Runtime: API request validation in every mutation handler
 *
 * The same schema serves both purposes.
 */

/**
 * Generate runtime Zod schema from collection field config.
 * Used in saveDocument() Phase 1 validation.
 */
export function getCollectionZodSchema(collection: string): z.ZodSchema {
  const config = getCollectionConfig(collection);
  return buildZodSchema(config.fields);
}

function buildZodSchema(fields: NxFieldConfig[]): z.ZodObject<Record<string, z.ZodTypeAny>> {
  const shape: Record<string, z.ZodTypeAny> = {};

  for (const field of fields) {
    if (field.type === "row" || field.type === "collapsible") continue; // layout-only

    let schema: z.ZodTypeAny;
    switch (field.type) {
      case "text":
      case "textarea":
      case "email":
        schema = z.string();
        if ("minLength" in field && field.minLength)
          schema = (schema as z.ZodString).min(field.minLength);
        if ("maxLength" in field && field.maxLength)
          schema = (schema as z.ZodString).max(field.maxLength);
        break;
      case "number":
        schema = field.integerOnly ? z.number().int() : z.number();
        if (field.min !== undefined) schema = (schema as z.ZodNumber).min(field.min);
        if (field.max !== undefined) schema = (schema as z.ZodNumber).max(field.max);
        break;
      case "checkbox":
        schema = z.boolean();
        break;
      case "select":
      case "radio":
        schema = z.enum(field.options.map((o) => o.value) as [string, ...string[]]);
        break;
      case "relationship":
        schema = field.hasMany ? z.array(z.string().uuid()) : z.string().uuid();
        break;
      case "upload":
        schema = z.string().uuid();
        break;
      case "date":
        schema = z.coerce.date();
        break;
      case "richText":
      case "blocks":
      case "json":
        schema = z.unknown(); // Opaque JSON — validated by editor, not by field schema
        break;
      case "group":
        schema = buildZodSchema(field.fields);
        break;
      case "array":
        schema = z.array(buildZodSchema(field.fields));
        if (field.minRows) schema = (schema as z.ZodArray<z.ZodTypeAny>).min(field.minRows);
        if (field.maxRows) schema = (schema as z.ZodArray<z.ZodTypeAny>).max(field.maxRows);
        break;
      default:
        schema = z.unknown();
    }

    shape[field.name] = field.required ? schema : schema.optional().nullable();
  }

  return z.object(shape);
}
```

### O.2 Schema Evolution Guidelines (HS-3)

```
Code-first schema generation handles "initial create" well.
For schema evolution, the following rules apply:

1. ADD field:
   - Add field to collection config → pnpm db:generate → ALTER TABLE ADD COLUMN
   - New column is nullable by default → no data migration needed
   - Safe. No data loss.

2. REMOVE field:
   - Remove from config → pnpm db:generate → drizzle-kit generates DROP COLUMN
   - Developer MUST review migration SQL before applying
   - CLI prints WARNING: "Field 'subtitle' removed from 'posts'. This will drop data."
   - The generated migration is NOT auto-applied. Manual `pnpm db:migrate` required.

3. RENAME field:
   - Drizzle-kit sees "remove old + add new" (cannot infer rename)
   - Developer must manually edit migration: ALTER TABLE RENAME COLUMN
   - CLI prints WARNING: "Manual migration edit required for field rename."

4. CHANGE field type:
   - Type mismatch (e.g., text → number) generates DROP + ADD
   - Developer must write custom migration with CAST or data transform
   - CLI prints ERROR: "Type change on 'price' (text → number). Manual migration required."

5. DELETE collection:
   - Remove from config → drizzle-kit generates DROP TABLE
   - CLI prints WARNING: "Collection 'events' removed. All data will be lost."
   - Developer must confirm with --force flag or manual migration edit.

6. Plugin uninstall:
   - Plugin collections are prefixed: nx_c_{pluginId}_{slug}
   - Uninstall generates DROP TABLE for all plugin collections
   - CLI prints summary of tables to be dropped before applying.

General rule: pnpm db:generate NEVER auto-applies destructive changes.
All migrations are reviewable SQL files. Developer applies manually.
```

### O.3 Media Lifecycle (HS-4)

```typescript
/**
 * Media reference tracking and deletion policy.
 */

// 1. Reference tracking:
// When content is saved, the write pipeline extracts media IDs from:
// - upload fields (direct reference)
// - richText content (inline images in Lexical JSON)
// - block props (media references in block data)
// These are stored in a lightweight reference table:

export const nxMediaRefs = pgTable(
  "nx_media_refs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    mediaId: uuid("media_id")
      .notNull()
      .references(() => nxMedia.id, { onDelete: "cascade" }),
    collection: text("collection").notNull(),
    documentId: uuid("document_id").notNull(),
    field: text("field").notNull(),
  },
  (table) => ({
    mediaIdx: index("nx_media_refs_media").on(table.mediaId),
    docIdx: index("nx_media_refs_doc").on(table.documentId),
  }),
);

// 2. Deletion policy:
// DELETE /api/media/{id}:
//   a. Check nxMediaRefs for active references
//   b. If references exist: return 409 { error: "MEDIA_IN_USE", references: [...] }
//   c. If no references: soft-delete (set deletedAt timestamp)
//   d. After 30 days: "media:cleanup" job hard-deletes file from storage

// 3. Upload constraints (configurable in nexpress.config.ts):
export interface NxUploadConfig {
  maxFileSize: number; // bytes, default: 10 * 1024 * 1024 (10MB)
  allowedMimeTypes: string[]; // default: ["image/*", "application/pdf", "video/*"]
  imageSizes?: NxImageSize[]; // custom size definitions
}
```

---

## P. Search (HS-7)

### P.1 PostgreSQL Full-Text Search

```typescript
/**
 * v1 search: PostgreSQL tsvector/tsquery.
 * No external search engine needed.
 * Adequate for admin collection search and small-medium sites.
 */

// 1. Each generated collection table gets a tsvector column:
//    searchVector: tsvector("search_vector")
//    Updated on INSERT/UPDATE via a PostgreSQL trigger or in the write pipeline.

// 2. The search vector is built from text/textarea/richText fields:
export function buildSearchVector(
  config: NxCollectionConfig,
  data: Record<string, unknown>,
): string {
  const parts: string[] = [];
  for (const field of config.fields) {
    if (field.type === "text" || field.type === "textarea") {
      const value = data[field.name];
      if (typeof value === "string") parts.push(value);
    }
    if (field.type === "richText") {
      // Extract plain text from Lexical JSON
      const value = data[field.name];
      if (value) parts.push(extractPlainText(value as NxRichTextContent));
    }
  }
  return parts.join(" ");
}

// 3. Search query in findDocuments():
export async function findDocuments(collection: string, options: FindOptions) {
  const table = getTable(collection);
  let query = db.select().from(table);

  if (options.search) {
    // PostgreSQL full-text search with ranking
    query = query
      .where(sql`${table.searchVector} @@ plainto_tsquery('english', ${options.search})`)
      .orderBy(
        sql`ts_rank(${table.searchVector}, plainto_tsquery('english', ${options.search})) DESC`,
      );
  }

  // ...pagination, sorting, etc.
}

// 4. Generated schema addition for searchable collections:
//    searchVector: tsvector("search_vector"),
//    Index: GIN index on search_vector column
//
// Escalation: For large sites or advanced search (facets, typo tolerance),
// add Meilisearch/Typesense adapter. The search interface is abstracted.
```

---

## Appendix: QA Scenarios

### QA-A: Database Schema Generation

| #   | Tool                       | Scenario                                  | Steps                                                                         | Expected                                                                                                                        |
| --- | -------------------------- | ----------------------------------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| A1  | `pnpm` CLI                 | Generate schema from config               | 1. Define 3 collections in `nexpress.config.ts` 2. Run `pnpm db:generate`     | `drizzle/schema.generated.ts` contains 3 primary tables + join/array tables. File is deterministic (same config → same output). |
| A2  | `pnpm` CLI + `drizzle-kit` | Add field to existing collection          | 1. Add `subtitle: text` field to posts collection 2. Run `pnpm db:generate`   | New column in generated schema. `drizzle-kit generate` produces `ALTER TABLE nx_c_posts ADD COLUMN subtitle text` migration.    |
| A3  | `pnpm` CLI                 | Array field generates child table         | 1. Define `tags: array` field in posts config 2. Run `pnpm db:generate`       | `nx_c_posts__tags` table in generated schema with `parent_id`, `order`, and `tag` columns.                                      |
| A4  | `pnpm` CLI                 | hasMany relationship generates join table | 1. Define `categories: relationship, hasMany: true` 2. Run `pnpm db:generate` | `nx_c_posts__categories` join table with `post_id`, `category_id`, `order` columns and composite unique index.                  |
| A5  | `pnpm` CLI                 | Invalid config fails validation           | 1. Set collection slug to `"123invalid"` 2. Run `pnpm db:generate`            | CLI exits with non-zero code and validation error: "Slug must be lowercase alphanumeric with hyphens". No schema file written.  |

### QA-B: Content Modeling

| #   | Tool       | Scenario                         | Steps                                                                                                      | Expected                                                                                              |
| --- | ---------- | -------------------------------- | ---------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| B1  | `tsc`      | defineCollection type-checks     | 1. Call `defineCollection({...})` with all 16 field types 2. Run `pnpm tsc --noEmit`                       | Zero type errors.                                                                                     |
| B2  | `pnpm` CLI | Type generation                  | 1. Define posts and pages collections 2. Run `pnpm generate:types`                                         | `src/nexpress-types.ts` created with `Post` and `Page` interfaces matching field definitions.         |
| B3  | `pnpm` CLI | Group fields flatten correctly   | 1. Define `seo: group` with `metaTitle`, `metaDescription`, `ogImage` sub-fields 2. Run `pnpm db:generate` | Primary table has columns `seo_meta_title`, `seo_meta_description`, `seo_og_image` (no nested table). |
| B4  | `pnpm` CLI | Config validation catches errors | 1. Set `maxLength: 5` and `minLength: 10` on a text field 2. Run `pnpm db:generate`                        | CLI exits with error: "maxLength (5) is less than minLength (10)".                                    |

### QA-C: Authentication

| #   | Tool            | Scenario                              | Steps                                                                                                                                            | Expected                                                                                                                                       |
| --- | --------------- | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| C1  | `curl`          | Successful login                      | `curl -X POST http://localhost:3000/api/auth/login -H 'Content-Type: application/json' -d '{"email":"admin@test.com","password":"password"}' -v` | 200 status. Response body contains `user` object. `Set-Cookie` headers include `nx-session` (httpOnly, Secure, SameSite=Lax) and `nx-refresh`. |
| C2  | `curl`          | Failed login increments attempts      | 1. Send 3 POSTs to `/api/auth/login` with wrong password 2. Query `nx_users` table                                                               | Each returns 401. `login_attempts` column equals 3.                                                                                            |
| C3  | `curl` + `psql` | Account lockout                       | 1. Set `maxLoginAttempts=3` in config 2. Send 3 wrong-password requests 3. Send correct password                                                 | First 3 return 401. 4th returns 429 with "Account locked". `psql: SELECT lock_until FROM nx_users` shows future timestamp.                     |
| C4  | `curl`          | Token invalidation on password change | 1. Login (save cookie) 2. PATCH `/api/auth/change-password` 3. GET `/api/auth/me` with old cookie                                                | Step 3 returns 401 (tokenVersion mismatch after password change).                                                                              |
| C5  | `curl`          | Expired token rejected                | 1. Login with `tokenExpiration: 1` (1 second) 2. Wait 2 seconds 3. GET `/api/auth/me`                                                            | 401 response. `nx-session` cookie is expired/invalid.                                                                                          |
| C6  | `curl`          | Role-based access denied              | 1. Login as user with role "author" 2. `curl -X DELETE /api/collections/posts/{id}` with session cookie                                          | 403 response. Body: `{"error":"Forbidden"}`.                                                                                                   |

### QA-D: Rendering Layer

| #   | Tool                  | Scenario                              | Steps                                                                                                      | Expected                                                                                                                                         |
| --- | --------------------- | ------------------------------------- | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| D1  | Playwright            | Public page renders from blocks       | 1. Seed a page with Hero + FeatureGrid blocks 2. `await page.goto('/')` 3. Assert block components visible | `page.locator('[data-block="hero"]')` is visible. `page.locator('[data-block="feature-grid"]')` is visible. Theme CSS custom properties applied. |
| D2  | Playwright            | Blog post renders rich text           | 1. Seed a post with Lexical content 2. `await page.goto('/blog/test-post')` 3. Check rendered HTML         | `page.locator('article h1')` contains post title. `page.locator('.prose p')` contains paragraph text. No `lexical` JS chunks in network tab.     |
| D3  | Playwright            | Draft mode shows unpublished          | 1. Login as editor 2. `await page.goto('/api/preview?path=/blog/draft-post')` 3. Check for draft content   | `page.locator('[data-draft-banner]')` is visible. Draft post content is rendered.                                                                |
| D4  | `curl` + Playwright   | ISR revalidation                      | 1. Visit `/blog/test-post` (cache) 2. PATCH post title via API 3. Wait 1s 4. Visit `/blog/test-post` again | New title appears. `x-nextjs-cache` header shows `MISS` on second request.                                                                       |
| D5  | `next build` + `grep` | Admin components don't leak to public | 1. Run `pnpm build` 2. `grep -r "@nexpress/admin" .next/static/chunks/`                                    | Zero matches. No admin package imports in public site chunks.                                                                                    |

### QA-E: Admin UI

| #   | Tool                | Scenario                         | Steps                                                                                                | Expected                                                                                                                                                             |
| --- | ------------------- | -------------------------------- | ---------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| E1  | Playwright          | Unauthenticated access redirects | 1. `await page.goto('/admin')` (no login)                                                            | URL changes to `/admin/login?redirect=%2Fadmin`. Login form visible.                                                                                                 |
| E2  | Playwright          | Collection list view             | 1. Login as admin 2. `await page.goto('/admin/collections/posts')`                                   | DataTable visible with columns matching `config.admin.listColumns`. Pagination controls present.                                                                     |
| E3  | Playwright          | Create document                  | 1. Click "Create Post" 2. Fill title, excerpt 3. Click "Save"                                        | URL changes to `/admin/collections/posts/{new-id}`. Toast/flash confirms creation. `psql: SELECT * FROM nx_c_posts` shows new row.                                   |
| E4  | Playwright + `psql` | Edit document with revision      | 1. Navigate to existing post edit view 2. Change title 3. Click "Save"                               | Title updated in DB. `psql: SELECT * FROM nx_revisions WHERE document_id='{id}'` shows new revision with `version` incremented.                                      |
| E5  | Playwright          | Form auto-generation             | 1. Define collection with text, checkbox, select, richText, upload fields 2. Navigate to create view | Each field type renders correct component: `<input>` for text, `<Switch>` for checkbox, `<Select>` for select, Lexical editor for richText, media picker for upload. |
| E6  | Playwright          | Sidebar groups collections       | 1. Set `admin.group: "Blog"` on posts and categories 2. Visit `/admin`                               | Sidebar contains "Blog" group heading. Posts and Categories links are nested under it.                                                                               |

### QA-F: Editor System

| #   | Tool       | Scenario                        | Steps                                                                                                                                              | Expected                                                                                                                      |
| --- | ---------- | ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| F1  | Playwright | Rich text editor loads in admin | 1. Login 2. Navigate to create post 3. Click on content field                                                                                      | Lexical editor initializes. Toolbar visible with configured features (bold, italic, heading, link, image, list, quote, code). |
| F2  | Playwright | Rich text formatting            | 1. Type text in editor 2. Select text 3. Click bold button 4. Save                                                                                 | `psql: SELECT content FROM nx_c_posts` returns Lexical JSON with `{ "type": "text", "format": 1 }` (bold).                    |
| F3  | Playwright | Block page editor drag-and-drop | 1. Create a page 2. Add Hero and FeatureGrid blocks 3. Drag FeatureGrid above Hero 4. Save                                                         | `psql: SELECT blocks FROM nx_c_pages` returns JSON array with FeatureGrid at index 0, Hero at index 1.                        |
| F4  | Playwright | Block props editor              | 1. Add Hero block to page 2. Click gear icon (⚙) on Hero 3. Edit title prop 4. Save                                                                | Block `props.title` updated in DB.                                                                                            |
| F5  | Vitest     | renderRichText SSR correctness  | 1. Create Lexical JSON with paragraph, heading, link, image nodes 2. Call `renderRichText(content)` 3. Render to string via `renderToStaticMarkup` | Output HTML contains `<p>`, `<h2>`, `<a href="...">`, `<img>` elements. No Lexical runtime imports.                           |
| F6  | Vitest     | Block data binding              | 1. Create NxBlockInstance with `dataBinding: { collection: "posts", limit: 3 }` 2. Render block server-side                                        | Block receives 3 posts from DB as props.                                                                                      |

### QA-G: Media System

| #   | Tool                | Scenario                               | Steps                                                                                                                                 | Expected                                                                                                                                                                                                                                                                            |
| --- | ------------------- | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| G1  | `curl`              | Upload image (async)                   | `curl -X POST http://localhost:3000/api/media/upload -H 'Cookie: nx-session=...' -F 'file=@test.jpg'`                                 | 202 response. Body contains `id`, `filename`, `mimeType`, `status: "processing"`. `sizes` is null (not yet generated). `psql: SELECT status FROM nx_media WHERE id='{id}'` returns `"processing"`.                                                                                  |
| G2  | `psql` + filesystem | Image variants generated after job     | 1. Upload 2000x1500 JPEG (G1) 2. Wait for worker to process job 3. Check storage and DB                                               | `psql: SELECT status, sizes FROM nx_media WHERE id='{id}'` returns `status = "ready"`, `sizes` JSON has thumbnail/small/medium/large/og entries. Files exist: `{id}/original.jpg`, `{id}/thumbnail.webp`, `{id}/small.webp`, `{id}/medium.webp`, `{id}/large.webp`, `{id}/og.webp`. |
| G3  | `curl`              | Unauthenticated upload rejected        | `curl -X POST http://localhost:3000/api/media/upload -F 'file=@test.jpg'` (no cookie)                                                 | 401 response. No file saved.                                                                                                                                                                                                                                                        |
| G4  | `curl` + `psql`     | Delete unreferenced media soft-deletes | 1. Upload image (no content references) 2. `curl -X DELETE /api/media/{id}` 3. Check DB                                               | 200 response `{ deleted: true }`. `psql: SELECT deleted_at FROM nx_media WHERE id='{id}'` shows non-null timestamp. Storage files still exist (hard-deleted by cleanup job after 30 days).                                                                                          |
| G4b | `curl`              | Delete referenced media blocked        | 1. Upload image 2. Reference it in a post 3. `curl -X DELETE /api/media/{id}`                                                         | 409 response. `{ error: { code: "MEDIA_IN_USE", references: [...] } }`. Media NOT deleted.                                                                                                                                                                                          |
| G5  | Playwright          | Media library UI                       | 1. Login 2. Navigate to `/admin/media` 3. Upload via drag-drop                                                                        | Upload progress shown. New thumbnail appears in media grid. Folder navigation works.                                                                                                                                                                                                |
| G6  | Vitest              | Storage adapter interface              | 1. Create `LocalStorageAdapter({ directory: "/tmp/test", baseUrl: "/media" })` 2. Call `upload()`, `getUrl()`, `exists()`, `delete()` | Each method executes without error. `exists()` returns true after upload, false after delete. `getUrl()` returns `/media/{key}`.                                                                                                                                                    |

### QA-H: Theme Engine

| #   | Tool       | Scenario                         | Steps                                                                                                          | Expected                                                                                                                      |
| --- | ---------- | -------------------------------- | -------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| H1  | Vitest     | Theme JSON → CSS conversion      | 1. Call `generateThemeCss(DEFAULT_THEME)`                                                                      | Output string contains `@layer nx-theme { :root { --nx-color-primary: oklch(0.55 0.20 250); ... } }`. All token keys present. |
| H2  | Vitest     | Dark mode CSS                    | 1. Call `generateThemeCss(DEFAULT_THEME)` with `darkMode.enabled: true`                                        | Output contains `[data-theme="dark"] { --nx-color-background: oklch(0.15 0.02 260); ... }`.                                   |
| H3  | Playwright | Theme changes apply live         | 1. Login 2. Navigate to `/admin/settings/theme` 3. Change primary color 4. Save 5. Open public site in new tab | Public site `<style>` tag contains updated `--nx-color-primary` value.                                                        |
| H4  | Playwright | Tailwind v4 uses NexPress tokens | 1. Add `className="bg-primary text-primary-foreground"` to a block 2. Visit public page                        | Element has background color matching `--nx-color-primary` and text color matching `--nx-color-primary-foreground`.           |
| H5  | Vitest     | NxThemeStyle is server-only      | 1. Import `NxThemeStyle` 2. Render via `renderToStaticMarkup`                                                  | Returns a `<style>` tag with CSS. No `"use client"` directive in source. Zero client JS.                                      |

### QA-I: Agent Interface

| #   | Tool            | Scenario                                | Steps                                                                                                                     | Expected                                                                                                                                                                                                             |
| --- | --------------- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| I1  | `curl`          | Block manifest API                      | `curl http://localhost:3000/api/manifest/blocks`                                                                          | 200 response. JSON array of blocks, each with `type`, `label`, `description`, `propsSchema` (valid JSON Schema), `defaultProps`, `category`.                                                                         |
| I2  | `curl`          | Collection manifest API                 | `curl http://localhost:3000/api/manifest/collections`                                                                     | 200 response. JSON array of collections, each with `slug`, `labels`, `fields` (schema descriptions), `access` booleans.                                                                                              |
| I3  | `curl`          | OpenAPI spec generated                  | `curl http://localhost:3000/api/openapi.json`                                                                             | Valid OpenAPI 3.1 JSON. Contains CRUD paths for each collection (`/api/collections/{slug}`), auth endpoints, media endpoints, manifest endpoints.                                                                    |
| I4  | `curl`          | Import preflight rejects unknown blocks | `curl -X POST /api/import -H 'Cookie: nx-session=...' -d '{"pages":[{"slug":"test","blocks":[{"type":"nonexistent"}]}]}'` | 422 response. Body: `{ error: { code: "IMPORT_PREFLIGHT_FAILED", details: ["Unknown block type: nonexistent"] } }`. No data written.                                                                                 |
| I5  | `curl`          | Import succeeds with valid payload      | `curl -X POST /api/import -H 'Cookie: nx-session=...' -d @site-export.json`                                               | 200 response. Body: `{ "success": true, "created": N, "updated": M, "skipped": [], "warnings": [] }`. Pages, navigation, theme, plugin configs applied.                                                              |
| I6  | `curl`          | Export site config                      | `curl /api/export -H 'Cookie: nx-session=...'`                                                                            | 200 response. Body matches `NxSiteConfig` schema. Contains collection schemas, pages, theme, navigation, plugins, settings. Media refs include `{ id, filename, hash }`. Excludes passwords and API keys.            |
| I7  | Vitest          | NxSiteConfig round-trip                 | 1. Export config 2. Reset DB 3. Import exported config 4. Export again                                                    | Second export matches first export (modulo timestamps, UUIDs). Slug-based upsert produces identical content.                                                                                                         |
| I8  | `curl` + `psql` | Import is transactional                 | 1. Send import with valid theme + page referencing nonexistent media 2. Check DB                                          | 200 response with `warnings` listing unresolved media ref. Theme AND page both written (media ref nullified). If payload has structural error mid-write, entire import rolls back — `psql` confirms no partial data. |
| I9  | `curl`          | Import is idempotent                    | 1. POST same import payload twice                                                                                         | Both return 200. Second run: `created: 0, updated: N`. No duplicate pages or settings.                                                                                                                               |
| I10 | `curl`          | Non-admin import rejected               | 1. Login as "author" role 2. POST `/api/import`                                                                           | 403 response. `{ error: { code: "FORBIDDEN" } }`.                                                                                                                                                                    |

### QA-J: CLI & Project Structure

| #   | Tool             | Scenario                          | Steps                                                                     | Expected                                                                                                                                                                                                       |
| --- | ---------------- | --------------------------------- | ------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| J1  | `npx` CLI        | create-nexpress scaffolds project | `npx create-nexpress test-site --yes` (non-interactive defaults)          | Directory `test-site/` created. Contains `src/collections/`, `src/blocks/`, `src/app/`, `src/nexpress.config.ts`, `docker/`, `package.json`, `.env.example`.                                                   |
| J2  | `pnpm` CLI       | Scaffolded project builds         | 1. `cd test-site` 2. `pnpm install` 3. `pnpm build`                       | Exit code 0. `.next/` directory created. No type errors.                                                                                                                                                       |
| J3  | `docker compose` | Docker compose starts full stack  | 1. `cd test-site` 2. `docker compose up -d` 3. Wait for health checks     | `nexpress` and `db` services running. `curl http://localhost:3000` returns 200. `docker compose exec db pg_isready` succeeds.                                                                                  |
| J4  | `pnpm` CLI       | Turbo pipeline order              | 1. Run `pnpm build` from monorepo root                                    | Packages build in dependency order: core → admin/editor/theme/blocks → cli → apps/web. No circular dependency errors.                                                                                          |
| J5  | `pnpm` CLI       | DB migration flow                 | 1. `pnpm db:generate` 2. `pnpm db:migrate` 3. `psql -c "\dt nx_*"`        | Migration file created in `drizzle/migrations/`. Tables `nx_users`, `nx_sessions`, `nx_revisions`, `nx_settings`, `nx_navigation`, `nx_plugins`, `nx_media`, `nx_media_folders`, `nx_c_posts`, etc. all exist. |
| J6  | `pnpm` CLI       | Dev server starts                 | 1. `pnpm dev` 2. Wait for "Ready" message 3. `curl http://localhost:3000` | Dev server starts. Hot reload works. Public site and `/admin` routes both accessible.                                                                                                                          |

### QA-K: Routing Contract

| #   | Tool       | Scenario                                   | Steps                                                                                                                                | Expected                                                                                                             |
| --- | ---------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------- |
| K1  | `pnpm` CLI | Reserved path rejected as slug             | 1. Set collection slug to `"admin"` in config 2. Run `pnpm db:generate`                                                              | CLI exits with error: "Slug 'admin' conflicts with reserved path". No schema generated.                              |
| K2  | `pnpm` CLI | Page slug collision rejected               | 1. Create a page with slug `"blog"` 2. Have a collection with dedicated `/blog/[slug]` route 3. Run `pnpm build`                     | Build fails with error: "Page slug 'blog' collides with static route /blog/[slug]. Page would be unreachable."       |
| K3  | Playwright | Homepage matches optional catch-all        | 1. Create page with slug `"/"` 2. `await page.goto('/')`                                                                             | Homepage renders from `[[...slug]]` catch-all. Page content visible. No 404.                                         |
| K4  | Playwright | Nested page path resolves                  | 1. Create page with slug `"about/team"` 2. `await page.goto('/about/team')`                                                          | Page renders correctly via `[[...slug]]` catch-all. `slug` param is `["about", "team"]`.                             |
| K5  | `curl`     | Plugin root-level rewrite works            | 1. Install SEO plugin with `kind: "site"` and `exposeAt: "/sitemap.xml"` 2. `pnpm build` 3. `curl http://localhost:3000/sitemap.xml` | Response is valid sitemap XML. Request was rewritten to `/api/plugins/seo/sitemap.xml` internally.                   |
| K6  | `pnpm` CLI | Static routes take priority over catch-all | 1. Create page with slug `"api"` 2. `curl http://localhost:3000/api`                                                                 | API route handler responds (not the page). Reserved path has higher priority. Config validator warned at build time. |

### QA-L: Write Pipeline & Access Control

| #   | Tool            | Scenario                                  | Steps                                                                                                                                                                                        | Expected                                                                                                                                        |
| --- | --------------- | ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| L1  | `curl` + `psql` | saveDocument atomic transaction           | 1. POST to create a post with a `hasMany` relationship 2. Intentionally trigger a constraint violation on the join table (e.g., nonexistent category ID) 3. `psql: SELECT * FROM nx_c_posts` | Post row NOT created (entire transaction rolled back). No orphan rows in join tables.                                                           |
| L2  | `curl`          | Zod validation rejects invalid input      | `curl -X POST /api/collections/posts -d '{"title": 123}'` with auth                                                                                                                          | 400 response. Body: `{ error: { code: "VALIDATION_ERROR", details: [{ path: ["title"], message: "Expected string" }] } }`. No document created. |
| L3  | `curl`          | Access control denies unauthorized create | 1. Configure posts access: `create: ({ user }) => user.role === "admin"` 2. Login as author 3. POST to create post                                                                           | 403 response. `{ error: { code: "FORBIDDEN" } }`. No document created in DB.                                                                    |
| L4  | `curl` + `psql` | Before hook can modify data               | 1. Add `beforeCreate` hook that sets `slug` from `title` 2. POST with title "Hello World" (no slug)                                                                                          | Document created with `slug: "hello-world"`. Hook transformation applied before DB write.                                                       |
| L5  | `curl` + `psql` | After hooks run via job queue             | 1. Add `afterCreate` hook that logs to a test table 2. POST to create a post 3. Wait 2s 4. Check test table                                                                                  | Post created immediately (201 response). After-hook side effect appears in test table within 2s (job queue processed).                          |
| L6  | `curl`          | Read access can be public or gated        | 1. Set posts `access.read` to `() => true` (public) 2. GET `/api/collections/posts` without auth                                                                                             | 200 response. Public data returned. No auth cookie needed.                                                                                      |

### QA-M: Background Jobs & Worker

| #   | Tool            | Scenario                                     | Steps                                                                                                                                                                     | Expected                                                                                                                              |
| --- | --------------- | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| M1  | `curl` + `psql` | Media upload returns 202 and enqueues job    | 1. POST `/api/media/upload` with a 5MB JPEG 2. Check response 3. `psql: SELECT status FROM nx_media WHERE id='{id}'`                                                      | 202 response with `{ id, status: "processing" }`. DB row has `status = "processing"`. Original file saved to storage.                 |
| M2  | `psql`          | Image processing job completes               | 1. Upload image (M1) 2. Wait for worker 3. `psql: SELECT status, sizes FROM nx_media WHERE id='{id}'`                                                                     | `status = "ready"`. `sizes` JSON contains thumbnail, small, medium, large, og entries with dimensions. Storage has all variant files. |
| M3  | `psql`          | Revision pruning job cleans old revisions    | 1. Create 30 revisions for a single post 2. Run `system:revisionPrune` job (or wait for daily cron) 3. `psql: SELECT count(*) FROM nx_revisions WHERE document_id='{id}'` | Count ≤ `maxPublished` (default 20). Latest revision preserved. Oldest excess revisions deleted.                                      |
| M4  | `psql`          | Session cleanup job                          | 1. Insert expired session rows (past `expires_at`) 2. Run `system:sessionCleanup` job 3. `psql: SELECT count(*) FROM nx_sessions WHERE expires_at < now()`                | Count = 0. Expired sessions purged. Valid sessions untouched.                                                                         |
| M5  | `curl` + `psql` | Content save triggers cache invalidation job | 1. GET a cached page (ISR) 2. PATCH the post via API 3. Wait 2s for job 4. GET same page again                                                                            | Updated content appears. `content:afterSave` job ran `revalidateTag`. Second request shows fresh data.                                |

### QA-N: Platform Policies

| #   | Tool       | Scenario                            | Steps                                                                                              | Expected                                                                                                                                                                                           |
| --- | ---------- | ----------------------------------- | -------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| N1  | `curl`     | API errors follow NxApiError format | 1. GET `/api/collections/nonexistent`                                                              | 404 response. Body matches `{ error: { code: "NOT_FOUND", message: "..." }, status: 404 }`. No ad-hoc error format.                                                                                |
| N2  | `curl`     | Security headers present            | `curl -I http://localhost:3000/`                                                                   | Response headers include: `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`, `Content-Security-Policy` with `frame-ancestors 'none'`. |
| N3  | `curl`     | Auth endpoint rate limited          | 1. Send 11 rapid POST requests to `/api/auth/login` from same IP                                   | First 10 return 401 (wrong password). 11th returns 429 `{ error: { code: "RATE_LIMITED" } }`.                                                                                                      |
| N4  | Vitest     | CSS sanitization strips injection   | 1. Call `sanitizeTokenValue("red; } body { background: url(evil)")`                                | Returns `"red  body { background evil"` (semicolons stripped, url() stripped, block terminators stripped). Length ≤ 200 chars.                                                                     |
| N5  | Vitest     | nxCache wraps unstable_cache        | 1. Mock `unstable_cache` 2. Call `nxCache(fn, ["key"], { tags: ["t1"] })` 3. Check mock was called | `unstable_cache` called with same arguments. Abstraction is pass-through.                                                                                                                          |
| N6  | `curl`     | Draft content not cached            | 1. Enter draft mode (`/api/preview?path=/blog/draft`) 2. GET draft page 3. Check response headers  | `Cache-Control: no-store` header present. Draft content served fresh from DB, not from ISR cache.                                                                                                  |
| N7  | `pnpm` CLI | Local storage multi-node warning    | 1. Set `NX_MULTI_NODE=true` in env 2. Set storage adapter to "local" 3. Start server               | Console output includes WARNING: "LocalStorageAdapter is not compatible with multi-node deployments. Use S3."                                                                                      |

### QA-O: Schema Evolution & Validation

| #   | Tool            | Scenario                                    | Steps                                                                                                                            | Expected                                                                                                                          |
| --- | --------------- | ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| O1  | `curl`          | Runtime Zod validation rejects invalid data | 1. POST `/api/collections/posts` with `{ title: null }` where title is `required: true`                                          | 400 response. `{ error: { code: "VALIDATION_ERROR", details: [{ path: ["title"] }] } }`.                                          |
| O2  | `curl`          | Runtime Zod validates field constraints     | 1. Define text field with `minLength: 5` 2. POST with `{ title: "Hi" }`                                                          | 400 response. Zod error includes "String must contain at least 5 character(s)".                                                   |
| O3  | `pnpm` CLI      | Add field generates safe migration          | 1. Add `subtitle: text` field 2. Run `pnpm db:generate`                                                                          | Migration SQL: `ALTER TABLE ADD COLUMN subtitle text`. Column is nullable. No data loss.                                          |
| O4  | `pnpm` CLI      | Remove field warns about data loss          | 1. Remove `subtitle` field from config 2. Run `pnpm db:generate`                                                                 | CLI prints WARNING: "Field 'subtitle' removed from 'posts'. This will drop data." Migration file generated but NOT auto-applied.  |
| O5  | `pnpm` CLI      | Type change requires manual migration       | 1. Change field type from `text` to `number` 2. Run `pnpm db:generate`                                                           | CLI prints ERROR: "Type change on field. Manual migration required." Developer must write custom migration with CAST.             |
| O6  | `curl` + `psql` | Media ref tracking on save                  | 1. Create a post with an upload field referencing media ID `{mid}` 2. `psql: SELECT * FROM nx_media_refs WHERE media_id='{mid}'` | Row exists with `collection: "posts"`, `document_id: "{pid}"`, `field: "image"`.                                                  |
| O7  | `curl`          | Delete media blocked when in use            | 1. Upload media 2. Reference it in a post 3. `DELETE /api/media/{id}`                                                            | 409 response. `{ error: { code: "MEDIA_IN_USE", references: [{ collection: "posts", documentId: "..." }] } }`. Media not deleted. |
| O8  | `curl` + `psql` | Delete unreferenced media soft-deletes      | 1. Upload media (no references) 2. `DELETE /api/media/{id}` 3. `psql: SELECT deleted_at FROM nx_media WHERE id='{id}'`           | 200 response. `deleted_at` is set to current timestamp. Storage files still exist (hard-deleted by cleanup job after 30 days).    |

### QA-P: Search

| #   | Tool   | Scenario                                | Steps                                                                                                                                         | Expected                                                                                                                                                  |
| --- | ------ | --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P1  | `curl` | Full-text search returns ranked results | 1. Seed 3 posts: "TypeScript Guide", "JavaScript Tips", "TypeScript Advanced" 2. `GET /api/collections/posts?search=TypeScript`               | 200 response. Results contain 2 posts. Ordered by relevance (ts_rank). "TypeScript Guide" and "TypeScript Advanced" returned, "JavaScript Tips" excluded. |
| P2  | `curl` | Search works across rich text content   | 1. Create a post with title "Intro" and rich text body containing "PostgreSQL optimization" 2. `GET /api/collections/posts?search=PostgreSQL` | 200 response. Post returned — search vector includes text extracted from Lexical rich text JSON.                                                          |
| P3  | `psql` | Search vector auto-populated            | 1. Create a post via API 2. `psql: SELECT search_vector FROM nx_c_posts WHERE id='{id}'`                                                      | `search_vector` column is NOT NULL. Contains tsvector tokens from title, excerpt, and rich text content fields.                                           |
| P4  | `curl` | Empty search returns all documents      | `GET /api/collections/posts` (no `search` param)                                                                                              | 200 response. Returns paginated results sorted by `-createdAt` (default). No FTS filtering applied.                                                       |
| P5  | `psql` | GIN index exists on search_vector       | `psql: SELECT indexname FROM pg_indexes WHERE tablename='nx_c_posts' AND indexdef LIKE '%gin%'`                                               | At least one GIN index on `search_vector` column.                                                                                                         |
