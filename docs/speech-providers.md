# Speech providers

Paseo has four independent speech slots. Each one picks its provider separately,
so you can run dictation on a cloud service while voice mode stays local.

| Slot                 | What it does                              | Providers                       |
| -------------------- | ----------------------------------------- | ------------------------------- |
| `dictationStt`       | Composer dictation (the mic button)       | `local`, `openai`, `volcengine` |
| `voiceStt`           | Realtime voice mode transcription         | `local`, `openai`, `volcengine` |
| `voiceTts`           | Realtime voice mode speech output         | `local`, `openai`               |
| `voiceTurnDetection` | Realtime voice mode end-of-turn detection | `local`                         |

All four default to `local`. **The bundled local model is Parakeet TDT v3, which
covers 25 European languages and does not recognize Chinese at all** — if you
dictate Chinese against the default config you get empty or garbage transcripts,
not an error. Pick `volcengine` (or `openai`) for Chinese.

## Selecting a provider

Persisted config (`$PASEO_HOME/config.json`) is the normal route:

```json
{
  "features": {
    "dictation": { "stt": { "provider": "volcengine" } }
  },
  "providers": {
    "volcengine": { "apiKey": "..." }
  }
}
```

Environment variables override nothing here — they are a fallback for credentials
only. The slot itself is chosen by `PASEO_DICTATION_STT_PROVIDER`,
`PASEO_VOICE_STT_PROVIDER`, `PASEO_VOICE_TTS_PROVIDER`, or
`PASEO_VOICE_TURN_DETECTION_PROVIDER`.

Providers are layered in `speech-runtime.ts`: local first, then Volcengine, then
OpenAI. Each layer only fills slots that requested it and are still empty. A slot
whose provider is missing credentials stays `null`, the daemon logs a warning, and
the client shows the feature as unavailable rather than silently downgrading.

## Volcengine (ByteDance) big-model streaming ASR

The only provider that streams partial transcripts. OpenAI and local both
transcribe in one shot at commit time, so text appears only after you stop
talking; Volcengine emits text while you speak.

### Console setup

1. Open **豆包语音 › 语音识别** in the Volcengine console and enable
   **大模型流式语音识别**. Pick the hour-metered plan (`duration`) unless you need
   guaranteed concurrency.
2. Create an application under **豆包语音 › 应用管理**. The legacy console gives you
   an **App ID** and an **Access Token**; the newer console gives a single
   **API Key**. Either scheme works — see the credentials section below.
3. Note the resource ID. Doubao ASR 1.0 is `volc.bigasr.sauc.duration`; 2.0 is
   `volc.seedasr.sauc.duration` and recognizes Chinese noticeably better.

A sub-account may not be allowed to enable the service; that has to happen on the
main account.

### Configuration

```json
{
  "features": {
    "dictation": { "stt": { "provider": "volcengine" } }
  },
  "providers": {
    "volcengine": {
      "stt": {
        "apiKey": "...",
        "resourceId": "volc.seedasr.sauc.duration",
        "hotwords": ["Paseo", "Unistyles", "worktree", "Expo Router"]
      }
    }
  }
}
```

| Key               | Default                                               | Notes                                                           |
| ----------------- | ----------------------------------------------------- | --------------------------------------------------------------- |
| `apiKey`          | —                                                     | New console credential, sent as `X-Api-Key`                     |
| `appId`           | —                                                     | Legacy console, sent as `X-Api-App-Key`                         |
| `accessToken`     | —                                                     | Legacy console, sent as `X-Api-Access-Key`                      |
| `endpoint`        | `wss://openspeech.bytedance.com/api/v3/sauc/bigmodel` | Bidirectional streaming endpoint                                |
| `resourceId`      | `volc.bigasr.sauc.duration`                           | Must match the plan you enabled                                 |
| `modelName`       | `bigmodel`                                            |                                                                 |
| `language`        | unset                                                 | Leave unset — auto-detection handles mixed Chinese/English      |
| `hotwords`        | —                                                     | Inline vocabulary, no console word list needed                  |
| `boostingTableId` | —                                                     | ID of a console-registered word list, usable alongside hotwords |
| `enableItn`       | `true`                                                | Spoken numbers become digits                                    |
| `enablePunc`      | `true`                                                | Punctuation                                                     |
| `enableDdc`       | `false`                                               | Disfluency removal — off, dictation must stay verbatim          |

