import { describe, expect, it } from "vitest";
import { isInlineDocumentNavigation } from "./inline-document-navigation";

describe("isInlineDocumentNavigation", () => {
  it("allows the platform URLs used for inline HTML documents", () => {
    expect(isInlineDocumentNavigation("about:blank")).toBe(true);
    expect(isInlineDocumentNavigation("data:text/html;charset=utf-8,hello")).toBe(true);
  });

  it("blocks external and file navigation", () => {
    expect(isInlineDocumentNavigation("https://example.com")).toBe(false);
    expect(isInlineDocumentNavigation("file:///tmp/secret.html")).toBe(false);
  });
});
