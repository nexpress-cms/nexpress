import Image from "next/image";
import { getMediaById, getStorageAdapter } from "@nexpress/core";

interface NxImageProps {
  media: NxMediaRecord | string;
  size?: string;
  alt?: string;
  className?: string;
  priority?: boolean;
  width?: number;
  height?: number;
}

interface NxMediaRecord {
  id: string;
  storageKey: string;
  width?: number | null;
  height?: number | null;
  alt?: string | null;
  originalFilename: string;
  sizes?: Record<
    string,
    { width?: number; height?: number; storageKey?: string }
  > | null;
}

function toMediaRecord(doc: Record<string, unknown>): NxMediaRecord {
  return {
    id: doc.id as string,
    storageKey: doc.storageKey as string,
    width: (doc.width as number) ?? null,
    height: (doc.height as number) ?? null,
    alt: (doc.alt as string) ?? null,
    originalFilename: doc.originalFilename as string,
    sizes: doc.sizes as NxMediaRecord["sizes"],
  };
}

export async function getMediaUrl(
  storageKey: string,
  size?: string,
): Promise<string> {
  const adapter = getStorageAdapter();
  const sizeKey = size
    ? storageKey.replace(/\/original\.\w+$/, `/${size}.webp`)
    : storageKey;

  return adapter.getUrl(sizeKey);
}

export async function NxImage({
  media,
  size = "medium",
  alt,
  className,
  priority,
  width,
  height,
}: NxImageProps) {
  const record: NxMediaRecord | null =
    typeof media === "string"
      ? await getMediaById(media).then((doc) =>
          doc ? toMediaRecord(doc) : null,
        )
      : media;

  if (!record) return null;

  const sizeData = record.sizes?.[size];
  const src = await getMediaUrl(record.storageKey, size);
  const imgWidth = width ?? sizeData?.width ?? record.width ?? 800;
  const imgHeight = height ?? sizeData?.height ?? record.height ?? 600;

  return (
    <Image
      src={src}
      width={imgWidth}
      height={imgHeight}
      alt={alt ?? record.alt ?? record.originalFilename}
      className={className}
      priority={priority}
    />
  );
}
