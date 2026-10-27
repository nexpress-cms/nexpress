import { deflateSync, inflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { SiteBuildError } from "./artifact-io.js";
import {
  canonicalizeSiteBuildPngV1,
  combineSiteBuildPngMontageV1,
  NP_SITE_BUILD_PNG_CANONICALIZER_V1,
} from "./png-canonicalizer.js";

type Chunk = readonly [type: string, data: Uint8Array];
const signature = Buffer.from("89504e470d0a1a0a", "hex");
const empty = new Uint8Array();

// Independent bit-by-bit CRC reference, deliberately separate from the production table.
function referenceCrc(bytes: Uint8Array): number {
  let remainder = 0xffffffff;
  for (const byte of bytes) {
    remainder ^= byte;
    for (let bit = 0; bit < 8; bit++)
      remainder = remainder & 1 ? (remainder >>> 1) ^ 0xedb88320 : remainder >>> 1;
  }
  return (remainder ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Buffer {
  const output = Buffer.alloc(data.length + 12);
  output.writeUInt32BE(data.length);
  output.write(type, 4, "ascii");
  output.set(data, 8);
  output.writeUInt32BE(referenceCrc(output.subarray(4, -4)), output.length - 4);
  return output;
}

function png(chunks: readonly Chunk[]): Buffer {
  return Buffer.concat([signature, ...chunks.map(([type, data]) => chunk(type, data))]);
}

function header(width: number, height: number, colorType = 6): Buffer {
  const data = Buffer.alloc(13);
  data.writeUInt32BE(width);
  data.writeUInt32BE(height, 4);
  data.set([8, colorType, 0, 0, 0], 8);
  return data;
}

function image(width: number, height: number, scanlines: Uint8Array, colorType = 6): Buffer {
  return png([
    ["IHDR", header(width, height, colorType)],
    ["IDAT", deflateSync(scanlines)],
    ["IEND", empty],
  ]);
}

function canonicalChunks(bytes: Uint8Array): Map<string, Buffer> {
  const input = Buffer.from(bytes);
  expect(input.subarray(0, 8)).toEqual(signature);
  const result = new Map<string, Buffer>();
  for (let offset = 8; offset < input.length;) {
    const size = input.readUInt32BE(offset);
    const type = input.toString("ascii", offset + 4, offset + 8);
    expect(result.has(type)).toBe(false);
    expect(input.readUInt32BE(offset + 8 + size)).toBe(
      referenceCrc(input.subarray(offset + 4, offset + 8 + size)),
    );
    result.set(type, input.subarray(offset + 8, offset + 8 + size));
    offset += size + 12;
    expect(offset).toBeLessThanOrEqual(input.length);
  }
  expect([...result.keys()]).toEqual(["IHDR", "sRGB", "IDAT", "IEND"]);
  return result;
}

function inputFailure(operation: () => unknown): void {
  try {
    operation();
    throw new Error("invalid PNG was accepted");
  } catch (error) {
    expect(error).toBeInstanceOf(SiteBuildError);
    expect(error).toMatchObject({ reason: "input", message: "input" });
  }
}
const rejects = (input: Uint8Array) => inputFailure(() => canonicalizeSiteBuildPngV1(input));

describe("private np.png-rgba.v1 screenshot canonicalizer", () => {
  it("matches independent fixed-Huffman literal and overlapping-match PNG vectors", () => {
    // Python struct + binascii.crc32 + zlib.adler32 and hand-tokenized fixed trees produced
    // these vectors. Python zlib independently inflated their RFC 1951 payloads.
    const input = Buffer.from(
      "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8cfd0e00000054101c0781cf86c0000000049454e44ae426082",
      "hex",
    );
    const expected = Buffer.from(
      "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489000000017352474200aece1ce90000000d49444154780163f8cfd0e00000054101c05532698e0000000049454e44ae426082",
      "hex",
    );
    const before = Buffer.from(input);
    const output = canonicalizeSiteBuildPngV1(input);
    expect(NP_SITE_BUILD_PNG_CANONICALIZER_V1).toBe("np.png-rgba.v1");
    expect(Buffer.from(output)).toEqual(expected);
    expect(input).toEqual(before);
    expect(inflateSync(canonicalChunks(output).get("IDAT")!)).toEqual(
      Buffer.from([0, 255, 0, 128, 64]),
    );
    expect(canonicalizeSiteBuildPngV1(output)).toEqual(output);
    const overlapping = canonicalizeSiteBuildPngV1(image(1, 1, Buffer.alloc(5)));
    expect(Buffer.from(overlapping)).toEqual(
      Buffer.from(
        "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489000000017352474200aece1ce90000000a494441547801630001000005000136d088dd0000000049454e44ae426082",
        "hex",
      ),
    );
    expect(inflateSync(canonicalChunks(overlapping).get("IDAT")!)).toEqual(Buffer.alloc(5));
  });

  it("unfilters all five RGBA filters and removes supported metadata and IDAT boundaries", () => {
    // Five 2-pixel rows have independent hand-framed filter bytes 0, 1, 2, 3 and 4.
    const filtered = Buffer.from(
      "00ff000a0001fe80ff010102030409121b24020203040501f9f1e903636363639190908f049c9a9a989b019981",
      "hex",
    );
    const pixels = Buffer.from(
      "ff000a0001fe80ff010203040a141e28030507090b0d0f1164656667c8c9cacb00ff00ffff00ff80",
      "hex",
    );
    const unfiltered = Buffer.concat(
      Array.from({ length: 5 }, (_, row) =>
        Buffer.concat([Buffer.from([0]), pixels.subarray(row * 8, row * 8 + 8)]),
      ),
    );
    const compressed = deflateSync(filtered, { level: 9 });
    const chromaticities = Buffer.alloc(32);
    [31_270, 32_900, 64_000, 33_000, 30_000, 60_000, 15_000, 6_000].forEach((value, index) =>
      chromaticities.writeUInt32BE(value, index * 4),
    );
    const gamma = Buffer.alloc(4);
    gamma.writeUInt32BE(45_455);
    const withMetadata = png([
      ["IHDR", header(2, 5)],
      ["sRGB", Uint8Array.of(2)],
      ["cHRM", chromaticities],
      ["gAMA", gamma],
      ["pHYs", Buffer.from("00000ec400000ec401", "hex")],
      ["IDAT", compressed.subarray(0, 3)],
      ["IDAT", empty],
      ["IDAT", compressed.subarray(3)],
      ["tEXt", Buffer.from("Creation Time\0synthetic-only")],
      ["tIME", Buffer.from([0x07, 0xea, 10, 23, 1, 2, 3])],
      ["IEND", empty],
    ]);
    const first = canonicalizeSiteBuildPngV1(withMetadata);
    expect(first).toEqual(canonicalizeSiteBuildPngV1(image(2, 5, unfiltered)));
    expect(inflateSync(canonicalChunks(first).get("IDAT")!)).toEqual(unfiltered);
    const changed = Buffer.from(unfiltered);
    changed[1] ^= 1;
    expect(canonicalizeSiteBuildPngV1(image(2, 5, changed))).not.toEqual(first);
  });

  it("expands RGB to opaque RGBA using RGB-specific filter spacing", () => {
    const rgb = Buffer.from("010a141e1e1e1e043c3c3c1e1e1e", "hex");
    const rgba = Buffer.from("000a141eff28323cff0046505aff646e78ff", "hex");
    const output = canonicalizeSiteBuildPngV1(image(2, 2, rgb, 2));
    expect(output).toEqual(canonicalizeSiteBuildPngV1(image(2, 2, rgba)));
    const chunks = canonicalChunks(output);
    expect(chunks.get("IHDR")).toEqual(header(2, 2));
    expect(inflateSync(chunks.get("IDAT")!)).toEqual(rgba);
  });

  it("writes fixed-code matches across bounded blocks with a valid independent Adler32", () => {
    const scanlines = Buffer.alloc((256 * 4 + 1) * 257);
    for (let row = 0; row < 257; row++) {
      const start = row * (256 * 4 + 1);
      for (let column = 1; column <= 256 * 4; column++)
        scanlines[start + column] = (row + column) & 255;
    }
    const output = canonicalizeSiteBuildPngV1(image(256, 257, scanlines));
    const compressed = canonicalChunks(output).get("IDAT")!;
    expect([...compressed.subarray(0, 2)]).toEqual([0x78, 0x01]);
    expect(compressed[2] & 7).toBe(2);
    expect(inflateSync(compressed)).toEqual(scanlines);
    expect(output.length).toBeLessThan(64 * 1024 * 1024);
  });

  it("uses deterministic stored fallback for entropy without expanding the codec bound", () => {
    const scanlines = Buffer.alloc((256 * 4 + 1) * 257);
    let state = 0x7b132c4d;
    for (let row = 0; row < 257; row++) {
      const start = row * (256 * 4 + 1);
      for (let column = 1; column <= 256 * 4; column++) {
        state ^= state << 13;
        state ^= state >>> 17;
        state ^= state << 5;
        scanlines[start + column] = state & 255;
      }
    }
    const output = canonicalizeSiteBuildPngV1(image(256, 257, scanlines));
    const compressed = canonicalChunks(output).get("IDAT")!;
    expect(compressed[2] & 7).toBe(0);
    expect(inflateSync(compressed)).toEqual(scanlines);
    expect(output.length).toBeLessThanOrEqual(
      scanlines.length + 70 + 6 + Math.ceil(scanlines.length / 65_535) * 5,
    );
    expect(canonicalizeSiteBuildPngV1(output)).toEqual(output);
    // Exercise stored -> fixed -> stored transitions and dictionary continuity.
    scanlines.fill(0, 65_535, 131_070);
    const mixed = canonicalizeSiteBuildPngV1(image(256, 257, scanlines));
    expect(inflateSync(canonicalChunks(mixed).get("IDAT")!)).toEqual(scanlines);
    expect(mixed.length).toBeLessThan(output.length - 50_000);
  });

  it("compresses a six-page desktop montage with blank and text-like pixels below 10 MiB", () => {
    const width = 1440;
    const height = 5400;
    const stride = width * 4 + 1;
    const scanlines = Buffer.alloc(stride * height, 255);
    for (let row = 0; row < height; row++) scanlines[row * stride] = 0;
    for (const withText of [false, true]) {
      if (withText) {
        // Stable geometric glyph-like strokes and page furniture, without loading fonts.
        for (let page = 0; page < 6; page++) {
          for (let line = 0; line < 30; line++) {
            for (let glyph = 0; glyph < 85; glyph++) {
              for (let y = 0; y < 12; y++) {
                for (let x = 0; x < 7; x++) {
                  if ((x * 3 + y * 5 + glyph + line * 7) % 11 > 3) continue;
                  const pixel =
                    (page * 900 + 80 + line * 24 + y) * stride + (80 + glyph * 14 + x) * 4 + 1;
                  scanlines.set([32 + page, 42 + line, 52 + glyph], pixel);
                }
              }
            }
          }
        }
      }
      const output = canonicalizeSiteBuildPngV1(image(width, height, scanlines));
      expect(output.length).toBeLessThanOrEqual(10 * 1024 * 1024);
      expect(inflateSync(canonicalChunks(output).get("IDAT")!).equals(scanlines)).toBe(true);
    }
  }, 15_000);

  it("stacks actual page pixels in the supplied order without labels, gaps or encoding differences", () => {
    const firstRows = Buffer.from([
      0, 255, 0, 0, 0, 0, 255, 0, 128, 0, 0, 0, 255, 255, 255, 255, 255, 64,
    ]);
    const lastRgb = Buffer.from([0, 0, 0, 0, 255, 255, 255]);
    const lastRgba = Buffer.from([0, 0, 0, 0, 255, 255, 255, 255, 255]);
    const first = image(2, 2, firstRows);
    const last = image(2, 1, lastRgb, 2);
    const compressed = deflateSync(firstRows, { level: 0 });
    const alternate = png([
      ["IHDR", header(2, 2)],
      ["sRGB", Uint8Array.of(1)],
      ["tEXt", Buffer.from("Note\0alternate compression")],
      ["IDAT", compressed.subarray(0, 5)],
      ["IDAT", compressed.subarray(5)],
      ["IEND", empty],
    ]);
    const montage = combineSiteBuildPngMontageV1(Object.freeze([first, last]));
    const chunks = canonicalChunks(montage);
    expect(chunks.get("IHDR")).toEqual(header(2, 3));
    expect(inflateSync(chunks.get("IDAT")!)).toEqual(Buffer.concat([firstRows, lastRgba]));
    expect(montage).toEqual(
      canonicalizeSiteBuildPngV1(image(2, 3, Buffer.concat([firstRows, lastRgba]))),
    );
    expect(combineSiteBuildPngMontageV1([alternate, canonicalizeSiteBuildPngV1(last)])).toEqual(
      montage,
    );
    expect(combineSiteBuildPngMontageV1([first])).toEqual(canonicalizeSiteBuildPngV1(first));
    const reversed = combineSiteBuildPngMontageV1([last, first]);
    expect(reversed).not.toEqual(montage);
    expect(inflateSync(canonicalChunks(reversed).get("IDAT")!)).toEqual(
      Buffer.concat([lastRgba, firstRows]),
    );
  });

  it("rejects inconsistent widths, missing/excess pages, aggregate axis and RGBA limits", () => {
    const single = image(1, 1, Buffer.alloc(5));
    inputFailure(() => combineSiteBuildPngMontageV1([]));
    inputFailure(() => combineSiteBuildPngMontageV1(Array.from({ length: 201 }, () => single)));
    const maximumPages = combineSiteBuildPngMontageV1(Array.from({ length: 200 }, () => single));
    expect(canonicalChunks(maximumPages).get("IHDR")).toEqual(header(1, 200));
    inputFailure(() => combineSiteBuildPngMontageV1([single, image(2, 1, Buffer.alloc(9))]));
    const corrupt = Buffer.from(single);
    corrupt[29] ^= 1;
    inputFailure(() => combineSiteBuildPngMontageV1([single, corrupt]));
    const tall = image(1, 32_768, Buffer.alloc(5 * 32_768));
    expect(canonicalChunks(combineSiteBuildPngMontageV1([tall])).get("IHDR")).toEqual(
      header(1, 32_768),
    );
    inputFailure(() => combineSiteBuildPngMontageV1([tall, single]));
    // Both pages are individually valid and below 60 MiB; together they exceed it.
    const half = image(2048, 3840, Buffer.alloc((2048 * 4 + 1) * 3840));
    const overHalf = image(2048, 3841, Buffer.alloc((2048 * 4 + 1) * 3841));
    inputFailure(() => combineSiteBuildPngMontageV1([half, overHalf]));
  }, 15_000);

  it("enforces the montage's 10 MiB output cap on otherwise valid high-entropy pages", () => {
    const width = 1024;
    const height = 1400;
    const stride = width * 4 + 1;
    const scanlines = Buffer.alloc(stride * height);
    let state = 0x4c2d15b7;
    for (let row = 0; row < height; row++) {
      for (let column = 1; column < stride; column++) {
        state ^= state << 13;
        state ^= state >>> 17;
        state ^= state << 5;
        scanlines[row * stride + column] = state & 255;
      }
    }
    const page = image(width, height, scanlines);
    expect(page.length).toBeLessThan(10 * 1024 * 1024);
    inputFailure(() => combineSiteBuildPngMontageV1([page, page]));
  }, 15_000);

  it("rejects corrupt framing, CRCs, noncontiguous image data and unsupported chunks", () => {
    const raw = Buffer.from([0, 1, 2, 3, 4]);
    const compressed = deflateSync(raw);
    const good = image(1, 1, raw);
    const badCrc = Buffer.from(good);
    badCrc[29] ^= 1;
    const wrongLength = Buffer.from(good);
    wrongLength.writeUInt32BE(0xffffffff, 33);
    const badSignature = Buffer.from(good);
    badSignature[0] = 0;
    const cases = [
      badCrc,
      wrongLength,
      badSignature,
      good.subarray(0, -1),
      Buffer.concat([good, Buffer.from([0])]),
      png([
        ["IDAT", compressed],
        ["IHDR", header(1, 1)],
        ["IEND", empty],
      ]),
      png([
        ["IHDR", header(1, 1)],
        ["IDAT", compressed],
      ]),
      png([
        ["IHDR", header(1, 1)],
        ["IEND", empty],
      ]),
      png([
        ["IHDR", header(1, 1)],
        ["IHDR", header(1, 1)],
        ["IDAT", compressed],
        ["IEND", empty],
      ]),
      png([
        ["IHDR", header(1, 1)],
        ["IDAT", compressed],
        ["IEND", Uint8Array.of(0)],
      ]),
      png([
        ["IHDR", header(1, 1)],
        ["IDAT", compressed.subarray(0, 2)],
        ["tEXt", Buffer.from("Note\0split")],
        ["IDAT", compressed.subarray(2)],
        ["IEND", empty],
      ]),
    ];
    for (const type of [
      "PLTE",
      "ABCD",
      "abCd",
      "abdd",
      "1BCD",
      "acTL",
      "fcTL",
      "fdAT",
      "tRNS",
      "iCCP",
      "cICP",
      "eXIf",
    ])
      cases.push(
        png([
          ["IHDR", header(1, 1)],
          [type, empty],
          ["IDAT", compressed],
          ["IEND", empty],
        ]),
      );
    for (const input of cases) rejects(input);
  });

  it("rejects unsupported sample encodings, dimensions and bounded decompression bombs", () => {
    const compressed = deflateSync(Buffer.from([0, 1, 2, 3, 4]));
    const headers = [header(0, 1), header(1, 0), header(32_769, 1), header(32_768, 481)];
    for (const [index, value] of [
      [8, 16],
      [9, 0],
      [9, 3],
      [9, 4],
      [10, 1],
      [11, 1],
      [12, 1],
    ]) {
      const changed = header(1, 1);
      changed[index] = value;
      headers.push(changed);
    }
    for (const value of headers)
      rejects(
        png([
          ["IHDR", value],
          ["IDAT", compressed],
          ["IEND", empty],
        ]),
      );
    for (const raw of [
      Buffer.alloc(4),
      Buffer.alloc(6),
      Buffer.from([5, 1, 2, 3, 4]),
      Buffer.alloc(1024 * 1024),
    ])
      rejects(image(1, 1, raw));
    for (const payload of [
      Buffer.alloc(6),
      compressed.subarray(0, -1),
      Buffer.concat([compressed, Buffer.from([0])]),
      Buffer.concat([compressed, compressed]),
    ])
      rejects(
        png([
          ["IHDR", header(1, 1)],
          ["IDAT", payload],
          ["IEND", empty],
        ]),
      );
    rejects(new Uint8Array(64 * 1024 * 1024 + 1));
    rejects(new Uint8Array(new SharedArrayBuffer(100)));
    rejects(
      png([
        ["IHDR", header(1, 1)],
        ...Array.from({ length: 4096 }, (): Chunk => ["IDAT", empty]),
        ["IDAT", compressed],
        ["IEND", empty],
      ]),
    );
  });

  it("fails closed on non-sRGB or malformed metadata rather than transforming pixels", () => {
    const compressed = deflateSync(Buffer.from([0, 1, 2, 3, 4]));
    const cases: Chunk[] = [
      ["gAMA", Buffer.from("000186a0", "hex")],
      ["gAMA", empty],
      ["cHRM", Buffer.alloc(32)],
      ["sRGB", Uint8Array.of(4)],
      ["sRGB", Uint8Array.of(0, 0)],
      ["pHYs", Buffer.alloc(8)],
      ["pHYs", Buffer.from("000000010000000102", "hex")],
      ["tIME", Buffer.from([0x07, 0xea, 2, 30, 0, 0, 0])],
      ["tEXt", Buffer.from("\0invalid-keyword")],
      ["tEXt", Buffer.from("Leading  spaces\0text")],
      ["tEXt", Buffer.from("Note\0embedded\0null")],
    ];
    for (const extra of cases)
      rejects(png([["IHDR", header(1, 1)], extra, ["IDAT", compressed], ["IEND", empty]]));
    rejects(
      png([
        ["IHDR", header(1, 1)],
        ["sRGB", Uint8Array.of(0)],
        ["sRGB", Uint8Array.of(0)],
        ["IDAT", compressed],
        ["IEND", empty],
      ]),
    );
    rejects(
      png([
        ["IHDR", header(1, 1)],
        ["IDAT", compressed],
        ["sRGB", Uint8Array.of(0)],
        ["IEND", empty],
      ]),
    );
  });
});
