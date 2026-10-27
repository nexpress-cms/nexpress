import { inflateSync } from "node:zlib";
import { SiteBuildError } from "./artifact-io.js";

export const NP_SITE_BUILD_PNG_CANONICALIZER_V1 = "np.png-rgba.v1";

const MAX_PNG_BYTES = 64 * 1024 * 1024;
const MAX_MONTAGE_BYTES = 10 * 1024 * 1024;
const MAX_RGBA_BYTES = 60 * 1024 * 1024;
const MAX_DIMENSION = 32_768;
const MAX_CHUNKS = 4_096;
const SIGNATURE = Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10);
const SRGB_CHROMATICITIES = [31_270, 32_900, 64_000, 33_000, 30_000, 60_000, 15_000, 6_000];
const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, byte) => {
  let value = byte;
  for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);
  return value >>> 0;
});

function invalid(): never {
  throw new SiteBuildError("input");
}

function crc32(bytes: Uint8Array, start: number, end: number): number {
  let value = 0xffffffff;
  for (let index = start; index < end; index++)
    value = (value >>> 8) ^ CRC_TABLE[(value ^ bytes[index]) & 255];
  return (value ^ 0xffffffff) >>> 0;
}

function paeth(left: number, up: number, upperLeft: number): number {
  const estimate = left + up - upperLeft;
  const leftDistance = Math.abs(estimate - left);
  const upDistance = Math.abs(estimate - up);
  const upperLeftDistance = Math.abs(estimate - upperLeft);
  return leftDistance <= upDistance && leftDistance <= upperLeftDistance
    ? left
    : upDistance <= upperLeftDistance
      ? up
      : upperLeft;
}

function validateMetadata(type: string, bytes: Uint8Array): void {
  const data = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (type === "sRGB") {
    if (bytes.length !== 1 || bytes[0] > 3) invalid();
  } else if (type === "gAMA") {
    // Other transfer functions would require a color transform, which this owner never does.
    if (bytes.length !== 4 || data.getUint32(0) !== 45_455) invalid();
  } else if (type === "cHRM") {
    if (
      bytes.length !== 32 ||
      SRGB_CHROMATICITIES.some((value, index) => data.getUint32(index * 4) !== value)
    )
      invalid();
  } else if (type === "pHYs") {
    if (bytes.length !== 9 || bytes[8] > 1) invalid();
  } else if (type === "tIME") {
    if (bytes.length !== 7) invalid();
    const year = data.getUint16(0);
    const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    if (
      bytes[2] < 1 ||
      bytes[2] > 12 ||
      bytes[3] < 1 ||
      bytes[3] > days[bytes[2] - 1] ||
      bytes[4] > 23 ||
      bytes[5] > 59 ||
      bytes[6] > 60
    )
      invalid();
  } else if (type === "tEXt") {
    const separator = bytes.indexOf(0);
    if (separator < 1 || separator > 79 || bytes[0] === 32 || bytes[separator - 1] === 32)
      invalid();
    for (let index = 0; index < separator; index++) {
      const byte = bytes[index];
      if (
        (!(byte >= 32 && byte <= 126) && !(byte >= 161)) ||
        (byte === 32 && bytes[index - 1] === 32)
      )
        invalid();
    }
    if (bytes.subarray(separator + 1).includes(0)) invalid();
  } else {
    // This also rejects ICC/HDR profiles, EXIF orientation, tRNS, APNG and unknown chunks.
    // Only the explicitly supported sRGB screenshot encoding has stable pixel semantics here.
    invalid();
  }
}

function inflateExactly(compressed: Uint8Array, expectedBytes: number): Uint8Array {
  // Node's declaration omits the `info: true` result shape. Check its runtime fields rather
  // than asserting them, including consumed input so an appended zlib stream cannot hide.
  const result: unknown = inflateSync(compressed, {
    maxOutputLength: expectedBytes,
    info: true,
  });
  if (
    !result ||
    typeof result !== "object" ||
    !("buffer" in result) ||
    !(result.buffer instanceof Uint8Array) ||
    result.buffer.length !== expectedBytes ||
    !("engine" in result) ||
    !result.engine ||
    typeof result.engine !== "object" ||
    !("bytesWritten" in result.engine) ||
    result.engine.bytesWritten !== compressed.length
  )
    invalid();
  return result.buffer;
}

