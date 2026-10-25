import type { SoundEventId } from "./events";
import type { SoundRule, SoundSettings } from "./settings";

export interface SoundContext {
  projectId?: string | null;
  /** Provider ID such as `claude`; a `provider/model` string is also accepted. */
  provider?: string | null;
}

export type SoundSource = "global" | "project" | "provider";

export interface ResolvedSound {
  /** Sound reference to play, or `none`. */
  sound: string;
  source: SoundSource;
}

export function providerIdOf(provider: string | null | undefined): string | null {
  const id = provider?.split("/")[0]?.trim();
  return id ? id : null;
}

function fromRule(rule: SoundRule | undefined, event: SoundEventId): string | undefined {
  if (!rule) return undefined;
  if (rule.mode === "muted") return "none";
  return rule.events[event];
}

/**
 * Picks the sound for one event: a project rule wins over a provider rule, which wins over the
 * global event setting. A muted rule silences every event.
 */
export function resolveSound(settings: SoundSettings, event: SoundEventId, context: SoundContext): ResolvedSound {
  const project = context.projectId ? settings.projectRules[context.projectId] : undefined;
  const projectSound = fromRule(project, event);
  if (projectSound !== undefined) return { sound: projectSound, source: "project" };

  const providerId = providerIdOf(context.provider);
  const provider = providerId ? settings.providerRules[providerId] : undefined;
  const providerSound = fromRule(provider, event);
  if (providerSound !== undefined) return { sound: providerSound, source: "provider" };

  const global = settings.events[event];
  return { sound: global.enabled ? global.sound : "none", source: "global" };
}
