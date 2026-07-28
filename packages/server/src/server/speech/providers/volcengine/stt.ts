import { EventEmitter } from "node:events";
import type pino from "pino";
import { v4 as uuidv4 } from "uuid";
import { WebSocket, type RawData } from "ws";

import type { SpeechToTextProvider, StreamingTranscriptionSession } from "../../speech-provider.js";
import {
  VOLCENGINE_ASR_SAMPLE_RATE,
  hasVolcengineCredentials,
  type VolcengineSttConfig,
} from "./config.js";
import {
  VolcengineMessageType,
  decodeServerFrame,
  encodeAudioRequest,
  encodeFullClientRequest,
  extractTranscript,
} from "./protocol.js";

/**
 * Volcengine wants 100–200 ms of audio per frame. Sending smaller frames wastes
 * round-trips; sending larger ones adds latency to the partial transcript.
 */
const AUDIO_FRAME_MS = 200;
const AUDIO_FRAME_BYTES = (VOLCENGINE_ASR_SAMPLE_RATE * 2 * AUDIO_FRAME_MS) / 1000;

/** How long to wait for the server's final frame after sending the last audio packet. */
const FINAL_RESPONSE_TIMEOUT_MS = 8000;
const CONNECT_TIMEOUT_MS = 10000;

interface VolcengineRequestPayload {
  user: { uid: string };
  audio: {
    format: string;
    codec: string;
    rate: number;
    bits: number;
    channel: number;
    language?: string;
  };
  request: {
    model_name: string;
    enable_itn: boolean;
    enable_punc: boolean;
    enable_ddc: boolean;
    result_type: string;
    show_utterances: boolean;
    corpus?: {
      boosting_table_id?: string;
      context?: string;
    };
  };
}

/**
 * Hotwords ride along as `corpus.context`, a JSON *string* holding a hotword list.
 * This inline form needs no console-registered word list, so the vocabulary can be
 * changed by editing config alone.
 */
function buildCorpus(config: VolcengineSttConfig): VolcengineRequestPayload["request"]["corpus"] {
  const hotwords = config.hotwords ?? [];
  if (hotwords.length === 0 && !config.boostingTableId) {
    return undefined;
  }
  return {
    ...(config.boostingTableId ? { boosting_table_id: config.boostingTableId } : {}),
    ...(hotwords.length > 0
      ? { context: JSON.stringify({ hotwords: hotwords.map((word) => ({ word })) }) }
      : {}),
  };
}

function buildRequestPayload(config: VolcengineSttConfig): VolcengineRequestPayload {
  return {
    user: { uid: "paseo" },
    audio: {
      format: "pcm",
      codec: "raw",
      rate: VOLCENGINE_ASR_SAMPLE_RATE,
      bits: 16,
      channel: 1,
      ...(config.language ? { language: config.language } : {}),
    },
    request: {
      model_name: config.modelName,
      enable_itn: config.enableItn,
      enable_punc: config.enablePunc,
      enable_ddc: config.enableDdc,
      // "full" makes every response frame carry the whole connection's transcript,
      // so the newest frame always supersedes the previous one.
      result_type: "full",
      show_utterances: true,
      ...(buildCorpus(config) ? { corpus: buildCorpus(config) } : {}),
    },
  };
}

function buildAuthHeaders(config: VolcengineSttConfig): Record<string, string> {
  const headers: Record<string, string> = {
    "X-Api-Resource-Id": config.resourceId,
    "X-Api-Request-Id": uuidv4(),
    "X-Api-Sequence": "-1",
  };
  if (config.apiKey) {
    // New console: a single API key replaces the App ID / Access Token pair.
    headers["X-Api-Key"] = config.apiKey;
    return headers;
  }
  headers["X-Api-App-Key"] = config.appId ?? "";
  headers["X-Api-Access-Key"] = config.accessToken ?? "";
  return headers;
}

