import { describe, expect, it } from "vitest";
import { isMermaidFenceLanguage } from "./mermaid-fence";

describe("isMermaidFenceLanguage", () => {
  it("detects Mermaid fence info strings", () => {
    expect(isMermaidFenceLanguage("mermaid")).toBe(true);
    expect(isMermaidFenceLanguage(" MERMAID ")).toBe(true);
    expect(isMermaidFenceLanguage("mermaid title=flow")).toBe(true);
  });

  it("leaves other code fences unchanged", () => {
    expect(isMermaidFenceLanguage("typescript")).toBe(false);
    expect(isMermaidFenceLanguage(undefined)).toBe(false);
  });
});
