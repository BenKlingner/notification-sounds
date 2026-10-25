import type { PluginTheme } from "@getpaseo/plugin";
import { type PluginSurfaceProps, useRpc, useSettings } from "@getpaseo/plugin/client";
import { Icon, SettingsAction, SettingsCard, useToast } from "@getpaseo/plugin/client/ui";
import { useQuery } from "@tanstack/react-query";
import { type ComponentType, type ReactNode, useMemo } from "react";
import { Pressable, type StyleProp, Text, View, type ViewStyle } from "react-native";
import { listCustomSoundsRpc } from "../../shared/rpc";
import { soundSettings, type SoundSettings } from "../../shared/settings";
import type { SoundPlayer } from "../player";
import { BUNDLED_SECTIONS, BUNDLED_SOUNDS } from "../../shared/bundled-sounds";
import { BUILTIN_CATEGORY_ORDER, BUILTIN_SOUNDS } from "../synth";

export const CUSTOM_SOUNDS_KEY = ["notification-sounds", "custom"];

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export interface SoundSettingsPageProps extends PluginSurfaceProps {
  player: SoundPlayer;
  values: SoundSettings;
  save(next: SoundSettings): void;
  preview(ref: string): void;
}

/**
 * Wraps a settings page with loading and error states, an immediate-save helper, and a preview
 * function, so each page only renders its controls.
 */
export function soundSettingsPage(player: SoundPlayer, Page: ComponentType<SoundSettingsPageProps>) {
  return function SoundSettingsPage(props: PluginSurfaceProps) {
    const settings = useSettings(soundSettings);
    const toast = useToast();

    if (settings.status === "loading") {
      return <Text style={{ color: props.theme.colors.foregroundMuted }}>Loading settings…</Text>;
    }
    if (settings.status === "error" || settings.status === "invalid") {
      return (
        <View style={{ gap: 16 }}>
          <Text style={{ color: props.theme.colors.statusDanger }}>{settings.error}</Text>
          <SettingsCard>
            <SettingsAction label="Restore defaults" actionLabel="Reset" onPress={() => void settings.reset()} />
          </SettingsCard>
        </View>
      );
    }

    const values = settings.values;
    const save = (next: SoundSettings) => {
      void settings.save(next, settings.revision).then((ok) => {
        if (!ok) toast.error(settings.saveError ?? "Could not save settings");
        else player.invalidate();
      });
    };
    const preview = (ref: string) => {
      player.preview(ref, values.volume, values.pauseMedia, (error) => toast.error(`Could not play sound: ${errorMessage(error)}`));
    };
    return <Page {...props} player={player} values={values} save={save} preview={preview} />;
  };
}

export interface SoundEntry {
  ref: string;
  label: string;
  section: string;
}

export interface SoundCatalog {
  custom: ReturnType<typeof useCustomSounds>;
  /** Sounds in display order: your folders first, then the built-in sections. */
  entries: SoundEntry[];
  sections: string[];
  /** Built-in sections (bundled, then classic) with their sounds, for the library page. */
  builtinGroups: [string, SoundEntry[]][];
  /** Starred sounds that still exist, in the order they were starred. */
  favorites: SoundEntry[];
  isFavorite(ref: string): boolean;
  toggleFavorite(ref: string): void;
  labelOf(ref: string): string;
  has(ref: string): boolean;
}

export const YOUR_SOUNDS_SECTION = "Your sounds";
export const FAVORITES_SECTION = "Favorites";

function useCustomSounds() {
  const listCustom = useRpc(listCustomSoundsRpc);
  return useQuery({ queryKey: CUSTOM_SOUNDS_KEY, queryFn: () => listCustom({}) });
}

