import { SettingsCard, SettingsRow, SettingsSection, SettingsSwitch } from "@getpaseo/plugin/client/ui";
import { View } from "react-native";
import { SOUND_EVENTS, SOUND_EVENT_IDS, type SoundEventId } from "../../shared/events";
import type { SoundSettings } from "../../shared/settings";
import { PageIntro, type SoundSettingsPageProps, useSoundCatalog } from "./common";
import { SoundPicker } from "./sound-picker";

export function EventsPage({ values, save, preview, player, theme, layout }: SoundSettingsPageProps) {
  const catalog = useSoundCatalog();
  const saveEvent = (id: SoundEventId, patch: Partial<SoundSettings["events"][SoundEventId]>) =>
    save({ ...values, events: { ...values.events, [id]: { ...values.events[id], ...patch } } });

  return (
    <View style={{ gap: layout.compact ? 16 : 24 }}>
      <PageIntro theme={theme}>
        The sound each event plays everywhere. Project and provider rules can change these for specific work.
      </PageIntro>
      <SettingsSection title="Default sound for each event">
        {SOUND_EVENT_IDS.map((id) => {
          const info = SOUND_EVENTS[id];
          const config = values.events[id];
          const missing = !catalog.has(config.sound) && !catalog.custom.isPending;
          return (
            <SettingsCard key={id}>
              <SettingsSwitch
                label={info.label}
                hint={info.hint}
                value={config.enabled}
                onValueChange={(enabled) => saveEvent(id, { enabled })}
              />
              <SettingsRow label="Sound" error={missing ? "This sound is no longer available." : null}>
                <SoundPicker
                  title={`Sound for ${info.label}`}
                  value={config.sound}
                  onChange={(sound) => saveEvent(id, { sound })}
                  catalog={catalog}
                  player={player}
                  preview={preview}
                  theme={theme}
                  compact={layout.compact}
                  disabled={!config.enabled}
                />
              </SettingsRow>
            </SettingsCard>
          );
        })}
      </SettingsSection>
    </View>
  );
}
