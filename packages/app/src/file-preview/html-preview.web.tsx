import { useMemo } from "react";
import { createSandboxedHtmlDocument } from "./sandboxed-html-document";

interface HtmlPreviewProps {
  source: string;
}

const FRAME_STYLE = {
  width: "100%",
  height: "100%",
  border: 0,
  display: "block",
  background: "transparent",
} as const;

export function HtmlPreview({ source }: HtmlPreviewProps) {
  const document = useMemo(() => createSandboxedHtmlDocument(source), [source]);
  return (
    <iframe
      title="HTML file preview"
      sandbox=""
      referrerPolicy="no-referrer"
      srcDoc={document}
      style={FRAME_STYLE}
    />
  );
}
