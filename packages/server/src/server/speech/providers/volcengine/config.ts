import { z } from "zod";

import type { PersistedConfig } from "../../../persisted-config.js";
import type { RequestedSpeechProviders } from "../../speech-types.js";

export const DEFAULT_VOLCENGINE_ASR_ENDPOINT =
  "wss://openspeech.bytedance.com/api/v3/sauc/bigmodel";
export const DEFAULT_VOLCENGINE_ASR_RESOURCE_ID = "volc.bigasr.sauc.duration";
export const DEFAULT_VOLCENGINE_ASR_MODEL = "bigmodel";

/**
 * Volcengine big-model ASR only accepts 16 kHz mono PCM16. Sessions advertise this
 * as `requiredSampleRate` so callers resample before appending audio.
 */
export const VOLCENGINE_ASR_SAMPLE_RATE = 16000;

export interface VolcengineSttConfig {
  /**
   * Legacy console credentials: App ID + Access Token, sent as
   * `X-Api-App-Key` / `X-Api-Access-Key`.
   */
  appId?: string;
  accessToken?: string;
  /** New console credential, sent as `X-Api-Key` instead of the pair above. */
  apiKey?: string;
  endpoint: string;
  resourceId: string;
  modelName: string;
  /**
   * Pins recognition to one language. Left unset the big model auto-detects and
   * handles mixed Chinese/English speech, which is usually what you want.
   */
  language?: string;
  /**
   * Inline hotwords. Injected into every request as `corpus.context`, which does
   * not require pre-registering a word list in the console.
   */
  hotwords?: string[];
  /** ID of a boosting table created in the console, used alongside `hotwords`. */
  boostingTableId?: string;
  /** Inverse text normalization — turns spoken numbers into digits. */
  enableItn: boolean;
  enablePunc: boolean;
  /** Disfluency removal ("嗯"、"那个"). Off by default: dictation should stay verbatim. */
  enableDdc: boolean;
}

export interface VolcengineSpeechProviderConfig {
  stt?: VolcengineSttConfig;
}

const OptionalTrimmedStringSchema = z
  .string()
  .trim()
  .optional()
  .transform((value) => (value && value.length > 0 ? value : undefined));

const BooleanFlagSchema = z
  .union([z.boolean(), z.string().trim().toLowerCase()])
  .optional()
  .transform((value) => {
    if (typeof value === "boolean") return value;
    if (value === undefined) return undefined;
    if (["1", "true", "yes", "y", "on"].includes(value)) return true;
    if (["0", "false", "no", "n", "off"].includes(value)) return false;
    return undefined;
  });

const HotwordsSchema = z
  .union([z.array(z.string()), z.string()])
  .optional()
  .transform((value) => {
    if (value === undefined) return undefined;
    const entries = Array.isArray(value) ? value : value.split(",");
    const cleaned = entries.map((entry) => entry.trim()).filter((entry) => entry.length > 0);
    return cleaned.length > 0 ? Array.from(new Set(cleaned)) : undefined;
  });

const VolcengineSttInputSchema = z.object({
  appId: OptionalTrimmedStringSchema,
  accessToken: OptionalTrimmedStringSchema,
  apiKey: OptionalTrimmedStringSchema,
  endpoint: OptionalTrimmedStringSchema,
  resourceId: OptionalTrimmedStringSchema,
  modelName: OptionalTrimmedStringSchema,
  language: OptionalTrimmedStringSchema,
  hotwords: HotwordsSchema,
  boostingTableId: OptionalTrimmedStringSchema,
  enableItn: BooleanFlagSchema,
  enablePunc: BooleanFlagSchema,
  enableDdc: BooleanFlagSchema,
});

function firstDefined<T>(values: Array<T | null | undefined>): T | undefined {
  for (const value of values) {
    if (value === undefined || value === null) {
      continue;
    }
    // An empty env var (a copied .env.example with VOLCENGINE_API_KEY=) must not
    // shadow a credential set later in the chain.
    if (typeof value === "string" && value.trim().length === 0) {
      continue;
    }
    return value;
  }
  return undefined;
}

