import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

export const MAX_CUSTOM_SOUND_BYTES = 5 * 1024 * 1024;
export const MAX_CUSTOM_SOUNDS = 5000;
export const MAX_LIBRARY_BYTES = 256 * 1024 * 1024;
export const CUSTOM_SOUND_EXTENSIONS = ["wav", "mp3", "ogg", "m4a", "aac", "flac"] as const;

export const CustomSoundSchema = z.object({
  /** Path inside the sound folder with `/` separators; also the `custom:` sound reference. */
  id: z.string(),
  name: z.string(),
  /** Folder path inside the sound folder, shown as "Warnings / Soft"; empty for top-level files. */
  category: z.string(),
  sizeBytes: z.number(),
  mimeType: z.string(),
});

export type CustomSound = z.infer<typeof CustomSoundSchema>;

export const AudioFileSchema = z.object({
  base64: z.string(),
  mimeType: z.string(),
});

export const listCustomSoundsRpc = defineRpc({
  name: "sounds.list",
  input: z.object({}),
  output: z.object({ folder: z.string(), sounds: z.array(CustomSoundSchema), truncated: z.boolean() }),
});

export const loadCustomSoundRpc = defineRpc({
  name: "sounds.load",
  input: z.object({ id: z.string(), volume: z.number().int().min(0).max(100) }),
  output: AudioFileSchema,
});

/** Plays a sound bundled with the plugin; `id` comes from shared/bundled-sounds.ts. */
export const loadBundledSoundRpc = defineRpc({
  name: "sounds.load-bundled",
  input: z.object({ id: z.string(), volume: z.number().int().min(0).max(100) }),
  output: AudioFileSchema,
});

/** Pauses playing media on the daemon machine; release the returned token after the sound. */
export const holdMediaRpc = defineRpc({
  name: "media.hold",
  input: z.object({}),
  /** `token` is null when media control is unsupported on the daemon's platform. */
  output: z.object({ token: z.string().nullable(), paused: z.number() }),
});

export const releaseMediaRpc = defineRpc({
  name: "media.release",
  input: z.object({ token: z.string().uuid() }),
  output: z.object({}),
});

/** Refresh a live lease while audio waits in the queue or plays. Expired leases stay expired. */
export const renewMediaRpc = defineRpc({
  name: "media.renew",
  input: z.object({ token: z.string().uuid() }),
  output: z.object({}),
});

export const mediaStatusRpc = defineRpc({
  name: "media.status",
  input: z.object({}),
  output: z.object({ supported: z.boolean(), players: z.number(), message: z.string().nullable() }),
});

export const importCustomSoundRpc = defineRpc({
  name: "sounds.import",
  input: z.object({
    /** A sound file, or a folder whose audio files are copied with their subfolders. */
    path: z.string().trim().min(1).max(4096),
    /** Optional destination folder inside the sound folder, such as "Warnings". */
    category: z.string().max(512).optional(),
  }),
  output: z.object({
    imported: z.number(),
    /** Files skipped because of their type, size, or destination depth. */
    skipped: z.number(),
    failed: z.number(),
    truncated: z.boolean(),
    destination: z.string(),
  }),
});

export const deleteCustomSoundRpc = defineRpc({
  name: "sounds.delete",
  input: z.object({ id: z.string() }),
  output: z.object({}),
});

export const openSoundFolderRpc = defineRpc({
  name: "sounds.open-folder",
  input: z.object({}),
  output: z.object({ folder: z.string() }),
});
