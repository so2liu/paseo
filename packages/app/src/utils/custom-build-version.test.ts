import { describe, expect, it } from "vitest";
import { toComparableVersion, withCustomBuildTag } from "./custom-build-version";

describe("toComparableVersion", () => {
  it("treats a fork release and a fork daemon built from it as the same version", () => {
    expect(toComparableVersion("0.3.1-LY.1")).toBe(toComparableVersion("0.3.1+LY"));
  });

  it("ignores a leading v and the build metadata", () => {
    expect(toComparableVersion("v0.3.1+LY")).toBe("0.3.1");
    expect(toComparableVersion("0.3.1+LY.2")).toBe("0.3.1");
  });

  it("strips only the fork counter, not other prereleases", () => {
    expect(toComparableVersion("0.3.0-beta.4")).toBe("0.3.0-beta.4");
    expect(toComparableVersion("0.3.0-beta.4+LY")).toBe("0.3.0-beta.4");
  });

  it("keeps genuinely different versions apart", () => {
    expect(toComparableVersion("0.2.5+LY")).not.toBe(toComparableVersion("0.3.1-LY.1"));
    expect(toComparableVersion("0.3.0-beta.4")).not.toBe(toComparableVersion("0.3.1"));
  });

  it("returns null for missing or blank input", () => {
    expect(toComparableVersion(null)).toBeNull();
    expect(toComparableVersion(undefined)).toBeNull();
    expect(toComparableVersion("   ")).toBeNull();
  });

  it("leaves withCustomBuildTag alone", () => {
    expect(withCustomBuildTag("0.3.1")).toBe("0.3.1+LY");
  });
});
