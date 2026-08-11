import { describe, expect, it } from "vitest";
import { workspaceKindLabelKey } from "./workspace-kind-label";

describe("workspaceKindLabelKey", () => {
  it("labels a Paseo-managed worktree as a worktree", () => {
    expect(workspaceKindLabelKey("worktree")).toBe("sidebar.workspace.kind.worktree");
  });

  it("labels both directory-backed kinds as local", () => {
    expect(workspaceKindLabelKey("directory")).toBe("sidebar.workspace.kind.local");
    expect(workspaceKindLabelKey("local_checkout")).toBe("sidebar.workspace.kind.local");
  });

  it("labels a plain checkout as local rather than a worktree", () => {
    expect(workspaceKindLabelKey("checkout")).toBe("sidebar.workspace.kind.local");
  });
});
