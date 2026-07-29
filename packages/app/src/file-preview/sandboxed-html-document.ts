const PREVIEW_CONTENT_SECURITY_POLICY = [
  "default-src * data: blob:",
  "script-src * data: blob: 'unsafe-inline' 'unsafe-eval'",
  "style-src * data: blob: 'unsafe-inline'",
  "img-src * data: blob:",
  "font-src * data: blob:",
  "media-src * data: blob:",
  "connect-src * data: blob:",
  "frame-src * data: blob:",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join("; ");

const SECURITY_META = `<meta http-equiv="Content-Security-Policy" content="${PREVIEW_CONTENT_SECURITY_POLICY}">`;

export function createSandboxedHtmlDocument(source: string): string {
  return `<!doctype html><html><head>${SECURITY_META}</head><body>${source}</body></html>`;
}
