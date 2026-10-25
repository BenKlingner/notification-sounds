/// <reference types="node" />
import { spawn } from "node:child_process";
import { lstat, mkdir, open, opendir, realpath, unlink } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import type { RpcInput, RpcOutput } from "@getpaseo/plugin";
import {
  CUSTOM_SOUND_EXTENSIONS,
  MAX_CUSTOM_SOUND_BYTES,
  MAX_CUSTOM_SOUNDS,
  MAX_LIBRARY_BYTES,
  type CustomSound,
  type deleteCustomSoundRpc,
  type importCustomSoundRpc,
  type loadBundledSoundRpc,
  type listCustomSoundsRpc,
  type loadCustomSoundRpc,
  type openSoundFolderRpc,
} from "../shared/rpc";
import { volumeToGain } from "../shared/volume";
import { BUNDLED_AUDIO } from "./bundled-audio";
import { scaleMp3 } from "./mp3";
import { scaleWav } from "./wav";
import { inDirectory, isCode, readAudio } from "./files";

type Extension = (typeof CUSTOM_SOUND_EXTENSIONS)[number];

const MIME_TYPES: Record<Extension, string> = {
  wav: "audio/wav",
  mp3: "audio/mpeg",
  ogg: "audio/ogg",
  m4a: "audio/mp4",
  aac: "audio/aac",
  flac: "audio/flac",
};

/** Subfolders are sections; deeper nesting than this is ignored. */
const MAX_DEPTH = 4;

export function soundFolder(): string {
  const paseoHome = process.env.PASEO_HOME?.trim() || path.join(homedir(), ".paseo");
  return path.resolve(paseoHome, "notification-sounds");
}

async function ensureFolder(): Promise<string> {
  // The configured Paseo home may legitimately be a symlink. Canonicalize that
  // trusted parent, never the library itself: a swapped library link must fail.
  const parent = path.dirname(soundFolder());
  await mkdir(parent, { recursive: true });
  const folder = path.join(await realpath(parent), "notification-sounds");
  await mkdir(folder).catch(error => { if (!isCode(error, "EEXIST")) throw error; });
  const info = await lstat(folder);
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("The sound folder must be a regular directory.");
  return folder;
}

function extensionOf(fileName: string): Extension | null {
  const ext = path.extname(fileName).slice(1).toLowerCase();
  return (CUSTOM_SOUND_EXTENSIONS as readonly string[]).includes(ext) ? (ext as Extension) : null;
}

function displayName(fileName: string): string {
  return path.basename(fileName, path.extname(fileName)).replace(/[-_]+/g, " ").trim() || fileName;
}

function hidden(segment: string): boolean {
  return segment.startsWith(".");
}

/** Resolves a sound ID such as `Warnings/alarm.wav` to a file inside the folder, refusing escapes. */
function resolveSoundPath(folder: string, id: string): string {
  const segments = id.split("/");
  const valid =
    segments.length <= MAX_DEPTH + 1 &&
    segments.every((segment) => segment && segment !== ".." && !hidden(segment) && !/[\\:\0]/.test(segment)) &&
    extensionOf(id) !== null;
  const resolved = path.join(folder, ...segments);
  if (!valid || !resolved.startsWith(folder + path.sep)) throw new Error(`Invalid sound: ${id}`);
  return resolved;
}

/** Cleans a user-typed category such as "Warnings / Soft" into safe folder segments. */
function categorySegments(category: string | undefined): string[] {
  return (category ?? "")
    .split(/[\\/]/)
    .map((segment) => segment.trim().replace(/[^\w.\- ]+/g, "_").replace(/^\.+/, ""))
    .filter(Boolean);
}

function safeFileName(name: string): string {
  const clean = name.replace(/[^\w.\- ]+/g, "_").replace(/^[. ]+|[. ]+$/g, "") || "sound";
  return /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(clean) ? `_${clean}` : clean;
}

/** True when `child` is `parent` or lies anywhere beneath it. Handles filesystem roots and other drives. */
function contains(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  return relative === "" || (!path.isAbsolute(relative) && relative.split(path.sep)[0] !== "..");
}

// Bound discovery even when a directory contains many unsupported files.
const MAX_SCAN_ENTRIES = 20_000;
const OPERATION_MS = 30_000;
let stopping = false;
export function stopSoundOperations(): Promise<unknown> { stopping = true; return mutationQueue; }

type Scan = { remaining: number; deadline: number; truncated: boolean };
const newScan = (): Scan => ({ remaining: MAX_SCAN_ENTRIES, deadline: Date.now() + OPERATION_MS, truncated: false });

