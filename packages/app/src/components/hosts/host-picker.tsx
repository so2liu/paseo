import { useCallback, useMemo, type ReactElement, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, View } from "react-native";
import type { GestureResponderEvent } from "react-native";
import { ChevronDown, ChevronUp, Plus, Server, Settings } from "lucide-react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { HostStatusDot } from "@/components/host-status-dot";
import { Combobox, ComboboxItem, type ComboboxProps } from "@/components/ui/combobox";
import { useLocalDaemonServerId } from "@/hooks/use-is-local-daemon";
import { useHostRuntimeSnapshot, type ActiveConnection } from "@/runtime/host-runtime";
import { useSidebarOrderStore } from "@/stores/sidebar-order-store";
import { orderHostsLocalFirst } from "@/types/host-connection";
import { orderHostsByPreference, type HostMoveDirection } from "@/utils/host-order";
import {
  ADD_HOST_OPTION_ID,
  ALL_HOSTS_OPTION_ID,
  ENABLE_BUILT_IN_DAEMON_OPTION_ID,
  getHostPickerLabel,
} from "./host-picker-constants";

export {
  ADD_HOST_OPTION_ID,
  ALL_HOSTS_OPTION_ID,
  ENABLE_BUILT_IN_DAEMON_OPTION_ID,
  getHostPickerLabel,
};

const SEARCHABLE_THRESHOLD = 10;
type RenderHostOption = NonNullable<ComboboxProps["renderOption"]>;
interface HostPickerHost {
  serverId: string;
  label: string;
}

export function HostStatusDotSlot({ serverId }: { serverId: string }): ReactElement {
  return (
    <View style={styles.statusDotSlot}>
      <HostStatusDot serverId={serverId} />
    </View>
  );
}

// Standard secure/plain web ports carry no information in the host display, so
// "relay.paseo.sh:443" reads as "relay.paseo.sh" while "127.0.0.1:6767" is kept.
function formatConnectionEndpoint(endpoint: string): string {
  return endpoint.replace(/:(?:443|80)$/, "");
}

// Socket/pipe transports have no host:port — their endpoint is a filesystem
// path, so they read as "Local". TCP and relay show the address being used.
function formatActiveConnectionLabel(connection: ActiveConnection): string {
  if (connection.type === "directSocket" || connection.type === "directPipe") {
    return "Local";
  }
  return formatConnectionEndpoint(connection.endpoint);
}

export interface HostPickerOptionProps {
  serverId: string;
  label: string;
  showActiveConnection: boolean;
  selected?: boolean;
  active: boolean;
  onPress: () => void;
  onOpenHostSettings?: (serverId: string) => void;
  onMoveHost?: (serverId: string, direction: HostMoveDirection) => void;
  canMoveUp?: boolean;
  canMoveDown?: boolean;
  testID?: string;
}