/** Every sound the host offers, grouped into sections for the picker and the library. */
export function useSoundCatalog(): SoundCatalog {
  const custom = useCustomSounds();
  const settings = useSettings(soundSettings);
  const toast = useToast();
  const starred = settings.status === "ready" ? settings.values.favorites : EMPTY;
  const catalog = useMemo(() => {
    const yours: SoundEntry[] = (custom.data?.sounds ?? []).map((sound) => ({
      ref: `custom:${sound.id}`,
      label: sound.name,
      section: sound.category || YOUR_SOUNDS_SECTION,
    }));
    // Top-level files lead, then folders alphabetically.
    const rank = (entry: SoundEntry) => (entry.section === YOUR_SOUNDS_SECTION ? 0 : 1);
    yours.sort((a, b) => rank(a) - rank(b) || a.section.localeCompare(b.section) || a.label.localeCompare(b.label));
    const builtins: SoundEntry[] = [
      ...BUNDLED_SECTIONS.flatMap((section) =>
        BUNDLED_SOUNDS.filter((sound) => sound.section === section).map((sound) => ({
          ref: `bundled:${sound.id}`,
          label: sound.label,
          section: `${section} (built-in)`,
        })),
      ),
      ...BUILTIN_CATEGORY_ORDER.flatMap((category) =>
        BUILTIN_SOUNDS.filter((sound) => sound.category === category).map((sound) => ({
          ref: `builtin:${sound.id}`,
          label: sound.label,
          section: `Classic ${category.toLowerCase()}`,
        })),
      ),
    ];
    const builtinGroups: [string, SoundEntry[]][] = [];
    for (const entry of builtins) {
      const last = builtinGroups[builtinGroups.length - 1];
      if (last?.[0] === entry.section) last[1].push(entry);
      else builtinGroups.push([entry.section, [entry]]);
    }
    const entries = [...yours, ...builtins];
    const sections = [...new Set(entries.map((entry) => entry.section))];
    const byRef = new Map(entries.map((entry) => [entry.ref, entry]));
    return {
      entries,
      sections,
      builtinGroups,
      labelOf: (ref: string) => (ref === "none" ? "No sound" : (byRef.get(ref)?.label ?? "Missing sound")),
      has: (ref: string) => ref === "none" || byRef.has(ref),
    };
  }, [custom.data]);

  const favorites = useMemo(() => {
    const byRef = new Map(catalog.entries.map((entry) => [entry.ref, entry]));
    return starred.flatMap((ref) => {
      const entry = byRef.get(ref);
      return entry ? [entry] : [];
    });
  }, [catalog.entries, starred]);

  const toggleFavorite = (ref: string) => {
    if (settings.status !== "ready") return;
    const current = settings.values.favorites;
    const next = current.includes(ref) ? current.filter((item) => item !== ref) : [...current, ref];
    void settings.save({ ...settings.values, favorites: next }, settings.revision).then((ok) => {
      if (!ok) toast.error(settings.saveError ?? "Could not save favorites");
    });
  };

  return {
    ...catalog,
    custom,
    favorites,
    isFavorite: (ref: string) => starred.includes(ref),
    toggleFavorite,
  };
}

const EMPTY: readonly string[] = [];

/** Star toggle for a sound; filled with the accent color when the sound is a favorite. */
export function StarButton({
  catalog,
  refValue,
  name,
  theme,
  size = 14,
  style,
}: {
  catalog: SoundCatalog;
  refValue: string;
  name: string;
  theme: PluginTheme;
  size?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const on = catalog.isFavorite(refValue);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: on }}
      accessibilityLabel={on ? `Remove ${name} from favorites` : `Add ${name} to favorites`}
      hitSlop={6}
      onPress={() => catalog.toggleFavorite(refValue)}
      style={style}
    >
      <Icon name="Star" size={size} color={on ? theme.colors.accent : theme.colors.foregroundMuted} />
    </Pressable>
  );
}

export function PageIntro({ theme, children }: { theme: PluginTheme; children: ReactNode }) {
  return <Text style={{ color: theme.colors.foregroundMuted, fontSize: 13, lineHeight: 18 }}>{children}</Text>;
}
