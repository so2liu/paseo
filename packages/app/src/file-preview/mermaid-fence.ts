export function isMermaidFenceLanguage(sourceInfo: string | undefined): boolean {
  return sourceInfo?.trim().split(/\s+/, 1)[0]?.toLowerCase() === "mermaid";
}
