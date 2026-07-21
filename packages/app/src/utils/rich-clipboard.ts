import MarkdownIt from "markdown-it";

const markdownRenderer = new MarkdownIt({
  html: false,
  linkify: true,
  typographer: true,
});

// Some rich-text editors import a semantic <code> element as a standalone code
// block, even when Markdown emitted it inline. That changes text around a path
// such as `/root` into three lines when pasted. Keep the monospace treatment but
// use an explicitly inline span so clipboard consumers preserve text flow.
markdownRenderer.renderer.rules.code_inline = (tokens, index) => {
  const content = markdownRenderer.utils.escapeHtml(tokens[index]?.content ?? "");
  return `<span style="display: inline; white-space: pre-wrap; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;">${content}</span>`;
};

type ClipboardMimeType = "text/plain" | "text/html";

export interface MarkdownClipboardContent {
  plainText: string;
  html: string;
}

export interface RichClipboardWriter {
  supportsHtml: () => boolean;
  write: (data: Record<ClipboardMimeType, Blob>) => Promise<void>;
}

export interface MarkdownClipboardEnvironment {
  richWriter?: RichClipboardWriter | null;
  writePlainText: (text: string) => Promise<unknown>;
}

export function createMarkdownClipboardContent(markdown: string): MarkdownClipboardContent {
  return {
    plainText: markdown,
    html: `<meta charset="utf-8">${markdownRenderer.render(markdown)}`,
  };
}

export async function writeMarkdownToRichClipboard(
  markdown: string,
  environment: MarkdownClipboardEnvironment,
): Promise<void> {
  if (environment.richWriter?.supportsHtml()) {
    const content = createMarkdownClipboardContent(markdown);
    try {
      await environment.richWriter.write({
        "text/plain": new Blob([content.plainText], { type: "text/plain" }),
        "text/html": new Blob([content.html], { type: "text/html" }),
      });
      return;
    } catch {
      // Fall through to the plain-text path. Some webviews expose rich clipboard
      // APIs but deny writes depending on focus, permissions, or browser policy.
    }
  }

  await environment.writePlainText(markdown);
}