/**
 * One Volcengine websocket, scoped to a single dictation segment.
 *
 * The interface Paseo providers implement is segment-based: audio accumulates
 * until `commit()`, which seals a segment and starts a new one. Volcengine has no
 * way to reset a live stream, so each segment gets its own connection. Segments
 * are long (auto-commit is 15 s), which makes the reconnect cost negligible, and
 * the next connection is opened eagerly so no speech is lost at the boundary.
 */
class SegmentConnection {
  private readonly ws: WebSocket;
  private readonly logger: pino.Logger;
  private readonly config: VolcengineSttConfig;
  private readonly onTranscript: (transcript: string, isFinal: boolean) => void;
  private readonly onError: (error: unknown) => void;

  private ready = false;
  private disposed = false;
  private sequence = 1;
  private pending: Buffer = Buffer.alloc(0);
  private lastTranscript = "";
  private finalizing = false;
  private finalResolved = false;
  private connectTimer: ReturnType<typeof setTimeout> | null = null;
  private finalTimer: ReturnType<typeof setTimeout> | null = null;
  private resolveFinal: ((transcript: string) => void) | null = null;

  constructor(params: {
    config: VolcengineSttConfig;
    logger: pino.Logger;
    onTranscript: (transcript: string, isFinal: boolean) => void;
    onError: (error: unknown) => void;
  }) {
    this.config = params.config;
    this.logger = params.logger;
    this.onTranscript = params.onTranscript;
    this.onError = params.onError;

    this.ws = new WebSocket(this.config.endpoint, {
      headers: buildAuthHeaders(this.config),
    });

    this.connectTimer = setTimeout(() => {
      if (!this.ready && !this.disposed) {
        this.fail(new Error("Timed out connecting to Volcengine ASR"));
      }
    }, CONNECT_TIMEOUT_MS);

    this.ws.on("upgrade", (response) => {
      // X-Tt-Logid identifies the request in Volcengine's console — worth keeping
      // in the log, it is the first thing their support asks for.
      const logId = response.headers["x-tt-logid"];
      if (logId) {
        this.logger.debug({ logId }, "Volcengine ASR connection established");
      }
    });

    this.ws.on("open", () => this.handleOpen());
    this.ws.on("message", (data) => this.handleMessage(data));
    this.ws.on("error", (error) => this.fail(error));
    this.ws.on("close", (code, reason) => this.handleClose(code, reason.toString()));
  }

  private handleOpen(): void {
    if (this.disposed) return;
    if (this.connectTimer) {
      clearTimeout(this.connectTimer);
      this.connectTimer = null;
    }
    try {
      this.ws.send(encodeFullClientRequest(buildRequestPayload(this.config), this.sequence));
      this.sequence += 1;
      this.ready = true;
      this.flush();
    } catch (error) {
      this.fail(error);
    }
  }

  private handleMessage(data: RawData): void {
    if (this.disposed) return;
    let frame: ReturnType<typeof decodeServerFrame>;
    try {
      frame = decodeServerFrame(Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer));
    } catch (error) {
      this.fail(error);
      return;
    }

    if (frame.messageType === VolcengineMessageType.ServerErrorResponse) {
      this.fail(
        new Error(`Volcengine ASR error ${frame.errorCode ?? "unknown"}: ${frame.rawPayload}`),
      );
      return;
    }

    const transcript = extractTranscript(frame.payload);
    if (transcript !== null) {
      this.lastTranscript = transcript;
      if (!frame.isLastPacket) {
        this.onTranscript(transcript, false);
      }
    }

