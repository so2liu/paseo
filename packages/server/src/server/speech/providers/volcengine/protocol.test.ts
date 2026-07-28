import { describe, expect, it } from "vitest";
import { gunzipSync, gzipSync } from "node:zlib";

import {
  VOLCENGINE_PROTOCOL_VERSION,
  VolcengineMessageFlags,
  VolcengineMessageType,
  decodeServerFrame,
  encodeAudioRequest,
  encodeFullClientRequest,
  extractTranscript,
} from "./protocol.js";

interface HeaderFields {
  protocolVersion: number;
  headerSizeWords: number;
  messageType: number;
  flags: number;
  serialization: number;
  compression: number;
}

function readHeader(frame: Buffer): HeaderFields {
  return {
    protocolVersion: frame[0] >> 4,
    headerSizeWords: frame[0] & 0x0f,
    messageType: frame[1] >> 4,
    flags: frame[1] & 0x0f,
    serialization: frame[2] >> 4,
    compression: frame[2] & 0x0f,
  };
}

/** Builds a server frame the way Volcengine does, so the decoder is tested against real shapes. */
function buildServerFrame(params: {
  messageType: number;
  flags: number;
  payload: string;
  sequence?: number;
  errorCode?: number;
  compress?: boolean;
  headerSizeWords?: number;
}): Buffer {
  const compress = params.compress ?? true;
  const headerSizeWords = params.headerSizeWords ?? 1;
  const header = Buffer.alloc(headerSizeWords * 4);
  header[0] = (VOLCENGINE_PROTOCOL_VERSION << 4) | headerSizeWords;
  header[1] = (params.messageType << 4) | params.flags;
  header[2] = (0b0001 << 4) | (compress ? 0b0001 : 0b0000);
  header[3] = 0x00;

  const body = Buffer.from(params.payload, "utf8");
  const payload = compress ? gzipSync(body) : body;

  const parts: Buffer[] = [header];
  if (params.sequence !== undefined) {
    const seq = Buffer.alloc(4);
    seq.writeInt32BE(params.sequence, 0);
    parts.push(seq);
  }
  if (params.errorCode !== undefined) {
    const code = Buffer.alloc(4);
    code.writeUInt32BE(params.errorCode, 0);
    parts.push(code);
  }
  const size = Buffer.alloc(4);
  size.writeUInt32BE(payload.length, 0);
  parts.push(size, payload);

  return Buffer.concat(parts);
}

describe("encodeFullClientRequest", () => {
  it("emits a gzipped JSON config frame carrying a positive sequence", () => {
    const payload = { request: { model_name: "bigmodel" } };
    const frame = encodeFullClientRequest(payload, 1);

    const header = readHeader(frame);
    expect(header.protocolVersion).toBe(VOLCENGINE_PROTOCOL_VERSION);
    expect(header.headerSizeWords).toBe(1);
    expect(header.messageType).toBe(VolcengineMessageType.FullClientRequest);
    expect(header.flags).toBe(VolcengineMessageFlags.PositiveSequence);
    expect(header.serialization).toBe(0b0001);
    expect(header.compression).toBe(0b0001);

    expect(frame.readInt32BE(4)).toBe(1);
    const declaredSize = frame.readUInt32BE(8);
    const body = frame.subarray(12);
    expect(body.length).toBe(declaredSize);
    expect(JSON.parse(gunzipSync(body).toString("utf8"))).toEqual(payload);
  });
});

describe("encodeAudioRequest", () => {
  it("marks a mid-stream frame with a positive sequence and no serialization", () => {
    const pcm = Buffer.from([0x01, 0x02, 0x03, 0x04]);
    const frame = encodeAudioRequest({ pcm16le: pcm, sequence: 7, isLast: false });

    const header = readHeader(frame);
    expect(header.messageType).toBe(VolcengineMessageType.AudioOnlyRequest);
    expect(header.flags).toBe(VolcengineMessageFlags.PositiveSequence);
    expect(header.serialization).toBe(0b0000);
    expect(frame.readInt32BE(4)).toBe(7);
    expect(gunzipSync(frame.subarray(12))).toEqual(pcm);
  });

  it("flips the sequence negative on the terminating frame", () => {
    // The negative sequence is the only signal that tells the server to flush and
    // emit a final transcript, so it has to survive encoding exactly.
    const frame = encodeAudioRequest({ pcm16le: Buffer.alloc(0), sequence: 12, isLast: true });

    const header = readHeader(frame);
    expect(header.flags).toBe(VolcengineMessageFlags.NegativeSequence);
    expect(frame.readInt32BE(4)).toBe(-12);
  });

  it("keeps an already-negative sequence negative rather than flipping it back", () => {
    const frame = encodeAudioRequest({ pcm16le: Buffer.alloc(0), sequence: -3, isLast: true });
    expect(frame.readInt32BE(4)).toBe(-3);
  });
});

