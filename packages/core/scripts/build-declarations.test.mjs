import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  declarationEntries,
  declarationForwarder,
  verifyDeclarationTree,
} from "./build-declarations.mjs";

const manifest = {
  exports: {
    ".": { types: "./dist/index.d.ts", import: "./dist/index.js" },
    "./db-schema": { types: "./dist/db-schema.d.ts", import: "./dist/db-schema.js" },
  },
};
test("the actual package export filenames constrain every supplied JS entry", () => {
  const entries = declarationEntries(
    { index: "src/index.ts", "db-schema": "src/db/schema/index.ts" },
    manifest,
  );
  assert.equal(entries[1].module, "db/schema/index");
  assert.throws(() => declarationEntries({ index: "src/index.ts" }, manifest));
  assert.throws(() =>
    declarationEntries({ index: "src/index.ts", "db-schema": "../outside.ts" }, manifest),
  );
  assert.throws(() =>
    declarationEntries(
      { index: "src/index.ts", "db-schema": "src/db/schema/index.ts" },
      {
        exports: {
          ...manifest.exports,
          "./db-schema": { ...manifest.exports["./db-schema"], types: "./dist/wrong.d.ts" },
        },
      },
    ),
  );
});
test("forwarders preserve named and future default exports with NodeNext .js references", () => {
  const [entry] = declarationEntries(
    { index: "src/index.ts", "db-schema": "src/db/schema/index.ts" },
    manifest,
  );
  assert.match(declarationForwarder(entry), /export \* from "\.\/types\/index\.js"/u);
  assert.doesNotMatch(declarationForwarder(entry), /export \{ default \}/u);
  assert.match(
    declarationForwarder(entry, true),
    /export \{ default \} from "\.\/types\/index\.js"/u,
  );
});
test("missing or escaping private declaration dependencies fail before publication", async () => {
  const root = await mkdtemp(join(tmpdir(), "np-declaration-tree-"));
  const ts = {
    preProcessFile: (text) => ({
      importedFiles: text ? [{ fileName: text }] : [],
      referencedFiles: [],
    }),
  };
  try {
    await mkdir(join(root, "leaf"));
    await writeFile(join(root, "index.d.ts"), "./leaf/types.js");
    await assert.rejects(verifyDeclarationTree(root, ts), /Missing private declaration/u);
    await writeFile(join(root, "leaf", "types.d.ts"), "");
    assert.equal(await verifyDeclarationTree(root, ts), 2);
    await writeFile(join(root, "index.d.ts"), "../source.js");
    await assert.rejects(verifyDeclarationTree(root, ts), /escapes/u);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
