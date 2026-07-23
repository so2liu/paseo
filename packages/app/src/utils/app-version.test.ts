import { describe, expect, it } from "vitest";
import { withCustomBuildTag } from "./custom-build-version";

describe("withCustomBuildTag", () => {
  it("adds the LY build identity to an upstream version", () => {
    expect(withCustomBuildTag("0.2.0-beta.1")).toBe("0.2.0-beta.1+LY");
  });

  it("preserves existing build metadata", () => {
    expect(withCustomBuildTag("0.2.0-beta.1+build.7")).toBe("0.2.0-beta.1+build.7.LY");
  });

  it("does not duplicate the LY tag", () => {
    expect(withCustomBuildTag("0.2.0-beta.1+LY")).toBe("0.2.0-beta.1+LY");
  });
});
