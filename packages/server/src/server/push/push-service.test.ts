import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type pino from "pino";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PushService } from "./push-service.js";
import { PushTokenStore } from "./token-store.js";

function createLogger(): pino.Logger {
  const logger = {
    child: () => logger,
    debug: () => undefined,
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
  };
  return logger as unknown as pino.Logger;
}

describe("PushService", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("retries mixed Expo projects as separate requests", async () => {
    const home = mkdtempSync(path.join(tmpdir(), "paseo-push-service-"));
    try {
      const tokenStore = new PushTokenStore(createLogger(), path.join(home, "tokens.json"));
      const fetchMock = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              errors: [{ code: "PUSH_TOO_MANY_EXPERIENCE_IDS" }],
            }),
            { status: 400, headers: { "Content-Type": "application/json" } },
          ),
        )
        .mockResolvedValue(
          new Response(JSON.stringify({ data: [{ status: "ok", id: "ticket" }] }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        );
      vi.stubGlobal("fetch", fetchMock);

      await new PushService(createLogger(), tokenStore).sendPush(
        ["ExponentPushToken[official]", "ExponentPushToken[custom]"],
        { title: "Done", body: "Agent finished" },
      );

      expect(fetchMock).toHaveBeenCalledTimes(3);
      const requestedTokens: string[][] = [];
      for (const call of fetchMock.mock.calls) {
        const messages = JSON.parse(String(call[1]?.body)) as Array<{ to: string }>;
        requestedTokens.push(messages.map((message) => message.to));
      }
      expect(requestedTokens).toEqual([
        ["ExponentPushToken[official]", "ExponentPushToken[custom]"],
        ["ExponentPushToken[official]"],
        ["ExponentPushToken[custom]"],
      ]);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});
