const test = require('node:test');
const assert = require('node:assert/strict');
const { loader, flush, deferred } = require('./load.cjs');

function fixture() {
  let status = 'Playing', pausedStatusReply = null, pauseReply = null, failPause = false;
  const timers = [], commands = [];
  const media = loader({ 'node:child_process': { execFile: (_cmd, args, _options, callback) => {
    const method = args[args.indexOf('--method') + 1];
    if (method.endsWith('ListNames')) callback(null, "(['org.mpris.MediaPlayer2.test'],)");
    else if (method.endsWith('Get')) {
      if (pausedStatusReply) { const waiter = pausedStatusReply; pausedStatusReply = null; waiter.resolve(callback); }
      else callback(null, ` (<'${status}'>,)`);
    } else {
      commands.push(method.endsWith('Pause') ? 'Pause' : 'Play');
      if (method.endsWith('Pause') && failPause) callback(new Error('pause failed'));
      else if (method.endsWith('Pause') && pauseReply) { pauseReply.resolve(callback); pauseReply = null; }
      else { status = method.endsWith('Pause') ? 'Paused' : 'Playing'; callback(null, '()'); }
    }
  } } }, {
    process: { ...process, platform: 'linux' },
    setTimeout: (fn, ms) => { const timer = { fn, ms, cleared: false }; timers.push(timer); if (ms === 350) queueMicrotask(fn); return timer; },
    clearTimeout: timer => { timer.cleared = true; },
  })('server/media');
  return {
    media, commands, timers,
    status: () => status,
    setStatus: value => { status = value; },
    failPause: () => { failPause = true; },
    delayStatus: () => { pausedStatusReply = deferred(); return pausedStatusReply.promise; },
    delayPause: () => { pauseReply = deferred(); return pauseReply.promise; },
    resume: () => { const timer = timers.findLast(t => t.ms === 600 && !t.cleared); assert(timer); timer.cleared = true; timer.fn(); },
  };
}

test('a new hold prevents an in-flight status query from resuming media', async () => {
  const f = fixture(); const first = await f.media.holdMedia({});
  await f.media.releaseMedia({ token: first.token });
  const reply = f.delayStatus(); f.resume();
  const statusCallback = await reply;
  const next = f.media.holdMedia({}); await flush();
  statusCallback(null, "(<'Paused'>,)"); await next; await flush();
  assert.equal(f.status(), 'Paused');
  assert.deepEqual(f.commands, ['Pause']);
  await f.media.releaseAllMedia();
  assert.equal(f.status(), 'Playing');
});

test('cleanup waits for a pending successful pause and resumes that player', async () => {
  const f = fixture(); const reply = f.delayPause();
  const hold = f.media.holdMedia({}); const callback = await reply;
  const cleanup = f.media.releaseAllMedia(); await flush();
  f.setStatus('Paused'); callback(null, '()');
  await hold; await cleanup;
  assert.equal(f.status(), 'Playing');
  assert.equal((await f.media.holdMedia({})).token, null);
});

test('a failed Pause never claims ownership of a player', async () => {
  const f = fixture(); f.failPause();
  const hold = await f.media.holdMedia({});
  assert.equal(hold.paused, 0);
  f.setStatus('Paused');
  await f.media.releaseAllMedia();
  assert.deepEqual(f.commands, ['Pause']);
});

test('lease renewal extends a live hold but cannot resurrect a released one', async () => {
  const f = fixture(); const hold = await f.media.holdMedia({});
  const original = f.timers.find(t => t.ms === 60_000);
  await f.media.renewMedia?.({ token: hold.token });
  assert.equal(original.cleared, true);
  await f.media.releaseMedia({ token: hold.token });
  await f.media.renewMedia?.({ token: hold.token });
  f.resume(); await flush();
  assert.equal(f.status(), 'Playing');
  await f.media.releaseAllMedia();
});

for (const platform of ['darwin', 'win32']) {
  test(`${platform}: pause and cleanup use desktop media control and respect rejected pauses`, async () => {
    let state = 'Playing', accept = true;
    const commands = [];
    const media = loader({ './media-desktop': {
      desktopMedia: {
        listPlayers: async () => ['player'],
        playbackStatus: async () => state,
        control: async (_id, method) => {
          commands.push(method);
          if (!accept) return false;
          state = method === 'Pause' ? 'Paused' : 'Playing';
          return true;
        },
      },
      desktopMediaHelp: 'Platform setup instructions',
    } }, {
      process: { ...process, platform },
      setTimeout: (fn, ms) => { if (ms === 350) queueMicrotask(fn); return {}; },
      clearTimeout: () => {},
    })('server/media');
    assert.equal((await media.mediaStatus({})).supported, true);
    accept = false;
    assert.equal((await media.holdMedia({})).token, null);
    accept = true;
    const first = await media.holdMedia({});
    assert.equal(first.paused, 1);
    const second = await media.holdMedia({});
    assert.ok(second.token);
    assert.equal(second.paused, 0);
    await media.releaseAllMedia();
    assert.equal(state, 'Playing');
    assert.deepEqual(commands, ['Pause', 'Pause', 'Play']);
  });
}

