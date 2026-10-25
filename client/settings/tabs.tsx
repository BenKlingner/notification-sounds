import { Icon } from "@getpaseo/plugin/client/ui";
import { type ComponentType, useEffect, useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import type { SoundSettingsPageProps } from "./common";
import { AboutPage } from "./about-page";
import { EventsPage } from "./events-page";
import { GeneralPage } from "./general-page";
import { LibraryPage } from "./library-page";
import { createRulesPage } from "./rules-page";

export type SettingsTabId = "general" | "events" | "projects" | "providers" | "library" | "about";

const TABS: { id: SettingsTabId; title: string; icon: string; Page: ComponentType<SoundSettingsPageProps> }[] = [
  { id: "general", title: "General", icon: "Volume2", Page: GeneralPage },
  { id: "events", title: "Events", icon: "BellRing", Page: EventsPage },
  { id: "projects", title: "Projects", icon: "FolderGit2", Page: createRulesPage("project") },
  { id: "providers", title: "Providers", icon: "Bot", Page: createRulesPage("provider") },
  { id: "library", title: "Sound library", icon: "Music", Page: LibraryPage },
  { id: "about", title: "About", icon: "Info", Page: AboutPage },
];

// Settings screens take no params, so a Command Center item records the tab it wants here
// just before opening the screen.
// An already-open page listens so it switches too.
let requestedTab: SettingsTabId | null = null;
const tabListeners = new Set<(tab: SettingsTabId) => void>();

export function requestSettingsTab(tab: SettingsTabId) {
  requestedTab = tab;
  for (const listener of tabListeners) listener(tab);
}

export function SettingsTabs(props: SoundSettingsPageProps) {
  const { theme, layout } = props;
  const [tab, setTab] = useState<SettingsTabId>(() => {
    const initial = requestedTab ?? "general";
    requestedTab = null;
    return initial;
  });

  useEffect(() => {
    const listener = (next: SettingsTabId) => {
      requestedTab = null;
      setTab(next);
    };
    tabListeners.add(listener);
    return () => {
      tabListeners.delete(listener);
    };
  }, []);

  const styles = useMemo(
    () => ({
      bar: { flexDirection: "row" as const, flexWrap: "wrap" as const, gap: 6 },
      tab: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        gap: 6,
        paddingHorizontal: 12,
        paddingVertical: layout.compact ? 10 : 7,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: theme.colors.border,
        backgroundColor: theme.colors.surface1,
      },
      tabActive: { borderColor: theme.colors.accent, backgroundColor: theme.colors.accent },
      text: { color: theme.colors.foreground, fontSize: 13 },
      textActive: { color: theme.colors.accentForeground, fontSize: 13, fontWeight: "500" as const },
    }),
    [theme, layout.compact],
  );

  const current = TABS.find((candidate) => candidate.id === tab) ?? TABS[0];
  const Page = current.Page;

  return (
    <View style={{ gap: layout.compact ? 16 : 20 }}>
      <View style={styles.bar} accessibilityRole="tablist">
        {TABS.map(({ id, title, icon }) => {
          const active = id === tab;
          return (
            <Pressable
              key={id}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
              accessibilityLabel={title}
              onPress={() => setTab(id)}
              style={[styles.tab, active && styles.tabActive]}
            >
              <Icon name={icon} size={14} color={active ? theme.colors.accentForeground : theme.colors.foregroundMuted} />
              <Text style={active ? styles.textActive : styles.text}>{title}</Text>
            </Pressable>
          );
        })}
      </View>
      <Page {...props} />
    </View>
  );
}
