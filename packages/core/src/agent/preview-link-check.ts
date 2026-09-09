import { lookup } from "node:dns/promises";
import { request } from "node:https";
import { isIP } from "node:net";
import ipaddr from "ipaddr.js";

/** Private preview-checker facet. Never exported from a package entry point. */
export async function checkPreviewExternalLink(
  url: URL,
  assertCurrentAuthority: () => Promise<void>,
): Promise<"reachable" | "unreachable" | "timeout"> {
  await assertCurrentAuthority();
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, 5_000);
  const aborted = new Promise<never>((_, reject) => {
    controller.signal.addEventListener("abort", () => reject(new Error("CHECK_TIMEOUT")), {
      once: true,
    });
  });
  let authorityFailed = false;
  try {
    // Reject a mixed public/private answer set, not merely the address selected first.
    const addresses = await Promise.race([
      lookup(url.hostname, { all: true, verbatim: true }),
      aborted,
    ]);
    if (
      addresses.length === 0 ||
      addresses.length > 64 ||
      addresses.some(({ address, family }) => {
        if (!isIP(address) || isIP(address) !== family) return true;
        const parsed = ipaddr.parse(address);
        return (
          parsed.range() !== "unicast" ||
          (parsed.kind() === "ipv6" && !parsed.match(ipaddr.IPv6.parse("2000::"), 3))
        );
      })
    )
      return "unreachable";
    await Promise.race([
      assertCurrentAuthority().catch(() => {
        authorityFailed = true;
        throw new Error("PREVIEW_CHECK_AUTHORITY_CHANGED");
      }),
      aborted,
    ]);
    if (controller.signal.aborted) return "timeout";
    const pinned = addresses[0];
    return await Promise.race([
      new Promise<"reachable" | "unreachable">((resolve) => {
        const req = request(
          {
            protocol: "https:",
            hostname: url.hostname,
            servername: url.hostname,
            port: 443,
            path: url.pathname,
            method: "HEAD",
            agent: false,
            family: pinned.family,
            // An explicit family also disables Node's automatic family selection.
            signal: controller.signal,
            headers: {},
            maxHeaderSize: 16_384,
            // The socket never resolves the host again. TLS still verifies the original host.
            lookup: (_hostname, _options, callback) =>
              callback(null, pinned.address, pinned.family),
          },
          (res) => {
            const status = res.statusCode ?? 0;
            res.destroy(); // Do not consume or expose a response body, including hostile HEAD bodies.
            resolve(status >= 200 && status < 300 ? "reachable" : "unreachable");
          },
        );
        req.once("error", () => resolve("unreachable"));
        req.end();
      }),
      aborted,
    ]);
  } catch {
    if (authorityFailed) throw new Error("PREVIEW_CHECK_AUTHORITY_CHANGED");
    return timedOut ? "timeout" : "unreachable";
  } finally {
    clearTimeout(timer);
    controller.abort();
    await assertCurrentAuthority();
  }
}