function desktopFixture(platform) {
  const timers = [], commands = [];
  const f = { state: 'Playing', statusFails: false, failNext: {}, commands, timers };
  f.media = loader({ './media-desktop': {
    desktopMedia: {
      listPlayers: async () => ['player'],
      playbackStatus: async () => { if (f.statusFails) throw new Error('helper timed out'); return f.state; },
      control: async (_id, method) => {
        commands.push(method);
        const failure = f.failNext[method];
        if (failure > 0) {
          f.failNext[method]--;
          if (f.applyBeforeFailing) f.state = 'Paused';
          throw new Error('helper timed out');
        }
        f.state = method === 'Pause' ? 'Paused' : 'Playing';
        return true;
      },
    },
    desktopMediaHelp: 'Platform setup instructions',
  } }, {
    process: { ...process, platform },
    console: { warn: () => {} },
    setTimeout: (fn, ms) => { const timer = { fn, ms, cleared: false }; timers.push(timer); if (ms === 350) queueMicrotask(fn); return timer; },
    clearTimeout: timer => { timer.cleared = true; },
  })('server/media');
  f.resume = async () => {
    const timer = timers.findLast(t => t.ms === 600 && !t.cleared);
    assert(timer, 'a resume should be scheduled');
    timer.cleared = true; timer.fn(); await flush();
  };
  f.hasPendingResume = () => timers.some(t => t.ms === 600 && !t.cleared);
  return f;
}

for (const platform of ['darwin', 'win32']) {
  test(`${platform}: releasing the last hold resumes media even when status checks fail`, async () => {
    const f = desktopFixture(platform);
    const hold = await f.media.holdMedia({});
    f.statusFails = true;
    await f.media.releaseMedia({ token: hold.token });
    await f.resume();
    assert.equal(f.state, 'Playing');
    assert.deepEqual(f.commands, ['Pause', 'Play']);
  });

  test(`${platform}: a failed resume is retried`, async () => {
    const f = desktopFixture(platform);
    const hold = await f.media.holdMedia({});
    f.failNext.Play = 1;
    await f.media.releaseMedia({ token: hold.token });
    await f.resume();
    assert.equal(f.state, 'Paused');
    await f.resume();
    assert.equal(f.state, 'Playing');
    assert.equal(f.hasPendingResume(), false);
  });

  test(`${platform}: resume attempts stop after the limit`, async () => {
    const f = desktopFixture(platform);
    const hold = await f.media.holdMedia({});
    f.failNext.Play = 99;
    await f.media.releaseMedia({ token: hold.token });
    await f.resume(); await f.resume(); await f.resume();
    assert.deepEqual(f.commands, ['Pause', 'Play', 'Play', 'Play']);
    assert.equal(f.hasPendingResume(), false);
  });

  test(`${platform}: cleanup retries a failed resume without waiting for a timer`, async () => {
    const f = desktopFixture(platform);
    await f.media.holdMedia({});
    f.failNext.Play = 1;
    await f.media.releaseAllMedia();
    assert.equal(f.state, 'Playing');
    assert.deepEqual(f.commands, ['Pause', 'Play', 'Play']);
  });

  test(`${platform}: a pause that times out but took effect is still resumed`, async () => {
    const f = desktopFixture(platform);
    f.failNext.Pause = 1; f.applyBeforeFailing = true;
    const hold = await f.media.holdMedia({});
    assert.equal(hold.paused, 1);
    await f.media.releaseMedia({ token: hold.token });
    await f.resume();
    assert.equal(f.state, 'Playing');
  });
}

test('linux: a failed status check during resume is retried', async () => {
  const f = fixture(); const hold = await f.media.holdMedia({});
  await f.media.releaseMedia({ token: hold.token });
  const reply = f.delayStatus(); f.resume();
  (await reply)(new Error('bus timeout')); await flush();
  assert.equal(f.status(), 'Paused');
  f.resume(); await flush();
  assert.equal(f.status(), 'Playing');
  assert.deepEqual(f.commands, ['Pause', 'Play']);
});
