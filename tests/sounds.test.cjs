const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { loader } = require('./load.cjs');

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'notification-sounds-test-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const load = loader({}, { process: { ...process, env: { ...process.env, PASEO_HOME: root } } });
  const sounds = load('server/sounds');
  const folder = sounds.soundFolder();
  await fs.mkdir(folder);
  return { root, folder, sounds, load };
}

test('symlinked sound directories cannot be read, deleted, or imported into', async t => {
  const { root, folder, sounds } = await fixture(t);
  const outside = path.join(root, 'outside'); await fs.mkdir(outside);
  await fs.writeFile(path.join(outside, 'keep.wav'), 'sentinel');
  await fs.symlink(outside, path.join(folder, 'linked'), 'junction');
  await assert.rejects(sounds.loadCustomSound({ id: 'linked/keep.wav', volume: 100 }));
  await assert.rejects(sounds.deleteCustomSound({ id: 'linked/keep.wav' }));
  await assert.rejects(sounds.importCustomSound({ path: path.join(outside, 'keep.wav'), category: 'linked' }));
  assert.equal(await fs.readFile(path.join(outside, 'keep.wav'), 'utf8'), 'sentinel');
  assert.deepEqual(await fs.readdir(outside), ['keep.wav']);
});

test('final file symlinks and non-files are rejected, ordinary files still load', async t => {
  const { root, folder, sounds } = await fixture(t);
  const external = path.join(root, 'outside.wav'); await fs.writeFile(external, 'sentinel');
  await fs.symlink(external, path.join(folder, 'linked.wav'));
  await assert.rejects(sounds.loadCustomSound({ id: 'linked.wav', volume: 100 }));
  await fs.mkdir(path.join(folder, 'directory.wav'));
  await assert.rejects(sounds.loadCustomSound({ id: 'directory.wav', volume: 100 }));
  await fs.writeFile(path.join(folder, 'real.wav'), 'audio');
  assert.equal(Buffer.from((await sounds.loadCustomSound({ id: 'real.wav', volume: 100 })).base64, 'base64').toString(), 'audio');
});

test('concurrent imports preserve both recordings with unique names', async t => {
  const { root, folder, sounds } = await fixture(t);
  for (const name of ['one', 'two']) {
    await fs.mkdir(path.join(root, name));
    await fs.writeFile(path.join(root, name, 'same.wav'), name);
  }
  await Promise.all(['one', 'two'].map(name => sounds.importCustomSound({ path: path.join(root, name, 'same.wav') })));
  const files = await fs.readdir(folder);
  assert.equal(files.length, 2);
  const contents = await Promise.all(files.map(file => fs.readFile(path.join(folder, file), 'utf8')));
  assert.deepEqual(contents.sort(), ['one', 'two']);
});

test('imports skip files that would exceed destination nesting depth', async t => {
  const { root, sounds } = await fixture(t);
  const source = path.join(root, 'tree');
  await fs.mkdir(path.join(source, 'a/b/c/d'), { recursive: true });
  await fs.writeFile(path.join(source, 'a/b/c/d/deep.wav'), 'audio');
  await fs.writeFile(path.join(source, 'shallow.wav'), 'audio');
  const result = await sounds.importCustomSound({ path: source });
  assert.equal(result.imported, 1);
  assert.equal(result.skipped, 1);
  assert.deepEqual(Array.from((await sounds.listCustomSounds({})).sounds, s => s.id), ['tree/shallow.wav']);
});

test('listing and repeated imports enforce a library-wide count limit', async t => {
  const { root, folder, sounds, load } = await fixture(t);
  const { MAX_CUSTOM_SOUNDS } = load('shared/rpc');
  await fs.mkdir(path.join(folder, 'a')); await fs.mkdir(path.join(folder, 'b'));
  // Real files exercise recursive termination, including a sibling after the cap.
  for (let i = 0; i < MAX_CUSTOM_SOUNDS; i += 100) {
    await Promise.all(Array.from({ length: Math.min(100, MAX_CUSTOM_SOUNDS - i) }, (_, n) => fs.writeFile(path.join(folder, 'a', `${i + n}.wav`), 'a')));
  }
  await fs.writeFile(path.join(folder, 'b', 'extra.wav'), 'b');
  const list = await sounds.listCustomSounds({});
  assert.equal(list.sounds.length, MAX_CUSTOM_SOUNDS);
  assert.equal(list.truncated, true);
  const source = path.join(root, 'new.wav'); await fs.writeFile(source, 'new');
  const result = await sounds.importCustomSound({ path: source });
  assert.equal(result.imported, 0);
  assert.equal(result.truncated, true);
  await assert.rejects(fs.stat(path.join(folder, 'new.wav')));
});

