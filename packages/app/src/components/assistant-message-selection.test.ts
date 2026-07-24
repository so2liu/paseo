import { describe, expect, it } from "vitest";
import MarkdownIt from "markdown-it";
import { groupAssistantMessageSelectionBlocks } from "./assistant-message-selection";

const parser = new MarkdownIt();

describe("assistant message selection blocks", () => {
  it("groups consecutive prose paragraphs into one native selection scope", () => {
    expect(
      groupAssistantMessageSelectionBlocks({
        blocks: ["First paragraph", "Second **paragraph**", "Third paragraph"],
        parser,
        enabled: true,
      }),
    ).toEqual([
      {
        blocks: ["First paragraph", "Second **paragraph**", "Third paragraph"],
        spansSelection: true,
      },
    ]);
  });

  it("keeps non-text blocks outside the shared selection scope", () => {
    expect(
      groupAssistantMessageSelectionBlocks({
        blocks: ["First paragraph", "Second paragraph", "```ts\nconst value = 1;\n```", "After"],
        parser,
        enabled: true,
      }),
    ).toEqual([
      {
        blocks: ["First paragraph", "Second paragraph"],
        spansSelection: true,
      },
      {
        blocks: ["```ts\nconst value = 1;\n```"],
        spansSelection: false,
      },
      {
        blocks: ["After"],
        spansSelection: false,
      },
    ]);
  });

  it("preserves independently rendered blocks when native grouping is disabled", () => {
    expect(
      groupAssistantMessageSelectionBlocks({
        blocks: ["First paragraph", "Second paragraph"],
        parser,
        enabled: false,
      }),
    ).toEqual([
      { blocks: ["First paragraph"], spansSelection: false },
      { blocks: ["Second paragraph"], spansSelection: false },
    ]);
  });
});
