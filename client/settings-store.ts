import { settingsRpc } from "@getpaseo/plugin";
import type { PluginCommandCapabilities } from "@getpaseo/plugin/client";
import { SoundSettingsSchema, soundSettings, type SoundSettings } from "../shared/settings";

const contracts = settingsRpc(soundSettings.id);

/**
 * Reads, changes, and saves the settings document outside a component, retrying once if another
 * client saved in between. Components use `useSettings` instead.
 */
export async function updateSettings(
  rpc: PluginCommandCapabilities["rpc"],
  change: (current: SoundSettings) => SoundSettings,
): Promise<void> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const current = await rpc(contracts.read, {});
    if (current.status !== "ready") throw new Error(`Notification sound settings are invalid: ${current.error}`);
    const values = change(SoundSettingsSchema.parse(current.values));
    const result = await rpc(contracts.write, { revision: current.revision, values });
    if (result.status === "saved") return;
    if (result.status === "invalid") throw new Error(result.error);
  }
  throw new Error("Settings changed elsewhere; try again.");
}
