import { normalizeHostPort } from "@getpaseo/protocol/daemon-endpoints";
import { parseConnectionOfferFromUrl } from "@getpaseo/protocol/connection-offer";
import {
  normalizeStoredHostProfile,
  type HostProfile,
  upsertHostConnectionInProfiles,
} from "@/types/host-connection";

const TRANSFER_FORMAT = "paseo-hosts";
const TRANSFER_VERSION = 1;

interface HostTransferDocument {
  format: typeof TRANSFER_FORMAT;
  version: typeof TRANSFER_VERSION;
  hosts: HostProfile[];
}

export function serializeHostTransfer(hosts: HostProfile[]): string {
  const document: HostTransferDocument = {
    format: TRANSFER_FORMAT,
    version: TRANSFER_VERSION,
    hosts,
  };
  return JSON.stringify(document, null, 2);
}

function parseTransferDocument(value: string): HostProfile[] {
  const parsed = JSON.parse(value) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Invalid server transfer data");
  }
  const record = parsed as Record<string, unknown>;
  if (record.format !== TRANSFER_FORMAT || record.version !== TRANSFER_VERSION) {
    throw new Error("Unsupported server transfer format");
  }
  if (!Array.isArray(record.hosts)) {
    throw new Error("Server transfer data has no hosts");
  }

  const hosts = record.hosts
    .map((host) => normalizeStoredHostProfile(host))
    .filter((host): host is HostProfile => host !== null);
  if (hosts.length === 0 && record.hosts.length > 0) {
    throw new Error("No valid servers found");
  }
  return hosts;
}

function parsePairingLinks(value: string, now: string): HostProfile[] {
  const lines = value.split(/\r?\n/);
  let hosts: HostProfile[] = [];

  for (const [index, rawLine] of lines.entries()) {
    const line = rawLine.trim();
    if (!line) continue;

    try {
      const offer = parseConnectionOfferFromUrl(line);
      if (!offer) throw new Error("Missing offer fragment");

      const relayEndpoint = normalizeHostPort(offer.relay.endpoint);
      const useTls = offer.relay.useTls;
      const connectionId =
        useTls === true ? `relay:wss:${relayEndpoint}` : `relay:${relayEndpoint}`;
      hosts = upsertHostConnectionInProfiles({
        profiles: hosts,
        serverId: offer.serverId,
        connection: {
          id: connectionId,
          type: "relay",
          relayEndpoint,
          ...(useTls !== undefined ? { useTls } : {}),
          daemonPublicKeyB64: offer.daemonPublicKeyB64,
        },
        now,
      });
    } catch {
      throw new Error(`Invalid pairing link on line ${index + 1}`);
    }
  }

  if (hosts.length === 0) {
    throw new Error("No valid servers found");
  }
  return hosts;
}

export function parseHostTransfer(value: string, now = new Date().toISOString()): HostProfile[] {
  const trimmed = value.trim();
  if (trimmed.startsWith("{")) {
    return parseTransferDocument(trimmed);
  }
  return parsePairingLinks(trimmed, now);
}
