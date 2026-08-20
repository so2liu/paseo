import type { Page } from "@playwright/test";
import { daemonWsRoutePattern } from "./daemon-port";

const TEST_COMMANDS = [
  {
    name: "tdd",
    description: "Write a red test, verify it fails for the right reason, implement to green",
    argumentHint: "",
  },
  {
    name: "help",
    description: "Show help for the current agent session and available slash commands",
    argumentHint: "",
  },
  {
    name: "hello",
    description: "Insert a friendly greeting prompt into the current composer",
    argumentHint: "",
  },
  {
    name: "heapdump",
    description: "Dump the JavaScript heap for local desktop debugging",
    argumentHint: "",
  },
  {
    name: "health",
    description: "Show runtime health checks and connection diagnostics",
    argumentHint: "",
  },
  {
    name: "history",
    description: "Summarize recent session history",
    argumentHint: "",
  },
  {
    name: "handoff",
    description: "Prepare a complete handoff note for another agent",
    argumentHint: "[agent]",
  },
  {
    name: "hover",
    description: "Audit hover behavior in desktop web surfaces",
    argumentHint: "",
  },
  {
    name: "harness",
    description: "Inspect the local test harness configuration",
    argumentHint: "",
  },
  {
    name: "hydrate",
    description: "Refresh persisted state used by the current workspace",
    argumentHint: "",
  },
  {
    name: "highlight",
    description: "Highlight important changes in the active diff",
    argumentHint: "",
  },
  {
    name: "home",
    description: "Navigate back to the workspace home surface",
    argumentHint: "",
  },
  {
    name: "host",
    description: "Inspect host connection metadata",
    argumentHint: "",
  },
] as const;

export async function installListCommandsStub(page: Page): Promise<void> {
  await page.routeWebSocket(daemonWsRoutePattern(), (ws) => {
    const server = ws.connectToServer();

    ws.onMessage((message) => {
      server.send(message);
    });

    server.onMessage((message) => {
      if (typeof message !== "string") {
        ws.send(message);
        return;
      }

      try {
        const parsed = JSON.parse(message) as {
          type?: string;
          message?: {
            type?: string;
            payload?: {
              commands?: unknown;
              error?: string | null;
            };
          };
        };
        if (
          parsed.type === "session" &&
          parsed.message?.type === "list_commands_response" &&
          parsed.message.payload
        ) {
          parsed.message.payload.commands = TEST_COMMANDS;
          parsed.message.payload.error = null;
          ws.send(JSON.stringify(parsed));
          return;
        }
      } catch {
        // Forward non-JSON frames unchanged.
      }

      ws.send(message);
    });
  });
}
