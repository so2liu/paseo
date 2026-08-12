import { useCallback, useEffect, useRef } from "react";
import { Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Notifications from "expo-notifications";
import * as Crypto from "expo-crypto";
import Constants from "expo-constants";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import { isWeb } from "@/constants/platform";

const STORAGE_PREFIX = "@paseo:expo-push-token:";
const DEVICE_ID_STORAGE_KEY = "@paseo:push-device-id";

/**
 * Identifies this install to every daemon it registers with, so a rebuild that hands out a
 * fresh Expo token replaces the previous registration instead of adding a second live token
 * for the same phone. It is not per-server: one install is one device everywhere.
 *
 * Installing over an existing app keeps its storage, which is exactly the case that used to
 * accumulate tokens. A full delete-and-reinstall starts a new id, and the token it abandons
 * dies the normal way once Expo reports it unregistered.
 */
async function getOrCreateDeviceId(): Promise<string> {
  const existing = await AsyncStorage.getItem(DEVICE_ID_STORAGE_KEY);
  if (typeof existing === "string" && existing.trim()) {
    return existing.trim();
  }
  const created = Crypto.randomUUID();
  await AsyncStorage.setItem(DEVICE_ID_STORAGE_KEY, created);
  return created;
}

function getExpoProjectId(): string | null {
  const constants = Constants as unknown as {
    easConfig?: { projectId?: unknown };
    expoConfig?: { extra?: { eas?: { projectId?: unknown } } };
  };
  const fromEas = constants?.easConfig?.projectId;
  if (typeof fromEas === "string" && fromEas.trim()) return fromEas.trim();

  const fromExtra = constants?.expoConfig?.extra?.eas?.projectId;
  if (typeof fromExtra === "string" && fromExtra.trim()) return fromExtra.trim();

  return null;
}

async function ensurePushPermission(): Promise<boolean> {
  const existing = await Notifications.getPermissionsAsync();
  if (existing.status === Notifications.PermissionStatus.GRANTED) return true;
  if (!existing.canAskAgain) return false;
  const requested = await Notifications.requestPermissionsAsync();
  return requested.status === Notifications.PermissionStatus.GRANTED;
}

export function usePushTokenRegistration(params: { client: DaemonClient; serverId: string }): void {
  const { client, serverId } = params;
  const tokenRef = useRef<string | null>(null);
  const deviceIdRef = useRef<string | null>(null);
  const lastSentTokenRef = useRef<string | null>(null);

  const registerIfPossible = useCallback(async () => {
    if (isWeb) return;
    if (!client.isConnected) return;
    const token = tokenRef.current;
    if (!token) return;
    if (lastSentTokenRef.current === token) return;
    lastSentTokenRef.current = token;
    client.registerPushToken(token, deviceIdRef.current ?? undefined);
  }, [client]);

  useEffect(() => {
    if (isWeb) return;

    const storageKey = `${STORAGE_PREFIX}${serverId}`;
    let cancelled = false;

    const run = async () => {
      deviceIdRef.current = await getOrCreateDeviceId();
      if (cancelled) return;
      const cached = await AsyncStorage.getItem(storageKey);
      if (cancelled) return;
      if (cached && typeof cached === "string") {
        tokenRef.current = cached;
      }

      const granted = await ensurePushPermission();
      if (!granted || cancelled) return;

      if (Platform.OS === "android") {
        await Notifications.setNotificationChannelAsync("default", {
          name: "default",
          importance: Notifications.AndroidImportance.DEFAULT,
        });
      }

      const projectId = getExpoProjectId();
      if (!projectId) {
        console.warn("[PushToken] Missing EAS projectId; cannot fetch Expo push token");
        return;
      }

      const result = await Notifications.getExpoPushTokenAsync({ projectId });
      if (cancelled) return;

      const token = result.data;
      if (typeof token !== "string" || !token.trim()) return;

      tokenRef.current = token;
      await AsyncStorage.setItem(storageKey, token);
      await registerIfPossible();
    };

    void run().catch((error) => {
      console.warn("[PushToken] Failed to register push token", error);
    });

    return () => {
      cancelled = true;
    };
  }, [registerIfPossible, serverId]);

  useEffect(() => {
    const unsubscribe = client.subscribeConnectionStatus((state) => {
      if (state.status === "connected") {
        void registerIfPossible();
      } else {
        // Re-register on the next successful connect.
        lastSentTokenRef.current = null;
      }
    });
    if (client.isConnected) {
      void registerIfPossible();
    }
    return unsubscribe;
  }, [client, registerIfPossible]);
}