Credentials also read from `VOLCENGINE_API_KEY`, `VOLCENGINE_APP_ID`,
`VOLCENGINE_ACCESS_TOKEN`, `VOLCENGINE_ASR_RESOURCE_ID`, `VOLCENGINE_ASR_ENDPOINT`,
`VOLCENGINE_ASR_MODEL`, `VOLCENGINE_ASR_LANGUAGE`, and `VOLCENGINE_HOTWORDS`
(comma-separated). Persisted config wins over the environment.

### Hotwords

Hotwords bias recognition toward vocabulary the model would otherwise mangle —
project names, library names, identifiers. They are injected inline as
`corpus.context`, so changing them means editing config, not re-registering a word
list in the console.

This beats cleaning up the transcript with an LLM afterwards: it fixes the word
during recognition instead of guessing at it later, costs nothing extra, and
cannot rewrite your meaning. Keep the list to terms that actually get misheard —
a long list dilutes the bias.

The list is currently global, not per-workspace. Making it follow the active
workspace would need the workspace identity on `dictation_stream_start`, which the
message does not carry today.

### Why `language` should stay unset

Paseo's shared STT language default is `"en"`, and the Volcengine session
deliberately ignores the generic `language` parameter it receives from
`createSession()`. Passing `en` to the big model would suppress the
Chinese/English code-switching it otherwise handles natively — which is the main
reason to use this provider. Set `providers.volcengine.stt.language` only if you
want recognition pinned to one language.

### Segments map to connections

The `SpeechToTextProvider` interface is segment-based: audio accumulates until
`commit()`, which seals a segment. Volcengine has no way to reset a live stream, so
**each segment gets its own websocket**. Consequences worth knowing:

- The next connection opens eagerly right after a commit, so the following
  utterance does not pay for the handshake.
- A segment with no audio (the silence auto-commit path) resolves to an empty
  final transcript without opening a connection at all.
- Every segment emits exactly one final transcript, including on error, timeout,
  or a dropped connection. Skipping it would leave `DictationStreamManager`
  waiting out its own timeout before giving up.

Auto-commit fires every 15 s (`PASEO_DICTATION_AUTO_COMMIT_SECONDS`), so the
reconnect rate is low enough not to matter.

### Protocol gotchas

`protocol.ts` implements the binary framing. Two things bite:

- **The terminating frame must carry a negative sequence number.** That is the
  only signal that tells the server to flush and produce a final transcript. A
  positive sequence on the last frame means it waits forever.
- **Audio must be 16 kHz mono PCM16.** Sessions advertise this through
  `requiredSampleRate`, and the caller resamples — providers never resample.

Audio goes out in 200 ms frames. Smaller frames waste round-trips; larger ones add
latency to the partial transcript.

`X-Tt-Logid` from the upgrade response is logged at debug level. It is the first
thing Volcengine support asks for.

## Adding another provider

1. Implement `SpeechToTextProvider` / `TextToSpeechProvider` from
   `speech/speech-provider.ts` under `speech/providers/<name>/`.
2. Add the id to `SpeechProviderIdSchema` in `speech/speech-types.ts` **and** the
   matching enum in `persisted-config.ts`.
3. Add a config resolver and wire it into `speech-config-resolver.ts`.
4. Add a runtime module exposing `initialize<Name>SpeechServices`, and layer it
   into `reconcileServices()` in `speech-runtime.ts`.
5. Thread the resolved config through `config.ts` → `bootstrap.ts`.

Test the frame codec directly, and test the session against a real local
`WebSocketServer` rather than a mock — the framing and sequence rules are where
the bugs live.
