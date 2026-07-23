import { PackageVersionResolutionError, resolvePackageVersion } from "./package-version.js";

const SERVER_PACKAGE_NAME = "@getpaseo/server";
const CUSTOM_BUILD_TAG = "LY";

export class DaemonVersionResolutionError extends PackageVersionResolutionError {}

function withCustomBuildTag(version: string): string {
  const [baseVersion, buildMetadata] = version.split("+", 2);
  if (!buildMetadata) {
    return `${baseVersion}+${CUSTOM_BUILD_TAG}`;
  }
  const tags = buildMetadata.split(".");
  return tags.includes(CUSTOM_BUILD_TAG)
    ? version
    : `${baseVersion}+${buildMetadata}.${CUSTOM_BUILD_TAG}`;
}

export function resolveDaemonVersion(moduleUrl: string = import.meta.url): string {
  try {
    return withCustomBuildTag(
      resolvePackageVersion({
        moduleUrl,
        packageName: SERVER_PACKAGE_NAME,
      }),
    );
  } catch (error) {
    if (error instanceof PackageVersionResolutionError) {
      throw new DaemonVersionResolutionError({
        moduleUrl,
        packageName: SERVER_PACKAGE_NAME,
      });
    }
    throw error;
  }
}