    if (frame.isLastPacket) {
      this.settleFinal();
    }
  }

  private handleClose(code: number, reason: string): void {
    if (this.disposed) return;
    // A close during finalization is expected — the server hangs up after the
    // last frame. Anything else means we lost the stream mid-utterance.
    if (this.finalizing) {
      this.settleFinal();
      return;
    }
    this.fail(
      new Error(`Volcengine ASR connection closed (${code}${reason ? `: ${reason}` : ""})`),
    );
  }

  private settleFinal(): void {
    if (this.finalResolved) return;
    this.finalResolved = true;
    if (this.finalTimer) {
      clearTimeout(this.finalTimer);
      this.finalTimer = null;
    }
    const resolve = this.resolveFinal;
    this.resolveFinal = null;
    resolve?.(this.lastTranscript);
  }

  private fail(error: unknown): void {
    if (this.disposed) return;
    // A failure mid-segment still has to produce a final transcript, otherwise the
    // dictation stream manager waits out its own timeout before giving up.
    if (this.finalizing) {
      this.settleFinal();
    } else {
      this.onError(error);
    }
    this.dispose();
  }

  /** Queues audio, sending whole frames as soon as enough has accumulated. */
  append(pcm16le: Buffer): void {
    if (this.disposed || this.finalizing) return;
    this.pending = this.pending.length === 0 ? pcm16le : Buffer.concat([this.pending, pcm16le]);
    this.flush();
  }

  /** Sends every whole frame that has accumulated, leaving the remainder queued. */
  private flush(): void {
    if (!this.ready || this.disposed) return;
    while (this.pending.length >= AUDIO_FRAME_BYTES) {
      const chunk = this.pending.subarray(0, AUDIO_FRAME_BYTES);
      this.pending = this.pending.subarray(AUDIO_FRAME_BYTES);
      try {
        this.ws.send(
          encodeAudioRequest({ pcm16le: chunk, sequence: this.sequence, isLast: false }),
        );
        this.sequence += 1;
      } catch (error) {
        this.fail(error);
        return;
      }
    }
  }

  /**
   * Sends whatever audio is left plus a negative-sequence terminator, then waits
   * for the server's final frame. Always resolves — with the best transcript seen
   * so far if the server never answers.
   */
  async finalize(): Promise<string> {
    if (this.disposed) {
      return this.lastTranscript;
    }
    this.finalizing = true;

    if (!this.ready) {
      // Never got as far as sending the config frame; there is nothing to flush.
      this.dispose();
      return this.lastTranscript;
    }

    const finalPromise = new Promise<string>((resolve) => {
      this.resolveFinal = resolve;
      this.finalTimer = setTimeout(() => {
        this.logger.warn("Timed out waiting for the final Volcengine ASR frame");
        this.settleFinal();
      }, FINAL_RESPONSE_TIMEOUT_MS);
    });

    try {
      // Everything but the tail goes out as normal frames, so the terminator stays
      // small and the server can start flushing immediately.
      this.flush();
      const tail = this.pending;
      this.pending = Buffer.alloc(0);
      this.ws.send(encodeAudioRequest({ pcm16le: tail, sequence: this.sequence, isLast: true }));
      this.sequence += 1;
    } catch (error) {
      this.logger.warn({ err: error }, "Failed to send the final Volcengine ASR frame");
      this.settleFinal();
    }

    const transcript = await finalPromise;
    this.dispose();
    return transcript;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.connectTimer) {
      clearTimeout(this.connectTimer);
      this.connectTimer = null;
    }
    if (this.finalTimer) {
      clearTimeout(this.finalTimer);
      this.finalTimer = null;
    }
    this.resolveFinal = null;
    this.pending = Buffer.alloc(0);
    try {
      this.ws.removeAllListeners();
      // Closing a socket that is still handshaking makes `ws` emit one last error
      // asynchronously. With every listener removed that becomes an unhandled
      // 'error' event, which takes the whole daemon down — so keep a sink attached.
      // This is the common path: the connection opened eagerly after a commit is
      // often still CONNECTING when the session ends.
      this.ws.on("error", () => {});
      if (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING) {
        this.ws.close();
      }
    } catch {
      // Closing a socket that already failed is not worth reporting.
    }
  }
}

export class VolcengineSTT implements SpeechToTextProvider {
  public readonly id = "volcengine" as const;

  private readonly config: VolcengineSttConfig;
  private readonly logger: pino.Logger;

  constructor(config: VolcengineSttConfig, parentLogger: pino.Logger) {
    if (!hasVolcengineCredentials(config)) {
      throw new Error(
        "Volcengine ASR requires either an API key or an App ID and Access Token pair",
      );
    }
    this.config = config;
    this.logger = parentLogger.child({ module: "agent", provider: "volcengine", component: "stt" });
    this.logger.info(
      {
        endpoint: config.endpoint,
        resourceId: config.resourceId,
        model: config.modelName,
        hotwordCount: config.hotwords?.length ?? 0,
      },
      "STT (Volcengine big-model streaming ASR) initialized",
    );
  }

