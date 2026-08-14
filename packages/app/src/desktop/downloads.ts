import { invokeDesktopCommand } from "@/desktop/electron/invoke";

export type DesktopDownloadSaveResult = { status: "saved"; path: string } | { status: "cancelled" };

export function saveDesktopDownload(input: {
  fileName: string;
  bytes: Uint8Array;
}): Promise<DesktopDownloadSaveResult> {
  return invokeDesktopCommand<DesktopDownloadSaveResult>("save_download_bytes", input);
}
