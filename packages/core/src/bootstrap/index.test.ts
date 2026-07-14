import { describe, expect, it } from "vitest";

import * as root from "../index.js";
import * as host from "./index.js";
import * as db from "../db/index.js";
import * as jobs from "../jobs/index.js";
import * as media from "../media/index.js";
import * as storage from "../storage/public.js";

describe("framework-host bootstrap exports", () => {
  it("keeps raw singleton wiring out of the core root barrel", () => {
    for (const name of [
      "createDbConnection",
      "getDb",
      "setDb",
      "setStorageAdapter",
      "configureStorageRuntime",
      "npShutdownStorageAdapter",
      "setJobQueue",
      "loadPlugins",
      "runHook",
      "runHookAndCollect",
      "teardownPlugins",
      "resetPlugins",
    ]) {
      expect(root).not.toHaveProperty(name);
      expect(host).toHaveProperty(name);
    }
  });

  it("keeps normal database access on the database domain subpath", () => {
    expect(db.createDbConnection).toBe(host.createDbConnection);
    expect(db.getDb).toBe(host.getDb);
    expect(db).not.toHaveProperty("setDb");
  });

  it("keeps singleton mutation on the framework-host boundary", () => {
    expect(storage).not.toHaveProperty("setStorageAdapter");
    expect(storage).not.toHaveProperty("configureStorageRuntime");
    expect(media).not.toHaveProperty("setStorageAdapter");
    expect(jobs).not.toHaveProperty("setJobQueue");
  });
});
