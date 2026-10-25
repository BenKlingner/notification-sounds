import type { PluginServerContext } from "@getpaseo/plugin/server";
import { holdMedia, mediaStatus, releaseAllMedia, releaseMedia, renewMedia } from "./server/media";
import {
  deleteCustomSound,
  importCustomSound,
  listCustomSounds,
  loadBundledSound,
  loadCustomSound,
  openSoundFolder,
  stopSoundOperations,
} from "./server/sounds";
import {
  deleteCustomSoundRpc,
  holdMediaRpc,
  mediaStatusRpc,
  releaseMediaRpc,
  renewMediaRpc,
  importCustomSoundRpc,
  listCustomSoundsRpc,
  loadBundledSoundRpc,
  loadCustomSoundRpc,
  openSoundFolderRpc,
} from "./shared/rpc";
import { soundSettings } from "./shared/settings";

export default function contribute(server: PluginServerContext) {
  server.registerSettings(soundSettings);
  server.handle(listCustomSoundsRpc, listCustomSounds);
  server.handle(loadCustomSoundRpc, loadCustomSound);
  server.handle(loadBundledSoundRpc, loadBundledSound);
  server.handle(importCustomSoundRpc, importCustomSound);
  server.handle(deleteCustomSoundRpc, deleteCustomSound);
  server.handle(openSoundFolderRpc, openSoundFolder);
  server.handle(holdMediaRpc, holdMedia);
  server.handle(releaseMediaRpc, releaseMedia);
  server.handle(renewMediaRpc, renewMedia);
  server.handle(mediaStatusRpc, mediaStatus);
  return async () => {
    await Promise.all([stopSoundOperations(), releaseAllMedia()]);
  };
}
