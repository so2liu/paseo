import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveAppVersion, resolveDisplayAppVersion } from "./app-version";
import { withCustomBuildTag } from "./custom-build-version";

const { electronRuntime, expoConfig } = vi.hoisted(() => ({
  electronRuntime: { value: false },
  expoConfig: { extra: {} as Record<string, unknown> },
}));

vi.mock("@/constants/platform", () => ({
  getIsElectron: () => electronRuntime.value,
}));

vi.mock("expo-constants", () => ({
  default: { expoConfig },
}));

afterEach(() => {
  electronRuntime.value = false;
  Reflect.deleteProperty(expoConfig.extra, "forkVersion");
  Reflect.deleteProperty(globalThis, "window");
});

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

describe("resolveDisplayAppVersion", () => {
  it("uses the Desktop shell version in Electron without adding another LY tag", () => {
    electronRuntime.value = true;
    Object.assign(globalThis, {
      window: { paseoDesktop: { version: "0.2.3-LY.2" } },
    });

    expect(resolveDisplayAppVersion()).toBe("0.2.3-LY.2");
  });

  it("uses the injected fork release version without adding another LY tag", () => {
    expoConfig.extra.forkVersion = "0.2.3-LY.3";

    expect(resolveDisplayAppVersion()).toBe("0.2.3-LY.3");
  });

  it("keeps the client package version for non-Electron platforms", () => {
    const clientVersion = resolveAppVersion();
    expect(clientVersion).not.toBeNull();
    expect(resolveDisplayAppVersion()).toBe(withCustomBuildTag(clientVersion ?? ""));
  });

  it("falls back to the existing display version when the Desktop version is unavailable", () => {
    electronRuntime.value = true;
    Object.assign(globalThis, {
      window: { paseoDesktop: { platform: "darwin" } },
    });

    const clientVersion = resolveAppVersion();
    expect(clientVersion).not.toBeNull();
    expect(resolveDisplayAppVersion()).toBe(withCustomBuildTag(clientVersion ?? ""));
  });

  it("keeps the client version used for daemon compatibility checks", () => {
    electronRuntime.value = true;
    Object.assign(globalThis, {
      window: { paseoDesktop: { version: "0.2.3-LY.2" } },
    });

    expect(resolveAppVersion()).not.toBe("0.2.3-LY.2");
  });
});
