/// <reference types="node" />
// Pauses other media on the daemon machine while a notification plays, then resumes it.
// Linux only: talks to MPRIS players (browsers, Spotify, VLC, and most desktop players) over the
// session D-Bus with `gdbus`, which ships with GLib on nearly every desktop.
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readlink } from "node:fs/promises";
import type { RpcInput, RpcOutput } from "@getpaseo/plugin";
import type { holdMediaRpc, mediaStatusRpc, releaseMediaRpc, renewMediaRpc } from "../shared/rpc";

const MPRIS_PREFIX = "org.mpris.MediaPlayer2.";
/** A hold that is never released (a client vanished mid-sound) expires after this long. */
const HOLD_TIMEOUT_MS = 60_000;
/** Quiet gap between pausing media and the sound, so the sound doesn't land on the music's tail. */
const PAUSE_LEAD_MS = 350;
/** Quiet gap after the last sound before media resumes; also keeps back-to-back sounds from
 *  resuming and re-pausing media in between. */
const RESUME_DELAY_MS = 600;

const holds = new Map<string, ReturnType<typeof setTimeout>>();
const paused = new Set<string>();
let resumeTimer: ReturnType<typeof setTimeout> | null = null;
let stopping = false;
let cleanup: Promise<void> | null = null;
let transitions: Promise<unknown> = Promise.resolve();

function enqueue<T>(action: () => Promise<T>): Promise<T> {
  const result = transitions.then(action);
  transitions = result.catch(() => {});
  return result;
}

function gdbus(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile("gdbus", ["call", "--session", ...args], { timeout: 3000, maxBuffer: 64 * 1024 }, (error, stdout) => {
      if (error) reject(error);
      else resolve(stdout);
    });
  });
}

async function listPlayers(): Promise<string[]> {
  const out = await gdbus([
    "--dest", "org.freedesktop.DBus",
    "--object-path", "/org/freedesktop/DBus",
    "--method", "org.freedesktop.DBus.ListNames",
  ]);
  const names = [...out.matchAll(/'([^']+)'/g)].map((match) => match[1]).filter((name) => name.startsWith(MPRIS_PREFIX));
  const own = await Promise.all(names.map(isPaseo));
  return names.filter((_, index) => !own[index]);
}

/** Chromium-based apps register as `...instance<pid>`; skip Paseo's own window. */
async function isPaseo(name: string): Promise<boolean> {
  const pid = /instance(\d+)$/.exec(name)?.[1];
  if (!pid) return false;
  const exe = await readlink(`/proc/${pid}/exe`).catch(() => "");
  return /paseo/i.test(exe);
}

async function playbackStatus(name: string): Promise<string | null> {
  const out = await gdbus([
    "--dest", name,
    "--object-path", "/org/mpris/MediaPlayer2",
    "--method", "org.freedesktop.DBus.Properties.Get",
    "org.mpris.MediaPlayer2.Player", "PlaybackStatus",
  ]).catch(() => null);
  return out ? (/'(\w+)'/.exec(out)?.[1] ?? null) : null;
}

function control(name: string, method: "Pause" | "Play"): Promise<string> {
  return gdbus(["--dest", name, "--object-path", "/org/mpris/MediaPlayer2", "--method", `org.mpris.MediaPlayer2.Player.${method}`]);
}

async function resumePaused(): Promise<void> {
  if (holds.size) return;
  await Promise.all([...paused].map(async name => {
    const status = await playbackStatus(name);
    // Holds are reserved synchronously, even while this status query is pending.
    if (holds.size) return;
    if (status === "Paused") {
      try { await control(name, "Play"); }
      catch { console.warn("[notification-sounds] Could not resume a media player."); }
    }
    paused.delete(name);
  }));
}

function scheduleResume(): void {
  if (!stopping && !holds.size && paused.size && !resumeTimer) {
    resumeTimer = setTimeout(() => {
      resumeTimer = null;
      void enqueue(resumePaused);
    }, RESUME_DELAY_MS);
  }
}

function releaseHold(token: string): void {
  const timer = holds.get(token);
  if (!timer) return;
  clearTimeout(timer);
  holds.delete(token);
  scheduleResume();
}

export function holdMedia(_input: RpcInput<typeof holdMediaRpc>): Promise<RpcOutput<typeof holdMediaRpc>> {
  if (process.platform !== "linux" || stopping || holds.size >= 32) return Promise.resolve({ token: null, paused: 0 });
  if (resumeTimer) { clearTimeout(resumeTimer); resumeTimer = null; }
  const token = randomUUID();
  holds.set(token, setTimeout(() => releaseHold(token), HOLD_TIMEOUT_MS));
  return enqueue(async () => {
    if (stopping || !holds.has(token)) return { token: null, paused: 0 };
    // Bound simultaneous D-Bus processes and pause latency on unusually busy hosts.
    const players = (await listPlayers().catch(() => [])).slice(0, 16);
    let count = 0;
    await Promise.all(players.map(async name => {
      if (paused.has(name) || (await playbackStatus(name)) !== "Playing" || stopping || !holds.has(token)) return;
      try {
        await control(name, "Pause");
        // Even when cleanup began during the command, record ownership so cleanup
        // (queued behind this transition) can resume the player.
        paused.add(name);
        count++;
      } catch { /* A failed pause does not confer ownership. */ }
    }));
    if (count && !stopping) await new Promise(resolve => setTimeout(resolve, PAUSE_LEAD_MS));
    if (stopping || !paused.size || !holds.has(token)) {
      releaseHold(token);
      scheduleResume();
      return { token: null, paused: count };
    }
    return { token, paused: count };
  });
}

export async function releaseMedia({ token }: RpcInput<typeof releaseMediaRpc>): Promise<RpcOutput<typeof releaseMediaRpc>> {
  releaseHold(token);
  return {};
}

export async function renewMedia({ token }: RpcInput<typeof renewMediaRpc>): Promise<RpcOutput<typeof renewMediaRpc>> {
  const timer = holds.get(token);
  if (timer && !stopping) {
    clearTimeout(timer);
    holds.set(token, setTimeout(() => releaseHold(token), HOLD_TIMEOUT_MS));
  }
  return {};
}

export async function mediaStatus(_input: RpcInput<typeof mediaStatusRpc>): Promise<RpcOutput<typeof mediaStatusRpc>> {
  if (process.platform !== "linux") {
    return { supported: false, players: 0, message: "Pausing media is only supported when Paseo runs on Linux." };
  }
  try {
    const players = await listPlayers();
    return { supported: true, players: players.length, message: null };
  } catch {
    return {
      supported: false,
      players: 0,
      message: "Could not reach the desktop session bus. Media control needs gdbus and a logged-in desktop.",
    };
  }
}

/** Reject new work immediately, then drain transitions before resuming owned players. */
export function releaseAllMedia(): Promise<void> {
  if (cleanup) return cleanup;
  stopping = true;
  for (const timer of holds.values()) clearTimeout(timer);
  holds.clear();
  if (resumeTimer) { clearTimeout(resumeTimer); resumeTimer = null; }
  cleanup = enqueue(resumePaused);
  return cleanup;
}
