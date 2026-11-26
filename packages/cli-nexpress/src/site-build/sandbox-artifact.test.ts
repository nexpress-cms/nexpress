import { describe, expect, it } from "vitest";
import { readSiteBuildSandboxArtifactV1 } from "./sandbox-artifact.js";

function tar(content: Uint8Array, name = "result.json", type = "0"): Buffer {
  const header = Buffer.alloc(512);
  header.write(name, 0, 100, "utf8");
  header.write("0000600\0", 100, "ascii");
  header.write("0000000\0", 108, "ascii");
  header.write("0000000\0", 116, "ascii");
  header.write(content.length.toString(8).padStart(11, "0") + "\0", 124, "ascii");
  header.write("00000000000\0", 136, "ascii");
  header.fill(32, 148, 156);
  header.write(type, 156, "ascii");
  header.write("ustar\0", 257, "ascii");
  header.write("00", 263, "ascii");
  const checksum = header.reduce((total, value) => total + value, 0);
  header.write(checksum.toString(8).padStart(6, "0") + "\0 ", 148, "ascii");
  return Buffer.concat([
    header,
    content,
    Buffer.alloc(((512 - (content.length % 512)) % 512) + 1024),
  ]);
}
describe("sandbox artifact archive boundary", () => {
  it("reads just the declared bounded regular file without extracting paths", () => {
    const bytes = Buffer.from('{"owned":true}\n');
    expect(readSiteBuildSandboxArtifactV1(tar(bytes), "result.json", 1024)).toEqual(
      new Uint8Array(bytes),
    );
    expect(() =>
      readSiteBuildSandboxArtifactV1(tar(bytes), "result.json", bytes.length - 1),
    ).toThrow();
  });
  it("rejects link, extension, directory and another basename records", () => {
    for (const type of ["1", "2", "5", "x", "g", "L", "K"])
      expect(() =>
        readSiteBuildSandboxArtifactV1(
          tar(Buffer.alloc(0), "result.json", type),
          "result.json",
          1024,
        ),
      ).toThrow();
    for (const name of ["../result.json", "/result.json", "nested/result.json", "other.json"])
      expect(() =>
        readSiteBuildSandboxArtifactV1(tar(Buffer.alloc(0), name), "result.json", 1024),
      ).toThrow();
  });
  it("rejects corruption, concatenated archives and a truncated terminator", () => {
    const original = tar(Buffer.from("safe"));
    const corrupt = Buffer.from(original);
    corrupt[100] ^= 1;
    expect(() => readSiteBuildSandboxArtifactV1(corrupt, "result.json", 1024)).toThrow();
    expect(() =>
      readSiteBuildSandboxArtifactV1(
        original.subarray(0, original.length - 512),
        "result.json",
        1024,
      ),
    ).toThrow();
    expect(() =>
      readSiteBuildSandboxArtifactV1(Buffer.concat([original, original]), "result.json", 1024),
    ).toThrow();
    const trailing = Buffer.from(original);
    trailing[trailing.length - 1] = 1;
    expect(() => readSiteBuildSandboxArtifactV1(trailing, "result.json", 1024)).toThrow();
  });
});
