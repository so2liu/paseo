/**
 * @vitest-environment jsdom
 */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { theme, volumeMeterProps } = vi.hoisted(() => ({
  theme: {
    spacing: { 2: 8, 3: 12, 4: 16 },
    iconSize: { sm: 14, md: 18, lg: 24 },
    controlHeight: { field: 44 },
    borderWidth: { 1: 1 },
    borderRadius: { "2xl": 16, full: 999 },
    fontSize: { xs: 11, sm: 13, xl: 20 },
    fontWeight: { normal: "400", semibold: "600" },
    colors: {
      surface0: "#000",
      foreground: "#fff",
      border: "#555",
      accent: "#0a84ff",
      accentForeground: "#fff",
    },
  },
  volumeMeterProps: [] as Array<{ variant?: "default" | "compact" }>,
}));

vi.mock("react-native", () => ({
  Platform: { OS: "web" },
  View: ({ children }: { children?: React.ReactNode }) =>
    React.createElement("div", null, children),
  Text: ({ children }: { children?: React.ReactNode }) =>
    React.createElement("span", null, children),
  Pressable: ({ children }: { children?: React.ReactNode }) =>
    React.createElement("button", { type: "button" }, children),
}));

vi.mock("react-native-unistyles", () => ({
  StyleSheet: {
    create: (factory: unknown) =>
      typeof factory === "function"
        ? (factory as (value: typeof theme) => unknown)(theme)
        : factory,
  },
  useUnistyles: () => ({ theme }),
}));

vi.mock("lucide-react-native", () => {
  const Icon = () => React.createElement("i");
  return {
    X: Icon,
    ArrowUp: Icon,
    RefreshCcw: Icon,
    Check: Icon,
    Mic: Icon,
    Pencil: Icon,
  };
});

vi.mock("@/components/ui/loading-spinner", () => ({
  LoadingSpinner: () => React.createElement("i"),
}));

vi.mock("./volume-meter", () => ({
  VolumeMeter: (props: { variant?: "default" | "compact" }) => {
    volumeMeterProps.push(props);
    return React.createElement("i");
  },
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, params?: { error?: string }) =>
      key === "message.dictation.failed" ? `Failed: ${params?.error}` : key,
  }),
}));

vi.stubGlobal("React", React);
vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);

import { DictationOverlay } from "./dictation-controls";

const callbacks = {
  onCancel: vi.fn(),
  onAccept: vi.fn(),
  onAcceptAndSend: vi.fn(),
};

describe("DictationOverlay", () => {
  let root: Root | null = null;
  let container: HTMLElement | null = null;

  beforeEach(() => {
    volumeMeterProps.length = 0;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root?.unmount());
    root = null;
    container?.remove();
    container = null;
  });

  it("updates the streaming transcript while recording", () => {
    act(() => {
      root?.render(
        <DictationOverlay
          {...callbacks}
          volume={0.5}
          duration={1}
          transcript="first partial"
          isRecording
          isProcessing={false}
          status="recording"
        />,
      );
    });
    expect(container?.textContent).toContain("first partial");

    act(() => {
      root?.render(
        <DictationOverlay
          {...callbacks}
          volume={0.5}
          duration={2}
          transcript="updated partial"
          isRecording
          isProcessing={false}
          status="recording"
        />,
      );
    });
    expect(container?.textContent).not.toContain("first partial");
    expect(container?.textContent).toContain("updated partial");
    expect(volumeMeterProps.at(-1)?.variant).toBe("compact");
  });

  it("does not render a cleared partial after dictation finishes", () => {
    act(() => {
      root?.render(
        <DictationOverlay
          {...callbacks}
          volume={0}
          duration={0}
          transcript=""
          isRecording={false}
          isProcessing={false}
          status="idle"
        />,
      );
    });
    expect(container?.textContent).toBe("");
  });

  it("keeps the full meter when the active overlay has no transcript preview", () => {
    act(() => {
      root?.render(
        <DictationOverlay
          {...callbacks}
          volume={0.5}
          duration={1}
          transcript=""
          isRecording
          isProcessing={false}
          status="recording"
        />,
      );
    });

    expect(volumeMeterProps.at(-1)?.variant).toBe("default");
  });
});
