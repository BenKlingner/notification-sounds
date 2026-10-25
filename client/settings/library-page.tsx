import { useRpc } from "@getpaseo/plugin/client";
import {
  Icon,
  SettingsAction,
  SettingsCard,
  SettingsInput,
  type SettingsInputHandle,
  SettingsRow,
  SettingsSection,
  useToast,
} from "@getpaseo/plugin/client/ui";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";
import {
  CUSTOM_SOUND_EXTENSIONS,
  deleteCustomSoundRpc,
  importCustomSoundRpc,
  openSoundFolderRpc,
} from "../../shared/rpc";
import {
  CUSTOM_SOUNDS_KEY,
  errorMessage,
  type SoundSettingsPageProps,
  type SoundEntry,
  StarButton,
  useSoundCatalog,
  YOUR_SOUNDS_SECTION,
} from "./common";

const FILTER_THRESHOLD = 20;
const PAGE_SIZE = 50;

export function LibraryPage({ player, preview, theme, layout }: SoundSettingsPageProps) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const catalog = useSoundCatalog();
  const { custom, builtinGroups } = catalog;
  const importCustom = useRpc(importCustomSoundRpc);
  const deleteCustom = useRpc(deleteCustomSoundRpc);
  const openFolder = useRpc(openSoundFolderRpc);
  const pathInput = useRef<SettingsInputHandle>(null);
  const [importPath, setImportPath] = useState("");
  const [importCategory, setImportCategory] = useState("");
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const [filter, setFilter] = useState("");
  const [pages, setPages] = useState<ReadonlyMap<string, number>>(new Map());
  useEffect(() => setPages(new Map()), [filter]);
  const [previewing, setPreviewing] = useState<string | null>(null);
  useEffect(() => player.onPreviewChange(setPreviewing), [player]);

  const refreshCustom = () => {
    player.invalidate();
    return queryClient.invalidateQueries({ queryKey: CUSTOM_SOUNDS_KEY });
  };

  const importMutation = useMutation({
    mutationFn: () => importCustom({ path: importPath, category: importCategory.trim() || undefined }),
    onSuccess: async ({ imported, skipped, failed, truncated }) => {
      pathInput.current?.replaceText("");
      setImportPath("");
      await refreshCustom();
      const notes = [
        skipped ? `${skipped} skipped (type, size, or nesting depth)` : "",
        failed ? `${failed} could not be copied` : "",
        truncated ? "Import stopped at a library or scan limit; remaining files were not copied" : "",
      ].filter(Boolean);
      toast.show([`Added ${imported} sound${imported === 1 ? "" : "s"}`, ...notes].join(". "), {
        variant: failed || truncated || !imported ? "warning" : "success",
      });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteCustom({ id }),
    onSuccess: () => refreshCustom(),
    onError: (error) => toast.error(errorMessage(error)),
  });

  const styles = useMemo(
    () => ({
      muted: { color: theme.colors.foregroundMuted, fontSize: 13 },
      chips: { flexDirection: "row" as const, flexWrap: "wrap" as const, gap: 8, paddingVertical: 4 },
      chip: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        gap: 10,
        paddingHorizontal: 12,
        paddingVertical: layout.compact ? 10 : 7,
        borderRadius: 999,
        borderWidth: 1,
        borderColor: theme.colors.border,
        backgroundColor: theme.colors.surface1,
      },
      chipActive: { borderColor: theme.colors.accent },
      chipText: { color: theme.colors.foreground, fontSize: 13 },
      group: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        gap: 10,
        paddingHorizontal: 16,
        paddingVertical: layout.compact ? 14 : 12,
      },
      chipPlay: { flexDirection: "row" as const, alignItems: "center" as const, gap: 6 },
      favoriteChips: { paddingTop: 14 },
      builtinChips: { paddingHorizontal: 16, paddingBottom: 14 },
      groupName: { flex: 1, color: theme.colors.foreground, fontSize: 14, fontWeight: "500" as const },
      soundRow: { flexDirection: "row" as const, alignItems: "center" as const, gap: 8 },
      iconButton: { padding: layout.compact ? 10 : 6, borderRadius: 6, backgroundColor: theme.colors.surface2 },
    }),
    [theme, layout.compact],
  );

  // Custom sounds grouped by their folder, in the order the server returns them.
  const groups = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    const map = new Map<string, NonNullable<typeof custom.data>["sounds"]>();
    for (const sound of custom.data?.sounds ?? []) {
      const section = sound.category || YOUR_SOUNDS_SECTION;
      if (needle && !sound.name.toLowerCase().includes(needle) && !section.toLowerCase().includes(needle)) continue;
      const group = map.get(section);
      if (group) group.push(sound);
      else map.set(section, [sound]);
    }
    return [...map.entries()].sort(([a], [b]) =>
      a === YOUR_SOUNDS_SECTION ? -1 : b === YOUR_SOUNDS_SECTION ? 1 : a.localeCompare(b),
    );
  }, [custom.data, filter]);

  const total = custom.data?.sounds.length ?? 0;
  const toggle = (section: string) =>
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(section)) next.delete(section);
      else next.add(section);
      return next;
    });

  const soundChip = ({ ref, label }: SoundEntry) => (
    <View key={ref} style={[styles.chip, previewing === ref && styles.chipActive]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Play ${label}`}
        onPress={() => preview(ref)}
        style={styles.chipPlay}
      >
        <Icon
          name={previewing === ref ? "Volume2" : "Play"}
          size={12}
          color={previewing === ref ? theme.colors.accent : theme.colors.foreground}
        />
        <Text style={styles.chipText}>{label}</Text>
      </Pressable>
      <StarButton catalog={catalog} refValue={ref} name={label} theme={theme} size={12} />
    </View>
  );

  return (
    <View style={{ gap: layout.compact ? 16 : 24 }}>
      {catalog.favorites.length ? (
        <SettingsSection title="Favorites">
          <SettingsCard>
            <View style={[styles.chips, styles.builtinChips, styles.favoriteChips]}>
              {catalog.favorites.map(soundChip)}
            </View>
          </SettingsCard>
        </SettingsSection>
      ) : null}

      <SettingsSection title="Your sounds">
        <SettingsCard>
          <SettingsRow
            label="Sound folder"
            hint={`Each subfolder becomes a section in the sound picker. Supported: ${CUSTOM_SOUND_EXTENSIONS.join(", ")}, up to 5 MB each. Imports are limited to 5,000 sounds and 256 MB total, with at most four section levels.`}
          >
            <Text selectable style={styles.muted}>
              {custom.data?.folder ?? (custom.isPending ? "Loading…" : "")}
            </Text>
          </SettingsRow>
          <SettingsAction
            label="Open the folder in your file manager"
            hint="Opens on the host machine."
            actionLabel="Open folder"
            onPress={() => {
              openFolder({}).catch((error) => toast.error(errorMessage(error)));
            }}
          />
          <SettingsAction label="Pick up files you added" actionLabel="Refresh" onPress={() => void refreshCustom()} />
        </SettingsCard>

        <SettingsCard>
          <SettingsInput
            ref={pathInput}
            label="Add a file or a whole folder"
            hint="A path on the host machine. Folders are copied with their subfolders, which become sections."
            placeholder="/home/you/Sounds/Warnings"
            onChangeText={setImportPath}
          />
          <SettingsInput
            label="Section (optional)"
            hint="Put the import in this section, e.g. Warnings or Warnings/Soft. A folder otherwise keeps its own name; enter / to place its subfolders at the top level."
            placeholder="Warnings"
            onChangeText={setImportCategory}
          />
          <SettingsAction
            label="Copy into the sound folder"
            actionLabel={importMutation.isPending ? "Adding…" : "Add"}
            disabled={!importPath.trim() || importMutation.isPending}
            onPress={() => importMutation.mutate()}
          />
        </SettingsCard>

        {custom.data?.truncated ? (
          <Text style={styles.muted}>The library listing reached a count, depth, or scan limit. Some files are not shown; reduce or reorganize the library before importing more.</Text>
        ) : null}

        {total > FILTER_THRESHOLD ? (
          <SettingsCard>
            <SettingsInput label={`Find among ${total} sounds`} placeholder="Type to filter" onChangeText={setFilter} />
          </SettingsCard>
        ) : null}

        {custom.error ? (
          <Text style={{ color: theme.colors.statusDanger }}>{errorMessage(custom.error)}</Text>
        ) : total === 0 ? (
          custom.isPending ? null : <Text style={styles.muted}>No custom sounds yet.</Text>
        ) : groups.length === 0 ? (
          <Text style={styles.muted}>No sounds match.</Text>
        ) : (
          groups.map(([section, sounds]) => {
            const open = expanded.has(section) || Boolean(filter.trim());
            const lastPage = Math.max(0, Math.ceil(sounds.length / PAGE_SIZE) - 1);
            const page = Math.min(pages.get(section) ?? 0, lastPage);
            const visible = sounds.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
            return (
              <SettingsCard key={section}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ expanded: open }}
                  accessibilityLabel={`${section}, ${sounds.length} sounds. ${open ? "Collapse" : "Expand"}`}
                  onPress={() => toggle(section)}
                  style={styles.group}
                >
                  <Icon name="Folder" size={16} color={theme.colors.foregroundMuted} />
                  <Text style={styles.groupName} numberOfLines={1}>
                    {section}
                  </Text>
                  <Text style={styles.muted}>{sounds.length}</Text>
                  <Icon name={open ? "ChevronDown" : "ChevronRight"} size={18} color={theme.colors.foregroundMuted} />
                </Pressable>
                {open
                  ? visible.map((sound) => {
                      const ref = `custom:${sound.id}`;
                      return (
                        <SettingsRow
                          key={sound.id}
                          label={sound.name}
                          hint={`${sound.id}, ${Math.ceil(sound.sizeBytes / 1024)} KB`}
                        >
                          <View style={styles.soundRow}>
                            <Pressable
                              accessibilityRole="button"
                              accessibilityLabel={`Play ${sound.name}`}
                              onPress={() => preview(ref)}
                              style={styles.iconButton}
                            >
                              <Icon
                                name={previewing === ref ? "Volume2" : "Play"}
                                size={16}
                                color={previewing === ref ? theme.colors.accent : theme.colors.foreground}
                              />
                            </Pressable>
                            <StarButton
                              catalog={catalog}
                              refValue={ref}
                              name={sound.name}
                              theme={theme}
                              size={16}
                              style={styles.iconButton}
                            />
                            <Pressable
                              accessibilityRole="button"
                              accessibilityLabel={`Delete ${sound.name}`}
                              onPress={() => deleteMutation.mutate(sound.id)}
                              style={styles.iconButton}
                            >
                              <Icon name="Trash2" size={16} color={theme.colors.statusDanger} />
                            </Pressable>
                          </View>
                        </SettingsRow>
                      );
                    })
                  : null}
                {open && lastPage > 0 ? (
                  <View style={{ padding: 16, gap: 8 }}>
                    <Text style={styles.muted}>{page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, sounds.length)} of {sounds.length}</Text>
                    <View style={{ flexDirection: "row", gap: 12 }}>
                      {([[-1, "Previous"], [1, "Next"]] as const).map(([step, label]) => {
                        const disabled = page + step < 0 || page + step > lastPage;
                        return (
                          <Pressable key={label} accessibilityRole="button" accessibilityLabel={`${label} sounds in ${section}`}
                            accessibilityState={{ disabled }} disabled={disabled}
                            onPress={() => setPages(current => new Map(current).set(section, page + step))}
                            style={[styles.iconButton, { minHeight: 44, justifyContent: "center", opacity: disabled ? 0.4 : 1 }]}>
                            <Text style={{ color: theme.colors.foreground }}>{label}</Text>
                          </Pressable>
                        );
                      })}
                    </View>
                  </View>
                ) : null}
              </SettingsCard>
            );
          })
        )}
      </SettingsSection>

      <SettingsSection title="Built-in sounds">
        {builtinGroups.map(([section, sounds]) => {
          const key = `builtin:${section}`;
          const open = expanded.has(key);
          return (
            <SettingsCard key={key}>
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ expanded: open }}
                accessibilityLabel={`${section}, ${sounds.length} sounds. ${open ? "Collapse" : "Expand"}`}
                onPress={() => toggle(key)}
                style={styles.group}
              >
                <Icon name="Music" size={16} color={theme.colors.foregroundMuted} />
                <Text style={styles.groupName} numberOfLines={1}>
                  {section}
                </Text>
                <Text style={styles.muted}>{sounds.length}</Text>
                <Icon name={open ? "ChevronDown" : "ChevronRight"} size={18} color={theme.colors.foregroundMuted} />
              </Pressable>
              {open ? (
                <View style={[styles.chips, styles.builtinChips]}>{sounds.map(soundChip)}</View>
              ) : null}
            </SettingsCard>
          );
        })}
      </SettingsSection>
    </View>
  );
}
