import assert from "node:assert/strict";
import test from "node:test";
import {
  computeNextReleaseVersion,
  getReleaseInfoFromSourceTag,
  parseReleaseVersion,
} from "./release-version-utils.mjs";

test("computes the next beta patch from a stable version", () => {
  assert.equal(computeNextReleaseVersion("0.1.59", "beta-patch"), "0.1.60-beta.1");
});

test("advances beta versions", () => {
  assert.equal(computeNextReleaseVersion("0.1.60-beta.1", "beta-next"), "0.1.60-beta.2");
});

test("promotes beta versions to stable", () => {
  assert.equal(computeNextReleaseVersion("0.1.60-beta.2", "promote"), "0.1.60");
});

test("parses beta release metadata", () => {
  assert.deepEqual(parseReleaseVersion("0.1.60-beta.1"), {
    version: "0.1.60-beta.1",
    major: 0,
    minor: 1,
    patch: 60,
    prerelease: "beta.1",
    baseVersion: "0.1.60",
    isPrerelease: true,
    isBeta: true,
    betaNumber: 1,
    isLy: false,
    lyNumber: null,
  });
});

test("parses fork LY release metadata", () => {
  assert.deepEqual(parseReleaseVersion("0.2.2-LY.3"), {
    version: "0.2.2-LY.3",
    major: 0,
    minor: 2,
    patch: 2,
    prerelease: "LY.3",
    baseVersion: "0.2.2",
    isPrerelease: true,
    isBeta: false,
    betaNumber: null,
    isLy: true,
    lyNumber: 3,
  });
});

test("emits beta release info from tags", () => {
  assert.deepEqual(getReleaseInfoFromSourceTag("v0.1.60-beta.1"), {
    sourceTag: "v0.1.60-beta.1",
    releaseTag: "v0.1.60-beta.1",
    version: "0.1.60-beta.1",
    baseVersion: "0.1.60",
    prerelease: "beta.1",
    isPrerelease: true,
    isBeta: true,
    betaNumber: 1,
    isLy: false,
    lyNumber: null,
    releaseType: "prerelease",
    releaseChannel: "beta",
    isSmokeTag: false,
  });
});

test("publishes fork LY tags on the stable channel", () => {
  assert.deepEqual(getReleaseInfoFromSourceTag("v0.2.2-LY.3"), {
    sourceTag: "v0.2.2-LY.3",
    releaseTag: "v0.2.2-LY.3",
    version: "0.2.2-LY.3",
    baseVersion: "0.2.2",
    prerelease: "LY.3",
    isPrerelease: false,
    isBeta: false,
    betaNumber: null,
    isLy: true,
    lyNumber: 3,
    releaseType: "release",
    releaseChannel: "latest",
    isSmokeTag: false,
  });
});

test("rejects unknown prerelease versions", () => {
  assert.throws(() => parseReleaseVersion("0.1.60-canary.1"), /Unsupported release version/);
  assert.throws(() => parseReleaseVersion("0.2.2-LY-3"), /Unsupported release version/);
});
