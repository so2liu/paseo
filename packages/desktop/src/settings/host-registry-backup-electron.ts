import { app } from "electron";
import {
  createHostRegistryBackupStore,
  type HostRegistryBackupStore,
} from "./host-registry-backup.js";

let hostRegistryBackupStore: HostRegistryBackupStore | null = null;

export function getHostRegistryBackupStore(): HostRegistryBackupStore {
  hostRegistryBackupStore ??= createHostRegistryBackupStore({
    userDataPath: app.getPath("userData"),
  });
  return hostRegistryBackupStore;
}
