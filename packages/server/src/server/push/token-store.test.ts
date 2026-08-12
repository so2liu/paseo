import { chmodSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type pino from "pino";
import { describe, expect, test } from "vitest";

import { PRIVATE_FILE_MODE } from "../private-files.js";
import { PushTokenStore } from "./token-store.js";

const MODE_MASK = 0o777;
const PERMISSIVE_FILE_MODE = 0o644;

function createLogger(): pino.Logger {
  const logger = {
    child: () => logger,
    debug: () => undefined,
    info: () => undefined,
    warn: () => undefined,
  };
  return logger as unknown as pino.Logger;
}

function modeOf(filePath: string): number {
  return statSync(filePath).mode & MODE_MASK;
}

describe.skipIf(process.platform === "win32")("PushTokenStore file permissions", () => {
  test("persists push tokens with private permissions", () => {
    const home = mkdtempSync(path.join(tmpdir(), "paseo-push-tokens-"));
    const tokenPath = path.join(home, "push-tokens.json");
    try {
      const store = new PushTokenStore(createLogger(), tokenPath);

      store.addToken("ExponentPushToken[test]");

      expect(modeOf(tokenPath)).toBe(PRIVATE_FILE_MODE);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  test("repairs existing push token file permissions when loading", () => {
    const home = mkdtempSync(path.join(tmpdir(), "paseo-push-tokens-"));
    const tokenPath = path.join(home, "push-tokens.json");
    try {
      writeFileSync(tokenPath, JSON.stringify({ tokens: ["ExponentPushToken[test]"] }));
      chmodSync(tokenPath, PERMISSIVE_FILE_MODE);

      const store = new PushTokenStore(createLogger(), tokenPath);

      expect(store.getAllTokens()).toEqual(["ExponentPushToken[test]"]);
      expect(modeOf(tokenPath)).toBe(PRIVATE_FILE_MODE);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});

describe("PushTokenStore device identity", () => {
  test("replaces a device's previous token instead of pushing to both", () => {
    const home = mkdtempSync(path.join(tmpdir(), "paseo-push-tokens-"));
    const tokenPath = path.join(home, "push-tokens.json");
    try {
      const store = new PushTokenStore(createLogger(), tokenPath);

      store.addToken("ExponentPushToken[old]", "device-a");
      store.addToken("ExponentPushToken[new]", "device-a");

      expect(store.getAllTokens()).toEqual(["ExponentPushToken[new]"]);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  test("keeps one token per device when several devices register", () => {
    const home = mkdtempSync(path.join(tmpdir(), "paseo-push-tokens-"));
    const tokenPath = path.join(home, "push-tokens.json");
    try {
      const store = new PushTokenStore(createLogger(), tokenPath);

      store.addToken("ExponentPushToken[phone]", "device-a");
      store.addToken("ExponentPushToken[tablet]", "device-b");
      store.addToken("ExponentPushToken[phone-2]", "device-a");

      expect(store.getAllTokens()).toEqual([
        "ExponentPushToken[tablet]",
        "ExponentPushToken[phone-2]",
      ]);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  test("still accepts tokens from clients that do not identify their device", () => {
    const home = mkdtempSync(path.join(tmpdir(), "paseo-push-tokens-"));
    const tokenPath = path.join(home, "push-tokens.json");
    try {
      const store = new PushTokenStore(createLogger(), tokenPath);

      store.addToken("ExponentPushToken[one]");
      store.addToken("ExponentPushToken[two]");

      expect(store.getAllTokens()).toEqual(["ExponentPushToken[one]", "ExponentPushToken[two]"]);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  test("reloads device identity so a restart still replaces the right token", () => {
    const home = mkdtempSync(path.join(tmpdir(), "paseo-push-tokens-"));
    const tokenPath = path.join(home, "push-tokens.json");
    try {
      new PushTokenStore(createLogger(), tokenPath).addToken("ExponentPushToken[old]", "device-a");

      const reloaded = new PushTokenStore(createLogger(), tokenPath);
      reloaded.addToken("ExponentPushToken[new]", "device-a");

      expect(reloaded.getAllTokens()).toEqual(["ExponentPushToken[new]"]);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  test("reads token files written before device ids existed", () => {
    const home = mkdtempSync(path.join(tmpdir(), "paseo-push-tokens-"));
    const tokenPath = path.join(home, "push-tokens.json");
    try {
      writeFileSync(tokenPath, JSON.stringify({ tokens: ["ExponentPushToken[legacy]"] }));

      const store = new PushTokenStore(createLogger(), tokenPath);

      expect(store.getAllTokens()).toEqual(["ExponentPushToken[legacy]"]);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});
