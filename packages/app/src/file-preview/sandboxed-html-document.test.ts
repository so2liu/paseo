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

  it("keeps a complete source document inside the sandbox wrapper", () => {
    const document = createSandboxedHtmlDocument('<html lang="en"><body>Hello</body></html>');

    expect(document).toContain('<body><html lang="en"><body>Hello</body></html></body>');
    expect(document).toContain("script-src 'none'");
    expect(document).toContain("connect-src 'none'");
  });

  it("wraps an HTML fragment in a complete sandboxed document", () => {
    const document = createSandboxedHtmlDocument("<h1>Hello</h1>");

    expect(document).toMatch(/^<!doctype html><html><head>/);
    expect(document).toContain("<body><h1>Hello</h1></body>");
  });
});
