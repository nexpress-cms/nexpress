import { createHash, generateKeyPairSync, randomUUID, X509Certificate } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer, type Server } from "node:https";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { NextRequest } from "next/server";
// eslint-disable-next-line import-x/no-relative-packages
import { proxy } from "../../../packages/app/src/proxy/index.js";
// eslint-disable-next-line import-x/no-relative-packages
import { readAgentPreviewLaunchForm } from "../../../packages/app/src/lib/agents/preview-launch-form.js";
import { chromium, type Browser } from "@playwright/test";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  createAgentStudioServerRuntimeV1,
  setAgentStudioServerRuntimeV1,
  resetAgentStudioServerRuntimeV1,
} from "@nexpress/core/agents";
// eslint-disable-next-line import-x/no-relative-packages
import { createAgentPreviewAccessServiceV1 } from "../../../packages/core/src/agent/preview-access-service.js";
// eslint-disable-next-line import-x/no-relative-packages
import { handleAgentPreviewOriginRequest } from "../../../packages/app/src/lib/agents/preview-http.js";
import { fixture, previewConfiguration, readyPreview, siteId } from "./agent-changeset-fixture.js";
import {
  ensureMigrated,
  truncateAll,
  registerTestCollections,
  closeTestDb,
  skipIfNoTestDb,
} from "./harness.js";
async function listen(server: Server): Promise<number> {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.removeListener("error", reject);
      resolve();
    });
  });
  return (server.address() as AddressInfo).port;
}
async function close(server: Server | undefined) {
  if (server?.listening) {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}
async function send(response: Response, res: ServerResponse) {
  res.statusCode = response.status;
  response.headers.forEach((value, key) => res.setHeader(key, value));
  res.end(Buffer.from(await response.arrayBuffer()));
}
async function request(req: IncomingMessage, origin: string): Promise<Request> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of req) {
    bytes += chunk.length;
    if (bytes > 16384) throw new Error("Request exceeds test bound.");
    chunks.push(Buffer.from(chunk));
  }
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers))
    if (value !== undefined) headers.set(name, Array.isArray(value) ? value.join(",") : value);
  return new Request(`${origin}${req.url}`, {
    method: req.method,
    headers,
    ...(chunks.length ? { body: Buffer.concat(chunks) } : {}),
  });
}
describe.skipIf(skipIfNoTestDb() || process.env.NP_TEST_PREVIEW_BROWSER !== "1")(
  "isolated preview real-browser launch",
  () => {
    beforeAll(ensureMigrated);
    afterEach(async () => {
      resetAgentStudioServerRuntimeV1();
      await truncateAll();
      registerTestCollections();
    });
    afterAll(closeTestDb);
    it("uses a cross-site POST, then an independent Strict-cookie navigation without leaking staff cookies", async () => {
      await truncateAll();
      registerTestCollections();
      const f = await fixture({ preview: previewConfiguration() });
      const preview = await readyPreview(f);
      const directory = await mkdtemp(join(tmpdir(), "nexpress-preview-browser-"));
      await chmod(directory, 0o700);
      let browser: Browser | undefined;
      let production: Server | undefined;
      let isolated: Server | undefined;
      const observations: {
        path: string;
        staffCookie: boolean;
        previewCookie: boolean;
        originKind: string;
      }[] = [];
      try {
        const keyFile = join(directory, "key.pem"),
          certFile = join(directory, "cert.pem");
        execFileSync(
          "openssl",
          [
            "req",
            "-x509",
            "-newkey",
            "rsa:2048",
            "-nodes",
            "-keyout",
            keyFile,
            "-out",
            certFile,
            "-days",
            "1",
            "-subj",
            "/CN=preview.example.net",
            "-addext",
            "subjectAltName=DNS:site.example.com,DNS:preview.example.net",
          ],
          { stdio: "ignore" },
        );
        await chmod(keyFile, 0o600);
        const key = await readFile(keyFile),
          cert = await readFile(certFile);
        const spki = new X509Certificate(cert).publicKey.export({ type: "spki", format: "der" });
        const pin = createHash("sha256").update(spki).digest("base64");
        let previewOrigin = "";
        let siteOrigin = "";
        let access: ReturnType<typeof createAgentPreviewAccessServiceV1>;
        const staffCookie = randomUUID();
        const csrfCookie = randomUUID();
        const launchPath = `/api/admin/agents/changesets/${preview.changeSetId}/previews/${preview.previewId}/launch`;
        const command = {
          idempotencyKey: randomUUID(),
          expectedVersion: 1,
          expectedPlanHash: preview.planHash,
          route: "/",
        };
        isolated = createServer({ key, cert }, (req, res) => {
          void (async () => {
            observations.push({
              path: req.url ?? "",
              staffCookie: (req.headers.cookie ?? "").includes("np-session="),
              previewCookie: (req.headers.cookie ?? "").includes("__Secure-np-preview-"),
              originKind:
                req.headers.origin === siteOrigin
                  ? "production"
                  : req.headers.origin === "null"
                    ? "null"
                    : req.headers.origin === undefined
                      ? "absent"
                      : "other",
            });
            await send(
              await handleAgentPreviewOriginRequest(await request(req, previewOrigin), {
                immutableAssets: {
                  "/__np/assets/fixture.css": async () =>
                    new Response("h1{color:rgb(1,2,3)}", {
                      headers: { "content-type": "text/css; charset=utf-8" },
                    }),
                },
              }),
              res,
            );
          })().catch(() => {
            res.statusCode = 500;
            res.end("Test request failed");
          });
        });
        production = createServer({ key, cert }, (req, res) => {
          void (async () => {
            if (req.url === "/") {
              res.setHeader("set-cookie", [
                `np-session=${staffCookie}; Path=/; Secure; HttpOnly; SameSite=Lax`,
                `np-csrf=${csrfCookie}; Path=/; Secure; SameSite=Lax`,
              ]);
              res.setHeader("content-type", "text/html; charset=utf-8");
              res.end(
                `<!doctype html><form method="post" action="${launchPath}" target="_blank" rel="noopener"><input type="hidden" name="csrfToken" value="${csrfCookie}"><input type="hidden" name="command" value="${JSON.stringify(command).replaceAll('"', "&quot;")}"><button type="submit">Open preview</button></form>`,
              );
              return;
            }
            if (
              req.url !== launchPath ||
              !(req.headers.cookie ?? "").includes(`np-session=${staffCookie}`)
            ) {
              res.statusCode = 404;
              res.end("Not found");
              return;
            }
            const incoming = await request(req, siteOrigin);
            const native = new NextRequest(incoming);
            const admitted = await proxy(native);
            if (admitted.status !== 200) {
              await send(admitted, res);
              return;
            }
            const decoded = await readAgentPreviewLaunchForm(native);
            const result = await access.launch({
              siteId,
              actor: f.actor.actor,
              changeSetId: preview.changeSetId,
              previewId: preview.previewId,
              command: decoded.command,
            });
            await send(new Response(result.html, { headers: result.headers }), res);
          })().catch(() => {
            res.statusCode = 500;
            res.end("Test request failed");
          });
        });
        previewOrigin = `https://preview.example.net:${await listen(isolated)}`;
        siteOrigin = `https://site.example.com:${await listen(production)}`;
        access = createAgentPreviewAccessServiceV1({
          changesets: f.service,
          previewOrigin,
          servedOrigins: [siteOrigin],
          siteOrigin: async () => siteOrigin,
          signingKeys: { active: { id: "browser-sign", ...generateKeyPairSync("ed25519") } },
          sessionKeys: { active: { id: "browser-session", key: new Uint8Array(32).fill(21) } },
          exchangeKeys: { active: { id: "browser-exchange", key: new Uint8Array(32).fill(22) } },
          renderCookieKeys: { active: { id: "browser-render", key: new Uint8Array(32).fill(23) } },
          captureKeys: { active: { id: "browser-capture", key: new Uint8Array(32).fill(24) } },
          reauthentication: { verify: () => true },
        });
        setAgentStudioServerRuntimeV1(
          createAgentStudioServerRuntimeV1({
            changesets: f.service,
            previewAccess: access,
            previewRenderer: async () =>
              new Response(
                '<!doctype html><link rel="stylesheet" href="/__np/assets/fixture.css"><h1>Preview fixture</h1>',
                {
                  headers: { "content-type": "text/html; charset=utf-8" },
                },
              ),
          }),
        );
        browser = await chromium.launch({
          args: [
            "--no-proxy-server",
            "--host-resolver-rules=MAP site.example.com 127.0.0.1,MAP preview.example.net 127.0.0.1",
            `--ignore-certificate-errors-spki-list=${pin}`,
          ],
        });
        const context = await browser.newContext();
        const adminPage = await context.newPage();
        await adminPage.goto(siteOrigin);
        const newPage = context.waitForEvent("page");
        await adminPage.getByRole("button", { name: "Open preview" }).click();
        const page = await newPage;
        try {
          await page.getByRole("heading", { name: "Preview fixture" }).waitFor({ timeout: 5000 });
        } catch {
          throw new Error(
            `Preview browser flow failed: ${JSON.stringify(observations.map(({ path, ...entry }) => ({ ...entry, pathKind: path.startsWith("/__np/view/") ? "view" : path })))}`,
          );
        }
        await expect
          .poll(() =>
            page
              .getByRole("heading", { name: "Preview fixture" })
              .evaluate((element) => getComputedStyle(element).color),
          )
          .toBe("rgb(1, 2, 3)");
        expect(
          observations.some(
            (item) =>
              item.path === "/__np/assets/fixture.css" && !item.staffCookie && !item.previewCookie,
          ),
        ).toBe(true);
        expect(page.url().startsWith(`${previewOrigin}/__np/view/${preview.previewId}/`)).toBe(
          true,
        );
        const previewCookies = (await context.cookies()).filter((item) =>
          item.name.startsWith("__Secure-np-preview-"),
        );
        expect(
          previewCookies.map(({ name, domain, path, secure, httpOnly, sameSite }) => ({
            name,
            domain,
            path,
            secure,
            httpOnly,
            sameSite,
          })),
        ).toEqual([
          {
            name: `__Secure-np-preview-${preview.previewId.replaceAll("-", "")}`,
            domain: "preview.example.net",
            path: `/__np/view/${preview.previewId}/`,
            secure: true,
            httpOnly: true,
            sameSite: "Strict",
          },
        ]);
        const launch = observations.find((item) => item.path === "/__np/launch");
        expect(launch).toEqual({
          path: "/__np/launch",
          staffCookie: false,
          previewCookie: false,
          originKind: "production",
        });
        expect(
          observations.some(
            (item) =>
              item.path.startsWith("/__np/view/") && item.previewCookie && !item.staffCookie,
          ),
        ).toBe(true);
        await page.goto(`${previewOrigin}/outside`);
        expect(observations.find((item) => item.path === "/outside")).toEqual({
          path: "/outside",
          staffCookie: false,
          previewCookie: false,
          originKind: "absent",
        });
        expect(observations.some((item) => item.staffCookie)).toBe(false);
      } finally {
        await browser?.close();
        await close(isolated);
        await close(production);
        await rm(directory, { recursive: true, force: true });
      }
    }, 60000);
  },
);
