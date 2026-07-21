import { useCallback, useMemo, type ComponentProps } from "react";
import { WebView } from "react-native-webview";
import { StyleSheet } from "react-native-unistyles";
import { createSandboxedHtmlDocument } from "./sandboxed-html-document";
import { isInlineDocumentNavigation } from "./inline-document-navigation";

interface HtmlPreviewProps {
  source: string;
}

type WebViewProps = ComponentProps<typeof WebView>;

export function HtmlPreview({ source }: HtmlPreviewProps) {
  const document = useMemo(() => ({ html: createSandboxedHtmlDocument(source) }), [source]);
  const handleShouldStartLoad = useCallback<
    NonNullable<WebViewProps["onShouldStartLoadWithRequest"]>
  >((navigation) => isInlineDocumentNavigation(navigation.url), []);

  return (
    <WebView
      source={document}
      style={styles.preview}
      containerStyle={styles.preview}
      originWhitelist={["*"]}
      onShouldStartLoadWithRequest={handleShouldStartLoad}
      javaScriptEnabled={false}
      domStorageEnabled={false}
      incognito
      scrollEnabled
      bounces={false}
      overScrollMode="never"
      automaticallyAdjustContentInsets={false}
      contentInsetAdjustmentBehavior="never"
      allowsLinkPreview={false}
      setSupportMultipleWindows={false}
      mixedContentMode="never"
      allowFileAccess={false}
      allowFileAccessFromFileURLs={false}
      allowUniversalAccessFromFileURLs={false}
    />
  );
}

const styles = StyleSheet.create((theme) => ({
  preview: {
    flex: 1,
    minHeight: 0,
    backgroundColor: theme.colors.surface0,
  },
}));
