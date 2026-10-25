import { useRpc } from "@getpaseo/plugin/client";
import { SettingsCard, SettingsSection, SettingsSelect, SettingsSwitch } from "@getpaseo/plugin/client/ui";
import { useQuery } from "@tanstack/react-query";
import { View } from "react-native";
import { SOUND_EVENTS, SOUND_EVENT_IDS } from "../../shared/events";
import { mediaStatusRpc } from "../../shared/rpc";
import type { SoundSettingsPageProps } from "./common";

const PAUSE_MEDIA_HINT =
  "Pauses music and videos on the computer running Paseo while a sound plays, then resumes them. Choose the events below. Requires Linux, gdbus, and a logged-in desktop with MPRIS players such as browsers, Spotify, or VLC. Media also pauses while a sound waits in Paseo’s audio queue.";

function usePauseMediaHint(enabled: boolean): string {
  const getStatus = useRpc(mediaStatusRpc);
  const status = useQuery({
    queryKey: ["notification-sounds", "media-status"],
    queryFn: () => getStatus({}),
    enabled,
    refetchOnWindowFocus: true,
  });
  if (!enabled || !status.data) return PAUSE_MEDIA_HINT;
  if (!status.data.supported) return `${PAUSE_MEDIA_HINT} ${status.data.message ?? "Not available on this host."}`;
  const { players } = status.data;
  return `${PAUSE_MEDIA_HINT} ${players === 0 ? "No media players are open right now." : `${players} media player${players === 1 ? "" : "s"} found.`}`;
}

const VOLUME_OPTIONS = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100].map((value) => ({
  label: `${value}%`,
  value: String(value),
}));

const COOLDOWN_OPTIONS = [
  { label: "None", value: "0" },
  { label: "0.5 seconds", value: "500" },
  { label: "1.5 seconds", value: "1500" },
  { label: "3 seconds", value: "3000" },
  { label: "10 seconds", value: "10000" },
];

export function GeneralPage({ values, save, layout }: SoundSettingsPageProps) {
  const pauseMediaHint = usePauseMediaHint(values.pauseMedia);
  return (
    <View style={{ gap: layout.compact ? 16 : 24 }}>
      <SettingsSection title="General">
        <SettingsCard>
          <SettingsSwitch
            label="Play notification sounds"
            hint="Plays on every device where the Paseo app is open and connected to this host."
            value={values.enabled}
            onValueChange={(enabled) => save({ ...values, enabled })}
          />
          <SettingsSelect
            label="Volume"
            hint="Applies to built-in sounds, PCM/32-bit float WAV, and MP3 without CRC protection. Other formats play at their recorded level."
            value={String(values.volume)}
            options={VOLUME_OPTIONS}
            onValueChange={(volume) => save({ ...values, volume: Number(volume) })}
          />
          <SettingsSelect
            label="Repeat limit"
            hint="Minimum gap between two plays of the same sound, so a burst of agents plays once."
            value={String(values.cooldownMs)}
            options={COOLDOWN_OPTIONS}
            onValueChange={(cooldown) => save({ ...values, cooldownMs: Number(cooldown) })}
          />
          <SettingsSwitch
            label="Allow sounds to pause media"
            hint={pauseMediaHint}
            value={values.pauseMedia}
            onValueChange={(pauseMedia) => save({ ...values, pauseMedia })}
          />
          <SettingsSwitch
            label="Include subagents"
            hint="Also play sounds for agents started by other agents."
            value={values.includeSubagents}
            onValueChange={(includeSubagents) => save({ ...values, includeSubagents })}
          />
        </SettingsCard>
      </SettingsSection>
      {values.pauseMedia ? (
        <SettingsSection title="Pause media for">
          <SettingsCard>
            {SOUND_EVENT_IDS.map((id) => {
              const event = values.events[id];
              return (
                <SettingsSwitch
                  key={id}
                  label={SOUND_EVENTS[id].label}
                  hint={
                    event.enabled
                      ? "Applies in every project and for every provider."
                      : "This event's sound is off on the Events tab."
                  }
                  value={event.pauseMedia}
                  disabled={!event.enabled}
                  onValueChange={(pauseMedia) =>
                    save({ ...values, events: { ...values.events, [id]: { ...event, pauseMedia } } })
                  }
                />
              );
            })}
          </SettingsCard>
        </SettingsSection>
      ) : null}
    </View>
  );
}
