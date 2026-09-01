/**
 * Runtime verification with injectable fake timers at production delays (30s / 90s).
 * Run: node scripts/verify-discover-paths-watchdog-runtime.mjs
 */

import {
  createDiscoverPathsWatchdog,
  DISCOVER_PATHS_COPY_MESSAGE,
  DISCOVER_PATHS_COPY_DELAY_MS,
  DISCOVER_PATHS_TIMEOUT_MS,
  DiscoverPathsTimeoutError,
} from '../js/discover-paths-watchdog.mjs';

function createFakeTimers() {
  let now = 0;
  const timers = new Map();
  let nextId = 1;
  const setTimeoutFn = (fn, ms) => {
    const id = nextId++;
    timers.set(id, { fn, at: now + ms });
    return id;
  };
  const clearTimeoutFn = (id) => { timers.delete(id); };
  const tick = (ms) => {
    now += ms;
    const due = [...timers.entries()].filter(([, t]) => t.at <= now);
    due.sort((a, b) => a[1].at - b[1].at);
    for (const [id, t] of due) {
      timers.delete(id);
      t.fn();
    }
  };
  return { now: () => now, setTimeoutFn, clearTimeoutFn, tick };
}

async function run() {
  const fake = createFakeTimers();
  let loadingMsg = 'Mapping your skills to possible directions…';
  let screen = 'analyzing';
  let busy = true;
  const startedAt = fake.now();
  const isActive = () => true;

  const watchdog = createDiscoverPathsWatchdog({
    isActive,
    onCopyDelay: () => { loadingMsg = DISCOVER_PATHS_COPY_MESSAGE; },
    startedAt,
    deadlineAt: startedAt + DISCOVER_PATHS_TIMEOUT_MS,
    now: fake.now(),
    setTimeoutFn: fake.setTimeoutFn,
    clearTimeoutFn: fake.clearTimeoutFn,
  });

  const work = watchdog.raceDeadline((async () => {
    await new Promise(() => {});
  })());

  fake.tick(DISCOVER_PATHS_COPY_DELAY_MS - 1);
  const beforeCopy = loadingMsg;
  fake.tick(1);
  const afterCopy = loadingMsg;

  fake.tick(DISCOVER_PATHS_TIMEOUT_MS - DISCOVER_PATHS_COPY_DELAY_MS);
  let timedOut = false;
  try {
    await work;
  } catch (err) {
    timedOut = err instanceof DiscoverPathsTimeoutError;
    if (timedOut) {
      screen = 'paths';
      busy = false;
    }
  }
  watchdog.dispose();

  const copyPass = beforeCopy !== DISCOVER_PATHS_COPY_MESSAGE && afterCopy === DISCOVER_PATHS_COPY_MESSAGE;
  const timeoutPass = timedOut && screen === 'paths' && !busy;

  console.log(`30s copy (${DISCOVER_PATHS_COPY_DELAY_MS}ms): ${copyPass ? 'PASS' : 'FAIL'} — "${afterCopy}"`);
  console.log(`90s exit (${DISCOVER_PATHS_TIMEOUT_MS}ms): ${timeoutPass ? 'PASS' : 'FAIL'} — screen=${screen}, busy=${busy}`);
  console.log(`RESULT: ${copyPass && timeoutPass ? 'PASS' : 'FAIL'}`);

  if (!copyPass || !timeoutPass) process.exit(1);
}

run();
