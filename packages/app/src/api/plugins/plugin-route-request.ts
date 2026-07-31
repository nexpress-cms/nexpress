import { NpValidationError, npPluginApiRouteLimits } from "@nexpress/core";

function rawBodyError(message: string): NpValidationError {
  return new NpValidationError("Invalid plugin route request body", [{ field: "body", message }]);
}

/**
 * Read the exact bytes used by signed plugin callbacks without allowing an
 * unbounded body to enter plugin code. Content-Type is deliberately ignored:
 * providers may sign JSON, form data, or a provider-specific media type.
 */
export async function npReadPluginApiRawBody(request: Request): Promise<Uint8Array> {
  const contentLengthHeader = request.headers.get("content-length");
  let declaredLength: number | null = null;
  if (contentLengthHeader !== null) {
    if (!/^(?:0|[1-9][0-9]*)$/u.test(contentLengthHeader)) {
      throw rawBodyError("Content-Length must be a canonical non-negative integer");
    }
    declaredLength = Number(contentLengthHeader);
    if (
      !Number.isSafeInteger(declaredLength) ||
      declaredLength > npPluginApiRouteLimits.rawBodyBytes
    ) {
      throw rawBodyError(
        `Request body exceeds ${npPluginApiRouteLimits.rawBodyBytes.toString()} bytes`,
      );
    }
  }

  const reader = request.body?.getReader();
  if (!reader) {
    if (declaredLength !== null && declaredLength !== 0) {
      throw rawBodyError("Content-Length does not match the received request body");
    }
    return new Uint8Array();
  }

  const chunks: Uint8Array[] = [];
  let received = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > npPluginApiRouteLimits.rawBodyBytes) {
        await reader.cancel().catch(() => undefined);
        throw rawBodyError(
          `Request body exceeds ${npPluginApiRouteLimits.rawBodyBytes.toString()} bytes`,
        );
      }
      // Own the observed bytes instead of retaining a potentially larger or
      // subsequently mutated backing buffer supplied by the stream.
      chunks.push(value.slice());
    }
  } catch (error) {
    if (error instanceof NpValidationError) throw error;
    throw rawBodyError("Request body could not be read");
  }

  if (declaredLength !== null && declaredLength !== received) {
    throw rawBodyError("Content-Length does not match the received request body");
  }

  const bytes = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}
