export interface MermaidDiagramColors {
  background: string;
  surface: string;
  foreground: string;
  muted: string;
  accent: string;
  border: string;
}

export interface MermaidDiagramProps {
  source: string;
}

export interface ThemedMermaidDiagramProps extends MermaidDiagramProps {
  colors: MermaidDiagramColors;
}

export interface MermaidWebViewMessage {
  channel: "paseo-mermaid";
  type: "ready" | "rendered" | "error";
  height?: number;
  message?: string;
}

export function createMermaidRenderRequest(input: ThemedMermaidDiagramProps) {
  return { type: "render" as const, source: input.source, colors: input.colors };
}

export function parseMermaidWebViewMessage(value: unknown): MermaidWebViewMessage | null {
  if (!value || typeof value !== "object") return null;
  if (!("channel" in value) || value.channel !== "paseo-mermaid") return null;
  if (!("type" in value)) return null;
  if (value.type !== "ready" && value.type !== "rendered" && value.type !== "error") return null;

  const height = "height" in value && typeof value.height === "number" ? value.height : undefined;
  const message =
    "message" in value && typeof value.message === "string" ? value.message : undefined;
  return { channel: "paseo-mermaid", type: value.type, height, message };
}
