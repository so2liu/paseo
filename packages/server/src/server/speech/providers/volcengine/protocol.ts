/**
 * Binary frame codec for the Volcengine (ByteDance) big-model streaming ASR
 * WebSocket API (`/api/v3/sauc/bigmodel`).
 *
 * Every frame starts with a 4-byte header:
 *
 *   byte 0: protocol version (4 bits) | header size in 4-byte words (4 bits)
 *   byte 1: message type (4 bits)     | message-type-specific flags (4 bits)
 *   byte 2: serialization (4 bits)    | compression (4 bits)
 *   byte 3: reserved
 *
 * The header is optionally followed by `(headerSize - 1) * 4` extension bytes,
 * then — depending on the flags and message type — a sequence number, an error
 * code, a big-endian payload size, and finally the payload itself.
 */

import { gunzipSync, gzipSync } from "node:zlib";

export const VOLCENGINE_PROTOCOL_VERSION = 0b0001;

/** Header size is expressed in 4-byte words; we always emit the minimal 4-byte header. */
const DEFAULT_HEADER_SIZE_WORDS = 0b0001;
const HEADER_WORD_BYTES = 4;

export const VolcengineMessageType = {
  FullClientRequest: 0b0001,
  AudioOnlyRequest: 0b0010,
  FullServerResponse: 0b1001,
  ServerAck: 0b1011,
  ServerErrorResponse: 0b1111,
} as const;

export type VolcengineMessageType =
  (typeof VolcengineMessageType)[keyof typeof VolcengineMessageType];

export const VolcengineMessageFlags = {
  /** No sequence field in the frame. */
  None: 0b0000,
  /** A positive sequence number follows the header. */
  PositiveSequence: 0b0001,
  /** Final frame of the request, no sequence number. */
  LastNoSequence: 0b0010,
  /** Final frame of the request, carrying a negative sequence number. */
  NegativeSequence: 0b0011,
} as const;

const Serialization = {
  None: 0b0000,
  Json: 0b0001,
} as const;

const Compression = {
  None: 0b0000,
  Gzip: 0b0001,
} as const;

const SEQUENCE_FLAG_BIT = 0b0001;
const LAST_PACKET_FLAG_BIT = 0b0010;

function buildHeader(params: {
  messageType: number;
  flags: number;
  serialization: number;
  compression: number;
}): Buffer {
  const header = Buffer.alloc(HEADER_WORD_BYTES);
  header[0] = (VOLCENGINE_PROTOCOL_VERSION << 4) | DEFAULT_HEADER_SIZE_WORDS;
  header[1] = (params.messageType << 4) | params.flags;
  header[2] = (params.serialization << 4) | params.compression;
  header[3] = 0x00;
  return header;
}

function buildInt32BE(value: number): Buffer {
  const buf = Buffer.alloc(4);
  buf.writeInt32BE(value, 0);
  return buf;
}

function buildUInt32BE(value: number): Buffer {
  const buf = Buffer.alloc(4);
  buf.writeUInt32BE(value, 0);
  return buf;
}

/**
 * Frame 1 of a request: the JSON config describing user/audio/request options.
 * Always carries sequence 1 — the server rejects a stream whose first frame is
 * not a positive-sequence full client request.
 */
export function encodeFullClientRequest(payload: unknown, sequence: number): Buffer {
  const compressed = gzipSync(Buffer.from(JSON.stringify(payload), "utf8"));
  return Buffer.concat([
    buildHeader({
      messageType: VolcengineMessageType.FullClientRequest,
      flags: VolcengineMessageFlags.PositiveSequence,
      serialization: Serialization.Json,
      compression: Compression.Gzip,
    }),
    buildInt32BE(sequence),
    buildUInt32BE(compressed.length),
    compressed,
  ]);
}

/**
 * An audio frame. The final frame of a stream must be marked `isLast`, which
 * flips the sequence number negative — that is how the server knows to flush
 * and emit the final transcript rather than waiting for more audio.
 */
export function encodeAudioRequest(params: {
  pcm16le: Buffer;
  sequence: number;
  isLast: boolean;
}): Buffer {
  const compressed = gzipSync(params.pcm16le);
  const sequence = params.isLast ? -Math.abs(params.sequence) : params.sequence;
  return Buffer.concat([
    buildHeader({
      messageType: VolcengineMessageType.AudioOnlyRequest,
      flags: params.isLast
        ? VolcengineMessageFlags.NegativeSequence
        : VolcengineMessageFlags.PositiveSequence,
      serialization: Serialization.None,
      compression: Compression.Gzip,
    }),
    buildInt32BE(sequence),
    buildUInt32BE(compressed.length),
    compressed,
  ]);
}

