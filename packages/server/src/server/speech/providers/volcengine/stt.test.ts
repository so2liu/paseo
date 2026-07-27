import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { gzipSync } from "node:zlib";
import pino from "pino";
import { WebSocketServer, type WebSocket as WsSocket } from "ws";

import type { StreamingTranscriptionSession } from "../../speech-provider.js";
import { VOLCENGINE_ASR_SAMPLE_RATE, type VolcengineSttConfig } from "./config.js";
import { VolcengineMessageType, decodeServerFrame } from "./protocol.js";
import { VolcengineSTT } from "./stt.js";

const logger = pino({ level: "silent" });

interface ReceivedFrame {
  messageType: number;
  sequence: number | null;
  isLast: boolean;
}

/**
 * A stand-in for Volcengine's endpoint. Real websockets, real framing — only the
 * recognition is faked, so the session's wire behavior is what gets tested.
 */
class FakeVolcengineServer {
  private readonly http: Server;
  private readonly wss: WebSocketServer;

  readonly connections: Array<{
    headers: Record<string, string | string[] | undefined>;
    frames: ReceivedFrame[];
    socket: WsSocket;
  }> = [];

  /** Called for every client frame, so a test can script the server's replies. */
  onFrame:
    | ((params: { frame: ReceivedFrame; socket: WsSocket; connectionIndex: number }) => void)
    | null = null;

  private constructor(http: Server, wss: WebSocketServer) {
    this.http = http;
    this.wss = wss;

    this.wss.on("connection", (socket, request) => {
      const connectionIndex = this.connections.length;
      const connection = { headers: request.headers, frames: [], socket };
      this.connections.push(connection);

      socket.on("message", (data) => {
        const raw = Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer);
        const decoded = decodeServerFrame(raw);
        const frame: ReceivedFrame = {
          messageType: decoded.messageType,
          sequence: decoded.sequence,
          isLast: decoded.isLastPacket,
        };
        connection.frames.push(frame);
        this.onFrame?.({ frame, socket, connectionIndex });
      });
    });
  }

  static async start(): Promise<FakeVolcengineServer> {
    const http = createServer();
    const wss = new WebSocketServer({ server: http });
    await new Promise<void>((resolve) => http.listen(0, "127.0.0.1", resolve));
    return new FakeVolcengineServer(http, wss);
  }

  get endpoint(): string {
    const address = this.http.address() as AddressInfo;
    return `ws://127.0.0.1:${address.port}`;
  }

  static sendResponse(socket: WsSocket, params: { text: string; isLast: boolean }): void {
    const flags = params.isLast ? 0b0011 : 0b0001;
    const header = Buffer.from([
      (0b0001 << 4) | 0b0001,
      (VolcengineMessageType.FullServerResponse << 4) | flags,
      (0b0001 << 4) | 0b0001,
      0x00,
    ]);
    const sequence = Buffer.alloc(4);
    sequence.writeInt32BE(params.isLast ? -1 : 1, 0);
    const payload = gzipSync(Buffer.from(JSON.stringify({ result: { text: params.text } })));
    const size = Buffer.alloc(4);
    size.writeUInt32BE(payload.length, 0);
    socket.send(Buffer.concat([header, sequence, size, payload]));
  }

  static sendError(socket: WsSocket, params: { code: number; message: string }): void {
    const header = Buffer.from([
      (0b0001 << 4) | 0b0001,
      (VolcengineMessageType.ServerErrorResponse << 4) | 0b0000,
      (0b0001 << 4) | 0b0000,
      0x00,
    ]);
    const code = Buffer.alloc(4);
    code.writeUInt32BE(params.code, 0);
    const payload = Buffer.from(params.message, "utf8");
    const size = Buffer.alloc(4);
    size.writeUInt32BE(payload.length, 0);
    socket.send(Buffer.concat([header, code, size, payload]));
  }

  async stop(): Promise<void> {
    for (const connection of this.connections) {
      connection.socket.terminate();
    }
    await new Promise<void>((resolve) => this.wss.close(() => resolve()));
    await new Promise<void>((resolve) => this.http.close(() => resolve()));
  }
}

function buildConfig(overrides: Partial<VolcengineSttConfig> & { endpoint: string }) {
  return {
    apiKey: "test-api-key",
    resourceId: "volc.bigasr.sauc.duration",
    modelName: "bigmodel",
    enableItn: true,
    enablePunc: true,
    enableDdc: false,
    ...overrides,
  } satisfies VolcengineSttConfig;
}

/** 200 ms of 16 kHz PCM16 — exactly one audio frame. */
function buildAudioFrame(): Buffer {
  return Buffer.alloc((VOLCENGINE_ASR_SAMPLE_RATE * 2 * 200) / 1000, 1);
}

