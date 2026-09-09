/** The existing launch command gains only a native-form encoding, not another authority. */
const path =
  /^\/api\/admin\/agents\/changesets\/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\/previews\/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\/launch$/u;
export function isAgentPreviewLaunchForm(request: Request): boolean {
  return (
    request.method === "POST" &&
    path.test(new URL(request.url).pathname) &&
    /^application\/x-www-form-urlencoded(?:\s*;\s*charset=utf-8)?$/iu.test(
      request.headers.get("content-type") ?? "",
    )
  );
}
export async function readAgentPreviewLaunchForm(
  request: Request,
): Promise<{ command: unknown; csrfToken: string }> {
  const url = new URL(request.url);
  if (
    !isAgentPreviewLaunchForm(request) ||
    url.search ||
    request.headers.get("origin") !== url.origin ||
    request.headers.get("sec-fetch-site") !== "same-origin" ||
    request.headers.has("content-encoding")
  )
    throw new Error("Invalid preview launch form");
  const reader = request.body?.getReader();
  if (!reader) throw new Error("Invalid preview launch form");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > 32768) {
        await reader.cancel();
        throw new Error("Invalid preview launch form");
      }
      chunks.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const values = new URLSearchParams(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  const keys = [...values.keys()];
  if (keys.length !== 2 || !keys.includes("command") || !keys.includes("csrfToken"))
    throw new Error("Invalid preview launch form");
  const csrfToken = values.get("csrfToken")!;
  const command = values.get("command")!;
  if (!csrfToken || csrfToken.length > 256 || command.length > 16384)
    throw new Error("Invalid preview launch form");
  return { csrfToken, command: JSON.parse(command) as unknown };
}
export function equalPreviewLaunchCsrfToken(expected: string | undefined, actual: string): boolean {
  if (!expected || expected.length !== actual.length || expected.length > 256) return false;
  let difference = 0;
  for (let index = 0; index < expected.length; index++)
    difference |= expected.charCodeAt(index) ^ actual.charCodeAt(index);
  return difference === 0;
}
