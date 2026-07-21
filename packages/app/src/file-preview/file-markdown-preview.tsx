import type { ReactNode } from "react";
import type { ASTNode, RenderRules } from "react-native-markdown-display";
import { MarkdownRenderer, createSharedMarkdownRules } from "@/components/markdown/renderer";
import { MermaidDiagram } from "./mermaid-diagram";
import { isMermaidFenceLanguage } from "./mermaid-fence";

const sharedMarkdownRules = createSharedMarkdownRules();
const sharedFenceRule = sharedMarkdownRules.fence;
if (!sharedFenceRule) {
  throw new Error("Shared Markdown renderer must define a fence rule");
}

const fileMarkdownRules: RenderRules = {
  ...sharedMarkdownRules,
  fence: (node: ASTNode, children: ReactNode[], parent: ASTNode[], styles, inheritedStyles) => {
    if (isMermaidFenceLanguage(node.sourceInfo)) {
      return <MermaidDiagram key={node.key} source={node.content ?? ""} />;
    }
    return sharedFenceRule(node, children, parent, styles, inheritedStyles);
  },
};

export function FileMarkdownPreview({ source }: { source: string }) {
  return <MarkdownRenderer text={source} rules={fileMarkdownRules} />;
}