function adler32(bytes: Uint8Array): number {
  let low = 1;
  let high = 0;
  for (let start = 0; start < bytes.length; start += 5_552) {
    for (let index = start; index < Math.min(start + 5_552, bytes.length); index++) {
      low += bytes[index];
      high += low;
    }
    low %= 65_521;
    high %= 65_521;
  }
  return ((high << 16) | low) >>> 0;
}

function reverseBits(value: number, width: number): number {
  let result = 0;
  for (let bit = 0; bit < width; bit++) {
    result = (result << 1) | (value & 1);
    value >>>= 1;
  }
  return result;
}

const FIXED_WIDTHS = Uint8Array.from({ length: 288 }, (_, symbol) =>
  symbol < 144 ? 8 : symbol < 256 ? 9 : symbol < 280 ? 7 : 8,
);
const FIXED_CODES = Uint16Array.from({ length: 288 }, (_, symbol) =>
  reverseBits(
    symbol < 144
      ? 0x30 + symbol
      : symbol < 256
        ? 0x190 + symbol - 144
        : symbol < 280
          ? symbol - 256
          : 0xc0 + symbol - 280,
    FIXED_WIDTHS[symbol],
  ),
);
const LENGTH_BASES = [
  3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131,
  163, 195, 227, 258,
];
const LENGTH_EXTRAS = [
  0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0,
];
const DISTANCE_BASES = [
  1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049,
  3073, 4097, 6145, 8193, 12289, 16385, 24577,
];
const DISTANCE_EXTRAS = [
  0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13,
];
const LENGTH_CODES = Uint8Array.from({ length: 259 }, (_, length) => {
  let index = LENGTH_BASES.length - 1;
  while (index > 0 && LENGTH_BASES[index] > length) index--;
  return index;
});
const DISTANCE_CODES = Uint8Array.from({ length: 32_769 }, (_, distance) => {
  let index = DISTANCE_BASES.length - 1;
  while (index > 0 && DISTANCE_BASES[index] > distance) index--;
  return index;
});

/** Bounded byte writer; RFC 1951 numbers are emitted least-significant bit first. */
class DeflateBits {
  private bytes = new Uint8Array(65_536);
  private offset = 0;
  private pending = 0;
  bitOffset = 0;

  constructor(private readonly maxPngBytes: number) {}

  private reserve(count: number): void {
    const required = this.offset + count;
    // The PNG's fixed framing occupies 70 bytes outside its IDAT data.
    if (required > this.maxPngBytes - 70) invalid();
    if (required > this.bytes.length) {
      const next = new Uint8Array(
        Math.min(this.maxPngBytes - 70, Math.max(required, this.bytes.length * 2)),
      );
      next.set(this.bytes);
      this.bytes = next;
    }
  }

  write(value: number, width: number): void {
    this.pending |= value << this.bitOffset;
    this.bitOffset += width;
    while (this.bitOffset >= 8) {
      this.reserve(1);
      this.bytes[this.offset++] = this.pending & 255;
      this.pending >>>= 8;
      this.bitOffset -= 8;
    }
  }

  align(): void {
    if (this.bitOffset) {
      this.reserve(1);
      this.bytes[this.offset++] = this.pending;
      this.pending = 0;
      this.bitOffset = 0;
    }
  }

  append(bytes: Uint8Array): void {
    if (this.bitOffset) invalid();
    this.reserve(bytes.length);
    this.bytes.set(bytes, this.offset);
    this.offset += bytes.length;
  }

  finish(checksum: number): Uint8Array {
    this.align();
    const trailer = new Uint8Array(4);
    new DataView(trailer.buffer).setUint32(0, checksum);
    this.append(trailer);
    return this.bytes.slice(0, this.offset);
  }
}

/**
 * Fixed, greedy LZ77 profile: 32 KiB window, newest-first hash chains, nearest-distance
 * tie breaks, at most 32 candidates and 1,024 compared bytes per token. Dictionary
 * storage and token blocks are fixed-size; search never scans the entire input.
 */
