const CUSTOM_BUILD_TAG = "LY";

export function withCustomBuildTag(version: string): string {
  const [baseVersion, buildMetadata] = version.split("+", 2);
  if (!buildMetadata) {
    return `${baseVersion}+${CUSTOM_BUILD_TAG}`;
  }
  const tags = buildMetadata.split(".");
  return tags.includes(CUSTOM_BUILD_TAG)
    ? version
    : `${baseVersion}+${buildMetadata}.${CUSTOM_BUILD_TAG}`;
}
