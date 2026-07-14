import {
  npSerializeMediaRecord,
  npValidateMediaApiItem,
  type NpMediaApiItem,
  type NpMediaRecord,
  type NpMediaUploaderSummary,
} from "@nexpress/core/media-contract";
import { getStorageAdapter, npGetStorageObjectUrl } from "@nexpress/core/storage";

export async function toMediaApiItem(
  record: NpMediaRecord,
  uploader?: NpMediaUploaderSummary | null,
): Promise<NpMediaApiItem> {
  const adapter = getStorageAdapter();
  const thumbnail = record.sizes?.thumbnail ?? null;
  const [originalUrl, thumbnailUrl] = await Promise.all([
    npGetStorageObjectUrl(adapter, record.storageKey),
    thumbnail ? npGetStorageObjectUrl(adapter, thumbnail.storageKey) : Promise.resolve(null),
  ]);
  const item: NpMediaApiItem = {
    ...npSerializeMediaRecord(record),
    urls: { original: originalUrl, thumbnail: thumbnailUrl },
    ...(uploader !== undefined ? { uploader } : {}),
  };
  const validation = npValidateMediaApiItem(item);
  if (!validation.ok) {
    throw new Error(
      `Invalid media API item at ${validation.issue.path}: ${validation.issue.message}`,
    );
  }
  return item;
}
