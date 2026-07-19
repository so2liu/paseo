import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Text, View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import { inlineUnistylesStyle } from "@/styles/unistyles-inline-style";
import {
  createMermaidRenderRequest,
  parseMermaidWebViewMessage,
  type ThemedMermaidDiagramProps,
} from "./mermaid-diagram-types";

const MIN_DIAGRAM_HEIGHT = 80;

function MermaidDiagramBase({ source, colors }: ThemedMermaidDiagramProps) {
  const { t } = useTranslation();
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(MIN_DIAGRAM_HEIGHT);
  const [document, setDocument] = useState<string | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [isReady, setIsReady] = useState(false);
  const request = useMemo(() => createMermaidRenderRequest({ source, colors }), [colors, source]);

  useEffect(() => {
    let active = true;
    async function loadRenderer() {
      try {
        const { mermaidWebViewHtml } = await import("./mermaid-webview-html");
        if (active) setDocument(mermaidWebViewHtml);
      } catch {
        if (active) setLoadFailed(true);
      }
    }
    void loadRenderer();
    return () => {
      active = false;
    };
  }, []);

  const renderDiagram = useCallback(() => {
    iframeRef.current?.contentWindow?.postMessage(request, "*");
  }, [request]);

  useEffect(() => {
    if (isReady) renderDiagram();
  }, [isReady, renderDiagram]);

  useEffect(() => {
    function handleMessage(event: MessageEvent<unknown>) {
      if (event.source !== iframeRef.current?.contentWindow) return;
      const message = parseMermaidWebViewMessage(event.data);
      if (!message) return;
      if (message.type === "ready") {
        setIsReady(true);
        return;
      }
      if (message.height !== undefined) {
        setHeight(Math.max(MIN_DIAGRAM_HEIGHT, message.height));
      }
    }

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, []);

  const frameStyle = useMemo(
    () =>
      inlineUnistylesStyle({
        width: "100%",
        height,
        borderWidth: 0,
        backgroundColor: "transparent",
      }),
    [height],
  );

  if (loadFailed) {
    return (
      <View style={styles.error}>
        <Text style={styles.errorText}>{t("panels.file.failedToLoadPreview")}</Text>
      </View>
    );
  }

  if (!document) {
    return <View style={styles.container} />;
  }

  return (
    <View style={styles.container}>
      <iframe
        ref={iframeRef}
        title="Mermaid diagram"
        sandbox="allow-scripts"
        srcDoc={document}
        style={frameStyle}
      />
    </View>
  );
}

export const MermaidDiagram = withUnistyles(MermaidDiagramBase, (theme) => ({
  colors: {
    background: theme.colors.surface0,
    surface: theme.colors.surface1,
    foreground: theme.colors.foreground,
    muted: theme.colors.foregroundMuted,
    accent: theme.colors.accent,
    border: theme.colors.border,
  },
}));

const styles = StyleSheet.create((theme) => ({
  container: {
    width: "100%",
    minHeight: MIN_DIAGRAM_HEIGHT,
    marginVertical: theme.spacing[2],
    overflow: "hidden",
  },
  error: {
    minHeight: MIN_DIAGRAM_HEIGHT,
    alignItems: "center",
    justifyContent: "center",
    padding: theme.spacing[3],
    backgroundColor: theme.colors.surface1,
  },
  errorText: {
    color: theme.colors.destructive,
    fontSize: theme.fontSize.sm,
  },
}));