export interface VolcengineUtterance {
  text?: string;
  start_time?: number;
  end_time?: number;
  definite?: boolean;
}

export interface VolcengineResponsePayload {
  result?: {
    text?: string;
    utterances?: VolcengineUtterance[];
  };
  audio_info?: {
    duration?: number;
  };
}

export interface DecodedVolcengineFrame {
  messageType: number;
  flags: number;
  /** True when the server marked this as the last frame of the response stream. */
  isLastPacket: boolean;
  sequence: number | null;
  /** Non-null only for error frames. */
  errorCode: number | null;
  payload: VolcengineResponsePayload | null;
  /** Raw payload text — retained so error frames can be reported verbatim. */
  rawPayload: string;
}

class FrameReader {
  private offset = 0;

  constructor(private readonly buffer: Buffer) {}

  skip(bytes: number): void {
    this.offset += bytes;
  }

  get remaining(): number {
    return Math.max(0, this.buffer.length - this.offset);
  }

  readInt32BE(): number {
    if (this.remaining < 4) {
      throw new Error("Volcengine frame truncated while reading a 32-bit field");
    }
    const value = this.buffer.readInt32BE(this.offset);
    this.offset += 4;
    return value;
  }

  readUInt32BE(): number {
    if (this.remaining < 4) {
      throw new Error("Volcengine frame truncated while reading a 32-bit field");
    }
    const value = this.buffer.readUInt32BE(this.offset);
    this.offset += 4;
    return value;
  }

  readRest(): Buffer {
    const rest = this.buffer.subarray(this.offset);
    this.offset = this.buffer.length;
    return rest;
  }

  /**
   * Reads a length-prefixed payload. A declared length longer than what actually
   * arrived is treated as "take the rest": the server occasionally pads the
   * declared size, and dropping the frame outright would lose a transcript.
   */
  readSizedPayload(): Buffer {
    const declaredSize = this.readUInt32BE();
    const rest = this.readRest();
    return declaredSize > 0 && declaredSize < rest.length ? rest.subarray(0, declaredSize) : rest;
  }
}

function decompressPayload(payload: Buffer, compression: number): Buffer {
  if (compression !== Compression.Gzip || payload.length === 0) {
    return payload;
  }
  return gunzipSync(payload);
}

function parsePayloadJson(raw: string): VolcengineResponsePayload | null {
  if (raw.trim().length === 0) {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return null;
    }
    return parsed as VolcengineResponsePayload;
  } catch {
    return null;
  }
}

export function decodeServerFrame(frame: Buffer): DecodedVolcengineFrame {
  if (frame.length < HEADER_WORD_BYTES) {
    throw new Error(`Volcengine frame too short (${frame.length} bytes)`);
  }

  const headerSizeWords = frame[0] & 0x0f;
  const messageType = frame[1] >> 4;
  const flags = frame[1] & 0x0f;
  const compression = frame[2] & 0x0f;

  const reader = new FrameReader(frame);
  // Skip the fixed header plus any header extension words we do not use.
  reader.skip(Math.max(headerSizeWords, DEFAULT_HEADER_SIZE_WORDS) * HEADER_WORD_BYTES);

  const sequence = (flags & SEQUENCE_FLAG_BIT) !== 0 ? reader.readInt32BE() : null;
  const errorCode =
    messageType === VolcengineMessageType.ServerErrorResponse ? reader.readUInt32BE() : null;

  const rawPayloadBuffer = decompressPayload(reader.readSizedPayload(), compression);
  const rawPayload = rawPayloadBuffer.toString("utf8");

  return {
    messageType,
    flags,
    isLastPacket: (flags & LAST_PACKET_FLAG_BIT) !== 0,
    sequence,
    errorCode,
    payload: parsePayloadJson(rawPayload),
    rawPayload,
  };
}

/**
 * The transcript for a response frame. `result_type: "full"` makes the server
 * send the whole connection's text on every frame, so the latest frame always
 * supersedes the previous one — no client-side accumulation needed.
 *
 * Older/alternate deployments omit `result.text` and only send `utterances`, so
 * fall back to joining those.
 */
export function extractTranscript(payload: VolcengineResponsePayload | null): string | null {
  if (!payload?.result) {
    return null;
  }
  const { text, utterances } = payload.result;
  if (typeof text === "string") {
    return text;
  }
  if (Array.isArray(utterances)) {
    return utterances
      .map((utterance) => utterance.text ?? "")
      .join("")
      .trim();
  }
  return null;
}
