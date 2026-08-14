import path from "node:path";

export type SaveDownloadResult = { status: "saved"; path: string } | { status: "cancelled" };

export interface SaveDownloadDependencies {
  downloadsDirectory: string;
  showSaveDialog: (options: { defaultPath: string }) => Promise<{
    canceled: boolean;
    filePath?: string;
  }>;
  writeFile: (filePath: string, bytes: Uint8Array) => Promise<void>;
}

function normalizeFileName(value: unknown): string {
  if (typeof value !== "string") {
    return "download";
  }

  const baseName = path.posix.basename(value.trim().replaceAll("\\", "/"));
  if (!baseName || baseName === "." || baseName === "..") {
    return "download";
  }
  return baseName.replace(/[\\/:*?"<>|]+/g, "_");
}

function normalizeBytes(value: unknown): Uint8Array {
  if (value instanceof Uint8Array) {
    return value;
  }
  if (value instanceof ArrayBuffer) {
    return new Uint8Array(value);
  }
  if (Array.isArray(value)) {
    return Uint8Array.from(value);
  }
  throw new Error("Download byte payload is required.");
}

export async function saveDownloadBytes(
  input: { fileName?: unknown; bytes?: unknown },
  dependencies: SaveDownloadDependencies,
): Promise<SaveDownloadResult> {
  const fileName = normalizeFileName(input.fileName);
  const bytes = normalizeBytes(input.bytes);
  const result = await dependencies.showSaveDialog({
    defaultPath: path.join(dependencies.downloadsDirectory, fileName),
  });

  if (result.canceled || !result.filePath) {
    return { status: "cancelled" };
  }

  await dependencies.writeFile(result.filePath, bytes);
  return { status: "saved", path: result.filePath };
}
