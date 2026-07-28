import type { Logger } from "pino";

import type { SpeechToTextProvider } from "../../speech-provider.js";
import type { RequestedSpeechProviders } from "../../speech-types.js";
import type { SpeechServices } from "../openai/runtime.js";
import {
  hasVolcengineCredentials,
  type VolcengineSpeechProviderConfig,
  type VolcengineSttConfig,
} from "./config.js";
import { VolcengineSTT } from "./stt.js";

export interface VolcengineSpeechAvailability {
  stt: boolean;
  dictationStt: boolean;
}

export function getVolcengineSpeechAvailability(
  config: VolcengineSpeechProviderConfig | undefined,
): VolcengineSpeechAvailability {
  const available = hasVolcengineCredentials(config?.stt);
  return { stt: available, dictationStt: available };
}

export function validateVolcengineCredentialRequirements(params: {
  providers: RequestedSpeechProviders;
  volcengineConfig: VolcengineSpeechProviderConfig | undefined;
  logger: Logger;
}): void {
  const { providers, volcengineConfig, logger } = params;
  if (hasVolcengineCredentials(volcengineConfig?.stt)) {
    return;
  }

  const missingFor: string[] = [];
  if (providers.voiceStt.enabled !== false && providers.voiceStt.provider === "volcengine") {
    missingFor.push("voice.stt");
  }
  if (
    providers.dictationStt.enabled !== false &&
    providers.dictationStt.provider === "volcengine"
  ) {
    missingFor.push("dictation.stt");
  }

  if (missingFor.length > 0) {
    logger.warn(
      { missingVolcengineCredentialsFor: missingFor },
      "Invalid speech configuration: Volcengine provider selected but credentials are missing — set providers.volcengine.apiKey (new console) or appId + accessToken (legacy console)",
    );
  }
}

function createVolcengineStt(
  config: VolcengineSttConfig,
  logger: Logger,
): SpeechToTextProvider | null {
  try {
    return new VolcengineSTT(config, logger);
  } catch (error) {
    logger.error({ err: error }, "Failed to initialize the Volcengine speech-to-text provider");
    return null;
  }
}

/**
 * Fills in whichever speech slots requested Volcengine and are still empty.
 * Runs after the local provider and before OpenAI, matching how the runtime
 * layers providers: the first one that can serve a slot wins.
 */
export function initializeVolcengineSpeechServices(params: {
  providers: RequestedSpeechProviders;
  volcengineConfig: VolcengineSpeechProviderConfig | undefined;
  existing: SpeechServices;
  logger: Logger;
}): SpeechServices {
  const { providers, volcengineConfig, existing, logger } = params;

  const needsStt =
    !existing.sttService &&
    providers.voiceStt.enabled !== false &&
    providers.voiceStt.provider === "volcengine";
  const needsDictation =
    !existing.dictationSttService &&
    providers.dictationStt.enabled !== false &&
    providers.dictationStt.provider === "volcengine";

  const sttConfig = volcengineConfig?.stt;
  if ((!needsStt && !needsDictation) || !sttConfig || !hasVolcengineCredentials(sttConfig)) {
    return existing;
  }

  // One provider instance serves both slots — sessions hold all per-stream state.
  const stt = createVolcengineStt(sttConfig, logger);
  if (!stt) {
    return existing;
  }

  return {
    ...existing,
    ...(needsStt ? { sttService: stt } : {}),
    ...(needsDictation ? { dictationSttService: stt } : {}),
  };
}
