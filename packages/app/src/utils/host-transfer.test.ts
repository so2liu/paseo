import { describe, expect, it } from "vitest";
import type { HostProfile } from "@/types/host-connection";
import { parseHostTransfer, serializeHostTransfer } from "./host-transfer";

const host: HostProfile = {
  serverId: "srv_test",
  label: "Mac mini",
  lifecycle: {},
  connections: [
    {
      id: "direct:macmini:6767",
      type: "directTcp",
      endpoint: "macmini:6767",
      useTls: false,
      password: "secret",
    },
  ],
  preferredConnectionId: "direct:macmini:6767",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

describe("host transfer", () => {
  it("round-trips saved host connections", () => {
    expect(parseHostTransfer(serializeHostTransfer([host]))).toEqual([host]);
  });

  it("rejects unknown formats", () => {
    expect(() => parseHostTransfer('{"format":"other","version":1,"hosts":[]}')).toThrow(
      "Unsupported server transfer format",
    );
  });

  it("filters invalid hosts while keeping valid hosts", () => {
    const document = JSON.parse(serializeHostTransfer([host]));
    document.hosts.push({ serverId: "broken", connections: [] });
    expect(parseHostTransfer(JSON.stringify(document))).toEqual([host]);
  });
});
