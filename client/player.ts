import { settingsRpc } from "@getpaseo/plugin";
import type { PluginClientContext } from "@getpaseo/plugin/client";
import { holdMediaRpc, loadBundledSoundRpc, loadCustomSoundRpc, releaseMediaRpc, renewMediaRpc } from "../shared/rpc";
import { SoundSettingsSchema, soundSettings, type SoundSettings } from "../shared/settings";
import { synthesizeBuiltin } from "./synth";

type AudioFile = { base64: string; mimeType: string };

const MAX_CACHE_BYTES = 8 * 1024 * 1024;
const MAX_PENDING_PLAYS = 8;

export interface SoundPlayer {
  /** With `pauseMedia`, other media on the daemon machine pauses while the sound plays. */
  play(ref: string, volume: number, pauseMedia?: boolean): Promise<void>;
  /**
   * Plays a sound for auditioning. Paseo queues audio and cannot stop it, so while one preview
   * plays only the most recent request waits; earlier ones are dropped.
   */
  preview(ref: string, volume: number, pauseMedia: boolean, onError?: (error: unknown) => void): void;
  /** Notifies with the reference being previewed, or null when previews stop. */
  onPreviewChange(listener: (ref: string | null) => void): () => void;
  readSettings(): Promise<SoundSettings | null>;
  /** Forget cached audio and settings, e.g. after a sound file changes. */
  invalidate(): void;
  dispose(): void;
}

export function createSoundPlayer(client: PluginClientContext): SoundPlayer {
  const audioCache = new Map<string, AudioFile>();
  const loading = new Map<string, Promise<AudioFile | null>>();
  let cacheBytes = 0;
  let generation = 0;
  let disposed = false;
  let activePlays = 0;
  const holds = new Map<string, ReturnType<typeof setInterval>>();
  const settingsContract = settingsRpc(soundSettings.id).read;
  let settingsRead: Promise<SoundSettings | null> | null = null;
  let previewing = false;
  let pending: { ref: string; volume: number; pauseMedia: boolean; onError?: (error: unknown) => void } | null =
    null;
  const previewListeners = new Set<(ref: string | null) => void>();
  const announce = (ref: string | null) => {
    for (const listener of previewListeners) listener(ref);
  };

  async function load(ref: string, volume: number): Promise<AudioFile | null> {
    const key = `${ref}@${volume}`;
    const cached = audioCache.get(key);
    if (cached) {
      audioCache.delete(key);
      audioCache.set(key, cached);
      return cached;
    }
    const current = loading.get(key);
    if (current) return current;
    const started = generation;
    const request = (async () => {
      if (ref.startsWith("builtin:")) return synthesizeBuiltin(ref.slice(8), volume);
      if (ref.startsWith("bundled:")) return client.rpc(loadBundledSoundRpc, { id: ref.slice(8), volume });
      if (ref.startsWith("custom:")) return client.rpc(loadCustomSoundRpc, { id: ref.slice(7), volume });
      return null;
    })();
    loading.set(key, request);
    try {
      const audio = await request;
      // Custom files can be changed by another client or outside Paseo. Only
      // deduplicate their in-flight reads; never retain them between plays.
      if (audio && !ref.startsWith("custom:") && !disposed && started === generation) {
        const bytes = audio.base64.length * 2; // Conservative UTF-16 storage budget.
        if (bytes <= MAX_CACHE_BYTES) {
          while (cacheBytes + bytes > MAX_CACHE_BYTES && audioCache.size) {
            const oldest = audioCache.keys().next().value!;
            cacheBytes -= audioCache.get(oldest)!.base64.length * 2;
            audioCache.delete(oldest);
          }
          audioCache.set(key, audio);
          cacheBytes += bytes;
        }
      }
      return audio;
    } finally {
      if (loading.get(key) === request) loading.delete(key);
    }
  }

  function release(token: string) {
    const timer = holds.get(token);
    if (timer) clearInterval(timer);
    holds.delete(token);
    void client.rpc(releaseMediaRpc, { token }).catch(() => {});
  }

  async function play(ref: string, volume: number, pauseMedia = false) {
    if (disposed || ref === "none" || volume <= 0) return;
    if (activePlays >= MAX_PENDING_PLAYS) throw new Error("Sound queue is full; try again shortly.");
    activePlays++;
    let token: string | null = null;
    try {
      const audio = await load(ref, volume);
      if (disposed) return;
      if (!audio) throw new Error(`Unknown sound: ${ref}`);
      const hold = pauseMedia ? await client.rpc(holdMediaRpc, {}).catch(() => null) : null;
      token = hold?.token ?? null;
      if (disposed) return;
      if (token) {
        const lease = token;
        let renewing = false;
        holds.set(lease, setInterval(() => {
          if (renewing || disposed) return;
          renewing = true;
          void client.rpc(renewMediaRpc, { token: lease }).catch(() => {}).finally(() => { renewing = false; });
        }, 20_000));
      }
      await client.playAudio(audio);
    } finally {
      if (token) release(token);
      activePlays--;
    }
  }

  function readSettings(): Promise<SoundSettings | null> {
    if (disposed) return Promise.resolve(null);
    if (settingsRead) return settingsRead;
    const started = generation;
    const request = client.rpc(settingsContract, {}).then(result => {
      if (disposed) return null;
      if (started !== generation) return readSettings();
      if (result.status !== "ready") return null;
      const parsed = SoundSettingsSchema.safeParse(result.values);
      return parsed.success ? parsed.data : null;
    }).finally(() => { if (settingsRead === request) settingsRead = null; });
    // Only coalesce concurrent reads. A later event reads current host settings,
    // including edits from other clients, instead of keeping a stale TTL cache.
    settingsRead = request;
    return request;
  }

  function invalidate() {
    generation++;
    audioCache.clear();
    cacheBytes = 0;
    loading.clear();
    settingsRead = null;
  }

  async function drainPreviews() {
    previewing = true;
    try {
      while (pending && !disposed) {
        const next = pending;
        pending = null;
        announce(next.ref);
        await play(next.ref, next.volume, next.pauseMedia).catch((error) => next.onError?.(error));
      }
    } finally {
      previewing = false;
      announce(null);
    }
  }

  return {
    play,
    preview(ref, volume, pauseMedia, onError) {
      if (disposed) return;
      pending = { ref, volume, pauseMedia, onError };
      if (!previewing) void drainPreviews().catch(error => console.warn("[notification-sounds] Preview failed", error));
    },
    onPreviewChange(listener) {
      previewListeners.add(listener);
      return () => {
        previewListeners.delete(listener);
      };
    },
    readSettings,
    invalidate,
    dispose() {
      if (disposed) return;
      disposed = true;
      pending = null;
      invalidate();
      for (const token of holds.keys()) release(token);
      previewListeners.clear();
    },
  };
}