function collectTranscripts(session: StreamingTranscriptionSession): {
  partials: string[];
  finals: Array<{ segmentId: string; transcript: string }>;
  committed: string[];
  errors: unknown[];
} {
  const partials: string[] = [];
  const finals: Array<{ segmentId: string; transcript: string }> = [];
  const committed: string[] = [];
  const errors: unknown[] = [];

  session.on("transcript", ({ segmentId, transcript, isFinal }) => {
    if (isFinal) {
      finals.push({ segmentId, transcript });
    } else {
      partials.push(transcript);
    }
  });
  session.on("committed", ({ segmentId }) => committed.push(segmentId));
  session.on("error", (error) => errors.push(error));

  return { partials, finals, committed, errors };
}

async function waitFor(predicate: () => boolean, timeoutMs = 3000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) {
      throw new Error("Timed out waiting for condition");
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

describe("VolcengineSTT", () => {
  let server: FakeVolcengineServer;

  beforeEach(async () => {
    server = await FakeVolcengineServer.start();
  });

  afterEach(async () => {
    await server.stop();
  });

  it("rejects a config with neither an API key nor an App ID / Access Token pair", () => {
    expect(
      () =>
        new VolcengineSTT(
          buildConfig({ endpoint: server.endpoint, apiKey: undefined, appId: "only-app-id" }),
          logger,
        ),
    ).toThrow(/API key or an App ID and Access Token/);
  });

  it("sends the new-console API key header when an API key is configured", async () => {
    const provider = new VolcengineSTT(buildConfig({ endpoint: server.endpoint }), logger);
    const session = provider.createSession({ logger });
    await session.connect();
    await waitFor(() => server.connections.length === 1);

    const headers = server.connections[0].headers;
    expect(headers["x-api-key"]).toBe("test-api-key");
    expect(headers["x-api-resource-id"]).toBe("volc.bigasr.sauc.duration");
    expect(headers["x-api-sequence"]).toBe("-1");
    expect(headers["x-api-app-key"]).toBeUndefined();
    session.close();
  });

  it("falls back to the legacy App ID and Access Token headers", async () => {
    const provider = new VolcengineSTT(
      buildConfig({
        endpoint: server.endpoint,
        apiKey: undefined,
        appId: "app-123",
        accessToken: "token-456",
      }),
      logger,
    );
    const session = provider.createSession({ logger });
    await session.connect();
    await waitFor(() => server.connections.length === 1);

    const headers = server.connections[0].headers;
    expect(headers["x-api-app-key"]).toBe("app-123");
    expect(headers["x-api-access-key"]).toBe("token-456");
    expect(headers["x-api-key"]).toBeUndefined();
    session.close();
  });

  it("opens the connection and sends the config frame before any audio arrives", async () => {
    const provider = new VolcengineSTT(buildConfig({ endpoint: server.endpoint }), logger);
    const session = provider.createSession({ logger });
    await session.connect();

    await waitFor(() => server.connections[0]?.frames.length === 1);
    expect(server.connections[0].frames[0]).toEqual({
      messageType: VolcengineMessageType.FullClientRequest,
      sequence: 1,
      isLast: false,
    });
    session.close();
  });

  it("streams partial transcripts and finalizes the segment on commit", async () => {
    server.onFrame = ({ frame, socket }) => {
      if (frame.messageType !== VolcengineMessageType.AudioOnlyRequest) return;
      if (frame.isLast) {
        FakeVolcengineServer.sendResponse(socket, { text: "把这段改成中文", isLast: true });
      } else {
        FakeVolcengineServer.sendResponse(socket, { text: "把这段", isLast: false });
      }
    };

    const provider = new VolcengineSTT(buildConfig({ endpoint: server.endpoint }), logger);
    const session = provider.createSession({ logger });
    const events = collectTranscripts(session);

    await session.connect();
    await waitFor(() => server.connections[0]?.frames.length === 1);

    session.appendPcm16(buildAudioFrame());
    await waitFor(() => events.partials.length > 0);
    expect(events.partials[0]).toBe("把这段");

    session.commit();
    // `committed` must land synchronously — the stream manager orders segments by it.
    expect(events.committed).toHaveLength(1);

    await waitFor(() => events.finals.length === 1);
    expect(events.finals[0].transcript).toBe("把这段改成中文");
    expect(events.finals[0].segmentId).toBe(events.committed[0]);
    expect(events.errors).toHaveLength(0);

    session.close();
  });

  it("terminates the stream with a negative-sequence audio frame", async () => {
    server.onFrame = ({ frame, socket }) => {
      if (frame.isLast) {
        FakeVolcengineServer.sendResponse(socket, { text: "done", isLast: true });
      }
    };

    const provider = new VolcengineSTT(buildConfig({ endpoint: server.endpoint }), logger);
    const session = provider.createSession({ logger });
    const events = collectTranscripts(session);

    await session.connect();
    await waitFor(() => server.connections[0]?.frames.length === 1);
    session.appendPcm16(buildAudioFrame());
    session.commit();
    await waitFor(() => events.finals.length === 1);

    const frames = server.connections[0].frames;
    const last = frames[frames.length - 1];
    expect(last.messageType).toBe(VolcengineMessageType.AudioOnlyRequest);
    expect(last.isLast).toBe(true);
    expect(last.sequence).toBeLessThan(0);
    // Every preceding frame must stay positive, or the server flushes early.
    expect(frames.slice(0, -1).every((frame) => (frame.sequence ?? 0) > 0)).toBe(true);

    session.close();
  });

  it("resolves a silent segment immediately without opening a connection for it", async () => {
    const provider = new VolcengineSTT(buildConfig({ endpoint: server.endpoint }), logger);
    const session = provider.createSession({ logger });
    const events = collectTranscripts(session);

    await session.connect();
    await waitFor(() => server.connections.length === 1);

    session.commit();

    expect(events.committed).toHaveLength(1);
    expect(events.finals).toEqual([{ segmentId: events.committed[0], transcript: "" }]);
    session.close();
  });

  it("opens a fresh connection for the segment that follows a commit", async () => {
    server.onFrame = ({ frame, socket }) => {
      if (frame.isLast) {
        FakeVolcengineServer.sendResponse(socket, { text: "first", isLast: true });
      }
    };

    const provider = new VolcengineSTT(buildConfig({ endpoint: server.endpoint }), logger);
    const session = provider.createSession({ logger });
    const events = collectTranscripts(session);

    await session.connect();
    await waitFor(() => server.connections[0]?.frames.length === 1);
    session.appendPcm16(buildAudioFrame());
    session.commit();
    await waitFor(() => events.finals.length === 1);

    // A second connection is opened eagerly so the next utterance skips the handshake.
    await waitFor(() => server.connections.length === 2);
    await waitFor(() => server.connections[1].frames.length === 1);
    expect(server.connections[1].frames[0].messageType).toBe(
      VolcengineMessageType.FullClientRequest,
    );

    session.close();
  });

  it("reports a server error frame through the error event", async () => {
    server.onFrame = ({ frame, socket }) => {
      if (frame.messageType === VolcengineMessageType.FullClientRequest) {
        FakeVolcengineServer.sendError(socket, { code: 45000001, message: "invalid app key" });
      }
    };

    const provider = new VolcengineSTT(buildConfig({ endpoint: server.endpoint }), logger);
    const session = provider.createSession({ logger });
    const events = collectTranscripts(session);

    await session.connect();
    await waitFor(() => events.errors.length === 1);
    expect(String(events.errors[0])).toContain("45000001");
    expect(String(events.errors[0])).toContain("invalid app key");

    session.close();
  });

  it("still produces a final transcript when the connection drops mid-finalize", async () => {
    server.onFrame = ({ frame, socket }) => {
      if (frame.messageType !== VolcengineMessageType.AudioOnlyRequest) return;
      if (frame.isLast) {
        // Hang up without a final frame — the stream manager must not be left waiting.
        socket.terminate();
      } else {
        FakeVolcengineServer.sendResponse(socket, { text: "partial only", isLast: false });
      }
    };

    const provider = new VolcengineSTT(buildConfig({ endpoint: server.endpoint }), logger);
    const session = provider.createSession({ logger });
    const events = collectTranscripts(session);

    await session.connect();
    await waitFor(() => server.connections[0]?.frames.length === 1);
    session.appendPcm16(buildAudioFrame());
    await waitFor(() => events.partials.length > 0);
    session.commit();

    await waitFor(() => events.finals.length === 1);
    expect(events.finals[0].transcript).toBe("partial only");

    session.close();
  });

  it("buffers sub-frame audio until a whole frame has accumulated", async () => {
    const provider = new VolcengineSTT(buildConfig({ endpoint: server.endpoint }), logger);
    const session = provider.createSession({ logger });

    await session.connect();
    await waitFor(() => server.connections[0]?.frames.length === 1);

    // A tenth of a frame must not trigger a send of its own.
    session.appendPcm16(Buffer.alloc(buildAudioFrame().length / 10, 1));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(server.connections[0].frames).toHaveLength(1);

    session.appendPcm16(Buffer.alloc((buildAudioFrame().length / 10) * 9, 1));
    await waitFor(() => server.connections[0].frames.length === 2);
    expect(server.connections[0].frames[1].messageType).toBe(
      VolcengineMessageType.AudioOnlyRequest,
    );

    session.close();
  });
});