test('invalid IDs cannot traverse or use Windows alternate streams', async t => {
  const { folder, sounds } = await fixture(t);
  if (process.platform !== 'win32') await fs.writeFile(path.join(folder, 'file:stream.wav'), 'sentinel');
  for (const id of ['../outside.wav', '/outside.wav', 'a\\b.wav', 'file:stream.wav', 'a/../b.wav']) {
    await assert.rejects(sounds.loadCustomSound({ id, volume: 100 }));
  }
});

test('library byte budget applies to repeated imports, not just a single batch', async t => {
  const { root, folder, sounds, load } = await fixture(t);
  const { MAX_LIBRARY_BYTES, MAX_CUSTOM_SOUND_BYTES } = load('shared/rpc');
  let remaining = MAX_LIBRARY_BYTES;
  for (let n = 0; remaining > 0; n++) {
    const file = await fs.open(path.join(folder, `${n}.wav`), 'w');
    const size = Math.min(remaining, MAX_CUSTOM_SOUND_BYTES);
    await file.truncate(size); await file.close(); remaining -= size;
  }
  const source = path.join(root, 'new.wav'); await fs.writeFile(source, 'audio');
  const result = await sounds.importCustomSound({ path: source });
  assert.equal(result.imported, 0);
  assert.equal(result.truncated, true);
});

test('sanitizing an unusual filename preserves its audio extension', async t => {
  const { root, sounds } = await fixture(t);
  const source = path.join(root, '..wav'); await fs.writeFile(source, 'audio');
  assert.equal((await sounds.importCustomSound({ path: source })).imported, 1);
  const list = await sounds.listCustomSounds({});
  assert.equal(list.sounds.length, 1);
  assert.equal(Buffer.from((await sounds.loadCustomSound({ id: list.sounds[0].id, volume: 100 })).base64, 'base64').toString(), 'audio');
});

test('failed files are reported without losing the successful part of a batch', async t => {
  const { root, sounds } = await fixture(t);
  const source = path.join(root, 'tree'); await fs.mkdir(source);
  await fs.writeFile(path.join(source, 'first.wav'), 'first');
  await fs.mkdir(path.join(source, 'sub'));
  await fs.writeFile(path.join(source, 'sub', 'second.wav'), 'second');
  // Force only one destination to be unwritable through a non-directory component.
  const destination = path.join(sounds.soundFolder(), 'tree'); await fs.mkdir(destination);
  await fs.writeFile(path.join(destination, 'sub'), 'keep');
  const result = await sounds.importCustomSound({ path: source });
  assert.equal(result.imported, 1);
  assert.equal(result.failed, 1);
  assert.equal(result.truncated, false);
});

test('replacing the library root after validation cannot redirect a read', async t => {
  const { root, folder } = await fixture(t);
  const outside = path.join(root, 'outside'); await fs.mkdir(outside);
  await fs.writeFile(path.join(outside, 'private.wav'), 'sentinel');
  let replaced = false;
  const sounds = loader({ 'node:fs/promises': {
    ...fs,
    lstat: async file => {
      const info = await fs.lstat(file);
      if (file === folder && !replaced) {
        replaced = true;
        await fs.rename(folder, folder + '-original');
        await fs.symlink(outside, folder, 'junction');
      }
      return info;
    },
  } }, { process: { ...process, env: { ...process.env, PASEO_HOME: root } } })('server/sounds');
  await assert.rejects(sounds.loadCustomSound({ id: 'private.wav', volume: 100 }));
  assert.equal(replaced, true);
  assert.equal(await fs.readFile(path.join(outside, 'private.wav'), 'utf8'), 'sentinel');
});

test('trusted Linux parent paths can contain colon and backslash characters', { skip: process.platform !== 'linux' }, async t => {
  const { root } = await fixture(t);
  const home = path.join(root, 'Paseo: Dev\\files');
  const folder = path.join(home, 'notification-sounds');
  await fs.mkdir(folder, { recursive: true });
  await fs.writeFile(path.join(folder, 'real.wav'), 'audio');
  const sounds = loader({}, { process: { ...process, env: { ...process.env, PASEO_HOME: home } } })('server/sounds');
  assert.equal(Buffer.from((await sounds.loadCustomSound({ id: 'real.wav', volume: 100 })).base64, 'base64').toString(), 'audio');
});

test('the filesystem root and other ancestors of the library are rejected as import sources', async t => {
  const { root, sounds } = await fixture(t);
  for (const source of [path.parse(root).root, path.dirname(root)]) {
    await assert.rejects(sounds.importCustomSound({ path: source }), /outside the sound folder/);
  }
});
