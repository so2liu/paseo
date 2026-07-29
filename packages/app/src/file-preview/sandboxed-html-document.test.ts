import { describe, expect, it } from "vitest";
import { createSandboxedHtmlDocument } from "./sandboxed-html-document";

describe("createSandboxedHtmlDocument", () => {
  it("places the preview policy before a complete source document", () => {
    const document = createSandboxedHtmlDocument(
      "<!doctype html><html><head><title>Preview</title></head><body>Hello</body></html>",
    );

    expect(document).toContain('<meta http-equiv="Content-Security-Policy"');
    expect(document.indexOf("Content-Security-Policy")).toBeLessThan(document.indexOf("<title>"));
  });

  it("allows scripts and external resources inside the sandbox wrapper", () => {
    const document = createSandboxedHtmlDocument('<html lang="en"><body>Hello</body></html>');

    expect(document).toContain('<body><html lang="en"><body>Hello</body></html></body>');
    expect(document).toContain("default-src * data: blob:");
    expect(document).toContain("script-src * data: blob: 'unsafe-inline' 'unsafe-eval'");
    expect(document).toContain("style-src * data: blob: 'unsafe-inline'");
    expect(document).toContain("img-src * data: blob:");
    expect(document).toContain("font-src * data: blob:");
    expect(document).toContain("connect-src * data: blob:");
  });

  it("wraps an HTML fragment in a complete sandboxed document", () => {
    const document = createSandboxedHtmlDocument("<h1>Hello</h1>");

    expect(document).toMatch(/^<!doctype html><html><head>/);
    expect(document).toContain("<body><h1>Hello</h1></body>");
  });
});
