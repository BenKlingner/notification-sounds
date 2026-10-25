const test = require('node:test');
const assert = require('node:assert/strict');
const { loader, flush, deferred } = require('./load.cjs');

async function watcher(refresh, settingsPatch = { projectRules: { p: { mode: 'muted' } } }) {
  const load = loader(); const played = []; let observer;
  const settings = load('shared/settings').SoundSettingsSchema.parse(settingsPatch);
  const stop = load('client/watcher').watchAgents({ paseo: {
    agents: { list: async () => ({ subscription: { subscribe: o => { observer = o; }, release: async () => {} } }) },
    workspaces: { ref: () => ({ refresh }) },
  } }, { readSettings: async () => settings, play: async (...args) => played.push(args) });
  await flush();
  const agent = { id: 'a', provider: 'codex', cwd: '/p', workspaceId: 'w', status: 'running' };
  observer.snapshot({ entries: [{ agent }] });
  return { played, stop, finish() {
    observer.update({ type: 'agent_update', payload: { kind: 'upsert', agent: {
      ...agent, status: 'idle', requiresAttention: true, attentionReason: 'finished', attentionTimestamp: '1',
    } } });
  } };
}

test('lookup failure cannot bypass project mute', async () => {
  const w = await watcher(async () => { throw new Error('offline'); });
  w.finish(); await flush(); w.stop();
  assert.equal(w.played.length, 0);
});

test('teardown during lookup prevents later playback', async () => {
  const pending = deferred();
  const w = await watcher(() => pending.promise, { projectRules: { p: { mode: 'custom' } } });
  w.finish(); await flush(); w.stop(); pending.resolve({ projectId: 'p' }); await flush();
  assert.equal(w.played.length, 0);
});

test('without project rules a project lookup is unnecessary', async () => {
  let lookups = 0;
  const w = await watcher(async () => { lookups++; return { projectId: 'p' }; }, {});
  w.finish(); await flush(); w.stop();
  assert.equal(lookups, 0);
  assert.equal(w.played.length, 1);
});

test('a missing workspace cannot bypass project mute', async () => {
  const w = await watcher(async () => null);
  w.finish(); await flush(); w.stop();
  assert.equal(w.played.length, 0);
});
