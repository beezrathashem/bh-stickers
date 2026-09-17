import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { Image } from "expo-image";
import { Feather } from "@expo/vector-icons";

import type { StickerPackInput } from "../../modules/whatsapp-stickers/src";
import { colors, radius } from "../theme";

const PREVIEW_COUNT = 4;

export function PackCard({
  pack,
  adding,
  disabled,
  added,
  onAdd,
}: {
  pack: StickerPackInput;
  adding: boolean;
  disabled: boolean;
  added: boolean | null;
  onAdd: () => void;
}) {
  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <Image source={{ uri: pack.trayImageUrl }} style={styles.tray} contentFit="contain" />
        <View style={styles.titles}>
          <Text style={styles.name} numberOfLines={1}>
            {pack.name}
          </Text>
          <Text style={styles.meta} numberOfLines={1}>
            {pack.stickers.length} stickers · {pack.publisher}
            {pack.animated ? " · animated" : ""}
          </Text>
        </View>
        {added === true && (
          <View style={styles.addedBadge}>
            <Feather name="check" size={14} color={colors.whatsapp} />
            <Text style={styles.addedText}>Added</Text>
          </View>
        )}
      </View>

      <View style={styles.previewRow}>
        {pack.stickers.slice(0, PREVIEW_COUNT).map((sticker, i) => (
          <Image
            key={`${pack.identifier}-${i}`}
            source={{ uri: sticker.imageUrl }}
            style={styles.preview}
            contentFit="contain"
            transition={150}
            accessibilityLabel={sticker.accessibilityText ?? `Sticker ${i + 1}`}
          />
        ))}
      </View>

      <Pressable
        onPress={onAdd}
        disabled={disabled || adding}
        style={({ pressed }) => [
          styles.button,
          (disabled || adding) && styles.buttonDisabled,
          pressed && !disabled && styles.buttonPressed,
        ]}
        accessibilityRole="button"
        accessibilityLabel={`Add ${pack.name} to WhatsApp`}
      >
        {adding ? (
          <>
            <ActivityIndicator color="#fff" />
            <Text style={styles.buttonText}>Preparing stickers…</Text>
          </>
        ) : (
          <>
            <Feather name="plus-circle" size={18} color="#fff" />
            <Text style={styles.buttonText}>{added ? "Add again" : "Add to WhatsApp"}</Text>
          </>
        )}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.card,
    borderRadius: radius,
    padding: 16,
    marginBottom: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  header: { flexDirection: "row", alignItems: "center" },
  tray: { width: 48, height: 48, borderRadius: 12, backgroundColor: colors.background },
  titles: { flex: 1, marginLeft: 12 },
  name: { fontSize: 17, fontWeight: "600", color: colors.text },
  meta: { fontSize: 13, color: colors.muted, marginTop: 2 },
  addedBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: "#E8FAF0",
  },
  addedText: { color: colors.whatsapp, fontSize: 12, fontWeight: "600" },
  previewRow: { flexDirection: "row", gap: 8, marginTop: 14 },
  preview: { flex: 1, aspectRatio: 1, borderRadius: 12, backgroundColor: colors.background },
  button: {
    marginTop: 16,
    height: 48,
    borderRadius: 12,
    backgroundColor: colors.whatsapp,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  buttonDisabled: { opacity: 0.5 },
  buttonPressed: { opacity: 0.85 },
  buttonText: { color: "#fff", fontSize: 16, fontWeight: "600" },
});
