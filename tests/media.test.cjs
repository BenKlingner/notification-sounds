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
