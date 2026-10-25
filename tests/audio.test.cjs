const test = require('node:test');
const assert = require('node:assert/strict');
const { loader } = require('./load.cjs');

test('every catalog entry and event default has bundled audio', () => {
  const load = loader();
  const { BUNDLED_AUDIO } = load('server/bundled-audio');
  const { BUNDLED_SOUNDS } = load('shared/bundled-sounds');
  const { SOUND_EVENTS } = load('shared/events');
  assert.deepEqual(Object.keys(BUNDLED_AUDIO).sort(), Array.from(BUNDLED_SOUNDS, s => s.id).sort());
  for (const event of Object.values(SOUND_EVENTS)) assert(BUNDLED_AUDIO[event.defaultSound.slice(8)]);
});

test('WAV attenuation preserves headers and scales signed PCM samples', () => {
  const load = loader();
  const { scaleWav } = load('server/wav');
  const { synthesizeBuiltin } = load('client/synth');
  const bytes = Buffer.from(synthesizeBuiltin('chime', 100).base64, 'base64');
  const original = Buffer.from(bytes);
  const scaled = scaleWav(bytes, 0.5);
  assert.deepEqual(scaled.subarray(0, 44), original.subarray(0, 44));
  for (let at = 44; at < bytes.length; at += 2) {
    assert.equal(scaled.readInt16LE(at), Math.round(original.readInt16LE(at) * 0.5) || 0);
  }
  assert.deepEqual(bytes, original);
});

test('MP3 attenuation keeps original bytes at full volume and never mutates the source', () => {
  const load = loader();
  const { scaleMp3 } = load('server/mp3');
  const { BUNDLED_AUDIO } = load('server/bundled-audio');
  for (const encoded of Object.values(BUNDLED_AUDIO)) {
    const input = Buffer.from(encoded, 'base64');
    const original = Buffer.from(input);
    assert.deepEqual(scaleMp3(input, 1), original);
    const scaled = scaleMp3(input, 0.5);
    assert.equal(scaled.length, input.length);
    assert.notDeepEqual(scaled, original);
    assert.deepEqual(input, original);
  }
});
