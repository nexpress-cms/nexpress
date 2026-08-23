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

function copyToArrayBuffer(value: Uint8Array): ArrayBuffer {
  const result = new ArrayBuffer(value.byteLength);
  new Uint8Array(result).set(value);
  return result;
}

async function importAgentCanonicalHmacKey(keyBytes: Uint8Array): Promise<CryptoKey> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new Error("Agent canonical HMAC-SHA-256 requires Web Crypto");
  return subtle.importKey(
    "raw",
    copyToArrayBuffer(keyBytes),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
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

/** Internal HMAC helper. Public callers must use one exact owner-specific MAC function. */
export async function macAgentCanonicalHmacSha256(
  value: Uint8Array,
  keyBytes: Uint8Array,
): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new Error("Agent canonical HMAC-SHA-256 requires Web Crypto");
  const key = await importAgentCanonicalHmacKey(keyBytes);
  const mac = new Uint8Array(await subtle.sign("HMAC", key, copyToArrayBuffer(value)));
  return encodeBase64Url(mac);
}

/** Internal constant-time HMAC verification through Web Crypto. */
export async function verifyAgentCanonicalHmacSha256(
  value: Uint8Array,
  keyBytes: Uint8Array,
  expectedMac: Uint8Array,
): Promise<boolean> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new Error("Agent canonical HMAC-SHA-256 requires Web Crypto");
  const key = await importAgentCanonicalHmacKey(keyBytes);
  return subtle.verify("HMAC", key, copyToArrayBuffer(expectedMac), copyToArrayBuffer(value));
}