export function HostPickerOption({
  serverId,
  label,
  showActiveConnection,
  selected,
  active,
  onPress,
  onOpenHostSettings,
  onMoveHost,
  canMoveUp = false,
  canMoveDown = false,
  testID,
}: HostPickerOptionProps): ReactElement {
  const { theme } = useUnistyles();
  const { t } = useTranslation();
  const activeConnection = useHostRuntimeSnapshot(serverId)?.activeConnection ?? null;
  const connectionLabel =
    showActiveConnection && activeConnection
      ? formatActiveConnectionLabel(activeConnection)
      : undefined;
  const leadingSlot = useMemo(() => <HostStatusDotSlot serverId={serverId} />, [serverId]);
  const handleSettingsPress = useCallback(
    (event: GestureResponderEvent) => {
      event.stopPropagation();
      onOpenHostSettings?.(serverId);
    },
    [onOpenHostSettings, serverId],
  );
  const handleMoveUp = useCallback(
    (event: GestureResponderEvent) => {
      event.stopPropagation();
      onMoveHost?.(serverId, "up");
    },
    [onMoveHost, serverId],
  );
  const handleMoveDown = useCallback(
    (event: GestureResponderEvent) => {
      event.stopPropagation();
      onMoveHost?.(serverId, "down");
    },
    [onMoveHost, serverId],
  );
  const trailingSlot = useMemo(() => {
    if (!onOpenHostSettings && !onMoveHost) return undefined;
    return (
      <View style={styles.rowActions}>
        {onMoveHost ? (
          <>
            <Pressable
              onPress={handleMoveUp}
              disabled={!canMoveUp}
              hitSlop={8}
              style={!canMoveUp ? styles.reorderButtonDisabled : undefined}
              accessibilityRole="button"
              accessibilityLabel={`${t("settings.host.terminalProfiles.moveUp")}: ${label}`}
            >
              <ChevronUp size={theme.iconSize.sm} color={theme.colors.foregroundMuted} />
            </Pressable>
            <Pressable
              onPress={handleMoveDown}
              disabled={!canMoveDown}
              hitSlop={8}
              style={!canMoveDown ? styles.reorderButtonDisabled : undefined}
              accessibilityRole="button"
              accessibilityLabel={`${t("settings.host.terminalProfiles.moveDown")}: ${label}`}
            >
              <ChevronDown size={theme.iconSize.sm} color={theme.colors.foregroundMuted} />
            </Pressable>
          </>
        ) : null}
        {onOpenHostSettings ? (
          <Pressable
            onPress={handleSettingsPress}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={`Open ${label} settings`}
          >
            <Settings size={theme.iconSize.sm} color={theme.colors.foregroundMuted} />
          </Pressable>
        ) : null}
      </View>
    );
  }, [
    canMoveDown,
    canMoveUp,
    handleMoveDown,
    handleMoveUp,
    handleSettingsPress,
    label,
    onMoveHost,
    onOpenHostSettings,
    t,
    theme.colors.foregroundMuted,
    theme.iconSize.sm,
  ]);

  return (
    <ComboboxItem
      label={label}
      description={connectionLabel}
      leadingSlot={leadingSlot}
      trailingSlot={trailingSlot}
      selected={selected}
      active={active}
      onPress={onPress}
      testID={testID}
    />
  );
}

const SYSTEM_HOST_PICKER_OPTION_LABELS: Record<"add" | "all" | "enableBuiltInDaemon", string> = {
  add: "Add host",
  all: "All hosts",
  enableBuiltInDaemon: "Enable built-in daemon",
};

function SystemHostPickerOption({
  active,
  selected,
  onPress,
  kind,
  testID,
}: {
  active: boolean;
  selected?: boolean;
  onPress: () => void;
  kind: "add" | "all" | "enableBuiltInDaemon";
  testID?: string;
}): ReactElement {
  const { theme } = useUnistyles();
  const Icon = kind === "add" ? Plus : Server;
  const label = SYSTEM_HOST_PICKER_OPTION_LABELS[kind];
  const leadingSlot = useMemo(
    () => <Icon size={theme.iconSize.sm} color={theme.colors.foregroundMuted} />,
    [Icon, theme.colors.foregroundMuted, theme.iconSize.sm],
  );

  return (
    <ComboboxItem
      label={label}
      leadingSlot={leadingSlot}
      selected={selected}
      active={active}
      onPress={onPress}
      testID={testID}
    />
  );
}

export interface HostPickerProps {
  hosts: HostPickerHost[];
  value: string;
  onSelect: (id: string) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  anchorRef: React.RefObject<View | null>;
  includeAllHost?: boolean;
  includeAddHost?: boolean;
  onAddHost?: () => void;
  includeEnableBuiltInDaemon?: boolean;
  onEnableBuiltInDaemon?: () => void;
  showActiveConnection?: boolean;
  onOpenHostSettings?: (serverId: string) => void;
  reorderable?: boolean;
  searchable?: boolean;
  title?: string;
  desktopPlacement?: ComboboxProps["desktopPlacement"];
  desktopMinWidth?: number;
  addHostTestID?: string;
  hostOptionTestID?: (serverId: string) => string;
  children: ReactNode;
}

