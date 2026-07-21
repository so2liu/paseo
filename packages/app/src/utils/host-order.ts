export type HostMoveDirection = "up" | "down";

function normalizeIds(ids: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const rawId of ids) {
    const id = rawId.trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    result.push(id);
  }
  return result;
}

export function orderHostsByPreference<T extends { serverId: string }>(
  hosts: readonly T[],
  preferredOrder: readonly string[],
): T[] {
  const hostById = new Map(hosts.map((host) => [host.serverId, host] as const));
  const ordered = normalizeIds(preferredOrder).flatMap((serverId) => {
    const host = hostById.get(serverId);
    if (!host) return [];
    hostById.delete(serverId);
    return [host];
  });
  for (const host of hosts) {
    if (!hostById.has(host.serverId)) continue;
    ordered.push(host);
    hostById.delete(host.serverId);
  }
  return ordered;
}

export function moveHostInOrder(input: {
  hostIds: readonly string[];
  preferredOrder: readonly string[];
  serverId: string;
  direction: HostMoveDirection;
}): string[] {
  const ordered = orderHostsByPreference(
    normalizeIds(input.hostIds).map((serverId) => ({ serverId })),
    input.preferredOrder,
  ).map((host) => host.serverId);
  const index = ordered.indexOf(input.serverId);
  if (index < 0) return ordered;
  const targetIndex = input.direction === "up" ? index - 1 : index + 1;
  if (targetIndex < 0 || targetIndex >= ordered.length) return ordered;
  const target = ordered[targetIndex];
  if (!target) return ordered;
  ordered[targetIndex] = input.serverId;
  ordered[index] = target;
  return ordered;
}
