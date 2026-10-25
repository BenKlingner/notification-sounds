import { defineSettings } from "@getpaseo/plugin";
import { z } from "zod";
import { SOUND_EVENTS, SOUND_EVENT_IDS, type SoundEventId } from "./events";

/**
 * A sound reference: `bundled:<id>` (audio shipped with the plugin), `builtin:<id>` (synthesized
 * classics), `custom:<file name>`, or `none`. Custom files live in the daemon's sound folder;
 * see server/sounds.ts.
 */
export const SoundRefSchema = z.string().min(1).max(2048);

const eventSettingsSchema = (id: SoundEventId) =>
  z
    .object({
      enabled: z.boolean().default(SOUND_EVENTS[id].defaultEnabled),
      sound: SoundRefSchema.default(SOUND_EVENTS[id].defaultSound),
      /** Pause other media while this event's sound plays, when `pauseMedia` allows it. Applies
       *  to every project and provider; rules change only the sound. */
      pauseMedia: z.boolean().default(true),
    })
    .prefault({});

const eventsShape = Object.fromEntries(
  SOUND_EVENT_IDS.map((id) => [id, eventSettingsSchema(id)]),
) as { [K in SoundEventId]: ReturnType<typeof eventSettingsSchema> };

/**
 * Overrides for one project or provider. `events` maps an event to a sound reference;
 * `none` silences it, and a missing event falls through to the next layer.
 */
export const SoundRuleSchema = z.object({
  /** Display name saved with the rule, so it still reads well if the project disappears. */
  name: z.string().default(""),
  mode: z.enum(["muted", "custom"]).default("custom"),
  events: z.partialRecord(z.enum(SOUND_EVENT_IDS), SoundRefSchema).default({}),
});

export type SoundRule = z.infer<typeof SoundRuleSchema>;

export const SoundSettingsSchema = z.object({
  enabled: z.boolean().default(true),
  /** 0 to 100. Applies to built-in sounds, PCM WAV, and MP3; other formats play as recorded. */
  volume: z.number().int().min(0).max(100).default(70),
  includeSubagents: z.boolean().default(false),
  /** Master switch: lets events pause other media on the daemon machine while their sound
   *  plays (Linux). Each event opts in with its own `pauseMedia`. */
  pauseMedia: z.boolean().default(false),
  /** Minimum gap between two sounds for the same event, so a burst of agents plays once. */
  cooldownMs: z.number().int().min(0).max(60_000).default(1500),
  events: z.object(eventsShape).prefault({}),
  /** Starred sound references, in the order they were starred; shown first in the picker. */
  favorites: z.array(SoundRefSchema).default([]),
  /** Keyed by Paseo project ID. Checked before provider rules. */
  projectRules: z.record(z.string(), SoundRuleSchema).default({}),
  /** Keyed by provider ID such as `claude` or `codex`. */
  providerRules: z.record(z.string(), SoundRuleSchema).default({}),
});

export type SoundSettings = z.infer<typeof SoundSettingsSchema>;

export const soundSettings = defineSettings({
  id: "sounds",
  scope: "host",
  version: 1,
  schema: SoundSettingsSchema,
});
