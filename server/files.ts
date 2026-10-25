/// <reference types="node" />
import { constants } from "node:fs";
import { lstat, mkdir, open, realpath, type FileHandle } from "node:fs/promises";
import path from "node:path";
import { MAX_CUSTOM_SOUND_BYTES } from "../shared/rpc";

export function isCode(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === code;
}

/** Linux directory descriptors anchor operations even if a parent is renamed or
 * replaced. Other platforms reject existing links, but Node's pathname APIs
 * cannot exclude concurrent directory replacement by another local process. */
export async function inDirectory<T>(
  root: string,
  segments: string[],
  create: boolean,
  use: (directory: string) => Promise<T>,
): Promise<T> {
  const handles: FileHandle[] = [];
  const linux = process.platform === "linux";
  // Anchor the entire absolute path from /, including the library root's parents.
  const parents = linux ? path.resolve(root).split(path.sep).filter(Boolean) : [];
  let directory = linux ? path.parse(root).root : root;
  try {
    const components = [null, ...parents, ...segments];
    for (const [index, segment] of components.entries()) {
      if (segment !== null) {
        if (index > parents.length && (!segment || segment === "." || segment === ".." || /[\\/:\0]/.test(segment))) {
          throw new Error("Invalid sound directory.");
        }
        directory = path.join(directory, segment);
        if (create && index > parents.length) await mkdir(directory).catch(error => { if (!isCode(error, "EEXIST")) throw error; });
      }
      const before = await lstat(directory);
      if (!before.isDirectory() || before.isSymbolicLink()) throw new Error("Sound directories cannot be symbolic links.");
      if (linux) {
        const handle = await open(directory, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
        handles.push(handle);
        const after = await handle.stat();
        if (before.dev !== after.dev || before.ino !== after.ino) throw new Error("Sound directory changed; try again.");
        directory = `/proc/self/fd/${handle.fd}`;
      } else {
        if (await realpath(directory) !== directory) throw new Error("Sound directory changed; try again.");
      }
    }
    return await use(directory);
  } finally {
    await Promise.all(handles.map(handle => handle.close()));
  }
}

/** Bounded reads from regular files only. O_NONBLOCK avoids hanging on a FIFO
 * swapped in between lstat and open; the handle's identity is checked afterward. */
export async function readAudio(file: string): Promise<Buffer> {
  const before = await lstat(file);
  if (!before.isFile() || before.isSymbolicLink()) throw new Error("Choose a regular audio file, not a link or device.");
  if (before.size > MAX_CUSTOM_SOUND_BYTES) throw new Error("Audio files must be 5 MB or smaller.");
  const handle = await open(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
  try {
    const info = await handle.stat();
    if (!info.isFile() || before.dev !== info.dev || before.ino !== info.ino || info.size > MAX_CUSTOM_SOUND_BYTES) {
      throw new Error("Audio file changed; try again.");
    }
    const bytes = Buffer.alloc(info.size + 1);
    let size = 0;
    while (size < bytes.length) {
      const read = await handle.read(bytes, size, bytes.length - size, size);
      if (!read.bytesRead) break;
      size += read.bytesRead;
    }
    if (size !== info.size) throw new Error("Audio file changed while reading; try again.");
    return bytes.subarray(0, size);
  } finally {
    await handle.close();
  }
}