function fixedDeflate(bytes: Uint8Array, maxPngBytes: number): Uint8Array {
  const heads = new Int32Array(65_536).fill(-1);
  const previous = new Int32Array(32_768).fill(-1);
  const tokens = new Uint32Array(65_535);
  const writer = new DeflateBits(maxPngBytes);
  writer.append(Uint8Array.of(0x78, 0x01));
  const hash = (position: number) =>
    ((bytes[position] * 251 + bytes[position + 1]) * 251 + bytes[position + 2]) & 65_535;
  for (let blockStart = 0; blockStart < bytes.length; blockStart += 65_535) {
    const blockEnd = Math.min(blockStart + 65_535, bytes.length);
    const last = blockEnd === bytes.length;
    let count = 0;
    let fixedCost = 3 + FIXED_WIDTHS[256];
    for (let position = blockStart; position < blockEnd;) {
      let bestLength = 0;
      let bestDistance = 0;
      const maximum = Math.min(258, blockEnd - position);
      if (maximum >= 3) {
        let candidate = heads[hash(position)];
        const oldest = Math.max(0, position - 32_768);
        let effort = 0;
        for (
          let attempt = 0;
          candidate >= oldest && attempt < 32 && effort + 4 <= 1_024;
          attempt++
        ) {
          effort += 4;
          if (
            bytes[candidate] === bytes[position] &&
            bytes[candidate + 1] === bytes[position + 1] &&
            bytes[candidate + 2] === bytes[position + 2] &&
            bytes[candidate + bestLength] === bytes[position + bestLength]
          ) {
            let length = 3;
            while (length < maximum && effort < 1_024) {
              effort++;
              if (bytes[candidate + length] !== bytes[position + length]) break;
              length++;
            }
            if (length > bestLength) {
              bestLength = length;
              bestDistance = position - candidate;
              if (length === maximum) break;
            }
          }
          candidate = previous[candidate & 32_767];
        }
      }
      const consumed = bestLength >= 3 ? bestLength : 1;
      if (bestLength >= 3) {
        tokens[count++] = (bestLength << 16) | bestDistance;
        const lengthCode = LENGTH_CODES[bestLength];
        const distanceCode = DISTANCE_CODES[bestDistance];
        fixedCost +=
          FIXED_WIDTHS[257 + lengthCode] +
          LENGTH_EXTRAS[lengthCode] +
          5 +
          DISTANCE_EXTRAS[distanceCode];
      } else {
        tokens[count++] = bytes[position];
        fixedCost += FIXED_WIDTHS[bytes[position]];
      }
      for (
        let inserted = position;
        inserted < position + consumed && inserted + 2 < bytes.length;
        inserted++
      ) {
        const key = hash(inserted);
        previous[inserted & 32_767] = heads[key];
        heads[key] = inserted;
      }
      position += consumed;
    }
    // Fixed codes can expand high-entropy data. A deterministic stored-block fallback
    // guarantees the original 64 MiB codec bound without weakening the montage gate.
    const fixedPadding = last ? (8 - ((writer.bitOffset + fixedCost) & 7)) & 7 : 0;
    const storedCost =
      3 + ((8 - ((writer.bitOffset + 3) & 7)) & 7) + 32 + (blockEnd - blockStart) * 8;
    if (fixedCost + fixedPadding > storedCost) {
      writer.write(last ? 1 : 0, 3);
      writer.align();
      const length = blockEnd - blockStart;
      writer.write(length, 16);
      writer.write(length ^ 0xffff, 16);
      writer.append(bytes.subarray(blockStart, blockEnd));
    } else {
      writer.write(last ? 3 : 2, 3);
      for (let index = 0; index < count; index++) {
        const token = tokens[index];
        const length = token >>> 16;
        if (!length) {
          writer.write(FIXED_CODES[token], FIXED_WIDTHS[token]);
        } else {
          const distance = token & 0xffff;
          const lengthCode = LENGTH_CODES[length];
          const distanceCode = DISTANCE_CODES[distance];
          writer.write(FIXED_CODES[257 + lengthCode], FIXED_WIDTHS[257 + lengthCode]);
          writer.write(length - LENGTH_BASES[lengthCode], LENGTH_EXTRAS[lengthCode]);
          writer.write(reverseBits(distanceCode, 5), 5);
          writer.write(distance - DISTANCE_BASES[distanceCode], DISTANCE_EXTRAS[distanceCode]);
        }
      }
      writer.write(FIXED_CODES[256], FIXED_WIDTHS[256]);
    }
  }
  return writer.finish(adler32(bytes));
}

