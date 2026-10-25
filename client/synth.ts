// Built-in sounds are synthesized on the client as 16-bit mono WAV files, so the plugin
// can apply the volume setting exactly to these classic sounds.

import { volumeToGain } from "../shared/volume";

type Wave = "sine" | "triangle" | "square";

interface Note {
  /** Start time in seconds. */
  at: number;
  /** Frequency in Hz; `to` glides linearly to a second frequency over the note. */
  freq: number;
  to?: number;
  /** Length in seconds, including the decay tail. */
  dur: number;
  gain?: number;
  wave?: Wave;
  attack?: number;
  /** Decay time constant in seconds; smaller is more percussive. */
  decay?: number;
  /** Extra partials as [frequency ratio, relative gain, decay multiplier]. */
  partials?: [number, number, number][];
}

interface BuiltinSound {
  id: string;
  label: string;
  category: string;
  notes: Note[];
}

const BELL: [number, number, number][] = [
  [2.0, 0.35, 0.6],
  [2.76, 0.25, 0.45],
  [5.4, 0.12, 0.25],
];
const MARIMBA: [number, number, number][] = [
  [4.0, 0.3, 0.2],
  [9.2, 0.08, 0.1],
];

export const BUILTIN_CATEGORY_ORDER = ["Chimes", "Positive", "Attention", "Negative"];

export const BUILTIN_SOUNDS: BuiltinSound[] = [
  {
    id: "chime",
    label: "Chime",
    category: "Chimes",
    notes: [
      { at: 0, freq: 1046.5, dur: 0.6, gain: 0.5, decay: 0.22, partials: BELL },
      { at: 0.13, freq: 1568, dur: 0.9, gain: 0.45, decay: 0.3, partials: BELL },
    ],
  },
  {
    id: "ding",
    label: "Ding",
    category: "Chimes",
    notes: [{ at: 0, freq: 880, dur: 1.2, gain: 0.55, decay: 0.4, partials: BELL }],
  },
  {
    id: "bell",
    label: "Bell",
    category: "Chimes",
    notes: [
      {
        at: 0,
        freq: 659.3,
        dur: 1.6,
        gain: 0.5,
        decay: 0.55,
        partials: [
          [2.0, 0.5, 0.7],
          [3.01, 0.3, 0.5],
          [4.17, 0.2, 0.4],
          [5.43, 0.12, 0.3],
        ],
      },
    ],
  },
  {
    id: "marimba",
    label: "Marimba",
    category: "Chimes",
    notes: [
      { at: 0, freq: 880, dur: 0.45, gain: 0.55, decay: 0.12, partials: MARIMBA },
      { at: 0.1, freq: 1108.7, dur: 0.45, gain: 0.5, decay: 0.12, partials: MARIMBA },
      { at: 0.2, freq: 1318.5, dur: 0.6, gain: 0.5, decay: 0.16, partials: MARIMBA },
    ],
  },
  {
    id: "success",
    label: "Success",
    category: "Positive",
    notes: [
      { at: 0, freq: 523.3, dur: 0.25, gain: 0.4, wave: "triangle", decay: 0.1 },
      { at: 0.07, freq: 659.3, dur: 0.25, gain: 0.4, wave: "triangle", decay: 0.1 },
      { at: 0.14, freq: 784, dur: 0.25, gain: 0.4, wave: "triangle", decay: 0.1 },
      { at: 0.21, freq: 1046.5, dur: 0.6, gain: 0.45, wave: "triangle", decay: 0.2 },
    ],
  },
  {
    id: "rise",
    label: "Rise",
    category: "Positive",
    notes: [
      { at: 0, freq: 523.3, dur: 0.35, gain: 0.45, decay: 0.12 },
      { at: 0.11, freq: 659.3, dur: 0.35, gain: 0.45, decay: 0.12 },
      { at: 0.22, freq: 784, dur: 0.5, gain: 0.45, decay: 0.18 },
    ],
  },
  {
    id: "fall",
    label: "Fall",
    category: "Negative",
    notes: [
      { at: 0, freq: 784, dur: 0.35, gain: 0.45, decay: 0.12 },
      { at: 0.11, freq: 659.3, dur: 0.35, gain: 0.45, decay: 0.12 },
      { at: 0.22, freq: 523.3, dur: 0.5, gain: 0.45, decay: 0.18 },
    ],
  },
  {
    id: "bubble",
    label: "Bubble",
    category: "Positive",
    notes: [
      { at: 0, freq: 380, to: 900, dur: 0.09, gain: 0.5, attack: 0.004, decay: 0.05 },
      { at: 0.11, freq: 480, to: 1150, dur: 0.11, gain: 0.5, attack: 0.004, decay: 0.06 },
    ],
  },
  {
    id: "pop",
    label: "Pop",
    category: "Attention",
    notes: [{ at: 0, freq: 900, to: 260, dur: 0.08, gain: 0.6, attack: 0.002, decay: 0.03 }],
  },
  {
    id: "knock",
    label: "Knock",
    category: "Attention",
    notes: [
      { at: 0, freq: 210, to: 150, dur: 0.12, gain: 0.8, wave: "triangle", attack: 0.002, decay: 0.035 },
      { at: 0.16, freq: 210, to: 150, dur: 0.12, gain: 0.8, wave: "triangle", attack: 0.002, decay: 0.035 },
    ],
  },
  {
    id: "alert",
    label: "Alert",
    category: "Attention",
    notes: [
      { at: 0, freq: 1000, dur: 0.09, gain: 0.45, wave: "square", attack: 0.003, decay: 0.2 },
      { at: 0.14, freq: 1000, dur: 0.09, gain: 0.45, wave: "square", attack: 0.003, decay: 0.2 },
      { at: 0.28, freq: 1000, dur: 0.09, gain: 0.45, wave: "square", attack: 0.003, decay: 0.2 },
    ],
  },
  {
    id: "error",
    label: "Error",
    category: "Negative",
    notes: [
      { at: 0, freq: 440, dur: 0.22, gain: 0.4, wave: "triangle", decay: 0.15 },
      { at: 0.2, freq: 311.1, dur: 0.4, gain: 0.45, wave: "triangle", decay: 0.2 },
    ],
  },
  {
    id: "soft",
    label: "Soft",
    category: "Chimes",
    notes: [{ at: 0, freq: 587.3, dur: 0.9, gain: 0.45, attack: 0.06, decay: 0.3, partials: [[2, 0.15, 0.6]] }],
  },
];