  public createSession(params: {
    logger: pino.Logger;
    language?: string;
    prompt?: string;
  }): StreamingTranscriptionSession {
    const emitter = new EventEmitter();
    const logger = params.logger.child({ provider: "volcengine", component: "stt-session" });
    // `params.language` is deliberately ignored. Paseo's shared default is "en",
    // and forcing English on the big model breaks the mixed Chinese/English speech
    // it otherwise handles natively. Set `providers.volcengine.stt.language` to pin
    // a language explicitly.
    const config = this.config;

    let connected = false;
    let closed = false;
    let segmentId = uuidv4();
    let previousSegmentId: string | null = null;
    let connection: SegmentConnection | null = null;
    /** Set while a segment has audio; a segment with none skips the round-trip entirely. */
    let segmentHasAudio = false;

    const openConnection = (activeSegmentId: string): SegmentConnection =>
      new SegmentConnection({
        config,
        logger,
        onTranscript: (transcript, isFinal) => {
          emitter.emit("transcript", { segmentId: activeSegmentId, transcript, isFinal });
        },
        onError: (error) => {
          emitter.emit("error", error);
        },
      });

    const ensureConnection = (): SegmentConnection => {
      if (!connection) {
        connection = openConnection(segmentId);
      }
      return connection;
    };

    return {
      requiredSampleRate: VOLCENGINE_ASR_SAMPLE_RATE,

      async connect() {
        connected = true;
        // Opening ahead of the first chunk keeps the websocket handshake off the
        // critical path, which is the whole point of a streaming provider.
        ensureConnection();
      },

      appendPcm16(chunk: Buffer) {
        if (!connected || closed) {
          emitter.emit("error", new Error("STT session not connected"));
          return;
        }
        if (chunk.length === 0) return;
        segmentHasAudio = true;
        ensureConnection().append(chunk);
      },

      commit() {
        if (!connected || closed) {
          emitter.emit("error", new Error("STT session not connected"));
          return;
        }

        const committedId = segmentId;
        const prev = previousSegmentId;
        const committedConnection = connection;
        const hadAudio = segmentHasAudio;

        previousSegmentId = committedId;
        segmentId = uuidv4();
        connection = null;
        segmentHasAudio = false;
        emitter.emit("committed", { segmentId: committedId, previousSegmentId: prev });

        if (!hadAudio || !committedConnection) {
          // Silence between commits still needs a final transcript, or the stream
          // manager keeps waiting for a segment that will never resolve.
          committedConnection?.dispose();
          emitter.emit("transcript", { segmentId: committedId, transcript: "", isFinal: true });
          return;
        }

        void (async () => {
          try {
            const transcript = await committedConnection.finalize();
            emitter.emit("transcript", { segmentId: committedId, transcript, isFinal: true });
          } catch (error) {
            emitter.emit("error", error);
            emitter.emit("transcript", { segmentId: committedId, transcript: "", isFinal: true });
          } finally {
            // Reopen eagerly so the next utterance does not pay for the handshake —
            // but only if nothing opened one already. Finalizing takes a few hundred
            // ms, and audio arriving in that window has `appendPcm16` open the next
            // segment's connection itself. Overwriting it here would silently drop
            // every word spoken across the segment boundary.
            if (!closed && !connection) {
              connection = openConnection(segmentId);
            }
          }
        })();
      },

      clear() {
        connection?.dispose();
        connection = null;
        segmentHasAudio = false;
        if (connected && !closed) {
          connection = openConnection(segmentId);
        }
      },

      close() {
        closed = true;
        connected = false;
        connection?.dispose();
        connection = null;
        emitter.removeAllListeners();
      },

      on(event: string, handler: (payload: never) => void) {
        return emitter.on(event, handler as (...args: unknown[]) => void);
      },
    };
  }
}
