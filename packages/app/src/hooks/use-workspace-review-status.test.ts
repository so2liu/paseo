import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Review completion is explicit: only a user action such as **Mark as done** may
 * clear a workspace's attention. Opening, focusing, typing in, or sending from a
 * workspace must not.
 *
 * This regression has shipped several times, and every time it arrived the same
 * way — someone wired the composer's attention callbacks to something that
 * clears, or added a second clearing path next to the explicit one. Both forms
 * are visible in the source, and neither is visible in a rendered-output test,
 * so this file guards the wiring itself.
 *
 * See CLAUDE.md, "NEVER auto-complete or auto-acknowledge Ready to review".
 */

const SOURCE_ROOT = path.resolve(__dirname, "..");

function listSourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      return listSourceFiles(entryPath);
    }
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [entryPath] : [];
  });
}

function relative(filePath: string): string {
  return path.relative(SOURCE_ROOT, filePath);
}

describe("review completion stays explicit", () => {
  it("clears attention from exactly one place: the explicit Mark as done action", () => {
    const callers = listSourceFiles(SOURCE_ROOT).filter((filePath) =>
      readFileSync(filePath, "utf8").includes("clearWorkspaceAttention("),
    );

    // A new entry here means a second way to complete review appeared. If it is
    // a user action, route it through `useWorkspaceReviewStatus`; if it fires on
    // focus, visibility, or navigation, it is the regression this test exists for.
    expect(callers.map(relative).sort()).toEqual([
      "hooks/use-clear-workspace-attention.ts",
      "hooks/use-workspace-review-status.ts",
    ]);
  });

  it("leaves upstream's unwired clearing hook unwired", () => {
    // `useClearWorkspaceAttention` is dead code upstream ships and neither side
    // calls. It is kept as-is rather than deleted, to avoid a fork-only deletion
    // that re-conflicts on every sync — but the moment something imports it, we
    // have the second clearing path this rule forbids.
    const importers = listSourceFiles(SOURCE_ROOT).filter((filePath) =>
      /useClearWorkspaceAttention|use-clear-workspace-attention/.test(
        readFileSync(filePath, "utf8"),
      ),
    );

    expect(importers.map(relative)).toEqual(["hooks/use-clear-workspace-attention.ts"]);
  });

  it("leaves the composer's attention callbacks inert", () => {
    const panel = readFileSync(path.join(SOURCE_ROOT, "panels/agent-panel.tsx"), "utf8");

    // Upstream binds these to a controller that clears on focus and on send. The
    // fork keeps them inert, so typing into or sending from a workspace under
    // review leaves it under review.
    expect(panel).toContain("onAttentionInputFocus={noopAttentionClear}");
    expect(panel).toContain("onAttentionPromptSend={noopAttentionClear}");
    expect(panel).toMatch(/const noopAttentionClear = \(\) => \{\};/);
  });
});
