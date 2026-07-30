import { useCallback, useEffect, useMemo, useRef, useState, type ComponentProps } from "react";
import { Text, View, type LayoutChangeEvent } from "react-native";
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
import { useMermaidViewport, type MermaidViewportSnapshot } from "./mermaid-viewport-context";

const MERMAID_WEBVIEW_ORIGIN_WHITELIST = ["*"];
const MIN_DIAGRAM_HEIGHT = 80;
const MOUNT_VIEWPORTS = 1;
const UNMOUNT_VIEWPORTS = 2;
const RENDERED_UNMOUNT_VIEWPORTS = 4;

type WebViewProps = ComponentProps<typeof WebView>;

function MermaidDiagramBase({ source, colors }: ThemedMermaidDiagramProps) {
  const { t } = useTranslation();
  const viewport = useMermaidViewport();
  const webViewRef = useRef<WebView>(null);
  const layoutRef = useRef({ y: 0, height: MIN_DIAGRAM_HEIGHT, isMeasured: false });
  const hasRenderedRef = useRef(false);
  const [height, setHeight] = useState(MIN_DIAGRAM_HEIGHT);
  const [isMounted, setIsMounted] = useState(viewport === null);
  const [webViewSource, setWebViewSource] = useState<{ html: string } | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [isReady, setIsReady] = useState(false);
  const request = useMemo(() => createMermaidRenderRequest({ source, colors }), [colors, source]);

  const updateMountState = useCallback(
    (snapshot: MermaidViewportSnapshot) => {
      const layout = layoutRef.current;
      if (!layout.isMeasured || snapshot.viewportHeight === 0) return;

      const distanceAbove = snapshot.scrollY - (layout.y + layout.height);
      const distanceBelow = layout.y - (snapshot.scrollY + snapshot.viewportHeight);
      const distanceFromViewport = Math.max(distanceAbove, distanceBelow, 0);
      const unmountViewports = hasRenderedRef.current
        ? RENDERED_UNMOUNT_VIEWPORTS
        : UNMOUNT_VIEWPORTS;
      const thresholdViewports = isMounted ? unmountViewports : MOUNT_VIEWPORTS;
      const shouldMount = distanceFromViewport <= snapshot.viewportHeight * thresholdViewports;
      if (shouldMount === isMounted) return;
      if (!shouldMount) setIsReady(false);
      setIsMounted(shouldMount);
    },
    [isMounted],
  );

  useEffect(() => {
    if (!viewport) return;
    updateMountState(viewport.getSnapshot());
    return viewport.subscribe(updateMountState);
  }, [updateMountState, viewport]);

  useEffect(() => {
    if (!isMounted) return;
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
  }, [isMounted]);

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
      hasRenderedRef.current = true;
      setHeight(Math.max(MIN_DIAGRAM_HEIGHT, message.height));
    }
  }, []);

  const handleLayout = useCallback(
    (event: LayoutChangeEvent) => {
      const { y, height: layoutHeight } = event.nativeEvent.layout;
      layoutRef.current = { y, height: layoutHeight, isMeasured: true };
      if (viewport) updateMountState(viewport.getSnapshot());
    },
    [updateMountState, viewport],
  );

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

  if (!isMounted || !webViewSource) {
    return <View onLayout={handleLayout} style={[styles.container, dynamicHeight]} />;
  }

  return (
    <View onLayout={handleLayout} style={[styles.container, dynamicHeight]}>
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
        pointerEvents="none"
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
