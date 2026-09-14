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

/**
 * The comparable part of a version, for deciding whether two Paseo builds are the same one.
 *
 * The fork stamps its builds two different ways and neither is wrong. A release carries the
 * counter in the prerelease position (`0.3.1-LY.1`) because SemVer ignores `+build` when it
 * compares, so a counter there would make every release rank equal and auto-update would
 * never fire. A daemon has no counter to carry: its manifest deliberately stays on the
 * upstream version, and the counter only exists in the git tag. It marks itself `0.3.1+LY`
 * at runtime purely to say "fork build".
 *
 * Comparing those as strings reports every daemon as a different version from the app,
 * including one built from the very same commit. Strip both fork markers and compare what
 * is left. Other prereleases stay significant: `0.3.0-beta.4` really is not `0.3.1`.
 */
export function toComparableVersion(version: string | null | undefined): string | null {
  const trimmed = version?.trim();
  if (!trimmed) return null;
  const withoutPrefix = trimmed.replace(/^v/i, "");
  const [beforeBuild] = withoutPrefix.split("+", 1);
  const base = beforeBuild ?? withoutPrefix;
  return base.replace(new RegExp(`-${CUSTOM_BUILD_TAG}\\.\\d+$`), "");
}
