# File preview

The file pane chooses its rendered mode from the file extension. Markdown and HTML render only
when the caller opens the whole file; a line-targeted open keeps using the source-code view so the
requested line can be highlighted.

## Markdown and Mermaid

Markdown files use the shared native Markdown renderer. A fenced block whose first info-string
token is `mermaid` is replaced by `MermaidDiagram`; other fences keep using the normal highlighted
code block.

Mermaid runs locally. The browser build uses a sandboxed iframe, and native uses an isolated
`react-native-webview`. Both load the same generated document:

- source entry: `packages/app/src/file-preview/mermaid-webview-entry.ts`
- generated document: `packages/app/src/file-preview/mermaid-webview-html.ts`
- generator: `npm run build:mermaid-webview --workspace=@getpaseo/app`

Run the generator after changing Mermaid, its WebView entry, or its version. EAS runs it through
the app's `build:webviews` post-install step. Keep Mermaid's `securityLevel` set to `strict`; diagram
source must never be sent to a hosted rendering service.

## HTML

`.html` and `.htm` files render as documents instead of syntax-highlighted source. Previewed HTML
is untrusted workspace content:

- web renders it in an iframe with an empty `sandbox` permission set;
- native disables JavaScript and navigation in `react-native-webview`;
- `createSandboxedHtmlDocument` injects a CSP that blocks scripts, network requests, frames,
  objects, forms, and base-URL changes;
- inline styles and embedded `data:`/`blob:` images, media, and fonts remain available.

Do not add `allow-same-origin`, `allow-scripts`, external resource origins, file access, or app
bridges to the HTML preview. Relative workspace assets are intentionally not resolved by this
initial sandboxed preview.

## File downloads

Browser downloads use a short-lived daemon token and the daemon's HTTP download endpoint. Native
downloads follow the active host transport: relay, socket, and pipe connections reuse the existing
binary WebSocket file channel; direct TCP keeps the HTTP path for streaming efficiency and falls
back to the binary client path if HTTP fails.

On iOS and Android, the downloaded bytes are first written to the app cache and then handed to the
system share sheet. The user chooses a durable destination such as Files from that sheet.