async function walk(
  root: string,
  relative: string[],
  scan: Scan,
  visit: (absolute: string, relative: string[], size: number) => Promise<boolean>,
): Promise<boolean> {
  return inDirectory(root, relative, false, async directory => {
    const entries = await opendir(directory);
    for await (const entry of entries) {
      if (stopping || --scan.remaining < 0 || Date.now() > scan.deadline) {
        scan.truncated = true;
        return false;
      }
      if (hidden(entry.name) || /[\\:\0]/.test(entry.name)) continue;
      const next = [...relative, entry.name];
      if (entry.isDirectory()) {
        if (relative.length >= MAX_DEPTH) { scan.truncated = true; continue; }
        if (!(await walk(root, next, scan, visit))) return false;
      } else if (entry.isFile()) {
        const absolute = path.join(directory, entry.name);
        const info = await lstat(absolute);
        if (info.isFile() && !(await visit(absolute, next, info.size))) return false;
      }
    }
    return true;
  });
}

async function catalog(folder: string, scan = newScan()) {
  const sounds: CustomSound[] = [];
  await walk(folder, [], scan, async (_absolute, relative, size) => {
    const fileName = relative[relative.length - 1];
    const ext = extensionOf(fileName);
    if (ext) {
      if (sounds.length >= MAX_CUSTOM_SOUNDS) { scan.truncated = true; return false; }
      sounds.push({ id: relative.join("/"), name: displayName(fileName),
        category: relative.slice(0, -1).join(" / "), sizeBytes: size, mimeType: MIME_TYPES[ext] });
    }
    return true;
  });
  sounds.sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
  return { folder, sounds, truncated: scan.truncated };
}

export async function listCustomSounds(
  _input: RpcInput<typeof listCustomSoundsRpc>,
): Promise<RpcOutput<typeof listCustomSoundsRpc>> {
  return catalog(await ensureFolder());
}

export async function loadCustomSound({
  id,
  volume,
}: RpcInput<typeof loadCustomSoundRpc>): Promise<RpcOutput<typeof loadCustomSoundRpc>> {
  const folder = await ensureFolder();
  resolveSoundPath(folder, id);
  const segments = id.split("/");
  const name = segments.pop()!;
  const ext = extensionOf(id)!;
  let bytes = await inDirectory(folder, segments, false, directory => readAudio(path.join(directory, name)));
  if (ext === "wav") bytes = scaleWav(bytes, volumeToGain(volume));
  else if (ext === "mp3") bytes = scaleMp3(bytes, volumeToGain(volume));
  return { base64: bytes.toString("base64"), mimeType: MIME_TYPES[ext] };
}

export async function loadBundledSound({
  id,
  volume,
}: RpcInput<typeof loadBundledSoundRpc>): Promise<RpcOutput<typeof loadBundledSoundRpc>> {
  const data = Object.hasOwn(BUNDLED_AUDIO, id) ? BUNDLED_AUDIO[id] : undefined;
  if (!data) throw new Error(`Unknown bundled sound: ${id}`);
  const gain = volumeToGain(volume);
  const base64 = gain >= 0.999 ? data : scaleMp3(Buffer.from(data, "base64"), gain).toString("base64");
  return { base64, mimeType: "audio/mpeg" };
}

// Serialize mutations so concurrent clients share the same library quota.
let mutationQueue: Promise<unknown> = Promise.resolve();
let pendingMutations = 0;
function mutate<T>(run: () => Promise<T>): Promise<T> {
  if (stopping || pendingMutations >= 16) return Promise.reject(new Error("Sound library is busy; try again."));
  pendingMutations++;
  const result = mutationQueue.then(() => {
    if (stopping) throw new Error("Sound library is stopping.");
    return run();
  });
  mutationQueue = result.catch(() => {}).finally(() => { pendingMutations--; });
  return result;
}

async function copyInto(bytes: Buffer, name: string, directory: string): Promise<void> {
  const ext = path.extname(name);
  const base = path.basename(name, ext);
  for (let n = 1; n <= MAX_CUSTOM_SOUNDS + 1; n++) {
    const target = path.join(directory, n === 1 ? name : `${base}-${n}${ext}`);
    const file = await open(target, "wx", 0o600).catch(error => {
      if (isCode(error, "EEXIST")) return null;
      throw error;
    });
    if (!file) continue;
    try {
      await file.writeFile(bytes);
    } catch (error) {
      await file.close();
      await unlink(target).catch(() => {});
      throw error;
    }
    await file.close();
    return;
  }
  throw new Error("Too many files with this name.");
}

