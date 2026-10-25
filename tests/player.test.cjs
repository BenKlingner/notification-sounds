const test = require('node:test');
const assert = require('node:assert/strict');
const { loader, flush, deferred } = require('./load.cjs');

test('custom recordings are refreshed between plays', async () => {
  let value = 'first'; const played = [];
  const player = loader()('client/player').createSoundPlayer({
    rpc: async () => ({ base64: value, mimeType: 'audio/wav' }),
    playAudio: async audio => played.push(audio.base64),
  });
  await player.play('custom:test.wav', 70); value = 'second';
  await player.play('custom:test.wav', 70);
  assert.deepEqual(played, ['first', 'second']);
});

test('disposal stops an in-flight load and discards pending previews', async () => {
  const pending = deferred(); const played = [];
  const player = loader()('client/player').createSoundPlayer({
    rpc: () => pending.promise, playAudio: async audio => played.push(audio),
  });
  player.preview('custom:first.wav', 70, false);
  player.preview('custom:second.wav', 70, false);
  player.dispose?.();
  pending.resolve({ base64: 'sound', mimeType: 'audio/wav' });
  await flush();
  assert.equal(played.length, 0);
});

test('settings are re-read for the next notification after a save on another client', async () => {
  const load = loader(); let enabled = true;
  const player = load('client/player').createSoundPlayer({
    rpc: async () => ({ status: 'ready', values: { enabled } }), playAudio: async () => {},
  });
  assert.equal((await player.readSettings()).enabled, true);
  enabled = false;
  assert.equal((await player.readSettings()).enabled, false);
});

test('immutable audio cache evicts old entries instead of retaining all recordings', async () => {
  let firstLoads = 0;
  const player = loader()('client/player').createSoundPlayer({
    rpc: async (_contract, { id }) => {
      if (id === 'first') firstLoads++;
      return { base64: 'x'.repeat(1024 * 1024), mimeType: 'audio/mpeg' };
    }, playAudio: async () => {},
  });
  await player.play('bundled:first', 70);
  await player.play('bundled:first', 70);
  assert.equal(firstLoads, 1);
  for (let n = 0; n < 20; n++) await player.play(`bundled:other${n}`, 70);
  await player.play('bundled:first', 70);
  assert.equal(firstLoads, 2);
});

test('only the latest preview waits behind the playing preview', async () => {
  const first = deferred(); const played = [];
  const player = loader()('client/player').createSoundPlayer({
    rpc: async (_contract, { id }) => ({ base64: id, mimeType: 'audio/wav' }),
    playAudio: async audio => { played.push(audio.base64); if (played.length === 1) await first.promise; },
  });
  player.preview('custom:first.wav', 70, false); await flush();
  player.preview('custom:second.wav', 70, false);
  player.preview('custom:third.wav', 70, false);
  first.resolve(); await flush();
  assert.deepEqual(played, ['first.wav', 'third.wav']);
});
