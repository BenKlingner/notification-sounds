// Agent events the plugin can play a sound for. The client detects each one from the
// agent directory subscription; see client/watcher.ts. Default sounds come from the bundled
// library (shared/bundled-sounds.ts); they were chosen by listening to a shortlist with Gemini.

export const SOUND_EVENT_IDS = [
  "finished",
  "error",
  "permission",
  "question",
  "plan",
  "turnStarted",
  "agentCreated",
  "agentArchived",
] as const;

export type SoundEventId = (typeof SOUND_EVENT_IDS)[number];

export interface SoundEventInfo {
  id: SoundEventId;
  label: string;
  hint: string;
  defaultEnabled: boolean;
  defaultSound: string;
}

export const SOUND_EVENTS: Record<SoundEventId, SoundEventInfo> = {
  finished: {
    id: "finished",
    label: "Agent finished",
    hint: "An agent completes its turn and is waiting for you.",
    defaultEnabled: true,
    defaultSound: "bundled:UI/Gentle mallet task completed",
  },
  error: {
    id: "error",
    label: "Agent failed",
    hint: "An agent stops because of an error.",
    defaultEnabled: true,
    defaultSound: "bundled:UI/Low two-note fail thud",
  },
  permission: {
    id: "permission",
    label: "Permission needed",
    hint: "An agent asks to run a tool or change modes.",
    defaultEnabled: true,
    defaultSound: "bundled:UI/Woody two-tone chat knock",
  },
  question: {
    id: "question",
    label: "Question asked",
    hint: "An agent asks you a question.",
    defaultEnabled: true,
    defaultSound: "bundled:UI/Hollow chat bubble pop",
  },
  plan: {
    id: "plan",
    label: "Plan ready",
    hint: "An agent proposes a plan for you to approve.",
    defaultEnabled: true,
    defaultSound: "bundled:UI/Bright two-note confirmation chime",
  },
  turnStarted: {
    id: "turnStarted",
    label: "Agent started working",
    hint: "An agent begins a new turn.",
    defaultEnabled: false,
    defaultSound: "bundled:UI/Short wooden mallet alert",
  },
  agentCreated: {
    id: "agentCreated",
    label: "Agent created",
    hint: "A new agent appears on this host.",
    defaultEnabled: false,
    defaultSound: "bundled:UI/Fast synth arpeggio roll-up",
  },
  agentArchived: {
    id: "agentArchived",
    label: "Agent archived",
    hint: "An agent is archived or removed.",
    defaultEnabled: false,
    defaultSound: "bundled:UI/Soft whoosh message sent",
  },
};
