import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Linking,
  Platform,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";

import WhatsAppStickers, { type StickerPackInput } from "../../modules/whatsapp-stickers/src";
import { PackCard } from "../components/PackCard";
import { LINKS, fetchPacks } from "../packs";
import { colors, radius } from "../theme";

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; packs: StickerPackInput[] };

export function HomeScreen() {
  const insets = useSafeAreaInsets();
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [refreshing, setRefreshing] = useState(false);
  const [whatsappInstalled, setWhatsappInstalled] = useState<boolean | null>(null);
  const [addingId, setAddingId] = useState<string | null>(null);
  const [addedIds, setAddedIds] = useState<Record<string, boolean>>({});

  const load = useCallback(async () => {
    try {
      const packs = await fetchPacks();
      setState({ status: "ready", packs });
      // Android can ask WhatsApp which packs are already installed; iOS cannot.
      if (Platform.OS === "android") {
        const entries = await Promise.all(
          packs.map(async (p) => [p.identifier, await WhatsAppStickers.isStickerPackAdded(p.identifier).catch(() => null)] as const),
        );
        setAddedIds(Object.fromEntries(entries.filter(([, v]) => v === true).map(([id]) => [id, true] as const)));
      }
    } catch (e) {
      setState({ status: "error", message: e instanceof Error ? e.message : String(e) });
    }
  }, []);

  useEffect(() => {
    void load();
    WhatsAppStickers.isWhatsAppAvailable().then(setWhatsappInstalled).catch(() => setWhatsappInstalled(false));
  }, [load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  const onAdd = useCallback(async (pack: StickerPackInput) => {
    setAddingId(pack.identifier);
    try {
      const result = await WhatsAppStickers.addStickerPack(pack);
      if (result.status === "added") {
        setAddedIds((prev) => ({ ...prev, [pack.identifier]: true }));
        Alert.alert("Added to WhatsApp", "Open WhatsApp and tap the sticker icon to start using them.");
      }
    } catch (e) {
      Alert.alert("Could not add stickers", e instanceof Error ? e.message : String(e));
    } finally {
      setAddingId(null);
    }
  }, []);

  const nativeReady = WhatsAppStickers.isNativeModuleAvailable();
  const canAdd = nativeReady && whatsappInstalled === true;

  const header = (
    <View>
      <Text style={styles.title}>BH Stickers</Text>
      <Text style={styles.subtitle}>Torah stickers from BeEzrat HaShem for WhatsApp. Tap a pack to add it.</Text>
      {whatsappInstalled === false && (
        <Notice icon="alert-circle" text="WhatsApp is not installed on this phone. Install it to add sticker packs." />
      )}
      {!nativeReady && <Notice icon="alert-circle" text="This build is missing the WhatsApp module. Please reinstall the app." />}
    </View>
  );

  const footer = (
    <View style={styles.footer}>
      <Text style={styles.footerTitle}>BeEzrat HaShem</Text>
      <LinkRow icon="globe" label="Website" onPress={() => Linking.openURL(LINKS.website)} />
      <LinkRow icon="smartphone" label="Get the BeEzrat HaShem app" onPress={() => Linking.openURL(LINKS.getApp)} />
      <LinkRow icon="mail" label="Contact us" onPress={() => Linking.openURL(`mailto:${LINKS.contactEmail}`)} />
      <Text style={styles.legal}>WhatsApp is a trademark of WhatsApp LLC. This app is not affiliated with WhatsApp.</Text>
    </View>
  );

  if (state.status === "loading") {
    return (
      <View style={[styles.screen, styles.center, { paddingTop: insets.top }]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  if (state.status === "error") {
    return (
      <View style={[styles.screen, { paddingTop: insets.top + 12, paddingHorizontal: 16 }]}>
        {header}
        <View style={styles.emptyCard}>
          <Feather name="wifi-off" size={28} color={colors.muted} />
          <Text style={styles.emptyText}>Could not load sticker packs. Check your connection and try again.</Text>
          <Pressable onPress={onRefresh} style={styles.retry} accessibilityRole="button">
            <Text style={styles.retryText}>Retry</Text>
          </Pressable>
        </View>
        {footer}
      </View>
    );
  }

  return (
    <FlatList
      style={styles.screen}
      contentContainerStyle={{ paddingTop: insets.top + 12, paddingBottom: insets.bottom + 24, paddingHorizontal: 16 }}
      data={state.packs}
      keyExtractor={(p) => p.identifier}
      ListHeaderComponent={header}
      ListFooterComponent={footer}
      ListEmptyComponent={
        <View style={styles.emptyCard}>
          <Feather name="smile" size={28} color={colors.muted} />
          <Text style={styles.emptyText}>No sticker packs yet. Check back soon!</Text>
        </View>
      }
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
      renderItem={({ item }) => (
        <PackCard
          pack={item}
          adding={addingId === item.identifier}
          disabled={!canAdd || (addingId != null && addingId !== item.identifier)}
          added={addedIds[item.identifier] ?? null}
          onAdd={() => onAdd(item)}
        />
      )}
    />
  );
}

function Notice({ icon, text }: { icon: React.ComponentProps<typeof Feather>["name"]; text: string }) {
  return (
    <View style={styles.notice}>
      <Feather name={icon} size={18} color={colors.primary} />
      <Text style={styles.noticeText}>{text}</Text>
    </View>
  );
}

function LinkRow({ icon, label, onPress }: { icon: React.ComponentProps<typeof Feather>["name"]; label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={styles.linkRow} accessibilityRole="link">
      <Feather name={icon} size={16} color={colors.primary} />
      <Text style={styles.linkText}>{label}</Text>
      <Feather name="chevron-right" size={16} color={colors.muted} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  center: { alignItems: "center", justifyContent: "center" },
  title: { fontSize: 32, fontWeight: "700", color: colors.text, marginTop: 8 },
  subtitle: { fontSize: 15, color: colors.muted, marginTop: 6, marginBottom: 18, lineHeight: 21 },
  notice: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: colors.card,
    borderRadius: radius,
    padding: 14,
    marginBottom: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  noticeText: { flex: 1, color: colors.text, fontSize: 14, lineHeight: 20 },
  emptyCard: {
    backgroundColor: colors.card,
    borderRadius: radius,
    padding: 28,
    alignItems: "center",
    gap: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  emptyText: { color: colors.text, textAlign: "center", fontSize: 15, lineHeight: 21 },
  retry: { backgroundColor: colors.primary, paddingHorizontal: 20, paddingVertical: 10, borderRadius: 10 },
  retryText: { color: "#fff", fontWeight: "600" },
  footer: { marginTop: 8, backgroundColor: colors.card, borderRadius: radius, padding: 16, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  footerTitle: { fontSize: 13, fontWeight: "600", color: colors.muted, textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 6 },
  linkRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 12, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  linkText: { flex: 1, color: colors.text, fontSize: 15 },
  legal: { color: colors.muted, fontSize: 11, marginTop: 12, lineHeight: 16 },
});
