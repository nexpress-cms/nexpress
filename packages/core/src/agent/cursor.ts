import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

/** Shared internal opaque cursor encoding. Each inventory keeps its own authority/expiry validation. */
export function createAgentCursorCodecV1(inputKey: Uint8Array, domain: string) {
  if (!(inputKey instanceof Uint8Array) || inputKey.byteLength < 32) {
    throw new Error("Agent cursor key requires at least 32 bytes.");
  }
  const key = Buffer.from(inputKey);
  const encryptionKey = createHmac("sha256", key).update(`${domain}.encryption.v1`).digest();
  const mac = (value: string) =>
    createHmac("sha256", key).update(`${domain}.v1\0`).update(value).digest("base64url");
  return {
    mac,
    seal(value: unknown): string {
      const nonce = randomBytes(12);
      const cipher = createCipheriv("aes-256-gcm", encryptionKey, nonce);
      const encrypted = Buffer.concat([
        cipher.update(JSON.stringify(value), "utf8"),
        cipher.final(),
      ]);
      const body = Buffer.concat([nonce, cipher.getAuthTag(), encrypted]).toString("base64url");
      return `${body}.${mac(body)}`;
    },
    open(value: string): unknown {
      if (value.length > 2048) throw new Error("Invalid cursor.");
      const [body, signature, ...extra] = value.split(".");
      if (
        !body ||
        !signature ||
        extra.length ||
        signature.length !== 43 ||
        !timingSafeEqual(Buffer.from(signature), Buffer.from(mac(body)))
      )
        throw new Error("Invalid cursor.");
      const bytes = Buffer.from(body, "base64url");
      if (bytes.length < 29) throw new Error("Invalid cursor.");
      const decipher = createDecipheriv("aes-256-gcm", encryptionKey, bytes.subarray(0, 12));
      decipher.setAuthTag(bytes.subarray(12, 28));
      return JSON.parse(
        Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString("utf8"),
      ) as unknown;
    },
  };
}
