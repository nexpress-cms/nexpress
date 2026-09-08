import {
  withAgentChangeSetPreview,
  type NpAgentChangeSetPreviewContextV1,
} from "@nexpress/core/agents";
import { npAgentChangeSetLimits } from "@nexpress/core/agent-contract";

/**
 * Explicit host integration for the normal theme/block/SEO renderer. The callback must
 * return its actual rendered response. This consumes the entire stream inside the
 * read-only overlay; returning an unevaluated React element is not a renderer.
 */
export function withAgentChangeSetPreviewRender(
  context: NpAgentChangeSetPreviewContextV1,
  render: () => Promise<Response>,
): Promise<Response> {
  return withAgentChangeSetPreview(context, async () => {
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    let expired = false;
    const duration = Math.min(
      npAgentChangeSetLimits.renderLifetimeSeconds * 1000,
      Date.parse(context.expiresAt) - context.now.getTime(),
    );
    if (!Number.isFinite(duration) || duration <= 0)
      throw new Error("Preview render is unavailable.");
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        expired = true;
        void reader?.cancel().catch(() => undefined);
        reject(new Error("Preview render exceeded its deadline."));
      }, duration);
    });
    async function consume(): Promise<Response> {
      const response = await render();
      if (!(response instanceof Response))
        throw new TypeError("Preview renderer must return a Response.");
      if (expired) {
        await response.body?.cancel().catch(() => undefined);
        throw new Error("Preview render exceeded its deadline.");
      }
      reader = response.body?.getReader();
      const chunks: Uint8Array[] = [];
      let bytes = 0;
      if (reader) {
        try {
          for (;;) {
            const item = await reader.read();
            if (item.done) break;
            bytes += item.value.byteLength;
            if (bytes > npAgentChangeSetLimits.previewHtmlBytes)
              throw new Error("Preview render exceeds its bounded limit.");
            chunks.push(item.value);
          }
        } catch (error) {
          await reader.cancel().catch(() => undefined);
          throw error;
        } finally {
          reader.releaseLock();
        }
      }
      const body = new Uint8Array(bytes);
      let offset = 0;
      for (const chunk of chunks) {
        body.set(chunk, offset);
        offset += chunk.byteLength;
      }
      return new Response(response.body ? body : null, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      });
    }
    try {
      return await Promise.race([consume(), deadline]);
    } finally {
      clearTimeout(timer);
    }
  });
}
