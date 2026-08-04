import { randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

const HOST_REGISTRY_BACKUP_FILENAME = "host-registry-backup.json";
const MAX_REGISTRY_BYTES = 4 * 1024 * 1024;

interface PersistedHostRegistryBackup {
  version: 1;
  hosts: unknown[];
}

export interface HostRegistryBackupStore {
  read(): Promise<string | null>;
  write(value: string): Promise<void>;
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error;
}

function parseRegistry(value: string): unknown[] {
  if (Buffer.byteLength(value, "utf8") > MAX_REGISTRY_BYTES) {
    throw new Error("Host registry backup exceeds the size limit.");
  }
  const parsed = JSON.parse(value) as unknown;
  if (!Array.isArray(parsed)) {
    throw new Error("Host registry backup must be an array.");
  }
  return parsed;
}

function parseDocument(value: string): PersistedHostRegistryBackup | null {
  const parsed = JSON.parse(value) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return null;
  }
  const document = parsed as Record<string, unknown>;
  if (document.version !== 1 || !Array.isArray(document.hosts)) {
    return null;
  }
  return { version: 1, hosts: document.hosts };
}

export function createHostRegistryBackupStore({
  userDataPath,
}: {
  userDataPath: string;
}): HostRegistryBackupStore {
  const filePath = path.join(userDataPath, HOST_REGISTRY_BACKUP_FILENAME);
  let writeQueue: Promise<void> = Promise.resolve();

  return {
    async read(): Promise<string | null> {
      let raw: string;
      try {
        raw = await readFile(filePath, "utf8");
      } catch (error) {
        if (isNodeError(error) && error.code === "ENOENT") {
          return null;
        }
        throw error;
      }
      const document = parseDocument(raw);
      return document ? JSON.stringify(document.hosts) : null;
    },

    async write(value: string): Promise<void> {
      const hosts = parseRegistry(value);
      const document: PersistedHostRegistryBackup = { version: 1, hosts };
      const contents = `${JSON.stringify(document, null, 2)}\n`;
      const write = async () => {
        await mkdir(userDataPath, { recursive: true });
        const temporaryPath = `${filePath}.tmp.${process.pid}.${randomUUID()}`;
        await writeFile(temporaryPath, contents, { encoding: "utf8", mode: 0o600 });
        await rename(temporaryPath, filePath);
        await chmod(filePath, 0o600);
      };
      const queued = writeQueue.then(write, write);
      writeQueue = queued.catch(() => undefined);
      await queued;
    },
  };
}
