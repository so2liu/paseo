import { useCallback, useMemo, useState } from "react";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet } from "react-native-unistyles";
import { Button } from "@/components/ui/button";
import { useHostMutations } from "@/runtime/host-runtime";
import { parseHostTransfer } from "@/utils/host-transfer";
import { AdaptiveModalSheet, AdaptiveTextInput, type SheetHeader } from "./adaptive-modal-sheet";

const FLEX_ONE_STYLE = { flex: 1 } as const;

export function HostTransferModal({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const { importHosts } = useHostMutations();
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const header = useMemo<SheetHeader>(
    () => ({ title: t("settings.serverMigration.importTitle") }),
    [t],
  );

  const close = useCallback(() => {
    setValue("");
    setError(null);
    onClose();
  }, [onClose]);

  const handleImport = useCallback(async () => {
    try {
      setIsImporting(true);
      setError(null);
      const hosts = parseHostTransfer(value.trim());
      await importHosts(hosts);
      close();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t("settings.serverMigration.invalid"));
    } finally {
      setIsImporting(false);
    }
  }, [close, importHosts, t, value]);
  const handleImportPress = useCallback(() => {
    void handleImport();
  }, [handleImport]);

  return (
    <AdaptiveModalSheet
      header={header}
      visible={visible}
      onClose={close}
      testID="host-transfer-modal"
    >
      <Text style={styles.helper}>{t("settings.serverMigration.importHelp")}</Text>
      <AdaptiveTextInput
        value={value}
        onChangeText={setValue}
        placeholder={t("settings.serverMigration.placeholder")}
        multiline
        autoCapitalize="none"
        autoCorrect={false}
        style={styles.input}
        testID="host-transfer-input"
      />
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <View style={styles.actions}>
        <Button style={FLEX_ONE_STYLE} variant="secondary" onPress={close} disabled={isImporting}>
          {t("common.cancel")}
        </Button>
        <Button
          style={FLEX_ONE_STYLE}
          onPress={handleImportPress}
          disabled={isImporting || !value.trim()}
          testID="host-transfer-submit"
        >
          {isImporting
            ? t("settings.serverMigration.importing")
            : t("settings.serverMigration.importAction")}
        </Button>
      </View>
    </AdaptiveModalSheet>
  );
}

const styles = StyleSheet.create((theme) => ({
  helper: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
  input: {
    minHeight: 220,
    backgroundColor: theme.colors.surface2,
    borderRadius: theme.borderRadius.lg,
    borderWidth: 1,
    borderColor: theme.colors.border,
    color: theme.colors.foreground,
    padding: theme.spacing[3],
    textAlignVertical: "top",
    fontFamily: "monospace",
  },
  error: { color: theme.colors.destructive, fontSize: theme.fontSize.sm },
  actions: { flexDirection: "row", gap: theme.spacing[3] },
}));