const SAMPLE_RATE = 22050;

function oscillator(wave: Wave, phase: number): number {
  const cycle = phase / (2 * Math.PI);
  const frac = cycle - Math.floor(cycle);
  switch (wave) {
    case "triangle":
      return 1 - 4 * Math.abs(frac - 0.5);
    case "square":
      return frac < 0.5 ? 0.7 : -0.7;
    default:
      return Math.sin(phase);
  }
}

function render(notes: Note[], gain: number): Int16Array {
  const length = Math.max(...notes.map((note) => note.at + note.dur)) + 0.02;
  const samples = new Float32Array(Math.ceil(length * SAMPLE_RATE));
  for (const note of notes) {
    const start = Math.floor(note.at * SAMPLE_RATE);
    const count = Math.floor(note.dur * SAMPLE_RATE);
    const attack = note.attack ?? 0.008;
    const decay = note.decay ?? 0.2;
    const wave = note.wave ?? "sine";
    const voices: [number, number, number][] = [[1, 1, 1], ...(note.partials ?? [])];
    const phases = voices.map(() => 0);
    for (let i = 0; i < count; i++) {
      const t = i / SAMPLE_RATE;
      const progress = i / count;
      const freq = note.to === undefined ? note.freq : note.freq + (note.to - note.freq) * progress;
      // Short fade at the very end keeps every note click-free.
      const tail = Math.min(1, (count - i) / (0.01 * SAMPLE_RATE));
      const rise = Math.min(1, t / attack);
      let value = 0;
      voices.forEach(([ratio, level, decayScale], index) => {
        phases[index] += (2 * Math.PI * freq * ratio) / SAMPLE_RATE;
        const envelope = rise * Math.exp(-t / (decay * decayScale)) * tail;
        value += oscillator(index === 0 ? wave : "sine", phases[index]) * level * envelope;
      });
      samples[start + i] += value * (note.gain ?? 0.5);
    }
  }
  const pcm = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    pcm[i] = Math.max(-32768, Math.min(32767, Math.round(samples[i] * gain * 32767)));
  }
  return pcm;
}

function wavBytes(pcm: Int16Array): Uint8Array {
  const bytes = new Uint8Array(44 + pcm.length * 2);
  const view = new DataView(bytes.buffer);
  const ascii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) bytes[offset + i] = text.charCodeAt(i);
  };
  ascii(0, "RIFF");
  view.setUint32(4, 36 + pcm.length * 2, true);
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, SAMPLE_RATE, true);
  view.setUint32(28, SAMPLE_RATE * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  ascii(36, "data");
  view.setUint32(40, pcm.length * 2, true);
  for (let i = 0; i < pcm.length; i++) view.setInt16(44 + i * 2, pcm[i], true);
  return bytes;
}

const BASE64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

function toBase64(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i];
    const b = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const c = i + 2 < bytes.length ? bytes[i + 2] : 0;
    const triple = (a << 16) | (b << 8) | c;
    out += BASE64[(triple >> 18) & 63] + BASE64[(triple >> 12) & 63];
    out += i + 1 < bytes.length ? BASE64[(triple >> 6) & 63] : "=";
    out += i + 2 < bytes.length ? BASE64[triple & 63] : "=";
  }
  return out;
}

/** Returns a playable WAV for a built-in sound, or null when the ID is unknown. */
export function synthesizeBuiltin(id: string, volume: number): { base64: string; mimeType: string } | null {
  const sound = BUILTIN_SOUNDS.find((candidate) => candidate.id === id);
  if (!sound) return null;
  return { base64: toBase64(wavBytes(render(sound.notes, volumeToGain(volume)))), mimeType: "audio/wav" };
}