export function HostPicker({
  hosts,
  value,
  onSelect,
  open,
  onOpenChange,
  anchorRef,
  includeAllHost,
  includeAddHost,
  onAddHost,
  includeEnableBuiltInDaemon,
  onEnableBuiltInDaemon,
  showActiveConnection,
  onOpenHostSettings,
  reorderable = false,
  searchable,
  title,
  desktopPlacement = "bottom-start",
  desktopMinWidth,
  addHostTestID,
  hostOptionTestID,
  children,
}: HostPickerProps): ReactElement {
  const localServerId = useLocalDaemonServerId();
  const hostOrder = useSidebarOrderStore((state) => state.hostOrder);
  const moveHost = useSidebarOrderStore((state) => state.moveHost);
  const defaultOrderedHosts = useMemo(
    () => orderHostsLocalFirst(hosts, localServerId),
    [hosts, localServerId],
  );
  const orderedHosts = useMemo(
    () => orderHostsByPreference(defaultOrderedHosts, hostOrder),
    [defaultOrderedHosts, hostOrder],
  );
  const hostIds = useMemo(() => hosts.map((host) => host.serverId), [hosts]);
  const handleMoveHost = useCallback(
    (serverId: string, direction: HostMoveDirection) => moveHost(hostIds, serverId, direction),
    [hostIds, moveHost],
  );

  const options = useMemo(() => {
    const hostOptions = orderedHosts.map((host) => ({ id: host.serverId, label: host.label }));
    if (includeAllHost) hostOptions.unshift({ id: ALL_HOSTS_OPTION_ID, label: "All hosts" });
    if (includeAddHost) hostOptions.push({ id: ADD_HOST_OPTION_ID, label: "Add host" });
    if (includeEnableBuiltInDaemon)
      hostOptions.push({
        id: ENABLE_BUILT_IN_DAEMON_OPTION_ID,
        label: "Enable built-in daemon",
      });
    return hostOptions;
  }, [orderedHosts, includeAllHost, includeAddHost, includeEnableBuiltInDaemon]);

  const isSearchable = searchable === true && orderedHosts.length > SEARCHABLE_THRESHOLD;

  const handleSelect = useCallback(
    (id: string) => {
      if (id === ADD_HOST_OPTION_ID) {
        onAddHost?.();
      } else if (id === ENABLE_BUILT_IN_DAEMON_OPTION_ID) {
        onEnableBuiltInDaemon?.();
      } else {
        onSelect(id);
      }
      onOpenChange(false);
    },
    [onAddHost, onEnableBuiltInDaemon, onOpenChange, onSelect],
  );

  const handleOpenHostSettings = useCallback(
    (serverId: string) => {
      onOpenHostSettings?.(serverId);
      onOpenChange(false);
    },
    [onOpenHostSettings, onOpenChange],
  );

  const renderOption = useCallback<RenderHostOption>(
    ({ option, selected, active, onPress }) => {
      if (option.id === ADD_HOST_OPTION_ID) {
        return (
          <SystemHostPickerOption
            kind="add"
            active={active}
            onPress={onPress}
            testID={addHostTestID}
          />
        );
      }
      if (option.id === ALL_HOSTS_OPTION_ID) {
        return (
          <SystemHostPickerOption
            kind="all"
            active={active}
            selected={selected}
            onPress={onPress}
          />
        );
      }
      if (option.id === ENABLE_BUILT_IN_DAEMON_OPTION_ID) {
        return (
          <SystemHostPickerOption kind="enableBuiltInDaemon" active={active} onPress={onPress} />
        );
      }
      return (
        <HostPickerOption
          serverId={option.id}
          label={option.label}
          showActiveConnection={showActiveConnection === true}
          selected={selected}
          active={active}
          onPress={onPress}
          onOpenHostSettings={onOpenHostSettings ? handleOpenHostSettings : undefined}
          onMoveHost={reorderable ? handleMoveHost : undefined}
          canMoveUp={orderedHosts[0]?.serverId !== option.id}
          canMoveDown={orderedHosts[orderedHosts.length - 1]?.serverId !== option.id}
          testID={hostOptionTestID?.(option.id)}
        />
      );
    },
    [
      addHostTestID,
      hostOptionTestID,
      onOpenHostSettings,
      showActiveConnection,
      handleOpenHostSettings,
      handleMoveHost,
      orderedHosts,
      reorderable,
    ],
  );

  return (
    <>
      {children}
      <Combobox
        options={options}
        value={value}
        onSelect={handleSelect}
        renderOption={renderOption}
        searchable={isSearchable}
        searchPlaceholder="Search hosts"
        title={title ?? "Host"}
        open={open}
        onOpenChange={onOpenChange}
        anchorRef={anchorRef}
        desktopPlacement={desktopPlacement}
        desktopMinWidth={desktopMinWidth}
      />
    </>
  );
}

const styles = StyleSheet.create((theme) => ({
  statusDotSlot: {
    width: theme.iconSize.sm,
    height: theme.iconSize.sm,
    alignItems: "center",
    justifyContent: "center",
  },
  rowActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  reorderButtonDisabled: {
    opacity: 0.25,
  },
}));
