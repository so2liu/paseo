import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { saveDownloadBytes } from "./downloads";

let testDirectory: string | null = null;

describe("desktop file downloads", () => {
  afterEach(async () => {
    if (testDirectory) {
      await rm(testDirectory, { recursive: true, force: true });
      testDirectory = null;
    }
  });

  it("saves binary relay downloads to the path selected by the user", async () => {
    testDirectory = await mkdtemp(path.join(os.tmpdir(), "paseo-desktop-download-"));
    const selectedPath = path.join(testDirectory, "saved-design.md");
    const showSaveDialog = vi.fn(async () => ({ canceled: false, filePath: selectedPath }));
    const bytes = new Uint8Array([35, 32, 68, 101, 115, 105, 103, 110, 10]);

    await expect(
      saveDownloadBytes(
        { fileName: "../design.md", bytes },
        { downloadsDirectory: testDirectory, showSaveDialog, writeFile },
      ),
    ).resolves.toEqual({ status: "saved", path: selectedPath });

    expect(showSaveDialog).toHaveBeenCalledWith({
      defaultPath: path.join(testDirectory, "design.md"),
    });
    await expect(readFile(selectedPath)).resolves.toEqual(Buffer.from(bytes));
  });

  it("does not write a file when the save dialog is cancelled", async () => {
    testDirectory = await mkdtemp(path.join(os.tmpdir(), "paseo-desktop-download-"));
    const writeFileMock = vi.fn<typeof writeFile>();

    await expect(
      saveDownloadBytes(
        { fileName: "design.md", bytes: [1, 2, 3] },
        {
          downloadsDirectory: testDirectory,
          showSaveDialog: async () => ({ canceled: true }),
          writeFile: writeFileMock,
        },
      ),
    ).resolves.toEqual({ status: "cancelled" });

    expect(writeFileMock).not.toHaveBeenCalled();
  });
});
