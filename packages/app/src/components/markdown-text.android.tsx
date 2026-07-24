import { createContext, useContext, useMemo, type ReactNode } from "react";
import {
  Text,
  View,
  type StyleProp,
  type TextProps,
  type TextStyle,
  type ViewStyle,
} from "react-native";

interface MarkdownTextSpanProps {
  style?: StyleProp<TextStyle>;
  monoSurface?: boolean;
  children: ReactNode;
  onPress?: TextProps["onPress"];
  accessibilityRole?: TextProps["accessibilityRole"];
}

const MarkdownDocumentSelectionContext = createContext(false);

export function MarkdownDocumentView({ children }: { children: ReactNode }) {
  return (
    <MarkdownDocumentSelectionContext value>
      <Text selectable>{children}</Text>
    </MarkdownDocumentSelectionContext>
  );
}

export function MarkdownBodyView({
  bodyStyle,
  children,
}: {
  bodyStyle: ViewStyle;
  children: ReactNode;
}) {
  const isDocumentSelection = useContext(MarkdownDocumentSelectionContext);
  if (isDocumentSelection) {
    return children;
  }
  return <View style={bodyStyle}>{children}</View>;
}

// Android's <Text selectable> enables per-text-node selection natively.
// MarkdownDocumentView provides one shared ancestor for consecutive prose
// paragraphs; standalone rich blocks keep their own selection scope. onPress
// works natively here, so links routed through this span stay tappable.
export function MarkdownTextSpan({
  style,
  children,
  onPress,
  accessibilityRole,
}: MarkdownTextSpanProps) {
  return (
    <Text selectable style={style} onPress={onPress} accessibilityRole={accessibilityRole}>
      {children}
    </Text>
  );
}

interface MarkdownParagraphViewProps {
  paragraphStyle: ViewStyle;
  containsImage?: boolean;
  children: ReactNode;
}

const MARKDOWN_PARAGRAPH_RESET: ViewStyle = {};

// Paragraph stays a <View>, not a <Text>, for layout fidelity. RN Android's
// text engine *does* accept inline View children (TextInlineViewPlaceholderSpan
// in ReactBaseTextShadowNode), so this isn't a crash-avoidance choice — but
// inline-placeholder spans collapse block-level children (e.g. paragraph
// images) into one-character placeholders, which destroys image row layout.
// <View> preserves the original block layout. Consecutive prose takes the
// document-selection branch above, where nested Text nodes share one scope.
export function MarkdownParagraphView({ paragraphStyle, children }: MarkdownParagraphViewProps) {
  const isDocumentSelection = useContext(MarkdownDocumentSelectionContext);
  const style = useMemo(() => [paragraphStyle, MARKDOWN_PARAGRAPH_RESET], [paragraphStyle]);
  if (isDocumentSelection) {
    return <Text style={style}>{children}</Text>;
  }
  return <View style={style}>{children}</View>;
}