export function importCustomSound(input: RpcInput<typeof importCustomSoundRpc>): Promise<RpcOutput<typeof importCustomSoundRpc>> {
  return mutate(() => importSounds(input));
}

async function importSounds({ path: sourceInput, category }: RpcInput<typeof importCustomSoundRpc>): Promise<RpcOutput<typeof importCustomSoundRpc>> {
  const trimmed = sourceInput.trim().replace(/^["']|["']$/g, "");
  const source = await realpath(path.resolve(trimmed.startsWith("~/") || trimmed === "~" ? path.join(homedir(), trimmed.slice(1)) : trimmed));
  const info = await lstat(source);
  const folder = await ensureFolder();
  if (contains(folder, source) || contains(source, folder)) {
    throw new Error("Choose a source outside the sound folder that does not contain it.");
  }
  const sections = categorySegments(category);
  if (info.isDirectory() && !category?.trim()) sections.push(safeFileName(path.basename(source)));
  if (sections.length > MAX_DEPTH) throw new Error("Use at most four section levels.");
  const destination = path.join(folder, ...sections);
  // Validate even if the import later reaches its quota or contains no supported files.
  await inDirectory(folder, sections, true, async () => {});
  const scan = newScan();
  const existing = await catalog(folder, scan);
  let count = existing.sounds.length;
  let totalBytes = existing.sounds.reduce((sum, sound) => sum + sound.sizeBytes, 0);
  const result = { imported: 0, skipped: 0, failed: 0, truncated: existing.truncated, destination };
  if (existing.truncated) return result; // An incomplete inventory cannot establish free capacity.
  const add = async (absolute: string, relative: string[], size: number): Promise<boolean> => {
    if (!extensionOf(absolute) || size > MAX_CUSTOM_SOUND_BYTES || sections.length + relative.length - 1 > MAX_DEPTH) {
      result.skipped++; return true;
    }
    if (stopping || Date.now() > scan.deadline || count >= MAX_CUSTOM_SOUNDS || totalBytes + size > MAX_LIBRARY_BYTES) {
      result.truncated = true; return false;
    }
    try {
      const bytes = await readAudio(absolute);
      if (stopping || Date.now() > scan.deadline) { result.truncated = true; return false; }
      if (totalBytes + bytes.length > MAX_LIBRARY_BYTES) { result.truncated = true; return false; }
      const subfolders = relative.slice(0, -1).map(safeFileName);
      const ext = path.extname(absolute).toLowerCase();
      const name = `${safeFileName(path.basename(absolute, path.extname(absolute)))}${ext}`;
      await inDirectory(folder, [...sections, ...subfolders], true, directory =>
        copyInto(bytes, name, directory));
      result.imported++; count++; totalBytes += bytes.length;
    } catch {
      // Preserve an accurate summary of an already partly completed batch.
      result.failed++;
    }
    return true;
  };
  if (info.isFile()) {
    if (!extensionOf(source)) throw new Error("Unsupported audio file type.");
    await add(source, [path.basename(source)], info.size);
  } else if (info.isDirectory()) {
    await walk(source, [], scan, add).catch(() => { result.failed++; result.truncated = true; });
  } else throw new Error("Choose a regular audio file or folder.");
  result.truncated ||= scan.truncated;
  return result;
}

export function deleteCustomSound({ id }: RpcInput<typeof deleteCustomSoundRpc>): Promise<RpcOutput<typeof deleteCustomSoundRpc>> {
  return mutate(async () => {
    const folder = await ensureFolder();
    resolveSoundPath(folder, id);
    const segments = id.split("/");
    const name = segments.pop()!;
    await inDirectory(folder, segments, false, async directory => {
      const target = path.join(directory, name);
      const info = await lstat(target);
      if (!info.isFile() || info.isSymbolicLink()) throw new Error("Only regular sound files can be deleted.");
      await unlink(target);
    });
    // Leave empty sections intact; deleting parent directories introduces another
    // filesystem race and is unnecessary for deleting the selected recording.
    return {};
  });
}

export async function openSoundFolder(
  _input: RpcInput<typeof openSoundFolderRpc>,
): Promise<RpcOutput<typeof openSoundFolderRpc>> {
  const folder = await ensureFolder();
  const command =
    process.platform === "darwin" ? "open" : process.platform === "win32" ? "explorer" : "xdg-open";
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, [folder], { detached: true, stdio: "ignore" });
    child.once("error", reject);
    child.once("spawn", () => {
      child.unref();
      resolve();
    });
  });
  return { folder };
}
