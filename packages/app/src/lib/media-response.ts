import { getStorageAdapter } from "@nexpress/core/media";
import {
  npSerializeMediaRecord,
  npValidateMediaApiItem,
  type NpMediaApiItem,
  type NpMediaRecord,
  type NpMediaUploaderSummary,
} from "@nexpress/core/media-contract";

export async function toMediaApiItem(
  record: NpMediaRecord,
  uploader?: NpMediaUploaderSummary | null,
): Promise<NpMediaApiItem> {
  const adapter = getStorageAdapter();
  const thumbnail = record.sizes?.thumbnail ?? null;
  const [originalUrl, thumbnailUrl] = await Promise.all([
    adapter.getUrl(record.storageKey),
    thumbnail ? adapter.getUrl(thumbnail.storageKey) : Promise.resolve(null),
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
