export type NxUserRole = "admin" | "editor" | "author" | "viewer";

export interface NxAuthUser {
  id: string;
  email: string;
  name: string;
  role: NxUserRole;
  tokenVersion: number;
}

export type NxAccessFunction = (args: {
  user: NxAuthUser | null;
  doc?: Record<string, unknown>;
  data?: Record<string, unknown>;
}) => boolean | Promise<boolean>;

export type NxFieldCondition = (
  data: Record<string, unknown>,
  siblingData: Record<string, unknown>,
) => boolean;

export type NxFieldValidator = (
  value: unknown,
  args: { data: Record<string, unknown>; siblingData: Record<string, unknown> },
) => string | true | Promise<string | true>;

export type NxRichTextContent = Record<string, unknown>;

export interface NxEditorConfig {
  features?: string[];
}

interface NxFieldBase {
  name: string;
  label?: string;
  required?: boolean;
  defaultValue?: unknown;
  hidden?: boolean;
  admin?: {
    description?: string;
    placeholder?: string;
    readOnly?: boolean;
    condition?: NxFieldCondition;
    width?: string;
  };
  validate?: NxFieldValidator;
}

export interface NxTextField extends NxFieldBase {
  type: "text";
  minLength?: number;
  maxLength?: number;
  unique?: boolean;
}

export interface NxTextareaField extends NxFieldBase {
  type: "textarea";
  minLength?: number;
  maxLength?: number;
  rows?: number;
}

export interface NxNumberField extends NxFieldBase {
  type: "number";
  min?: number;
  max?: number;
  step?: number;
  integerOnly?: boolean;
}

export interface NxRichTextField extends NxFieldBase {
  type: "richText";
  editor?: NxEditorConfig;
}

export interface NxBlocksField extends NxFieldBase {
  type: "blocks";
  allowedBlocks?: string[];
  minRows?: number;
  maxRows?: number;
}

export interface NxCheckboxField extends NxFieldBase {
  type: "checkbox";
  defaultValue?: boolean;
}

export interface NxDateField extends NxFieldBase {
  type: "date";
  pickerOptions?: {
    format?: string;
    includeTime?: boolean;
  };
}

export interface NxUploadField extends NxFieldBase {
  type: "upload";
  relationTo: string;
}

export interface NxRelationshipField extends NxFieldBase {
  type: "relationship";
  relationTo: string | string[];
  hasMany?: boolean;
  filterOptions?: Record<string, unknown>;
}

export interface NxSelectField extends NxFieldBase {
  type: "select";
  options: Array<{ label: string; value: string }>;
  hasMany?: boolean;
}

export interface NxRadioField extends NxFieldBase {
  type: "radio";
  options: Array<{ label: string; value: string }>;
}

export interface NxEmailField extends NxFieldBase {
  type: "email";
}

export interface NxJsonField extends NxFieldBase {
  type: "json";
}

export interface NxArrayField extends NxFieldBase {
  type: "array";
  fields: NxFieldConfig[];
  minRows?: number;
  maxRows?: number;
}

export interface NxGroupField extends NxFieldBase {
  type: "group";
  fields: NxFieldConfig[];
}

export interface NxRowField {
  type: "row";
  fields: NxFieldConfig[];
}

export interface NxCollapsibleField {
  type: "collapsible";
  label: string;
  fields: NxFieldConfig[];
}

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

export type NxCollectionHook = (args: {
  data: Record<string, unknown>;
  user: NxAuthUser;
  collection: string;
  originalDoc?: Record<string, unknown> | null;
}) => Record<string, unknown> | Promise<Record<string, unknown>>;

export interface NxUploadConfig {
  maxFileSize?: number;
  allowedMimeTypes?: string[];
  imageSizes?: NxImageSize[];
}

export interface NxImageSize {
  name: string;
  width: number;
  height?: number;
  crop?: "center" | "top" | "bottom" | "left" | "right";
}

