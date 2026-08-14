import { beforeEach, describe, expect, test, vi } from "vitest";

const nativeMocks = vi.hoisted(() => ({
  files: new Map<string, Uint8Array>(),
  shareAsync: vi.fn(),
  isAvailableAsync: vi.fn(async () => true),
  createDownloadResumable: vi.fn(),
}));

const platformMocks = vi.hoisted(() => ({
  isWeb: false,
}));

vi.mock("@/constants/platform", () => ({
  get isWeb() {
    return platformMocks.isWeb;
  },
  get isNative() {
    return !platformMocks.isWeb;
  },
}));

vi.mock("expo-file-system", () => ({
  Paths: {
    cache: "file:///cache",
    document: "file:///documents",
  },
  File: class MockFile {
    readonly uri: string;

    constructor(directory: string, name: string) {
      this.uri = `${directory}/${name}`;
    }

    get exists() {
      return nativeMocks.files.has(this.uri);
    }

    write(bytes: Uint8Array) {
      nativeMocks.files.set(this.uri, bytes);
    }
  },
}));

vi.mock("expo-file-system/legacy", () => ({
  createDownloadResumable: nativeMocks.createDownloadResumable,
}));

vi.mock("expo-sharing", () => ({
  isAvailableAsync: nativeMocks.isAvailableAsync,
  shareAsync: nativeMocks.shareAsync,
}));

import { useDownloadStore } from "./download-store";
import { defaultHostAppearance } from "@/hosts/appearance";

describe("download store native transfers", () => {
  beforeEach(() => {
    platformMocks.isWeb = false;
    nativeMocks.files.clear();
    nativeMocks.shareAsync.mockReset();
    nativeMocks.isAvailableAsync.mockReset();
    nativeMocks.isAvailableAsync.mockResolvedValue(true);
    nativeMocks.createDownloadResumable.mockReset();
    useDownloadStore.setState({
      downloads: new Map(),
      activeDownloadId: null,
    });
  });

  test("downloads over the active client when the iPhone is connected through relay", async () => {
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const readFile = vi.fn(async () => ({
      bytes,
      mime: "application/pdf",
      size: bytes.byteLength,
    }));
    const requestFileDownloadToken = vi.fn();

    await useDownloadStore.getState().startDownload({
      serverId: "server-1",
      scopeId: "workspace-1",
      fileName: "design.pdf",
      path: "docs/design.pdf",
      daemonProfile: undefined,
      activeConnectionType: "relay",
      isElectron: false,
      readFile,
      saveDesktopFile: vi.fn(),
      requestFileDownloadToken,
    });

    expect(requestFileDownloadToken).not.toHaveBeenCalled();
    expect(readFile).toHaveBeenCalledWith("docs/design.pdf");
    expect(nativeMocks.files.get("file:///cache/design.pdf")).toEqual(bytes);
    expect(nativeMocks.shareAsync).toHaveBeenCalledWith("file:///cache/design.pdf", {
      mimeType: "application/pdf",
      dialogTitle: "Share design.pdf",
    });
    expect([...useDownloadStore.getState().downloads.values()]).toEqual([
      expect.objectContaining({
        fileName: "design.pdf",
        status: "complete",
      }),
    ]);
  });

  test("falls back to the active client when direct HTTP download fails", async () => {
    nativeMocks.createDownloadResumable.mockReturnValue({
      downloadAsync: vi.fn(async () => {
        throw new Error("Network request failed");
      }),
    });
    const bytes = new Uint8Array([5, 6, 7]);
    const readFile = vi.fn(async () => ({
      bytes,
      mime: "text/plain",
      size: bytes.byteLength,
    }));

    await useDownloadStore.getState().startDownload({
      serverId: "server-1",
      scopeId: "workspace-1",
      fileName: "notes.txt",
      path: "notes.txt",
      daemonProfile: {
        serverId: "server-1",
        label: "Mac",
        lifecycle: {},
        appearance: defaultHostAppearance(),
        connections: [
          {
            id: "direct:mac.local:6767",
            type: "directTcp",
            endpoint: "mac.local:6767",
          },
        ],
        preferredConnectionId: null,
        createdAt: "2026-07-26T00:00:00.000Z",
        updatedAt: "2026-07-26T00:00:00.000Z",
      },
      activeConnectionType: "directTcp",
      isElectron: false,
      readFile,
      saveDesktopFile: vi.fn(),
      requestFileDownloadToken: vi.fn(async () => ({
        token: "token",
        fileName: "notes.txt",
        mimeType: "text/plain",
        error: null,
      })),
    });

    expect(readFile).toHaveBeenCalledWith("notes.txt");
    expect(nativeMocks.files.get("file:///cache/notes.txt")).toEqual(bytes);
    expect(nativeMocks.shareAsync).toHaveBeenCalledWith("file:///cache/notes.txt", {
      mimeType: "text/plain",
      dialogTitle: "Share notes.txt",
    });
  });

  test("downloads over the active client when Paseo Desktop is connected through relay", async () => {
    platformMocks.isWeb = true;
    const bytes = new Uint8Array([8, 9, 10]);
    const readFile = vi.fn(async () => ({
      bytes,
      mime: "text/markdown",
      size: bytes.byteLength,
    }));
    const saveDesktopFile = vi.fn(async () => ({
      status: "saved" as const,
      path: "/Users/test/Downloads/design.md",
    }));
    const requestFileDownloadToken = vi.fn();

    await useDownloadStore.getState().startDownload({
      serverId: "server-1",
      scopeId: "workspace-1",
      fileName: "design.md",
      path: "docs/design.md",
      daemonProfile: undefined,
      activeConnectionType: "relay",
      isElectron: true,
      readFile,
      saveDesktopFile,
      requestFileDownloadToken,
    });

    expect(requestFileDownloadToken).not.toHaveBeenCalled();
    expect(readFile).toHaveBeenCalledWith("docs/design.md");
    expect(saveDesktopFile).toHaveBeenCalledWith({ fileName: "design.md", bytes });
    expect([...useDownloadStore.getState().downloads.values()]).toEqual([
      expect.objectContaining({ fileName: "design.md", status: "complete" }),
    ]);
  });
});
