import { create } from "zustand";
import { File as FSFile, Paths } from "expo-file-system";
import * as LegacyFileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import type { HostProfile } from "@/types/host-connection";
import { buildDaemonWebSocketUrl } from "@/utils/daemon-endpoints";
import { openExternalUrl } from "@/utils/open-external-url";
import { isWeb } from "@/constants/platform";
import { i18n } from "@/i18n/i18next";
import type { DesktopDownloadSaveResult } from "@/desktop/downloads";

interface DownloadProgress {
  percent: number;
  bytesWritten: number;
  totalBytes: number;
  speed: number;
  eta: number;
}

export interface Download {
  id: string;
  serverId: string;
  scopeId: string;
  fileName: string;
  status: "downloading" | "complete" | "error";
  message?: string;
  progress?: DownloadProgress;
  startedAt: number;
}

interface DownloadState {
  downloads: Map<string, Download>;
  activeDownloadId: string | null;

  startDownload: (params: {
    serverId: string;
    scopeId: string;
    fileName: string;
    path: string;
    daemonProfile: HostProfile | undefined;
    activeConnectionType: "directTcp" | "directSocket" | "directPipe" | "relay" | null;
    isElectron: boolean;
    readFile: (path: string) => Promise<{
      bytes: Uint8Array;
      mime: string;
      size: number;
    }>;
    saveDesktopFile: (input: {
      fileName: string;
      bytes: Uint8Array;
    }) => Promise<DesktopDownloadSaveResult>;
    requestFileDownloadToken: (path: string) => Promise<{
      token: string | null;
      fileName: string | null;
      mimeType: string | null;
      error: string | null;
    }>;
  }) => Promise<void>;

  updateProgress: (id: string, progress: DownloadProgress) => void;
  completeDownload: (id: string) => void;
  failDownload: (id: string, message: string) => void;
  dismissDownload: (id: string) => void;
  dismissAllCompleted: () => void;
}

