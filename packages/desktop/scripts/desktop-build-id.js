const { randomUUID } = require("node:crypto");
const { writeFileSync } = require("node:fs");
const path = require("node:path");

const DESKTOP_BUILD_ID_FILENAME = "desktop-build-id";
const EXECUTABLE_NAME = "Paseo";

function resolveResourcesDir(appOutDir, platform) {
  return platform === "darwin"
    ? path.join(appOutDir, `${EXECUTABLE_NAME}.app`, "Contents", "Resources")
    : path.join(appOutDir, "resources");
}

function writeDesktopBuildId(appOutDir, platform, buildId = randomUUID()) {
  const normalizedBuildId = buildId.trim();
  if (!normalizedBuildId || /[\r\n]/.test(normalizedBuildId)) {
    throw new Error("Desktop build ID must be a non-empty single line.");
  }

  const buildIdPath = path.join(
    resolveResourcesDir(appOutDir, platform),
    DESKTOP_BUILD_ID_FILENAME,
  );
  writeFileSync(buildIdPath, `${normalizedBuildId}\n`, { encoding: "utf8", mode: 0o644 });
  return { buildId: normalizedBuildId, buildIdPath };
}

module.exports = {
  DESKTOP_BUILD_ID_FILENAME,
  resolveResourcesDir,
  writeDesktopBuildId,
};
