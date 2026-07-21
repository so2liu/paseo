import { useCallback, useEffect, useMemo, useRef, useState, type ComponentProps } from "react";
import { Text, View } from "react-native";
import { WebView, type WebViewMessageEvent } from "react-native-webview";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import { inlineUnistylesStyle } from "@/styles/unistyles-inline-style";
import {
  createMermaidRenderRequest,
  parseMermaidWebViewMessage,
  type ThemedMermaidDiagramProps,
} from "./mermaid-diagram-types";
import { isInlineDocumentNavigation } from "./inline-document-navigation";

const MERMAID_WEBVIEW_ORIGIN_WHITELIST = ["*"];
const MIN_DIAGRAM_HEIGHT = 80;

type WebViewProps = ComponentProps<typeof WebView>;

function MermaidDiagramBase({ source, colors }: ThemedMermaidDiagramProps) {
  const { t } = useTranslation();
  const webViewRef = useRef<WebView>(null);
  const [height, setHeight] = useState(MIN_DIAGRAM_HEIGHT);
  const [webViewSource, setWebViewSource] = useState<{ html: string } | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [isReady, setIsReady] = useState(false);
  const request = useMemo(() => createMermaidRenderRequest({ source, colors }), [colors, source]);

  useEffect(() => {
    let active = true;
    async function loadRenderer() {
      try {
        const { mermaidWebViewHtml } = await import("./mermaid-webview-html");
        if (active) setWebViewSource({ html: mermaidWebViewHtml });
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
    webViewRef.current?.injectJavaScript(
      `window.__PASEO_MERMAID_RENDER__?.(${JSON.stringify(request)}); true;`,
    );
  }, [request]);

  useEffect(() => {
    if (isReady) renderDiagram();
  }, [isReady, renderDiagram]);

  const handleMessage = useCallback((event: WebViewMessageEvent) => {
    let decoded: unknown;
    try {
      decoded = JSON.parse(event.nativeEvent.data);
    } catch {
      return;
    }
    const message = parseMermaidWebViewMessage(decoded);
    if (!message) return;
    if (message.type === "ready") {
      setIsReady(true);
      return;
    }
    if (message.height !== undefined) {
      setHeight(Math.max(MIN_DIAGRAM_HEIGHT, message.height));
    }
  }, []);

  const handleShouldStartLoad = useCallback<
    NonNullable<WebViewProps["onShouldStartLoadWithRequest"]>
  >((navigation) => isInlineDocumentNavigation(navigation.url), []);

  const dynamicHeight = useMemo(() => inlineUnistylesStyle({ height }), [height]);

  if (loadFailed) {
    return (
      <View style={styles.error}>
        <Text style={styles.errorText}>{t("panels.file.failedToLoadPreview")}</Text>
      </View>
    );
  }

  if (!webViewSource) {
    return <View style={[styles.container, dynamicHeight]} />;
  }

  return (
    <View style={[styles.container, dynamicHeight]}>
      <WebView
        ref={webViewRef}
        source={webViewSource}
        style={styles.webView}
        containerStyle={styles.webView}
        originWhitelist={MERMAID_WEBVIEW_ORIGIN_WHITELIST}
        onShouldStartLoadWithRequest={handleShouldStartLoad}
        onMessage={handleMessage}
        javaScriptEnabled
        domStorageEnabled={false}
        incognito
        scrollEnabled={false}
        bounces={false}
        overScrollMode="never"
        automaticallyAdjustContentInsets={false}
        contentInsetAdjustmentBehavior="never"
        allowsLinkPreview={false}
        setSupportMultipleWindows={false}
        mixedContentMode="never"
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
  webView: {
    flex: 1,
    backgroundColor: "transparent",
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
