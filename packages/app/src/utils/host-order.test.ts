import { describe, expect, it } from "vitest";
import { moveHostInOrder, orderHostsByPreference } from "./host-order";

const hosts = ["a", "b", "c"].map((serverId) => ({ serverId }));

describe("host order", () => {
  it("puts explicitly ordered hosts first and keeps new hosts stable", () => {
    expect(orderHostsByPreference(hosts, ["c", "a"]).map((host) => host.serverId)).toEqual([
      "c",
      "a",
      "b",
    ]);
  });

  it("moves a host relative to the complete visible host list", () => {
    expect(
      moveHostInOrder({
        hostIds: ["a", "b", "c"],
        preferredOrder: ["c"],
        serverId: "b",
        direction: "up",
      }),
    ).toEqual(["c", "b", "a"]);
  });

  it("does not move a host beyond a list boundary", () => {
    expect(
      moveHostInOrder({
        hostIds: ["a", "b"],
        preferredOrder: ["b", "a"],
        serverId: "b",
        direction: "up",
      }),
    ).toEqual(["b", "a"]);
  });
});
