const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { loader } = require('./load.cjs');

function desktop(platform, run) {
  return loader({ 'node:child_process': { execFile: (command, args, options, callback) => {
    assert.ok(options.timeout > 0 && options.timeout <= 10_000);
    assert.ok(options.maxBuffer <= 64 * 1024);
    assert.equal(options.shell, undefined);
    try { callback(null, run(command, args, options)); }
    catch (error) { callback(error); }
  } } }, { process: { ...process, platform } })('server/media-desktop').desktopMedia;
}

function macFixture() {
  const players = {
    'com.apple.Music': { running: true, state: 'playing' },
    'com.spotify.client': { running: true, state: 'paused' },
  };
  const calls = [];
  const backend = desktop('darwin', (command, args) => {
    assert.equal(command, '/usr/bin/osascript');
    const context = vm.createContext({ Application: id => {
      assert.ok(id in players, 'Only supported applications may be targeted');
      const player = players[id];
      return {
        running: () => player.running,
        playerState: () => { if (player.denied) throw new Error('Automation denied'); return player.state; },
        pause: () => { calls.push([id, 'Pause']); player.state = 'paused'; },
        play: () => { calls.push([id, 'Play']); player.state = 'playing'; },
      };
    } });
    vm.runInContext(args[args.indexOf('-e') + 1], context);
    return context.run(args.slice(args.indexOf('-e') + 2));
  });
  return { backend, players, calls };
}

test('macOS only controls running Music/Spotify and uses explicit state-checked commands', async () => {
  const { backend, players, calls } = macFixture();
  assert.deepEqual(Array.from(await backend.listPlayers()), ['com.apple.Music', 'com.spotify.client']);
  assert.equal(await backend.control('com.spotify.client', 'Pause'), false);
  assert.equal(await backend.control('com.apple.Music', 'Pause'), true);
  assert.equal(await backend.playbackStatus('com.apple.Music'), 'Paused');
  assert.equal(await backend.control('com.apple.Music', 'Play'), true);
  players['com.apple.Music'].running = false;
  assert.equal(await backend.control('com.apple.Music', 'Play'), false);
  assert.equal(await backend.control('untrusted"; doShellScript("bad")', 'Pause'), false);
  assert.deepEqual(calls, [['com.apple.Music', 'Pause'], ['com.apple.Music', 'Play']]);
});

test('macOS Automation denial cannot claim a paused player', async () => {
  const { backend, players, calls } = macFixture();
  players['com.apple.Music'].denied = true;
  await assert.rejects(backend.control('com.apple.Music', 'Pause'));
  assert.deepEqual(calls, []);
});

test('Windows passes session IDs as data and honors false from TryPauseAsync', async () => {
  const id = 'SomeApp_$([bad])\'"';
  const requests = [];
  const backend = desktop('win32', (command, args, options) => {
    assert.match(command, /powershell(?:\.exe)?$/i);
    assert.ok(args.includes('-NoProfile'));
    assert.ok(args.includes('-NonInteractive'));
    assert.equal(options.windowsHide, true);
    const script = Buffer.from(args[args.indexOf('-EncodedCommand') + 1], 'base64').toString('utf16le');
    assert.equal(script.includes(id), false, 'Session ID must never be interpolated into script code');
    const request = JSON.parse(options.env.PASEO_MEDIA_REQUEST);
    requests.push(request);
    return JSON.stringify(request.action === 'list' ? [id, 'Paseo.App', id, 'Spotify.exe'] : request.action === 'status' ? 'Playing' : false);
  });
  assert.deepEqual(Array.from(await backend.listPlayers()), ['Spotify.exe']);
  assert.equal(await backend.playbackStatus(id), 'Playing');
  assert.equal(await backend.control(id, 'Pause'), false);
  assert.deepEqual(requests[2], { action: 'Pause', id });
});

test('malformed native replies and missing helpers fail closed', async () => {
  const broken = desktop('win32', () => 'garbage');
  await assert.rejects(broken.listPlayers());
  const wrong = desktop('win32', () => JSON.stringify('yes'));
  await assert.rejects(wrong.control('player', 'Pause'));
  const missing = desktop('darwin', () => { throw new Error('ENOENT'); });
  await assert.rejects(missing.listPlayers());
});

// On the target OS this exercises the real OS bridge without pausing anything.
test('native desktop helper discovers players without changing playback', {
  skip: process.platform !== 'win32' && process.platform !== 'darwin',
}, async () => {
  const { desktopMedia } = loader()('server/media-desktop');
  const players = await desktopMedia.listPlayers();
  assert.ok(Array.isArray(players));
  assert.ok(players.every(id => typeof id === 'string'));
});
