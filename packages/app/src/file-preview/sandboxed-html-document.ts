const PREVIEW_CONTENT_SECURITY_POLICY = [
  "default-src 'none'",
  "img-src data: blob:",
  "media-src data: blob:",
  "font-src data:",
  "style-src 'unsafe-inline'",
  "script-src 'none'",
  "connect-src 'none'",
  "frame-src 'none'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join("; ");

const SECURITY_META = `<meta http-equiv="Content-Security-Policy" content="${PREVIEW_CONTENT_SECURITY_POLICY}">`;

export function createSandboxedHtmlDocument(source: string): string {
  return `<!doctype html><html><head>${SECURITY_META}</head><body>${source}</body></html>`;
}
