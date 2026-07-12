interface NpNavItemBase {
  id: string;
  label: string;
  children?: NpNavItem[];
}

export interface NpNavLinkItem extends NpNavItemBase {
  type: "link";
  url: string;
  collection?: never;
  collectionSlug?: never;
  pageId?: never;
}

export interface NpNavCollectionItem extends NpNavItemBase {
  type: "collection";
  collection: string;
  url?: never;
  collectionSlug?: never;
  pageId?: never;
}

export interface NpNavPageItem extends NpNavItemBase {
  type: "page";
  pageId: string;
  collectionSlug?: string;
  url?: never;
  collection?: never;
}

/** Stable recursive wire item stored in `np_navigation.items`. */
export type NpNavItem = NpNavLinkItem | NpNavCollectionItem | NpNavPageItem;

export type NpNavigationItems = NpNavItem[];

interface NpResolvedNavItemBase {
  id: string;
  label: string;
  url: string;
  children?: NpResolvedNavItem[];
}

export type NpResolvedNavItem =
  | (NpResolvedNavItemBase & { type: "link" })
  | (NpResolvedNavItemBase & { type: "collection"; collection: string })
  | (NpResolvedNavItemBase & {
      type: "page";
      pageId: string;
      collectionSlug?: string;
    });

export type NpResolvedNavigationItems = NpResolvedNavItem[];
