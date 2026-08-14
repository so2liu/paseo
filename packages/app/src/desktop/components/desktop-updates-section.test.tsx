/**
 * @vitest-environment jsdom
 */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  appVersion: "0.3.1-LY.10",
  daemonStatus: {
    serverId: "local",
    status: "running" as const,
    listen: "127.0.0.1:6767",
    hostname: "mac",
    pid: 1234,
    home: "/tmp/paseo",
    version: "0.3.0+LY" as string | null,
    desktopManaged: true,
    desktopBuildId: "build-7" as string | undefined,
    appBuildId: "build-10" as string | undefined,
    error: null,
  },
  restartDesktopDaemon: vi.fn(),
  setStatus: vi.fn(),
  refetch: vi.fn(),
  manageBuiltInDaemon: true,
}));

vi.mock("react-native", () => ({
  Alert: { alert: vi.fn() },
  Platform: { OS: "web" },
  Text: ({ children, testID }: { children?: React.ReactNode; testID?: string }) =>
    React.createElement("span", { "data-testid": testID }, children),
  View: ({ children, testID }: { children?: React.ReactNode; testID?: string }) =>
    React.createElement("div", { "data-testid": testID }, children),
}));

vi.mock("react-native-unistyles", () => ({
  StyleSheet: {
    create: (factory: unknown) =>
      typeof factory === "function"
        ? (factory as (theme: unknown) => unknown)({
            spacing: { 1: 4, 2: 8, 3: 12, 6: 24 },
            borderRadius: { lg: 8 },
            fontSize: { xs: 11, sm: 13 },
            colors: {
              foreground: "#fff",
              foregroundMuted: "#aaa",
              destructive: "#f44",
              palette: { amber: { 500: "#f90" } },
            },
            iconSize: { sm: 14 },
          })
        : factory,
  },
  useUnistyles: () => ({
    theme: {
      iconSize: { sm: 14 },
      colors: { foreground: "#fff", foregroundMuted: "#aaa" },
    },
  }),
}));

vi.mock("lucide-react-native", () => {
  const icon = () => null;
  return {
    Activity: icon,
    ArrowUpRight: icon,
    Copy: icon,
    FileText: icon,
    RefreshCw: icon,
  };
});

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, string>) => {
      const translations: Record<string, string> = {
        "desktop.daemon.title": "Daemon",
        "desktop.daemon.status.running": "running",
        "desktop.daemon.status.notRunning": "not running",
        "desktop.daemon.status.pid": "PID",
        "desktop.daemon.versionSync.managedHint": "Restart with this app's bundled daemon.",
        "desktop.daemon.versionSync.managedPausedHint":
          "Turn on built-in daemon management, then sync and restart.",
        "desktop.daemon.versionSync.externalHint": "Update the external daemon service.",
        "desktop.daemon.versionSync.action": "Sync and restart",
        "desktop.daemon.versionSync.syncing": "Syncing...",
        "desktop.daemon.versionSync.failed": "Unable to sync daemon: {{message}}",
        "desktop.daemon.versionSync.stillMismatched": "Still mismatched",
      };
      return (translations[key] ?? key).replace("{{message}}", values?.message ?? "");
    },
  }),
}));
vi.mock("@/i18n/i18next", () => ({ i18n: { t: (key: string) => key } }));

vi.mock("@/components/ui/button", () => ({
  Button: ({
    children,
    onPress,
    loading,
    testID,
  }: {
    children?: React.ReactNode;
    onPress?: () => void;
    loading?: boolean;
    testID?: string;
  }) =>
    React.createElement(
      "button",
      { type: "button", "data-testid": testID, disabled: loading, onClick: onPress },
      children,
    ),
}));

vi.mock("@/components/ui/loading-spinner", () => ({ LoadingSpinner: () => null }));
vi.mock("@/components/ui/switch", () => ({ Switch: () => null }));
vi.mock("@/components/adaptive-modal-sheet", () => ({ AdaptiveModalSheet: () => null }));
vi.mock("@/screens/settings/settings-section", () => ({
  SettingsSection: ({ children }: { children?: React.ReactNode }) =>
    React.createElement("section", null, children),
}));
vi.mock("@/styles/settings", () => ({ settingsStyles: {} }));
vi.mock("@/styles/code-surface", () => ({ CODE_SURFACE_DATASET: {} }));
vi.mock("@/utils/open-external-url", () => ({ openExternalUrl: vi.fn() }));
vi.mock("expo-clipboard", () => ({ setStringAsync: vi.fn(async () => undefined) }));

