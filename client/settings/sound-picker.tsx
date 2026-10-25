import type { PluginTheme } from "@getpaseo/plugin";
import { FlatList, Icon, Modal, TextInput } from "@getpaseo/plugin/client/ui";
import { useEffect, useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import type { SoundPlayer } from "../player";
import { FAVORITES_SECTION, type SoundCatalog, StarButton } from "./common";

export interface PickerChoice {
  value: string;
  label: string;
  hint?: string;
}

interface SoundPickerProps {
  /** Modal title, e.g. "Sound for Agent finished". */
  title: string;
  value: string;
  onChange(value: string): void;
  catalog: SoundCatalog;
  player: SoundPlayer;
  preview(ref: string): void;
  theme: PluginTheme;
  compact: boolean;
  /** Choices listed above the sounds, such as "Use default". "No sound" is always offered. */
  choices?: PickerChoice[];
  /** What the trigger's play button plays when `value` is a choice rather than a sound. */
  previewFallback?: string | null;
  disabled?: boolean;
}

type Row =
  | { kind: "header"; key: string; title: string; count: number }
  | { kind: "choice"; key: string; value: string; label: string; hint?: string }
  | { kind: "sound"; key: string; value: string; label: string; section: string };

function usePreviewing(player: SoundPlayer): string | null {
  const [current, setCurrent] = useState<string | null>(null);
  useEffect(() => player.onPreviewChange(setCurrent), [player]);
  return current;
}

export function SoundPicker({
  title,
  value,
  onChange,
  catalog,
  player,
  preview,
  theme,
  compact,
  choices = [],
  previewFallback,
  disabled,
}: SoundPickerProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const previewing = usePreviewing(player);

  const allChoices: PickerChoice[] = [...choices, { value: "none", label: "No sound" }];
  // `choices` is usually a fresh array each render; its contents decide when rows rebuild.
  const choicesKey = choices.map((item) => `${item.value}=${item.label}`).join("|");
  const choice = allChoices.find((candidate) => candidate.value === value);
  const label = choice?.label ?? catalog.labelOf(value);
  const missing = !choice && !catalog.has(value);
  const playable = choice ? (value === "none" ? null : (previewFallback ?? null)) : missing ? null : value;

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const result: Row[] = [];
    if (!needle) {
      for (const item of allChoices) result.push({ kind: "choice", key: `choice:${item.value}`, ...item });
      // Favorites repeat at the top; while searching, matches show once in their own section.
      if (catalog.favorites.length) {
        const count = catalog.favorites.length;
        result.push({ kind: "header", key: "header:favorites", title: FAVORITES_SECTION, count });
        for (const entry of catalog.favorites) {
          result.push({ kind: "sound", key: `fav:${entry.ref}`, value: entry.ref, label: entry.label, section: FAVORITES_SECTION });
        }
      }
    }
    const matching = catalog.entries.filter(
      (entry) =>
        !needle || entry.label.toLowerCase().includes(needle) || entry.section.toLowerCase().includes(needle),
    );
    const counts = new Map<string, number>();
    for (const entry of matching) counts.set(entry.section, (counts.get(entry.section) ?? 0) + 1);
    let lastSection: string | null = null;
    for (const entry of matching) {
      if (entry.section !== lastSection) {
        lastSection = entry.section;
        const count = counts.get(entry.section) ?? 0;
        result.push({ kind: "header", key: `header:${entry.section}`, title: entry.section, count });
      }
      result.push({ kind: "sound", key: entry.ref, value: entry.ref, label: entry.label, section: entry.section });
    }
    return result;
  }, [catalog.entries, catalog.favorites, query, choicesKey]);

  const styles = useMemo(
    () => ({
      control: { flexDirection: "row" as const, alignItems: "center" as const, gap: 8 },
      trigger: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        gap: 6,
        minWidth: compact ? 140 : 180,
        maxWidth: 260,
        paddingHorizontal: 12,
        paddingVertical: compact ? 10 : 7,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: missing ? theme.colors.statusDanger : theme.colors.border,
        backgroundColor: theme.colors.surface1,
        opacity: disabled ? 0.5 : 1,
      },
      triggerText: { flex: 1, color: theme.colors.foreground, fontSize: 13 },
      // The modal sets its own height; the body fills it so the list reaches the bottom edge.
      body: { flex: 1, minHeight: 320, gap: 12, padding: compact ? 16 : 20 },
      search: {
        color: theme.colors.foreground,
        backgroundColor: theme.colors.surface1,
        borderWidth: 1,
        borderColor: theme.colors.border,
        borderRadius: 8,
        paddingHorizontal: 12,
        paddingVertical: compact ? 10 : 8,
        fontSize: 14,
      },
      header: {
        flexDirection: "row" as const,
        justifyContent: "space-between" as const,
        paddingTop: 14,
        paddingBottom: 6,
        paddingHorizontal: 4,
      },
      headerText: { color: theme.colors.foregroundMuted, fontSize: 12, fontWeight: "600" as const },
      row: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        gap: 10,
        paddingHorizontal: 8,
        paddingVertical: compact ? 10 : 7,
        borderRadius: 8,
      },
      rowSelected: { backgroundColor: theme.colors.surface2 },
      rowText: { flex: 1, color: theme.colors.foreground, fontSize: 14 },
      rowHint: { color: theme.colors.foregroundMuted, fontSize: 12 },
      play: {
        width: 28,
        height: 28,
        borderRadius: 14,
        alignItems: "center" as const,
        justifyContent: "center" as const,
        backgroundColor: theme.colors.surface2,
      },
      playActive: { backgroundColor: theme.colors.accent },
      spacer: { width: 28 },
      star: { padding: compact ? 8 : 4 },
      check: { width: 16 },
      empty: { color: theme.colors.foregroundMuted, fontSize: 13, paddingVertical: 24, textAlign: "center" as const },
    }),
    [theme, compact, missing, disabled],
  );

  const select = (next: string) => {
    onChange(next);
    setOpen(false);
  };

  const PlayCircle = ({ refValue, name }: { refValue: string; name: string }) => {
    const active = previewing === refValue;
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Play ${name}`}
        hitSlop={6}
        onPress={() => preview(refValue)}
        style={[styles.play, active && styles.playActive]}
      >
        <Icon
          name={active ? "Volume2" : "Play"}
          size={13}
          color={active ? theme.colors.accentForeground : theme.colors.foreground}
        />
      </Pressable>
    );
  };

  return (
    <View style={styles.control}>
      {playable ? (
        <PlayCircle refValue={playable} name={label} />
      ) : (
        <View style={[styles.play, { opacity: 0.35 }]}>
          <Icon name="Play" size={13} color={theme.colors.foregroundMuted} />
        </View>
      )}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${title}: ${label}. Change`}
        disabled={disabled}
        onPress={() => {
          setQuery("");
          setOpen(true);
        }}
        style={styles.trigger}
      >
        <Text style={styles.triggerText} numberOfLines={1}>
          {missing ? "Missing sound" : label}
        </Text>
        <Icon name="ChevronDown" size={14} color={theme.colors.foregroundMuted} />
      </Pressable>

      <Modal
        title={title}
        icon={<Icon name="Music" size={18} color={theme.colors.foreground} />}
        open={open}
        onOpenChange={setOpen}
      >
        <Modal.Content scrollable={false} style={{ flex: 1 }} contentContainerStyle={{ flex: 1, padding: 0, gap: 0 }}>
          <View style={styles.body}>
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder={`Search ${catalog.entries.length} sounds`}
              placeholderTextColor={theme.colors.foregroundMuted}
              autoCorrect={false}
              style={styles.search}
            />
            <FlatList
              data={rows}
              keyExtractor={(row) => row.key}
              initialNumToRender={30}
              keyboardShouldPersistTaps="handled"
              style={{ flex: 1 }}
              ListEmptyComponent={<Text style={styles.empty}>No sounds match.</Text>}
              renderItem={({ item: row }) => {
                if (row.kind === "header") {
                  return (
                    <View style={styles.header}>
                      <Text style={styles.headerText}>{row.title}</Text>
                      <Text style={styles.rowHint}>{row.count}</Text>
                    </View>
                  );
                }
                const selected = row.value === value;
                const previewRef = row.kind === "sound" ? row.value : null;
                return (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                    accessibilityLabel={`Use ${row.label}`}
                    onPress={() => select(row.value)}
                    style={[styles.row, selected && styles.rowSelected]}
                  >
                    {previewRef ? <PlayCircle refValue={previewRef} name={row.label} /> : <View style={styles.spacer} />}
                    <View style={{ flex: 1 }}>
                      <Text style={styles.rowText} numberOfLines={1}>
                        {row.label}
                      </Text>
                      {row.kind === "choice" && row.hint ? <Text style={styles.rowHint}>{row.hint}</Text> : null}
                      {row.kind === "sound" && query.trim() ? <Text style={styles.rowHint}>{row.section}</Text> : null}
                    </View>
                    {row.kind === "sound" ? (
                      <StarButton catalog={catalog} refValue={row.value} name={row.label} theme={theme} style={styles.star} />
                    ) : null}
                    {selected ? <Icon name="Check" size={16} color={theme.colors.accent} /> : <View style={styles.check} />}
                  </Pressable>
                );
              }}
            />
          </View>
        </Modal.Content>
      </Modal>
    </View>
  );
}