function generateDownloadId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export const useDownloadStore = create<DownloadState>()((set, get) => ({
  downloads: new Map(),
  activeDownloadId: null,

  startDownload: async ({
    serverId,
    scopeId,
    fileName,
    path,
    daemonProfile,
    activeConnectionType,
    isElectron,
    readFile,
    saveDesktopFile,
    requestFileDownloadToken,
  }) => {
    const id = generateDownloadId();
    const download: Download = {
      id,
      serverId,
      scopeId,
      fileName,
      status: "downloading",
      startedAt: Date.now(),
    };

    set((state) => ({
      downloads: new Map(state.downloads).set(id, download),
      activeDownloadId: id,
    }));

    try {
      const downloadTarget = resolveDaemonDownloadTarget(daemonProfile);
      let resolvedFileName = fileName;
      let downloadedUri: string | null;
      let downloadedMimeType: string | null = null;

      const downloadOverActiveClient = async () => {
        const file = await readFile(path);
        get().updateProgress(id, {
          percent: 1,
          bytesWritten: file.size,
          totalBytes: file.size,
          speed: 0,
          eta: 0,
        });
        downloadedMimeType = file.mime;

        return persistActiveClientDownload({
          fileName: resolvedFileName,
          bytes: file.bytes,
          isElectron,
          saveDesktopFile,
        });
      };

      if (shouldDownloadOverActiveClient(activeConnectionType, isElectron)) {
        downloadedUri = await downloadOverActiveClient();
      } else {
        try {
          const tokenResponse = await requestFileDownloadToken(path);
          if (tokenResponse.error || !tokenResponse.token) {
            throw new Error(tokenResponse.error ?? i18n.t("downloads.requestTokenFailed"));
          }
          if (!downloadTarget.baseUrl) {
            throw new Error(i18n.t("downloads.hostUnavailable"));
          }

          resolvedFileName = tokenResponse.fileName ?? fileName;
          downloadedMimeType = tokenResponse.mimeType;
          const downloadUrl = buildDownloadUrl(
            downloadTarget.baseUrl,
            tokenResponse.token,
            isWeb ? downloadTarget.authCredentials : null,
          );

          if (isWeb) {
            triggerBrowserDownload(downloadUrl, resolvedFileName);
            get().completeDownload(id);
            return;
          }

          const downloadStartTime = Date.now();
          const targetFile = resolveDownloadTargetFile(resolvedFileName);
          const downloadResumable = LegacyFileSystem.createDownloadResumable(
            downloadUrl,
            targetFile.uri,
            downloadTarget.authHeader
              ? { headers: { Authorization: downloadTarget.authHeader } }
              : undefined,
            (data) => {
              const now = Date.now();
              const { totalBytesWritten, totalBytesExpectedToWrite } = data;

              if (totalBytesExpectedToWrite <= 0) {
                return;
              }

              const percent = totalBytesWritten / totalBytesExpectedToWrite;
              const elapsed = (now - downloadStartTime) / 1000;
              const speed = elapsed > 0 ? totalBytesWritten / elapsed : 0;
              const remaining = totalBytesExpectedToWrite - totalBytesWritten;
              const eta = speed > 0 ? remaining / speed : 0;

              get().updateProgress(id, {
                percent,
                bytesWritten: totalBytesWritten,
                totalBytes: totalBytesExpectedToWrite,
                speed,
                eta,
              });
            },
          );

          const result = await downloadResumable.downloadAsync();
          if (!result) {
            throw new Error(i18n.t("downloads.cancelled"));
          }
          downloadedUri = result.uri;
        } catch (error) {
          if (isWeb) {
            throw error;
          }
          downloadedUri = await downloadOverActiveClient();
        }
      }

      await finishDownload({
        downloadedUri,
        downloadedMimeType,
        resolvedFileName,
        id,
        isElectron,
        actions: get(),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : i18n.t("downloads.failed");
      if (isWeb) {
        console.warn("[DownloadStore] Download failed:", message);
        get().failDownload(id, message);
        return;
      }
      get().failDownload(id, message);
    }
  },

  updateProgress: (id, progress) => {
    set((state) => {
      const download = state.downloads.get(id);
      if (!download || download.status !== "downloading") {
        return state;
      }
      const updated = new Map(state.downloads);
      updated.set(id, { ...download, progress });
      return { downloads: updated };
    });
  },

  completeDownload: (id) => {
    set((state) => {
      const download = state.downloads.get(id);
      if (!download) {
        return state;
      }
      const updated = new Map(state.downloads);
      updated.set(id, { ...download, status: "complete" });
      return { downloads: updated };
    });
  },

  failDownload: (id, message) => {
    set((state) => {
      const download = state.downloads.get(id);
      if (!download) {
        return state;
      }
      const updated = new Map(state.downloads);
      updated.set(id, { ...download, status: "error", message });
      return { downloads: updated };
    });
  },

  dismissDownload: (id) => {
    set((state) => {
      const updated = new Map(state.downloads);
      updated.delete(id);
      const newActiveId =
        state.activeDownloadId === id ? findMostRecentDownloadId(updated) : state.activeDownloadId;
      return { downloads: updated, activeDownloadId: newActiveId };
    });
  },

  dismissAllCompleted: () => {
    set((state) => {
      const updated = new Map(state.downloads);
      for (const [id, download] of updated) {
        if (download.status !== "downloading") {
          updated.delete(id);
        }
      }
      let newActiveId: string | null;
      if (!state.activeDownloadId) newActiveId = null;
      else if (updated.has(state.activeDownloadId)) newActiveId = state.activeDownloadId;
      else newActiveId = findMostRecentDownloadId(updated);
      return { downloads: updated, activeDownloadId: newActiveId };
    });
  },
}));

function findMostRecentDownloadId(downloads: Map<string, Download>): string | null {
  let mostRecent: Download | null = null;
  for (const download of downloads.values()) {
    if (!mostRecent || download.startedAt > mostRecent.startedAt) {
      mostRecent = download;
    }
  }
  return mostRecent?.id ?? null;
}

function shouldDownloadOverActiveClient(
  activeConnectionType: "directTcp" | "directSocket" | "directPipe" | "relay" | null,
  isElectron: boolean,
): boolean {
  return isElectron || (!isWeb && activeConnectionType !== "directTcp");
}

async function persistActiveClientDownload({
  fileName,
  bytes,
  isElectron,
  saveDesktopFile,
}: {
  fileName: string;
  bytes: Uint8Array;
  isElectron: boolean;
  saveDesktopFile: (input: {
    fileName: string;
    bytes: Uint8Array;
  }) => Promise<DesktopDownloadSaveResult>;
}): Promise<string | null> {
  if (isElectron) {
    const result = await saveDesktopFile({ fileName, bytes });
    if (result.status === "cancelled") {
      return null;
    }
    return result.path;
  }

  const targetFile = resolveDownloadTargetFile(fileName);
  targetFile.write(bytes);
  return targetFile.uri;
}

async function finishDownload({
  downloadedUri,
  downloadedMimeType,
  resolvedFileName,
  id,
  isElectron,
  actions,
}: {
  downloadedUri: string | null;
  downloadedMimeType: string | null;
  resolvedFileName: string;
  id: string;
  isElectron: boolean;
  actions: Pick<DownloadState, "completeDownload" | "dismissDownload">;
}): Promise<void> {
  if (downloadedUri === null) {
    actions.dismissDownload(id);
    return;
  }

  actions.completeDownload(id);
  if (isElectron || !(await Sharing.isAvailableAsync())) {
    return;
  }

  await Sharing.shareAsync(downloadedUri, {
    mimeType: downloadedMimeType ?? undefined,
    dialogTitle: resolvedFileName
      ? i18n.t("downloads.shareFileNamed", { fileName: resolvedFileName })
      : i18n.t("downloads.shareFile"),
  });
}

interface DownloadTarget {
  baseUrl: string | null;
  authHeader: string | null;
  authCredentials: { username: string; password: string } | null;
}

function resolveDaemonDownloadTarget(daemon?: HostProfile): DownloadTarget {
  const connection = daemon?.connections.find((conn) => conn.type === "directTcp") ?? null;
  if (!connection) {
    return { baseUrl: null, authHeader: null, authCredentials: null };
  }

  let parsed: URL;
  try {
    parsed = new URL(
      buildDaemonWebSocketUrl(connection.endpoint, { useTls: connection.useTls ?? false }),
    );
  } catch {
    return { baseUrl: null, authHeader: null, authCredentials: null };
  }

  if (parsed.protocol === "ws:") {
    parsed.protocol = "http:";
  } else if (parsed.protocol === "wss:") {
    parsed.protocol = "https:";
  }

  let authCredentials: { username: string; password: string } | null = null;
  if (parsed.username || parsed.password) {
    authCredentials = {
      username: decodeURIComponent(parsed.username),
      password: decodeURIComponent(parsed.password),
    };
    parsed.username = "";
    parsed.password = "";
  }

  parsed.pathname = parsed.pathname.replace(/\/ws\/?$/, "/");

  const baseUrl = parsed.origin;
  const authHeader = authCredentials
    ? `Basic ${btoa(`${authCredentials.username}:${authCredentials.password}`)}`
    : null;

  return { baseUrl, authHeader, authCredentials };
}

function buildDownloadUrl(
  baseUrl: string,
  token: string,
  authCredentials: { username: string; password: string } | null,
): string {
  const url = new URL("/api/files/download", baseUrl);
  url.searchParams.set("token", token);
  if (authCredentials) {
    url.username = authCredentials.username;
    url.password = authCredentials.password;
  }
  return url.toString();
}

function triggerBrowserDownload(url: string, fileName: string) {
  if (typeof document === "undefined") {
    if (typeof window !== "undefined") {
      void openExternalUrl(url);
    }
    return;
  }

  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.rel = "noopener";
  document.body.appendChild(link);
  link.click();
  link.remove();
}

function resolveDownloadTargetFile(fileName: string): FSFile {
  const directory = Paths.cache ?? Paths.document;
  if (!directory) {
    throw new Error("No download directory available.");
  }

  const safeName = sanitizeDownloadFileName(fileName);
  const split = splitFileName(safeName);
  let targetFile = new FSFile(directory, safeName);
  let suffix = 1;

  while (targetFile.exists) {
    targetFile = new FSFile(directory, `${split.base} (${suffix})${split.ext}`);
    suffix += 1;
  }

  return targetFile;
}

function sanitizeDownloadFileName(fileName: string): string {
  const trimmed = fileName.trim();
  if (!trimmed) {
    return "download";
  }
  return trimmed.replace(/[\\/:*?"<>|]+/g, "_");
}

function splitFileName(fileName: string): { base: string; ext: string } {
  const lastDot = fileName.lastIndexOf(".");
  if (lastDot <= 0) {
    return { base: fileName, ext: "" };
  }
  return {
    base: fileName.slice(0, lastDot),
    ext: fileName.slice(lastDot),
  };
}

export function formatSpeed(bytesPerSecond: number): string {
  if (bytesPerSecond < 1024) {
    return `${Math.round(bytesPerSecond)} B/s`;
  }
  if (bytesPerSecond < 1024 * 1024) {
    return `${(bytesPerSecond / 1024).toFixed(1)} KB/s`;
  }
  return `${(bytesPerSecond / (1024 * 1024)).toFixed(1)} MB/s`;
}

export function formatEta(seconds: number): string {
  if (seconds < 1) {
    return "< 1s";
  }
  if (seconds < 60) {
    return `${Math.round(seconds)}s`;
  }
  const mins = Math.floor(seconds / 60);
  const secs = Math.round(seconds % 60);
  return `${mins}m ${secs}s`;
}
