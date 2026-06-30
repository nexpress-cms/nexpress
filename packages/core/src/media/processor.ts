import sharp from "sharp";

import type { NpImageSize } from "../config/types.js";

type NpSharpPipeline = ReturnType<typeof sharp>;

export interface NpProcessedImageVariant {
  name: string;
  buffer: Buffer;
  width: number;
  height: number;
  size: number;
}

export interface NpProcessedImageSourceMetadata {
  width: number | null;
  height: number | null;
  format: string | null;
}

export interface NpProcessedImageResult {
  source: NpProcessedImageSourceMetadata;
  variants: NpProcessedImageVariant[];
}

export const DEFAULT_IMAGE_SIZES: NpImageSize[] = [
  { name: "thumbnail", width: 300 },
  { name: "small", width: 600 },
  { name: "medium", width: 900 },
  { name: "large", width: 1400 },
  { name: "xlarge", width: 1920 },
  { name: "og", width: 1200, height: 630, crop: "center" },
];

export async function processImage(
  inputBuffer: Buffer,
  sizes: NpImageSize[],
  options: { format?: string; quality?: number } = {},
): Promise<NpProcessedImageResult> {
  const format = options.format ?? "webp";
  const quality = options.quality ?? 80;
  const sourceImage = sharp(inputBuffer).autoOrient();
  const metadata = await sourceImage.metadata();

  const variants = await Promise.all(
    sizes.map(async (size) => {
      const resized = size.height
        ? sourceImage.clone().resize({
            width: size.width,
            height: size.height,
            fit: "cover",
            position: resolveCropPosition(size.crop),
          })
        : sourceImage.clone().resize({
            width: size.width,
            fit: "inside",
            withoutEnlargement: true,
          });

      const formatted = applyFormat(resized, format, quality);
      const { data, info } = await formatted.toBuffer({ resolveWithObject: true });

      return {
        name: size.name,
        buffer: data,
        width: info.width,
        height: info.height,
        size: info.size ?? data.byteLength,
      };
    }),
  );

  return {
    source: {
      width: metadata.width ?? null,
      height: metadata.height ?? null,
      format: metadata.format ?? null,
    },
    variants,
  };
}

function applyFormat(image: NpSharpPipeline, format: string, quality: number): NpSharpPipeline {
  switch (format) {
    case "avif":
      return image.avif({ quality });
    case "jpeg":
      return image.jpeg({ quality });
    case "png":
      return image.png({ quality });
    case "webp":
    default:
      return image.webp({ quality });
  }
}

function resolveCropPosition(crop?: NpImageSize["crop"]): string | number {
  switch (crop) {
    case "top":
      return "top";
    case "bottom":
      return "bottom";
    case "left":
      return "left";
    case "right":
      return "right";
    case "center":
      return "centre";
    default:
      return sharp.strategy.attention;
  }
}