vi.mock("@/desktop/daemon/desktop-daemon", () => ({
  getCliDaemonStatus: vi.fn(async () => ""),
  restartDesktopDaemon: mocks.restartDesktopDaemon,
  shouldUseDesktopDaemon: () => true,
}));
vi.mock("@/desktop/hooks/use-built-in-daemon-management", () => ({
  useBuiltInDaemonManagement: () => ({ isUpdating: false, toggle: vi.fn() }),
}));
vi.mock("@/desktop/hooks/use-daemon-status", () => ({
  useDaemonStatus: () => ({
    data: { status: mocks.daemonStatus, logs: null },
    isLoading: false,
    error: null,
    setStatus: mocks.setStatus,
    refetch: mocks.refetch,
  }),
}));
vi.mock("@/desktop/settings/desktop-settings", () => ({
  useDesktopSettings: () => ({
    settings: {
      daemon: {
        manageBuiltInDaemon: mocks.manageBuiltInDaemon,
        keepRunningAfterQuit: false,
      },
    },
    updateSettings: vi.fn(async () => undefined),
    isLoading: false,
  }),
}));
vi.mock("@/utils/app-version", () => ({ resolveDisplayAppVersion: () => mocks.appVersion }));

import { LocalDaemonSection } from "./desktop-updates-section";

describe("LocalDaemonSection version sync", () => {
  let root: Root;
  let container: HTMLDivElement;
  let queryClient: QueryClient;

  beforeEach(() => {
    vi.stubGlobal("React", React);
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    mocks.appVersion = "0.3.1-LY.10";
    mocks.daemonStatus.version = "0.3.0+LY";
    mocks.daemonStatus.desktopManaged = true;
    mocks.daemonStatus.desktopBuildId = "build-7";
    mocks.daemonStatus.appBuildId = "build-10";
    mocks.manageBuiltInDaemon = true;
    mocks.restartDesktopDaemon.mockReset();
    mocks.setStatus.mockReset();
    mocks.refetch.mockReset();
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    queryClient.clear();
    vi.unstubAllGlobals();
  });

  function render(): void {
    act(() => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <LocalDaemonSection />
        </QueryClientProvider>,
      );
    });
  }

  it("does not warn when the daemon came from the exact Desktop build", () => {
    mocks.daemonStatus.version = "0.3.1+LY";
    mocks.daemonStatus.desktopBuildId = "build-10";

    render();

    expect(container.querySelector('[data-testid="daemon-version-sync-button"]')).toBeNull();
    expect(container.textContent).not.toContain("Restart with this app's bundled daemon.");
  });

  it("warns when a same-base daemon came from an older Desktop build", () => {
    mocks.daemonStatus.version = "0.3.1+LY";
    mocks.daemonStatus.desktopBuildId = "build-7";

    render();

    expect(container.textContent).toContain("Restart with this app's bundled daemon.");
    expect(container.querySelector('[data-testid="daemon-version-sync-button"]')).not.toBeNull();
  });

  it("explains that an externally managed daemon must be updated outside Desktop", () => {
    mocks.daemonStatus.desktopManaged = false;

    render();

    expect(container.textContent).toContain("Update the external daemon service.");
    expect(container.querySelector('[data-testid="daemon-version-sync-button"]')).toBeNull();
  });

  it("explains how to sync when built-in daemon management is paused", () => {
    mocks.manageBuiltInDaemon = false;

    render();

    expect(container.textContent).toContain(
      "Turn on built-in daemon management, then sync and restart.",
    );
    expect(container.querySelector('[data-testid="daemon-version-sync-button"]')).toBeNull();
  });

  it("syncs a genuinely older managed daemon through the warning action", async () => {
    const nextStatus = {
      ...mocks.daemonStatus,
      version: "0.3.1+LY",
      desktopBuildId: "build-10",
      appBuildId: "build-10",
    };
    let finishRestart: ((status: typeof nextStatus) => void) | null = null;
    mocks.restartDesktopDaemon.mockReturnValue(
      new Promise((resolve) => {
        finishRestart = resolve;
      }),
    );
    render();

    const button = container.querySelector<HTMLButtonElement>(
      '[data-testid="daemon-version-sync-button"]',
    );
    expect(button?.textContent).toBe("Sync and restart");

    act(() => button?.click());

    await waitFor(() => {
      expect(button?.textContent).toBe("Syncing...");
      expect(button?.disabled).toBe(true);
    });

    await act(async () => finishRestart?.(nextStatus));

    expect(mocks.restartDesktopDaemon).toHaveBeenCalledTimes(1);
    expect(mocks.setStatus).toHaveBeenCalledWith(nextStatus);
    expect(mocks.refetch).toHaveBeenCalledTimes(1);
  });

  it("keeps a visible retry action and error when synchronization fails", async () => {
    mocks.restartDesktopDaemon.mockRejectedValue(new Error("restart failed"));
    render();

    const button = container.querySelector<HTMLButtonElement>(
      '[data-testid="daemon-version-sync-button"]',
    );
    await act(async () => button?.click());

    await waitFor(() => {
      expect(container.textContent).toContain("Unable to sync daemon: restart failed");
    });
    expect(button?.disabled).toBe(false);
  });
});