function writeChunk(output: Uint8Array, offset: number, type: string, data: Uint8Array): number {
  const view = new DataView(output.buffer);
  view.setUint32(offset, data.length);
  for (let index = 0; index < 4; index++) output[offset + 4 + index] = type.charCodeAt(index);
  output.set(data, offset + 8);
  view.setUint32(offset + 8 + data.length, crc32(output, offset + 4, offset + 8 + data.length));
  return offset + 12 + data.length;
}

interface DecodedPng {
  width: number;
  height: number;
  scanlines: Uint8Array;
}

function decodePng(
  input: Uint8Array,
  bounds?: { width: number; remainingHeight: number },
): DecodedPng {
  if (
    !(input instanceof Uint8Array) ||
    input.byteLength < 57 ||
    input.byteLength > MAX_PNG_BYTES ||
    input.buffer instanceof SharedArrayBuffer
  )
    invalid();
  const bytes = new Uint8Array(input);
  if (SIGNATURE.some((byte, index) => bytes[index] !== byte)) invalid();
  const view = new DataView(bytes.buffer);
  const idat: Uint8Array[] = [];
  const metadata = new Set<string>();
  let compressedLength = 0;
  let width = 0;
  let height = 0;
  let channels = 0;
  let idatState: "before" | "inside" | "after" = "before";
  let ended = false;
  let chunkCount = 0;
  for (let offset = 8; offset < bytes.length;) {
    if (++chunkCount > MAX_CHUNKS) invalid();
    if (bytes.length - offset < 12) invalid();
    const length = view.getUint32(offset);
    if (length > bytes.length - offset - 12) invalid();
    const end = offset + length + 12;
    const codes = bytes.subarray(offset + 4, offset + 8);
    if (
      codes.some((byte) => !(byte >= 65 && byte <= 90) && !(byte >= 97 && byte <= 122)) ||
      (codes[2] & 32) !== 0 ||
      crc32(bytes, offset + 4, end - 4) !== view.getUint32(end - 4)
    )
      invalid();
    const type = String.fromCharCode(...codes);
    const data = bytes.subarray(offset + 8, end - 4);
    if (offset === 8) {
      if (type !== "IHDR" || length !== 13) invalid();
      width = view.getUint32(offset + 8);
      height = view.getUint32(offset + 12);
      channels = data[9] === 2 ? 3 : data[9] === 6 ? 4 : 0;
      if (
        width === 0 ||
        height === 0 ||
        width > MAX_DIMENSION ||
        height > MAX_DIMENSION ||
        !Number.isSafeInteger(width * height * 4) ||
        width * height * 4 > MAX_RGBA_BYTES ||
        data[8] !== 8 ||
        !channels ||
        data[10] !== 0 ||
        data[11] !== 0 ||
        data[12] !== 0 ||
        (bounds !== undefined && (width !== bounds.width || height > bounds.remainingHeight))
      )
        invalid();
    } else if (type === "IDAT") {
      if (idatState === "after") invalid();
      idatState = "inside";
      compressedLength += data.length;
      idat.push(data);
    } else {
      if (idatState === "inside") idatState = "after";
      if (type === "IEND") {
        if (length !== 0 || !idat.length || !compressedLength || end !== bytes.length) invalid();
        ended = true;
      } else {
        // sRGB/gAMA/cHRM/pHYs must precede IDAT. tEXt and tIME may follow it.
        if (idatState === "after" && type !== "tEXt" && type !== "tIME") invalid();
        if (type !== "tEXt" && metadata.has(type)) invalid();
        validateMetadata(type, data);
        metadata.add(type);
      }
    }
    offset = end;
  }
  if (!ended) invalid();
  const compressed = new Uint8Array(compressedLength);
  let offset = 0;
  for (const piece of idat) {
    compressed.set(piece, offset);
    offset += piece.length;
  }
  const stride = width * channels + 1;
  const inflated = inflateExactly(compressed, stride * height);
  const rgbaStride = width * 4 + 1;
  const rgba = new Uint8Array(rgbaStride * height);
  for (let row = 0; row < height; row++) {
    const rowStart = row * stride;
    const filter = inflated[rowStart];
    if (filter > 4) invalid();
    for (let column = 1; column < stride; column++) {
      const position = rowStart + column;
      const left = column > channels ? inflated[position - channels] : 0;
      const up = row > 0 ? inflated[position - stride] : 0;
      const upperLeft = row > 0 && column > channels ? inflated[position - stride - channels] : 0;
      const predictor =
        filter === 0
          ? 0
          : filter === 1
            ? left
            : filter === 2
              ? up
              : filter === 3
                ? Math.floor((left + up) / 2)
                : paeth(left, up, upperLeft);
      inflated[position] = (inflated[position] + predictor) & 255;
    }
    const destination = row * rgbaStride + 1;
    if (channels === 4) {
      rgba.set(inflated.subarray(rowStart + 1, rowStart + stride), destination);
    } else {
      for (let column = 0; column < width; column++) {
        const source = rowStart + 1 + column * 3;
        const target = destination + column * 4;
        rgba.set(inflated.subarray(source, source + 3), target);
        rgba[target + 3] = 255;
      }
    }
  }
  return { width, height, scanlines: rgba };
}

