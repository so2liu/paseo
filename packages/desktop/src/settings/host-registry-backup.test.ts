import { mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createHostRegistryBackupStore } from "./host-registry-backup.js";

const directories = new Set<string>();

async function createTempUserDataDir(): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "paseo-host-registry-"));
  directories.add(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all([...directories].map((directory) => rm(directory, { recursive: true })));
  directories.clear();
});

describe("host registry backup", () => {
  it("round-trips the registry through an atomic private file", async () => {
    const userDataPath = await createTempUserDataDir();
    const store = createHostRegistryBackupStore({ userDataPath });
    const registry = JSON.stringify([{ serverId: "srv_remote", connections: [] }]);

    await store.write(registry);

    await expect(store.read()).resolves.toBe(registry);
    await expect(readdir(userDataPath)).resolves.toEqual(["host-registry-backup.json"]);
    if (process.platform !== "win32") {
      const fileStat = await stat(path.join(userDataPath, "host-registry-backup.json"));
      expect(fileStat.mode & 0o777).toBe(0o600);
    }
  });

  it("returns null when missing and rejects a corrupt backup", async () => {
    const userDataPath = await createTempUserDataDir();
    const store = createHostRegistryBackupStore({ userDataPath });
    await expect(store.read()).resolves.toBeNull();

    await writeFile(path.join(userDataPath, "host-registry-backup.json"), "not-json", "utf8");
    await expect(store.read()).rejects.toThrow();
  });

  it("rejects non-array registry data without replacing the last good backup", async () => {
    const userDataPath = await createTempUserDataDir();
    const store = createHostRegistryBackupStore({ userDataPath });
    const registry = JSON.stringify([{ serverId: "srv_remote" }]);
    await store.write(registry);

    await expect(store.write(JSON.stringify({ serverId: "srv_bad" }))).rejects.toThrow(
      "must be an array",
    );

    await expect(store.read()).resolves.toBe(registry);
    const raw = await readFile(path.join(userDataPath, "host-registry-backup.json"), "utf8");
    expect(JSON.parse(raw)).toEqual({
      version: 1,
      hosts: [{ serverId: "srv_remote" }],
    });
  });
});
