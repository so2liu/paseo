import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

interface CliPackageJson {
  version?: unknown;
}

const CUSTOM_BUILD_TAG = "LY";

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

export function resolveCliVersion(): string {
  const packageJson = require("../package.json") as CliPackageJson;
  if (typeof packageJson.version === "string" && packageJson.version.trim().length > 0) {
    return withCustomBuildTag(packageJson.version.trim());
  }
  throw new Error("Unable to resolve @getpaseo/cli version from package.json.");
}
