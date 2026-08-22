function encodeBase64Url(value: Uint8Array): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  let result = "";
  for (let index = 0; index < value.length; index += 3) {
    const first = value[index] ?? 0;
    const second = value[index + 1];
    const third = value[index + 2];
    const word = (first << 16) | ((second ?? 0) << 8) | (third ?? 0);
    result += alphabet[(word >>> 18) & 63] ?? "";
    result += alphabet[(word >>> 12) & 63] ?? "";
    if (second !== undefined) result += alphabet[(word >>> 6) & 63] ?? "";
    if (third !== undefined) result += alphabet[word & 63] ?? "";
  }
  return result;
}

/** Internal SHA helper. Public callers must use one exact purpose-specific digest function. */
export async function digestAgentCanonicalSha256(
  value: Uint8Array,
): Promise<`cj1:sha256:${string}`> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new Error("Agent canonical SHA-256 requires Web Crypto");
  const input = new ArrayBuffer(value.byteLength);
  new Uint8Array(input).set(value);
  const digest = new Uint8Array(await subtle.digest("SHA-256", input));
  return `cj1:sha256:${encodeBase64Url(digest)}`;
}