function encodePng({ width, height, scanlines }: DecodedPng, maxPngBytes: number): Uint8Array {
  const deflated = fixedDeflate(scanlines, maxPngBytes);
  // Signature + IHDR + stable sRGB declaration + single IDAT + IEND.
  const outputLength = 8 + 25 + 13 + 12 + deflated.length + 12;
  if (outputLength > maxPngBytes) invalid();
  const output = new Uint8Array(outputLength);
  output.set(SIGNATURE);
  const header = new Uint8Array(13);
  const headerView = new DataView(header.buffer);
  headerView.setUint32(0, width);
  headerView.setUint32(4, height);
  header.set([8, 6, 0, 0, 0], 8);
  let offset = writeChunk(output, 8, "IHDR", header);
  offset = writeChunk(output, offset, "sRGB", Uint8Array.of(0));
  offset = writeChunk(output, offset, "IDAT", deflated);
  writeChunk(output, offset, "IEND", new Uint8Array());
  return output;
}

/**
 * Bounded private screenshot codec. Untagged screenshots are interpreted as sRGB; explicit
 * color metadata must match sRGB. This does not prove that a trusted renderer produced them.
 */
export function canonicalizeSiteBuildPngV1(input: Uint8Array): Uint8Array {
  try {
    return encodePng(decodePng(input), MAX_PNG_BYTES);
  } catch {
    throw new SiteBuildError("input");
  }
}

/** Stack actual decoded pixels in the caller's frozen comparison order, without labels or gaps. */
export function combineSiteBuildPngMontageV1(pages: readonly Uint8Array[]): Uint8Array {
  try {
    if (!Array.isArray(pages) || pages.length < 1 || pages.length > 200) invalid();
    const decoded: DecodedPng[] = [];
    let width = 0;
    let height = 0;
    for (const page of pages) {
      const bounds = width
        ? {
            width,
            remainingHeight:
              Math.min(MAX_DIMENSION, Math.floor(MAX_RGBA_BYTES / (width * 4))) - height,
          }
        : undefined;
      if (bounds && bounds.remainingHeight < 1) invalid();
      // Aggregate dimensions are checked at IHDR, before allocating/inflating another page.
      const pixels = decodePng(page, bounds);
      width = pixels.width;
      height += pixels.height;
      decoded.push(pixels);
    }
    const scanlines = new Uint8Array((width * 4 + 1) * height);
    let offset = 0;
    for (const page of decoded) {
      scanlines.set(page.scanlines, offset);
      offset += page.scanlines.length;
    }
    return encodePng({ width, height, scanlines }, MAX_MONTAGE_BYTES);
  } catch {
    throw new SiteBuildError("input");
  }
}
