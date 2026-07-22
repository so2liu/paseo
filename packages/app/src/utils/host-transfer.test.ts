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

  it("parses newline-separated relay pairing links", () => {
    const firstOffer =
      "https://app.paseo.sh/#offer=eyJ2IjoyLCJzZXJ2ZXJJZCI6InNydl9maXJzdCIsImRhZW1vblB1YmxpY0tleUI2NCI6ImZpcnN0LWtleSIsInJlbGF5Ijp7ImVuZHBvaW50IjoicmVsYXkuZXhhbXBsZS5jb206NDQzIiwidXNlVGxzIjp0cnVlfX0";
    const secondOffer =
      "https://app.paseo.sh/#offer=eyJ2IjoyLCJzZXJ2ZXJJZCI6InNydl9zZWNvbmQiLCJkYWVtb25QdWJsaWNLZXlCNjQiOiJzZWNvbmQta2V5IiwicmVsYXkiOnsiZW5kcG9pbnQiOiJyZWxheS5leGFtcGxlLmNvbTo0NDMifX0";

    expect(
      parseHostTransfer(`\n  ${firstOffer}  \n\n${secondOffer}\n`, "2026-07-22T00:00:00.000Z"),
    ).toEqual([
      {
        serverId: "srv_first",
        label: "srv_first",
        lifecycle: {},
        connections: [
          {
            id: "relay:wss:relay.example.com:443",
            type: "relay",
            relayEndpoint: "relay.example.com:443",
            useTls: true,
            daemonPublicKeyB64: "first-key",
          },
        ],
        preferredConnectionId: "relay:wss:relay.example.com:443",
        createdAt: "2026-07-22T00:00:00.000Z",
        updatedAt: "2026-07-22T00:00:00.000Z",
      },
      {
        serverId: "srv_second",
        label: "srv_second",
        lifecycle: {},
        connections: [
          {
            id: "relay:relay.example.com:443",
            type: "relay",
            relayEndpoint: "relay.example.com:443",
            daemonPublicKeyB64: "second-key",
          },
        ],
        preferredConnectionId: "relay:relay.example.com:443",
        createdAt: "2026-07-22T00:00:00.000Z",
        updatedAt: "2026-07-22T00:00:00.000Z",
      },
    ]);
  });

  it("merges duplicate relay links for the same server", () => {
    const offer =
      "https://app.paseo.sh/#offer=eyJ2IjoyLCJzZXJ2ZXJJZCI6InNydl9maXJzdCIsImRhZW1vblB1YmxpY0tleUI2NCI6ImZpcnN0LWtleSIsInJlbGF5Ijp7ImVuZHBvaW50IjoicmVsYXkuZXhhbXBsZS5jb206NDQzIiwidXNlVGxzIjp0cnVlfX0";

    expect(parseHostTransfer(`${offer}\n${offer}`, "2026-07-22T00:00:00.000Z")).toHaveLength(1);
  });

  it("reports the invalid relay link line", () => {
    expect(() => parseHostTransfer("https://app.paseo.sh/#offer=broken")).toThrow(
      "Invalid pairing link on line 1",
    );
  });
});
