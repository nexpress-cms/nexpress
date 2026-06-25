import { spawn } from "node:child_process";

import { findForbiddenBuildWarnings, renderForbiddenBuildWarnings } from "./build-core.js";

function nextBin(): string {
  return process.platform === "win32" ? "next.cmd" : "next";
}

async function main(): Promise<void> {
  const args = ["build", ...process.argv.slice(2)];
  let output = "";
  const child = spawn(nextBin(), args, {
    stdio: ["inherit", "pipe", "pipe"],
  });

  child.stdout?.on("data", (chunk: Buffer) => {
    const text = chunk.toString("utf8");
    output += text;
    process.stdout.write(chunk);
  });

  child.stderr?.on("data", (chunk: Buffer) => {
    const text = chunk.toString("utf8");
    output += text;
    process.stderr.write(chunk);
  });

  const exitCode = await new Promise<number>((resolve) => {
    child.on("error", (error) => {
      console.error(error);
      resolve(1);
    });
    child.on("close", (code, signal) => {
      if (signal) {
        console.error(`next build exited via signal ${signal}`);
        resolve(1);
        return;
      }
      resolve(code ?? 1);
    });
  });

  if (exitCode !== 0) {
    process.exit(exitCode);
  }

  const warnings = findForbiddenBuildWarnings(output);
  if (warnings.length > 0) {
    console.error(renderForbiddenBuildWarnings(warnings));
    process.exit(1);
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
