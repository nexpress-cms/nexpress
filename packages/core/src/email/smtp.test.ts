import net from "node:net";
import { afterEach, describe, expect, it } from "vitest";

import { SmtpEmailAdapter } from "./smtp.js";

interface CapturedSmtpMessage {
  mailFrom: string | null;
  rcptTo: string[];
  data: string;
}

interface SmtpCaptureServer {
  port: number;
  waitForMessage(): Promise<CapturedSmtpMessage>;
  close(): Promise<void>;
}

const activeServers: SmtpCaptureServer[] = [];

afterEach(async () => {
  await Promise.all(activeServers.splice(0).map((server) => server.close()));
});

describe("SmtpEmailAdapter", () => {
  it("rejects malformed constructor options before loading nodemailer", () => {
    expect(
      () =>
        new SmtpEmailAdapter({
          host: "smtp.example.com",
          port: Number.NaN,
          from: "noreply@example.test",
        }),
    ).toThrow(/email\.smtp\.port/u);
    expect(
      () =>
        new SmtpEmailAdapter({
          host: "smtp.example.com",
          port: 587,
          from: "noreply@example.test",
          user: "partial-user",
        }),
    ).toThrow(/provided together/u);
  });

  it("delivers a message through an SMTP-speaking relay", async () => {
    const relay = await startSmtpCaptureServer();
    activeServers.push(relay);

    const adapter = new SmtpEmailAdapter({
      host: "127.0.0.1",
      port: relay.port,
      from: "noreply@example.test",
      secure: false,
    });

    const delivered = relay.waitForMessage();
    await adapter.send({
      to: "admin@example.test",
      subject: "SMTP smoke",
      text: "Plain body from NexPress.",
      html: "<p><strong>HTML body</strong> from NexPress.</p>",
    });

    const message = await delivered;
    expect(message.mailFrom).toBe("noreply@example.test");
    expect(message.rcptTo).toEqual(["admin@example.test"]);
    expect(message.data).toContain("From: noreply@example.test");
    expect(message.data).toContain("To: admin@example.test");
    expect(message.data).toContain("Subject: SMTP smoke");
    expect(message.data).toContain("Plain body from NexPress.");
    expect(message.data).toContain("HTML body");
  });
});

async function startSmtpCaptureServer(): Promise<SmtpCaptureServer> {
  const messages: CapturedSmtpMessage[] = [];
  const waiters: Array<(message: CapturedSmtpMessage) => void> = [];
  const sockets = new Set<net.Socket>();

  const server = net.createServer((socket) => {
    sockets.add(socket);
    socket.setEncoding("utf8");
    socket.on("close", () => {
      sockets.delete(socket);
    });

    let buffer = "";
    let dataMode = false;
    let dataLines: string[] = [];
    let current: Omit<CapturedSmtpMessage, "data"> = { mailFrom: null, rcptTo: [] };

    const send = (line: string) => {
      socket.write(`${line}\r\n`);
    };

    const finishMessage = () => {
      const message: CapturedSmtpMessage = {
        ...current,
        data: dataLines.join("\n"),
      };
      const waiter = waiters.shift();
      if (waiter) {
        waiter(message);
      } else {
        messages.push(message);
      }
      current = { mailFrom: null, rcptTo: [] };
      dataLines = [];
      dataMode = false;
    };

    const handleCommand = (line: string) => {
      const verb = line.slice(0, 4).toUpperCase();
      switch (verb) {
        case "EHLO":
        case "HELO":
          socket.write("250-localhost\r\n250-8BITMIME\r\n250 SMTPUTF8\r\n");
          break;
        case "MAIL":
          current.mailFrom = extractAddress(line);
          send("250 2.1.0 OK");
          break;
        case "RCPT":
          current.rcptTo.push(extractAddress(line));
          send("250 2.1.5 OK");
          break;
        case "DATA":
          dataMode = true;
          send("354 End data with <CR><LF>.<CR><LF>");
          break;
        case "RSET":
          current = { mailFrom: null, rcptTo: [] };
          dataLines = [];
          dataMode = false;
          send("250 2.0.0 OK");
          break;
        case "NOOP":
          send("250 2.0.0 OK");
          break;
        case "QUIT":
          send("221 2.0.0 Bye");
          socket.end();
          break;
        default:
          send("502 5.5.2 Command not recognized");
      }
    };

    socket.on("data", (chunk) => {
      buffer += chunk.toString();
      let newlineIndex = buffer.indexOf("\n");
      while (newlineIndex >= 0) {
        const raw = buffer.slice(0, newlineIndex);
        buffer = buffer.slice(newlineIndex + 1);
        const line = raw.endsWith("\r") ? raw.slice(0, -1) : raw;

        if (dataMode) {
          if (line === ".") {
            finishMessage();
            send("250 2.0.0 queued");
          } else {
            dataLines.push(line);
          }
        } else {
          handleCommand(line);
        }

        newlineIndex = buffer.indexOf("\n");
      }
    });

    send("220 localhost ESMTP test relay");
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("SMTP capture server did not bind a TCP port.");
  }

  return {
    port: address.port,
    waitForMessage() {
      const message = messages.shift();
      if (message) return Promise.resolve(message);
      return new Promise<CapturedSmtpMessage>((resolve) => {
        waiters.push(resolve);
      });
    },
    async close() {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) reject(error);
          else resolve();
        });
        for (const socket of sockets) {
          socket.destroy();
        }
      });
    },
  };
}

function extractAddress(line: string): string {
  const match = line.match(/<([^>]+)>/);
  return match?.[1] ?? line;
}