describe("decodeServerFrame", () => {
  it("decodes a gzipped response carrying a sequence", () => {
    const frame = buildServerFrame({
      messageType: VolcengineMessageType.FullServerResponse,
      flags: VolcengineMessageFlags.PositiveSequence,
      sequence: 4,
      payload: JSON.stringify({ result: { text: "你好世界" } }),
    });

    const decoded = decodeServerFrame(frame);
    expect(decoded.messageType).toBe(VolcengineMessageType.FullServerResponse);
    expect(decoded.sequence).toBe(4);
    expect(decoded.isLastPacket).toBe(false);
    expect(decoded.errorCode).toBeNull();
    expect(decoded.payload?.result?.text).toBe("你好世界");
  });

  it("reports the last-packet flag", () => {
    const frame = buildServerFrame({
      messageType: VolcengineMessageType.FullServerResponse,
      flags: VolcengineMessageFlags.NegativeSequence,
      sequence: -9,
      payload: JSON.stringify({ result: { text: "结束" } }),
    });

    const decoded = decodeServerFrame(frame);
    expect(decoded.isLastPacket).toBe(true);
    expect(decoded.sequence).toBe(-9);
  });

  it("decodes an uncompressed response", () => {
    const frame = buildServerFrame({
      messageType: VolcengineMessageType.FullServerResponse,
      flags: VolcengineMessageFlags.None,
      compress: false,
      payload: JSON.stringify({ result: { text: "plain" } }),
    });

    const decoded = decodeServerFrame(frame);
    expect(decoded.sequence).toBeNull();
    expect(decoded.payload?.result?.text).toBe("plain");
  });

  it("skips header extension words instead of reading them as payload", () => {
    const frame = buildServerFrame({
      messageType: VolcengineMessageType.FullServerResponse,
      flags: VolcengineMessageFlags.None,
      headerSizeWords: 2,
      payload: JSON.stringify({ result: { text: "extended" } }),
    });

    expect(decodeServerFrame(frame).payload?.result?.text).toBe("extended");
  });

  it("surfaces the error code and raw body of an error frame", () => {
    const frame = buildServerFrame({
      messageType: VolcengineMessageType.ServerErrorResponse,
      flags: VolcengineMessageFlags.None,
      errorCode: 45000001,
      payload: "invalid request",
    });

    const decoded = decodeServerFrame(frame);
    expect(decoded.errorCode).toBe(45000001);
    expect(decoded.rawPayload).toBe("invalid request");
    expect(decoded.payload).toBeNull();
  });

  it("keeps the payload when the declared size overruns the frame", () => {
    // A truncated length prefix must not cost us a transcript we already received.
    const body = gzipSync(Buffer.from(JSON.stringify({ result: { text: "salvaged" } }), "utf8"));
    const header = Buffer.from([
      (VOLCENGINE_PROTOCOL_VERSION << 4) | 1,
      (VolcengineMessageType.FullServerResponse << 4) | VolcengineMessageFlags.None,
      (0b0001 << 4) | 0b0001,
      0x00,
    ]);
    const size = Buffer.alloc(4);
    size.writeUInt32BE(body.length + 128, 0);

    const decoded = decodeServerFrame(Buffer.concat([header, size, body]));
    expect(decoded.payload?.result?.text).toBe("salvaged");
  });

  it("throws on a frame shorter than a header", () => {
    expect(() => decodeServerFrame(Buffer.from([0x11, 0x90]))).toThrow(/too short/);
  });
});

describe("extractTranscript", () => {
  it("prefers the accumulated result text", () => {
    expect(
      extractTranscript({
        result: { text: "完整文本", utterances: [{ text: "片段", definite: true }] },
      }),
    ).toBe("完整文本");
  });

  it("falls back to joining utterances when text is absent", () => {
    expect(
      extractTranscript({
        result: { utterances: [{ text: "把这个" }, { text: "改成中文" }] },
      }),
    ).toBe("把这个改成中文");
  });

  it("returns an empty string rather than null for a silent segment", () => {
    // An empty transcript is a real answer; null means "this frame said nothing
    // about the transcript" and must not overwrite what we already have.
    expect(extractTranscript({ result: { text: "" } })).toBe("");
    expect(extractTranscript({ audio_info: { duration: 120 } })).toBeNull();
    expect(extractTranscript(null)).toBeNull();
  });
});
