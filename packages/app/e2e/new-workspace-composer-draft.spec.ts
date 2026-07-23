import { expect, test } from "./fixtures";
import { waitForConnectedHost } from "./helpers/add-project-flow";
import { gotoAppShell } from "./helpers/app";
import { getE2EDaemonPort } from "./helpers/daemon-port";
import { startIsolatedHostDaemon } from "./helpers/isolated-host-daemon";
import {
  expectNewWorkspaceDraft,
  expectNewWorkspaceProjectSelected,
  fillNewWorkspaceDraft,
  openGlobalNewWorkspaceComposer,
  openNewWorkspaceComposer,
  selectNewWorkspaceHost,
  selectNewWorkspaceProject,
} from "./helpers/new-workspace";
import { connectSeedClient, seedWorkspace, type SeededWorkspace } from "./helpers/seed-client";
import { getServerId } from "./helpers/server-id";
import { seedSavedSettingsHosts } from "./helpers/settings";
import { waitForSidebarHydration } from "./helpers/workspace-ui";

const DRAFT = `Please investigate the workspace startup failure.

Trace the request from the app through the daemon, preserve the existing behavior, and explain the root cause before making changes.`;

test.describe("New workspace composer draft", () => {
  test.describe.configure({ timeout: 240_000 });

  test("keeps the draft when the project changes", async ({ page }) => {
    const firstProject: SeededWorkspace = await seedWorkspace({
      repoPrefix: "new-workspace-draft-project-a-",
    });
    const secondProject: SeededWorkspace = await seedWorkspace({
      repoPrefix: "new-workspace-draft-project-b-",
    });

    try {
      await gotoAppShell(page);
      await waitForSidebarHydration(page);
      await openNewWorkspaceComposer(page, {
        projectKey: firstProject.projectId,
        projectDisplayName: firstProject.projectDisplayName,
      });
      await expectNewWorkspaceProjectSelected(page, firstProject.projectDisplayName);

      await fillNewWorkspaceDraft(page, DRAFT);

      await selectNewWorkspaceProject(page, {
        projectKey: secondProject.projectId,
        projectDisplayName: secondProject.projectDisplayName,
      });

      await expectNewWorkspaceDraft(page, DRAFT);
    } finally {
      await secondProject.cleanup();
      await firstProject.cleanup();
    }
  });

  test("keeps the draft when the host changes", async ({ page }) => {
    const project: SeededWorkspace = await seedWorkspace({
      repoPrefix: "new-workspace-draft-host-",
    });
    const secondaryServerId = "new-workspace-draft-secondary-host";

    try {
      await seedSavedSettingsHosts(page, [
        {
          serverId: getServerId(),
          label: "Primary host",
          endpoint: `127.0.0.1:${getE2EDaemonPort()}`,
        },
        {
          serverId: secondaryServerId,
          label: "Secondary host",
          endpoint: "127.0.0.1:9",
        },
      ]);

      await gotoAppShell(page);
      await waitForSidebarHydration(page);
      await openGlobalNewWorkspaceComposer(page);

      await fillNewWorkspaceDraft(page, DRAFT);
      await selectNewWorkspaceHost(page, "Secondary host");

      await expectNewWorkspaceDraft(page, DRAFT);
    } finally {
      await project.cleanup();
    }
  });

  test("keeps the explicitly selected host when the project changes", async ({ page }) => {
    const firstProject = await seedWorkspace({
      repoPrefix: "new-workspace-host-priority-a-",
    });
    const targetProject = await seedWorkspace({
      repoPrefix: "new-workspace-host-priority-b-",
    });
    const secondaryServerId = "new-workspace-host-priority-secondary";
    const secondaryHost = await startIsolatedHostDaemon(secondaryServerId);
    const secondaryClient = await connectSeedClient({ port: secondaryHost.port });
    let secondaryProjectId: string | null = null;

    try {
      await secondaryClient.connect();
      const secondaryWorkspace = await secondaryClient.createWorkspace({
        source: { kind: "directory", path: targetProject.repoPath },
      });
      expect(secondaryWorkspace.workspace).not.toBeNull();
      secondaryProjectId = secondaryWorkspace.workspace?.projectId ?? null;

      await seedSavedSettingsHosts(page, [
        {
          serverId: getServerId(),
          label: "Primary host",
          endpoint: `127.0.0.1:${getE2EDaemonPort()}`,
        },
        {
          serverId: secondaryServerId,
          label: "Secondary host",
          endpoint: `127.0.0.1:${secondaryHost.port}`,
        },
      ]);
      await gotoAppShell(page);
      await waitForConnectedHost(page, {
        serverId: secondaryServerId,
        endpoint: `localhost:${secondaryHost.port}`,
      });
      await waitForSidebarHydration(page);
      await openNewWorkspaceComposer(page, {
        projectKey: firstProject.projectId,
        projectDisplayName: firstProject.projectDisplayName,
      });

      await selectNewWorkspaceHost(page, "Secondary host");
      await selectNewWorkspaceHost(page, "Primary host");
      await selectNewWorkspaceProject(page, {
        projectKey: targetProject.projectId,
        projectDisplayName: targetProject.projectDisplayName,
      });

      await expect(page.getByTestId("host-picker-trigger")).toContainText("Primary host");
    } finally {
      if (secondaryProjectId) {
        await secondaryClient.removeProject(secondaryProjectId).catch(() => undefined);
      }
      await secondaryClient.close().catch(() => undefined);
      await secondaryHost.close().catch(() => undefined);
      await targetProject.cleanup();
      await firstProject.cleanup();
    }
  });
});
