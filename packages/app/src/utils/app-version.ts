import Constants from "expo-constants";
import { getIsElectron } from "@/constants/platform";
import { getDesktopHost } from "@/desktop/host";
import appPackage from "../../package.json";
import { withCustomBuildTag } from "./custom-build-version";

function toVersionOrNull(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return null;
  }

  return trimmed;
}

export function resolveAppVersion(): string | null {
  const packageVersion = toVersionOrNull(appPackage?.version);
  if (packageVersion) {
    return packageVersion;
  }

  const expoVersion = toVersionOrNull(Constants.expoConfig?.version);
  if (expoVersion) {
    return expoVersion;
  }

  const manifestVersion = toVersionOrNull(
    (Constants as unknown as { manifest?: { version?: unknown } }).manifest?.version,
  );
  if (manifestVersion) {
    return manifestVersion;
  }

  return null;
}

export function resolveDisplayAppVersion(): string | null {
  if (getIsElectron()) {
    const desktopVersion = toVersionOrNull(getDesktopHost()?.version);
    if (desktopVersion) {
      return desktopVersion;
    }
  }

  const forkVersion = toVersionOrNull(Constants.expoConfig?.extra?.forkVersion);
  if (forkVersion) {
    return forkVersion;
  }

  const version = resolveAppVersion();
  return version ? withCustomBuildTag(version) : null;
}
