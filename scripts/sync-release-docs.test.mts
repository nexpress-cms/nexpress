import assert from "node:assert/strict";
import { test } from "node:test";

import { renderReleaseDocs } from "./sync-release-docs.mjs";

const sources = {
  readme: "> **Status — pre-1.0 (`v0.4.x`).**\n",
  security: "The current framework release line is\n`0.4.x`.\n",
  releasing:
    "**Current published baseline:** NexPress `0.4.1` and `create-nexpress 0.1.36`\n" +
    "(tag `v0.4.1`).\n",
};

test("synchronizes public release markers from generated package versions", () => {
  const rendered = renderReleaseDocs(sources, {
    coreVersion: "0.5.0",
    createNexpressVersion: "0.1.37",
  });

  assert.match(rendered.readme, /Status — pre-1\.0 \(`v0\.5\.x`\)/);
  assert.match(rendered.security, /current framework release line is\n`0\.5\.x`/);
  assert.ok(
    rendered.releasing.includes(
      "**Current published baseline:** NexPress `0.5.0` and `create-nexpress 0.1.37`\n" +
        "(tag `v0.5.0`).",
    ),
  );
});

test("fails closed for malformed versions or missing and duplicated markers", () => {
  assert.throws(
    () =>
      renderReleaseDocs(sources, {
        coreVersion: "0.5",
        createNexpressVersion: "0.1.37",
      }),
    /exact stable semver/,
  );

  assert.throws(
    () =>
      renderReleaseDocs(
        { ...sources, readme: "release marker missing\n" },
        { coreVersion: "0.5.0", createNexpressVersion: "0.1.37" },
      ),
    /README\.md must contain exactly one release marker; found 0/,
  );

  assert.throws(
    () =>
      renderReleaseDocs(
        { ...sources, security: `${sources.security}${sources.security}` },
        { coreVersion: "0.5.0", createNexpressVersion: "0.1.37" },
      ),
    /SECURITY\.md must contain exactly one release marker; found 2/,
  );
});
