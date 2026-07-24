interface MarkdownToken {
  type: string;
  children?: MarkdownToken[] | null;
}

interface MarkdownParser {
  parse(source: string, environment: object): MarkdownToken[];
}

export interface AssistantMessageSelectionBlockGroup {
  blocks: string[];
  spansSelection: boolean;
}

function isSelectableProseBlock(block: string, parser: MarkdownParser): boolean {
  const tokens = parser.parse(block, {});
  if (
    tokens.length !== 3 ||
    tokens[0]?.type !== "paragraph_open" ||
    tokens[1]?.type !== "inline" ||
    tokens[2]?.type !== "paragraph_close"
  ) {
    return false;
  }
  return !tokens[1].children?.some((token) => token.type === "image");
}

export function groupAssistantMessageSelectionBlocks(input: {
  blocks: string[];
  parser: MarkdownParser;
  enabled: boolean;
}): AssistantMessageSelectionBlockGroup[] {
  if (!input.enabled) {
    return input.blocks.map((block) => ({ blocks: [block], spansSelection: false }));
  }

  const groups: AssistantMessageSelectionBlockGroup[] = [];
  let proseBlocks: string[] = [];

  function flushProseBlocks() {
    if (proseBlocks.length === 0) return;
    groups.push({
      blocks: proseBlocks,
      spansSelection: proseBlocks.length > 1,
    });
    proseBlocks = [];
  }

  for (const block of input.blocks) {
    if (isSelectableProseBlock(block, input.parser)) {
      proseBlocks.push(block);
      continue;
    }
    flushProseBlocks();
    groups.push({ blocks: [block], spansSelection: false });
  }
  flushProseBlocks();

  return groups;
}
