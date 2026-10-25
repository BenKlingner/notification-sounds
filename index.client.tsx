import type { PluginClientContext } from "@getpaseo/plugin/client";
import { createSoundPlayer } from "./client/player";
import { soundSettingsPage } from "./client/settings/common";
import { requestSettingsTab, SettingsTabs } from "./client/settings/tabs";
import { updateSettings } from "./client/settings-store";
import { watchAgents } from "./client/watcher";
import { SOUND_EVENTS } from "./shared/events";

const SETTINGS_ID = "sounds";

export default function contribute(client: PluginClientContext) {
  const player = createSoundPlayer(client);
  const stopWatching = watchAgents(client, player);

  client.addSettingsScreen({
    id: SETTINGS_ID,
    title: "Notification sounds",
    icon: "Volume2",
    Component: soundSettingsPage(player, SettingsTabs),
  });

  client.addCommandCenterItem({
    id: "open-settings",
    title: "Notification sounds: settings",
    icon: "Volume2",
    context: "global",
    onSelect({ openSettings }) {
      requestSettingsTab("general");
      openSettings(SETTINGS_ID);
    },
  });

  client.addCommandCenterItem({
    id: "open-project-rules",
    title: "Notification sounds: project rules",
    icon: "FolderGit2",
    context: "global",
    onSelect({ openSettings }) {
      requestSettingsTab("projects");
      openSettings(SETTINGS_ID);
    },
  });

  client.addCommandCenterItem({
    id: "mute-project",
    title: "Notification sounds: mute this project",
    icon: "VolumeX",
    context: "workspace",
    async onSelect({ rpc, workspace }) {
      await updateSettings(rpc, (current) => ({
        ...current,
        projectRules: {
          ...current.projectRules,
          [workspace.projectId]: {
            name: workspace.projectDisplayName,
            events: current.projectRules[workspace.projectId]?.events ?? {},
            mode: "muted",
          },
        },
      }));
      player.invalidate();
    },
  });

  client.addCommandCenterItem({
    id: "unmute-project",
    title: "Notification sounds: unmute this project",
    icon: "Volume2",
    context: "workspace",
    async onSelect({ rpc, workspace }) {
      await updateSettings(rpc, (current) => {
        const rule = current.projectRules[workspace.projectId];
        if (!rule || rule.mode !== "muted") return current;
        const projectRules = { ...current.projectRules };
        // A muted rule with no custom sounds was only a mute; drop it entirely.
        if (Object.keys(rule.events).length === 0) delete projectRules[workspace.projectId];
        else projectRules[workspace.projectId] = { ...rule, mode: "custom" };
        return { ...current, projectRules };
      });
      player.invalidate();
    },
  });

  client.addCommandCenterItem({
    id: "test-sound",
    title: "Notification sounds: play the finished sound",
    icon: "BellRing",
    context: "global",
    async onSelect() {
      const settings = await player.readSettings();
      await player.play(
        settings?.events.finished.sound ?? SOUND_EVENTS.finished.defaultSound,
        settings?.volume ?? 70,
        Boolean(settings?.pauseMedia && settings.events.finished.pauseMedia),
      );
    },
  });

  return () => {
    stopWatching();
    player.dispose();
  };
}