export interface NxCollectionConfig {
  slug: string;
  labels: { singular: string; plural: string };
  slugField?:
    | boolean
    | {
        useField?: string;
        unique?: boolean;
      };
  fields: NxFieldConfig[];
  access?: {
    create?: NxAccessFunction;
    read?: NxAccessFunction;
    update?: NxAccessFunction;
    delete?: NxAccessFunction;
  };
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
  versions?: {
    drafts?: boolean | { autosave?: boolean; autosaveInterval?: number };
    max?: number;
  };
  timestamps?: boolean;
  admin?: {
    listColumns?: string[];
    defaultSort?: string;
    group?: string;
    hidden?: boolean;
    description?: string;
    components?: {
      listView?: string;
      editView?: string;
      createView?: string;
    };
  };
  upload?: NxUploadConfig;
}

export interface NxBlockConfig {
  slug: string;
  labels: { singular: string; plural: string };
  fields: NxFieldConfig[];
  imageUrl?: string;
}

export type NxBlockInstance = {
  blockType: string;
  [key: string]: unknown;
};

export interface NxPluginConfig {
  id: string;
  name: string;
  init?: (ctx: NxPluginContext) => void | Promise<void>;
}

/**
 * Structural shape accepted by `loadPlugins()` for SDK-built plugins.
 * Declared here rather than imported from `@nexpress/plugin-sdk` to avoid a
 * dependency cycle (plugin-sdk already depends on core).
 */
export interface NxResolvedPluginLike {
  manifest: {
    id: string;
    name: string;
    version?: string;
    description?: string;
    capabilities: readonly string[];
  };
  hooks?: Record<string, unknown>;
  routes?: ReadonlyArray<{
    path: string;
    method: string;
    handler: unknown;
    description?: string;
    auth?: boolean;
  }>;
}

export interface NxPluginContext {
  addCollection: (config: NxCollectionConfig) => void;
  addBlock: (config: NxBlockConfig) => void;
  addHook: (
    collection: string,
    event: string,
    hook: NxCollectionHook,
  ) => void;
}

export interface NxNavItem {
  id: string;
  label: string;
  type: "link" | "collection" | "page";
  url?: string;
  collection?: string;
  pageId?: string;
  children?: NxNavItem[];
}

export interface NxConfig {
  site: {
    name: string;
    url: string;
  };
  db: {
    connectionString: string;
    pool?: { max?: number };
  };
  storage?: {
    adapter: "local" | "s3";
    local?: { directory: string; baseUrl: string };
    s3?: { bucket: string; region: string; endpoint?: string };
  };
  collections: NxCollectionConfig[];
  blocks?: NxBlockConfig[];
  editor?: NxEditorConfig;
  images?: {
    sizes?: NxImageSize[];
    format?: "webp" | "avif" | "jpeg" | "png";
    quality?: number;
  };
  auth?: {
    secret: string;
    tokenExpiration?: number;
    refreshTokenExpiration?: number;
    maxLoginAttempts?: number;
    lockoutDuration?: number;
  };
  plugins?: Array<NxPluginConfig | NxResolvedPluginLike>;
  typescript?: {
    outputFile?: string;
  };
}

export type NxJobType =
  | "content:afterSave"
  | "content:afterDelete"
  | "content:publishScheduled"
  | "media:processImage"
  | "media:cleanup"
  | "plugin:scheduledTask"
  | "system:revisionPrune"
  | "system:sessionCleanup"
  | "auth:sendPasswordReset";

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

export type NxDocumentStatus = "draft" | "scheduled" | "published" | "archived";

export interface NxSaveOptions {
  status?: NxDocumentStatus;
}

export interface NxSaveResult {
  doc: Record<string, unknown>;
  operation: "create" | "update";
}

export const ROLE_HIERARCHY: Record<NxUserRole, number> = {
  viewer: 0,
  author: 1,
  editor: 2,
  admin: 3,
};

export function hasRole(user: NxAuthUser, minRole: NxUserRole): boolean {
  return ROLE_HIERARCHY[user.role] >= ROLE_HIERARCHY[minRole];
}
