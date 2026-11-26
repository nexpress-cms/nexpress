import { SiteBuildError } from "./artifact-io.js";

/** Strict single regular-file Docker copy archive; never extract a container-controlled tar. */
export function readSiteBuildSandboxArtifactV1(
  archive: Uint8Array,
  basename: string,
  maxBytes: number,
): Uint8Array {
  const bytes = Buffer.from(archive);
  const fail = (): never => {
    throw new SiteBuildError("input");
  };
  if (
    !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/u.test(basename) ||
    bytes.length < 1536 ||
    bytes.length % 512 !== 0 ||
    !Number.isSafeInteger(maxBytes) ||
    maxBytes < 1 ||
    maxBytes > 64 * 1024 * 1024
  )
    fail();
  const header = bytes.subarray(0, 512);
  const string = (start: number, length: number) => {
    const value = header.subarray(start, start + length),
      end = value.indexOf(0);
    if (end < 0 || value.subarray(end).some((byte) => byte !== 0)) fail();
    return value.subarray(0, end).toString("utf8");
  };
  const octal = (start: number, length: number) => {
    const value = header.subarray(start, start + length).toString("ascii");
    const prefix = /^[0-7]+/u.exec(value)?.[0];
    if (
      !prefix ||
      Array.from(value.slice(prefix.length)).some(
        (character) => character !== "\0" && character !== " ",
      )
    )
      return fail();
    const result = Number.parseInt(prefix, 8);
    if (!Number.isSafeInteger(result)) return fail();
    return result;
  };
  const size = octal(124, 12),
    checksum = octal(148, 8);
  const sum = header.reduce(
    (total, byte, index) => total + (index >= 148 && index < 156 ? 32 : byte),
    0,
  );
  if (
    string(0, 100) !== basename ||
    (header[156] !== 0 && header[156] !== 48) ||
    string(157, 100) !== "" ||
    string(345, 155) !== "" ||
    size > maxBytes ||
    checksum !== sum
  )
    fail();
  const end = 512 + size,
    padding = Math.ceil(end / 512) * 512;
  if (padding + 1024 > bytes.length || bytes.subarray(end).some((byte) => byte !== 0)) fail();
  return new Uint8Array(bytes.subarray(512, end));
}
