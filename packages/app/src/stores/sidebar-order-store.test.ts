import { describe, expect, it } from "vitest";
import { migrateSidebarOrderState } from "./sidebar-order-store";

describe("migrateSidebarOrderState", () => {
  it("prefixes legacy per-server workspace order with the source server id", () => {
    const migrated = migrateSidebarOrderState({
      projectOrderByServerId: {
        "host-a": ["project-a"],
        "host-b": ["project-a"],
      },
      workspaceOrderByServerAndProject: {
        "host-a::project-a": ["main", "feature"],
        "host-b::project-a": ["main"],
      },
    });

    expect(migrated).toEqual({
      hostOrder: [],
      projectOrder: ["project-a"],
      workspaceOrderByProject: {
        "project-a": ["host-a:main", "host-a:feature", "host-b:main"],
      },
    });
  });

  it("preserves a stored host order", () => {
    expect(migrateSidebarOrderState({ hostOrder: ["host-b", "host-a", "host-b", ""] })).toEqual({
      hostOrder: ["host-b", "host-a"],
      projectOrder: [],
      workspaceOrderByProject: {},
    });
  });
});
