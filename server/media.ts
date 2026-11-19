/// <reference types="node" />
// Pauses other media on the daemon machine while a notification plays, then resumes it.
// Linux uses MPRIS; Windows and macOS use their desktop media adapters.
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readlink } from "node:fs/promises";
import type { RpcInput, RpcOutput } from "@getpaseo/plugin";
import type { holdMediaRpc, mediaStatusRpc, releaseMediaRpc, renewMediaRpc } from "../shared/rpc";

import { desktopMedia, desktopMediaHelp } from "./media-desktop";

const desktop = process.platform === "win32" || process.platform === "darwin";
const supported = desktop || process.platform === "linux";
const MPRIS_PREFIX = "org.mpris.MediaPlayer2.";
/** A hold that is never released (a client vanished mid-sound) expires after this long. */
const HOLD_TIMEOUT_MS = 60_000;
/** Quiet gap between pausing media and the sound, so the sound doesn't land on the music's tail. */
const PAUSE_LEAD_MS = 350;
/** Quiet gap after the last sound before media resumes; also keeps back-to-back sounds from
 *  resuming and re-pausing media in between. */
const RESUME_DELAY_MS = 600;
/** A slow or failed helper must not strand media, but a vanished player must not retry forever. */
const MAX_RESUME_ATTEMPTS = 3;

const holds = new Map<string, ReturnType<typeof setTimeout>>();
const paused = new Set<string>();
const resumeFailures = new Map<string, number>();
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
  if (desktop) return desktopMedia.listPlayers();
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
  if (desktop) return desktopMedia.playbackStatus(name).catch(() => null);
  const out = await gdbus([
    "--dest", name,
    "--object-path", "/org/mpris/MediaPlayer2",
    "--method", "org.freedesktop.DBus.Properties.Get",
    "org.mpris.MediaPlayer2.Player", "PlaybackStatus",
  ]).catch(() => null);
  return out ? (/'(\w+)'/.exec(out)?.[1] ?? null) : null;
}

async function control(name: string, method: "Pause" | "Play"): Promise<boolean> {
  if (desktop) return desktopMedia.control(name, method);
  await gdbus(["--dest", name, "--object-path", "/org/mpris/MediaPlayer2", "--method", `org.mpris.MediaPlayer2.Player.${method}`]);
  return true;
}

function forget(name: string): void {
  paused.delete(name);
  resumeFailures.delete(name);
}

async function resumePlayer(name: string): Promise<void> {
  try {
    // Desktop helpers check for the paused state themselves, in the same process as Play.
    if (!desktop) {
      const status = await playbackStatus(name);
      // Holds are reserved synchronously, even while this status query is pending.
      if (holds.size) return;
      if (status === null) throw new Error("Unknown playback status");
      if (status !== "Paused") { forget(name); return; }
    }
    await control(name, "Play");
    forget(name);
  } catch {
    const attempts = (resumeFailures.get(name) ?? 0) + 1;
    resumeFailures.set(name, attempts);
    if (attempts >= MAX_RESUME_ATTEMPTS) {
      forget(name);
      console.warn("[notification-sounds] Could not resume a media player.");
    }
  }
}

async function resumePaused(): Promise<void> {
  do {
    if (holds.size) return;
    await Promise.all([...paused].map(resumePlayer));
    // Failures stay in `paused`. Attempts are capped, so this loop ends during cleanup.
  } while (stopping && paused.size);
  scheduleResume();
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
  if (!supported || stopping || holds.size >= 32) return Promise.resolve({ token: null, paused: 0 });
  if (resumeTimer) { clearTimeout(resumeTimer); resumeTimer = null; }
  const token = randomUUID();
  holds.set(token, setTimeout(() => releaseHold(token), HOLD_TIMEOUT_MS));
  return enqueue(async () => {
    if (stopping || !holds.has(token)) return { token: null, paused: 0 };
    // Bound simultaneous helper processes and pause latency on unusually busy hosts.
    const players = (await listPlayers().catch(() => [])).slice(0, 16);
    let count = 0;
    await Promise.all(players.map(async name => {
      if (paused.has(name) || (await playbackStatus(name)) !== "Playing" || stopping || !holds.has(token)) return;
      let accepted: boolean;
      try {
        accepted = await control(name, "Pause");
      } catch {
        // A timed-out command can still take effect. This player was playing just before
        // the request, so if it is paused now, keep ownership and resume it later.
        accepted = (await playbackStatus(name)) === "Paused";
      }
      if (!accepted) return;
      // Even when cleanup began during the command, record ownership so cleanup
      // (queued behind this transition) can resume the player.
      paused.add(name);
      count++;
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
  if (!supported) {
    return { supported: false, players: 0, message: "Pausing media requires a Linux, Windows, or macOS host." };
  }
  try {
    const players = await listPlayers();
    return { supported: true, players: players.length, message: desktop ? desktopMediaHelp : null };
  } catch {
    return {
      supported: false,
      players: 0,
      message: desktop ? `Could not access desktop media controls. ${desktopMediaHelp}` : "Could not reach the desktop session bus. Media control needs gdbus and a logged-in desktop.",
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
