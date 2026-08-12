import type pino from "pino";
import { existsSync, readFileSync } from "node:fs";

import { ensurePrivateFile, writePrivateFileAtomicSync } from "../private-files.js";

interface PushTokenEntry {
  token: string;
  deviceId: string | null;
}

/**
 * Store for Expo push tokens.
 *
 * Tokens are persisted to disk so pushes still work after daemon restarts.
 *
 * A device gets a new Expo token whenever the app is rebuilt or reinstalled, and the old one
 * stays deliverable for a while, so a store keyed only by token accumulates several live
 * tokens for one phone and pushes the same notification to it once per token. Clients that
 * send a device id therefore replace their own previous token instead of adding to it.
 * Clients that don't (older builds) keep the original add-only behaviour.
 */
export class PushTokenStore {
  private readonly logger: pino.Logger;
  private entries: Map<string, PushTokenEntry> = new Map();
  private readonly filePath: string;

  constructor(logger: pino.Logger, filePath: string) {
    this.logger = logger.child({ component: "token-store" });
    this.filePath = filePath;
    this.loadFromDisk();
  }

  addToken(token: string, deviceId?: string | null): void {
    const normalized = token.trim();
    if (!normalized) return;
    const normalizedDeviceId = deviceId?.trim() || null;

    const supersededTokens = normalizedDeviceId
      ? [...this.entries.values()]
          .filter((entry) => entry.deviceId === normalizedDeviceId && entry.token !== normalized)
          .map((entry) => entry.token)
      : [];

    const existing = this.entries.get(normalized);
    if (existing && existing.deviceId === normalizedDeviceId && supersededTokens.length === 0) {
      return;
    }

    for (const superseded of supersededTokens) {
      this.entries.delete(superseded);
    }
    this.entries.set(normalized, { token: normalized, deviceId: normalizedDeviceId });
    this.persist();
    this.logger.debug(
      { total: this.entries.size, superseded: supersededTokens.length },
      "Added token",
    );
  }

  removeToken(token: string): void {
    const normalized = token.trim();
    if (!normalized) return;
    const deleted = this.entries.delete(normalized);
    if (deleted) {
      this.persist();
      this.logger.debug({ total: this.entries.size }, "Removed token");
    }
  }

  getAllTokens(): string[] {
    return [...this.entries.keys()];
  }

  private loadFromDisk(): void {
    try {
      if (!existsSync(this.filePath)) {
        return;
      }
      ensurePrivateFile(this.filePath);
      const raw = readFileSync(this.filePath, "utf-8");
      const parsed = JSON.parse(raw) as { tokens?: unknown; entries?: unknown };
      this.entries = new Map(
        readPersistedEntries(parsed).map((entry) => [entry.token, entry] as const),
      );
      this.logger.info({ total: this.entries.size }, "Loaded push tokens");
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.logger.warn({ err }, "Failed to load push tokens");
    }
  }

  private persist(): void {
    try {
      const entries = [...this.entries.values()];
      // `tokens` is still written as a plain array so rolling the daemon back to a build that
      // predates device ids keeps working instead of silently losing every registration.
      const payload =
        JSON.stringify({ tokens: entries.map((entry) => entry.token), entries }, null, 2) + "\n";
      writePrivateFileAtomicSync(this.filePath, payload);
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.logger.warn({ err }, "Failed to persist push tokens");
    }
  }
}

function readPersistedEntries(parsed: { tokens?: unknown; entries?: unknown }): PushTokenEntry[] {
  if (Array.isArray(parsed.entries)) {
    return parsed.entries.flatMap((value) => {
      if (typeof value !== "object" || value === null) return [];
      const { token, deviceId } = value as { token?: unknown; deviceId?: unknown };
      if (typeof token !== "string" || !token.trim()) return [];
      return [
        {
          token: token.trim(),
          deviceId: typeof deviceId === "string" && deviceId.trim() ? deviceId.trim() : null,
        },
      ];
    });
  }
  if (Array.isArray(parsed.tokens)) {
    return parsed.tokens.flatMap((value) =>
      typeof value === "string" && value.trim() ? [{ token: value.trim(), deviceId: null }] : [],
    );
  }
  return [];
}
