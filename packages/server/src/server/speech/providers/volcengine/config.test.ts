import { describe, expect, it } from "vitest";

import type { PersistedConfig } from "../../../persisted-config.js";
import type { RequestedSpeechProviders } from "../../speech-types.js";
import {
  DEFAULT_VOLCENGINE_ASR_ENDPOINT,
  DEFAULT_VOLCENGINE_ASR_RESOURCE_ID,
  hasVolcengineCredentials,
  resolveVolcengineSpeechConfig,
} from "./config.js";

function buildProviders(
  overrides: Partial<Record<keyof RequestedSpeechProviders, string>> = {},
): RequestedSpeechProviders {
  const build = (provider: string) => ({
    provider: provider as RequestedSpeechProviders["dictationStt"]["provider"],
    explicit: true,
    enabled: true,
  });
  return {
    dictationStt: build(overrides.dictationStt ?? "local"),
    voiceTurnDetection: build(overrides.voiceTurnDetection ?? "local"),
    voiceStt: build(overrides.voiceStt ?? "local"),
    voiceTts: build(overrides.voiceTts ?? "local"),
  };
}

function resolve(params: {
  env?: NodeJS.ProcessEnv;
  persisted?: PersistedConfig;
  providers?: RequestedSpeechProviders;
}) {
  return resolveVolcengineSpeechConfig({
    env: params.env ?? {},
    persisted: params.persisted ?? ({} as PersistedConfig),
    providers: params.providers ?? buildProviders(),
  });
}

describe("resolveVolcengineSpeechConfig", () => {
  it("returns nothing when Volcengine is neither configured nor requested", () => {
    expect(resolve({})).toBeUndefined();
  });

  it("applies endpoint, resource, and flag defaults to a bare API key", () => {
    const config = resolve({ env: { VOLCENGINE_API_KEY: "key-1" } });

    expect(config?.stt).toMatchObject({
      apiKey: "key-1",
      endpoint: DEFAULT_VOLCENGINE_ASR_ENDPOINT,
      resourceId: DEFAULT_VOLCENGINE_ASR_RESOURCE_ID,
      modelName: "bigmodel",
      enableItn: true,
      enablePunc: true,
      // Disfluency removal stays off: dictation feeds an agent, so it must stay verbatim.
      enableDdc: false,
    });
    // Auto-detection handles mixed Chinese/English, so no language is pinned.
    expect(config?.stt?.language).toBeUndefined();
  });

  it("accepts the legacy App ID and Access Token pair", () => {
    const config = resolve({
      env: { VOLCENGINE_APP_ID: "app-1", VOLCENGINE_ACCESS_TOKEN: "token-1" },
    });

    expect(config?.stt?.appId).toBe("app-1");
    expect(config?.stt?.accessToken).toBe("token-1");
    expect(hasVolcengineCredentials(config?.stt)).toBe(true);
  });

  it("treats a lone App ID as incomplete credentials", () => {
    const config = resolve({
      env: { VOLCENGINE_APP_ID: "app-1" },
      providers: buildProviders({ dictationStt: "volcengine" }),
    });

    expect(hasVolcengineCredentials(config?.stt)).toBe(false);
  });

  it("prefers persisted config over environment variables", () => {
    const config = resolve({
      env: { VOLCENGINE_API_KEY: "from-env" },
      persisted: {
        providers: { volcengine: { stt: { apiKey: "from-config" } } },
      } as PersistedConfig,
    });

    expect(config?.stt?.apiKey).toBe("from-config");
  });

  it("ignores an empty environment variable instead of letting it mask a fallback", () => {
    const config = resolve({
      env: { VOLCENGINE_API_KEY: "   " },
      persisted: {
        providers: { volcengine: { apiKey: "real-key" } },
      } as PersistedConfig,
    });

    expect(config?.stt?.apiKey).toBe("real-key");
  });

  it("reads hotwords from persisted config", () => {
    const config = resolve({
      env: { VOLCENGINE_API_KEY: "key-1" },
      persisted: {
        providers: { volcengine: { stt: { hotwords: ["Paseo", "Unistyles", "worktree"] } } },
      } as PersistedConfig,
    });

    expect(config?.stt?.hotwords).toEqual(["Paseo", "Unistyles", "worktree"]);
  });

  it("splits, trims, and de-duplicates a comma-separated hotword env var", () => {
    const config = resolve({
      env: { VOLCENGINE_API_KEY: "key-1", VOLCENGINE_HOTWORDS: " Paseo , Expo ,, Paseo " },
    });

    expect(config?.stt?.hotwords).toEqual(["Paseo", "Expo"]);
  });

  it("returns a credential-less config when Volcengine is requested but unconfigured", () => {
    // The runtime needs the requested-but-broken case to reach its warning path
    // rather than silently falling through to another provider.
    const config = resolve({ providers: buildProviders({ dictationStt: "volcengine" }) });

    expect(config?.stt).toBeDefined();
    expect(hasVolcengineCredentials(config?.stt)).toBe(false);
  });
});
