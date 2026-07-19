import mermaid from "mermaid";

interface MermaidRenderColors {
  background: string;
  surface: string;
  foreground: string;
  muted: string;
  accent: string;
  border: string;
}

interface MermaidRenderRequest {
  type: "render";
  source: string;
  colors: MermaidRenderColors;
}

interface MermaidRenderEvent {
  channel: "paseo-mermaid";
  type: "ready" | "rendered" | "error";
  height?: number;
  message?: string;
}

declare global {
  interface Window {
    ReactNativeWebView?: { postMessage?: (message: string) => void };
    __PASEO_MERMAID_RENDER__?: (request: MermaidRenderRequest) => Promise<void>;
  }
}

const root = document.createElement("div");
root.id = "mermaid-root";
document.body.appendChild(root);

const style = document.createElement("style");
style.textContent = `
html, body {
  width: 100%;
  min-height: 1px;
  margin: 0;
  padding: 0;
  overflow: hidden;
  background: transparent;
}
#mermaid-root {
  width: 100%;
  box-sizing: border-box;
  overflow: hidden;
}
#mermaid-root svg {
  display: block;
  max-width: 100%;
  height: auto;
  margin: 0 auto;
}
#mermaid-root pre {
  margin: 0;
  padding: 12px;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  font: 12px/1.45 ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
}
`;
document.head.appendChild(style);

function publish(event: Omit<MermaidRenderEvent, "channel">) {
  const message: MermaidRenderEvent = { channel: "paseo-mermaid", ...event };
  window.ReactNativeWebView?.postMessage?.(JSON.stringify(message));
  if (window.parent !== window) {
    window.parent.postMessage(message, "*");
  }
}

function measureHeight(): number {
  return Math.max(80, Math.ceil(root.getBoundingClientRect().height));
}

function hasStringFields(value: object, fields: readonly string[]): boolean {
  for (const field of fields) {
    if (!(field in value)) return false;
    const fieldValue: unknown = Reflect.get(value, field);
    if (typeof fieldValue !== "string") return false;
  }
  return true;
}

function isRenderRequest(value: unknown): value is MermaidRenderRequest {
  if (!value || typeof value !== "object") return false;
  if (!("type" in value) || value.type !== "render") return false;
  if (!("source" in value) || typeof value.source !== "string") return false;
  if (!("colors" in value) || !value.colors || typeof value.colors !== "object") return false;
  return hasStringFields(value.colors, [
    "background",
    "surface",
    "foreground",
    "muted",
    "accent",
    "border",
  ]);
}

let renderSequence = 0;
window.__PASEO_MERMAID_RENDER__ = async (request) => {
  if (!isRenderRequest(request)) return;
  const sequence = ++renderSequence;
  const { colors } = request;
  root.style.color = colors.foreground;
  root.replaceChildren();
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: "strict",
    suppressErrorRendering: true,
    theme: "base",
    themeVariables: {
      background: colors.background,
      primaryColor: colors.surface,
      primaryTextColor: colors.foreground,
      primaryBorderColor: colors.border,
      lineColor: colors.muted,
      secondaryColor: colors.background,
      tertiaryColor: colors.surface,
      textColor: colors.foreground,
      mainBkg: colors.surface,
      nodeBorder: colors.border,
      clusterBkg: colors.background,
      clusterBorder: colors.border,
      edgeLabelBackground: colors.background,
      actorBkg: colors.surface,
      actorBorder: colors.border,
      actorTextColor: colors.foreground,
      signalColor: colors.foreground,
      signalTextColor: colors.foreground,
      labelBoxBkgColor: colors.surface,
      labelBoxBorderColor: colors.border,
      labelTextColor: colors.foreground,
      noteBkgColor: colors.surface,
      noteBorderColor: colors.accent,
      noteTextColor: colors.foreground,
    },
  });

  try {
    const rendered = await mermaid.render(`paseo-mermaid-${sequence}`, request.source);
    if (sequence !== renderSequence) return;
    root.innerHTML = rendered.svg;
    rendered.bindFunctions?.(root);
    requestAnimationFrame(() => publish({ type: "rendered", height: measureHeight() }));
  } catch (error) {
    if (sequence !== renderSequence) return;
    const message = error instanceof Error ? error.message : String(error);
    const failure = document.createElement("pre");
    failure.textContent = message;
    failure.style.color = colors.foreground;
    failure.style.background = colors.surface;
    root.replaceChildren(failure);
    requestAnimationFrame(() => publish({ type: "error", message, height: measureHeight() }));
  }
};

window.addEventListener("message", (event) => {
  if (isRenderRequest(event.data)) {
    void window.__PASEO_MERMAID_RENDER__?.(event.data);
  }
});

publish({ type: "ready" });
