import { normalizeStoredHostProfile, type HostProfile } from "@/types/host-connection";

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

export function parseHostTransfer(value: string): HostProfile[] {
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