/**
 * Credentials are complete when either console's scheme is fully satisfied:
 * new console gives a single API key, legacy console gives App ID + Access Token.
 */
export function hasVolcengineCredentials(stt: VolcengineSttConfig | undefined): boolean {
  if (!stt) return false;
  return Boolean(stt.apiKey) || Boolean(stt.appId && stt.accessToken);
}

type VolcengineSttInput = z.infer<typeof VolcengineSttInputSchema>;

function isVolcengineRequested(providers: RequestedSpeechProviders): boolean {
  return (
    (providers.dictationStt.enabled !== false &&
      providers.dictationStt.provider === "volcengine") ||
    (providers.voiceStt.enabled !== false && providers.voiceStt.provider === "volcengine")
  );
}

function buildVolcengineSttInput(params: {
  env: NodeJS.ProcessEnv;
  persisted: PersistedConfig;
}): VolcengineSttInput {
  const { env } = params;
  // Credentials may sit either on the provider block or on its `stt` sub-block;
  // defaulting both to `{}` keeps the lookup chains below flat.
  const root = params.persisted.providers?.volcengine ?? {};
  const stt = root.stt ?? {};
  return VolcengineSttInputSchema.parse({
    appId: firstDefined<string>([stt.appId, root.appId, env.VOLCENGINE_APP_ID]),
    accessToken: firstDefined<string>([
      stt.accessToken,
      root.accessToken,
      env.VOLCENGINE_ACCESS_TOKEN,
    ]),
    apiKey: firstDefined<string>([stt.apiKey, root.apiKey, env.VOLCENGINE_API_KEY]),
    endpoint: firstDefined<string>([stt.endpoint, env.VOLCENGINE_ASR_ENDPOINT]),
    resourceId: firstDefined<string>([stt.resourceId, env.VOLCENGINE_ASR_RESOURCE_ID]),
    modelName: firstDefined<string>([stt.modelName, env.VOLCENGINE_ASR_MODEL]),
    language: firstDefined<string>([stt.language, env.VOLCENGINE_ASR_LANGUAGE]),
    hotwords: firstDefined<string[] | string>([stt.hotwords, env.VOLCENGINE_HOTWORDS]),
    boostingTableId: stt.boostingTableId,
    enableItn: stt.enableItn,
    enablePunc: stt.enablePunc,
    enableDdc: stt.enableDdc,
  });
}

function buildVolcengineSttConfig(input: VolcengineSttInput): VolcengineSttConfig {
  return {
    ...(input.appId ? { appId: input.appId } : {}),
    ...(input.accessToken ? { accessToken: input.accessToken } : {}),
    ...(input.apiKey ? { apiKey: input.apiKey } : {}),
    endpoint: input.endpoint ?? DEFAULT_VOLCENGINE_ASR_ENDPOINT,
    resourceId: input.resourceId ?? DEFAULT_VOLCENGINE_ASR_RESOURCE_ID,
    modelName: input.modelName ?? DEFAULT_VOLCENGINE_ASR_MODEL,
    ...(input.language ? { language: input.language } : {}),
    ...(input.hotwords ? { hotwords: input.hotwords } : {}),
    ...(input.boostingTableId ? { boostingTableId: input.boostingTableId } : {}),
    enableItn: input.enableItn ?? true,
    enablePunc: input.enablePunc ?? true,
    enableDdc: input.enableDdc ?? false,
  };
}

export function resolveVolcengineSpeechConfig(params: {
  env: NodeJS.ProcessEnv;
  persisted: PersistedConfig;
  providers: RequestedSpeechProviders;
}): VolcengineSpeechProviderConfig | undefined {
  const input = buildVolcengineSttInput(params);
  const hasCredentials = Boolean(input.apiKey) || Boolean(input.appId && input.accessToken);

  // A config without credentials is still returned when Volcengine was explicitly
  // requested, so the runtime can warn about it instead of silently falling back.
  if (!hasCredentials && !isVolcengineRequested(params.providers)) {
    return undefined;
  }

  return { stt: buildVolcengineSttConfig(input) };
}
