export function isInlineDocumentNavigation(url: string): boolean {
  return url === "about:blank" || url.startsWith("data:text/html");
}
