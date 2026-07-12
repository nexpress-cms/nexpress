import Image from "next/image";
import { getMediaById, getMediaUrl as resolveMediaUrl } from "@nexpress/core/media";
import type { NpMediaRecord } from "@nexpress/core/media-contract";

interface NpImageProps {
  media: NpMediaRecord | string;
  size?: string;
  alt?: string;
  className?: string;
  priority?: boolean;
  width?: number;
  height?: number;
}

export async function getMediaUrl(mediaId: string, size?: string): Promise<string | null> {
  return resolveMediaUrl(mediaId, { variant: size ?? "original" });
}

export async function NpImage({
  media,
  size = "medium",
  alt,
  className,
  priority,
  width,
  height,
}: NpImageProps) {
  const record: NpMediaRecord | null =
    typeof media === "string" ? await getMediaById(media) : media;

  if (!record) return null;

  const sizeData = record.sizes?.[size];
  const src = await getMediaUrl(record.id, size);
  if (!src) return null;
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
