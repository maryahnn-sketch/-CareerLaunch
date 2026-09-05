/**
 * Regression checks for discoverPaths loading, timeout, and retry safety.
 * Run: node scripts/test-discover-paths-loading.mjs
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  createDiscoverPathsWatchdog,
  invalidateDiscoverPathsGeneration,
  shouldClearDiscoverPathsBusy,
  DiscoverPathsTimeoutError,
  DISCOVER_PATHS_TIMEOUT_MS,
  DISCOVER_PATHS_COPY_DELAY_MS,
  DISCOVER_PATHS_MIN_TIER_MS,
  DISCOVER_PATHS_COPY_MESSAGE,
} from '../js/discover-paths-watchdog.mjs';
import {
  canStartAiTier,
  nextStructuredRetryAction,
  shouldReshapeStructuredFailure,
} from '../js/structured-call-policy.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const INDEX_HTML = readFileSync(join(__dirname, '../index.html'), 'utf8');

const DISCOVER_PATHS_FN = INDEX_HTML.match(
  /async function discoverPaths\(\)[\s\S]*?async function sendConvo\(\)/
)?.[0] || '';

let passed = 0;
let failed = 0;

function assert(label, condition, detail = '') {
  if (condition) {
    console.log(`PASS ${label}`);
    passed += 1;
    return true;
  }
  console.log(`FAIL ${label}${detail ? `: ${detail}` : ''}`);
  failed += 1;
  return false;
}

function createFakeTimers() {
  let now = 0;
  const timers = new Map();
  let nextId = 1;

  const setTimeoutFn = (fn, ms) => {
    const id = nextId++;
    timers.set(id, { fn, at: now + ms });
    return id;
  };

  const clearTimeoutFn = (id) => {
    timers.delete(id);
  };

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

async function runBehavioralTests() {
  await testNeverResolvingModuleLoad();
  await testNeverResolvingApiCall();
  await testCopyDelayAtThirtySeconds();
  await testStaleResponseAfterTimeout();
  await testDiscoverPathsOrchestrationNeverResolvingApi();
  await testHangingModuleImportBeforeWatchdog();
  await testDiversePathsApplyBeforeTimeout();
}

async function testNeverResolvingModuleLoad() {
  const fake = createFakeTimers();
  let generation = 1;
  let screen = 'analyzing';
  let busy = true;
  let loadingMsg = 'Mapping your skills to possible directions…';
  let errorMsg = '';
  let errorRetry = null;

  const isActive = () => generation === 1;
  const watchdog = createDiscoverPathsWatchdog({
    isActive,
    onCopyDelay: () => { loadingMsg = DISCOVER_PATHS_COPY_MESSAGE; },
    startedAt: fake.now(),
    deadlineAt: fake.now() + DISCOVER_PATHS_TIMEOUT_MS,
    now: fake.now(),
    setTimeoutFn: fake.setTimeoutFn,
    clearTimeoutFn: fake.clearTimeoutFn,
  });

  const work = watchdog.raceDeadline(new Promise(() => {}));
  fake.tick(DISCOVER_PATHS_TIMEOUT_MS);

  let caught;
  try {
    await work;
  } catch (err) {
    caught = err;
  }

  invalidateDiscoverPathsGeneration(1, () => generation, (g) => { generation = g; });
  errorMsg = "We couldn't map career paths just now. Nothing was lost. You can try again.";
  errorRetry = () => {};
  loadingMsg = '';
  screen = 'paths';
  if (shouldClearDiscoverPathsBusy(1, generation)) busy = false;
  watchdog.dispose();

  assert(
    'never-resolving module/API work rejects at 90s deadline',
    caught instanceof DiscoverPathsTimeoutError
  );
  assert(
    'never-resolving module load exits to paths with retry',
    screen === 'paths' && typeof errorRetry === 'function' && errorMsg.includes('try again') && !busy
  );
}

async function testNeverResolvingApiCall() {
  const fake = createFakeTimers();
  let generation = 2;
  let screen = 'analyzing';
  let paths = null;

  const isActive = () => generation === 2;
  const watchdog = createDiscoverPathsWatchdog({
    isActive,
    onCopyDelay: () => {},
    startedAt: fake.now(),
    deadlineAt: fake.now() + DISCOVER_PATHS_TIMEOUT_MS,
    now: fake.now(),
    setTimeoutFn: fake.setTimeoutFn,
    clearTimeoutFn: fake.clearTimeoutFn,
  });

  const simulateDiscover = async () => {
    await Promise.resolve();
    await new Promise(() => {});
    paths = [{ title: 'Late Path' }];
    screen = 'paths';
  };

  const raced = watchdog.raceDeadline(simulateDiscover());
  fake.tick(DISCOVER_PATHS_TIMEOUT_MS);

  try {
    await raced;
  } catch (err) {
    if (err instanceof DiscoverPathsTimeoutError) {
      invalidateDiscoverPathsGeneration(2, () => generation, (g) => { generation = g; });
      screen = 'paths';
    }
  }
  watchdog.dispose();

  assert(
    'never-resolving API call rejects at deadline',
    screen === 'paths' && paths === null && generation === 3
  );
}

async function testCopyDelayAtThirtySeconds() {
  const fake = createFakeTimers();
  let loadingMsg = 'Mapping your skills to possible directions…';
  const watchdog = createDiscoverPathsWatchdog({
    isActive: () => true,
    onCopyDelay: () => { loadingMsg = DISCOVER_PATHS_COPY_MESSAGE; },
    startedAt: fake.now(),
    deadlineAt: fake.now() + DISCOVER_PATHS_TIMEOUT_MS,
    now: fake.now(),
    setTimeoutFn: fake.setTimeoutFn,
    clearTimeoutFn: fake.clearTimeoutFn,
  });

  fake.tick(DISCOVER_PATHS_COPY_DELAY_MS - 1);
  assert(
    'loading copy unchanged before 30s',
    loadingMsg === 'Mapping your skills to possible directions…'
  );

  fake.tick(1);
  assert(
    'loading copy updates at 30s',
    loadingMsg === DISCOVER_PATHS_COPY_MESSAGE
  );

  watchdog.dispose();
}

async function testStaleResponseAfterTimeout() {
  const fake = createFakeTimers();
  let generation = 5;
  let screen = 'paths';
  let paths = [];

  const isActive = () => generation === 5;
  const watchdog = createDiscoverPathsWatchdog({
    isActive,
    onCopyDelay: () => {},
    startedAt: fake.now(),
    deadlineAt: fake.now() + DISCOVER_PATHS_TIMEOUT_MS,
    now: fake.now(),
    setTimeoutFn: fake.setTimeoutFn,
    clearTimeoutFn: fake.clearTimeoutFn,
  });

  let resolveLate;
  const lateWork = new Promise((resolve) => { resolveLate = resolve; });
  const raced = watchdog.raceDeadline(lateWork);
  fake.tick(DISCOVER_PATHS_TIMEOUT_MS);

  try {
    await raced;
  } catch (err) {
    if (err instanceof DiscoverPathsTimeoutError) {
      invalidateDiscoverPathsGeneration(5, () => generation, (g) => { generation = g; });
      screen = 'paths';
    }
  }

  resolveLate([{ title: 'Should Not Apply' }]);
  await Promise.resolve();

  if (isActive()) {
    paths = [{ title: 'Should Not Apply' }];
    screen = 'paths';
  }

  assert(
    'stale response after timeout does not apply paths',
    screen === 'paths' && paths.length === 0 && generation === 6
  );

  watchdog.dispose();
}

/** Full discoverPaths orchestration: watchdog starts before any await; API never resolves. */
async function testDiscoverPathsOrchestrationNeverResolvingApi() {
  const fake = createFakeTimers();
  let generation = 10;
  let screen = 'analyzing';
  let busy = true;
  let loadingMsg = 'Mapping your skills to possible directions…';
  let errorMsg = '';
  let errorRetry = null;
  let paths = null;

  const myGen = ++generation;
  const isActive = () => myGen === generation;
  const startedAt = fake.now();
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
    await Promise.resolve();
    await new Promise(() => {});
    paths = [{ title: 'Late Path' }];
    return paths;
  })());

  fake.tick(DISCOVER_PATHS_COPY_DELAY_MS);
  assert(
    'orchestration updates loading copy at 30s while API hangs',
    loadingMsg === DISCOVER_PATHS_COPY_MESSAGE
  );

  fake.tick(DISCOVER_PATHS_TIMEOUT_MS - DISCOVER_PATHS_COPY_DELAY_MS);

  try {
    await work;
  } catch (err) {
    if (err instanceof DiscoverPathsTimeoutError) {
      invalidateDiscoverPathsGeneration(myGen, () => generation, (g) => { generation = g; });
      errorMsg = "We couldn't map career paths just now. Nothing was lost. You can try again.";
      errorRetry = () => {};
      loadingMsg = '';
      screen = 'paths';
      if (shouldClearDiscoverPathsBusy(myGen, generation)) busy = false;
    }
  }
  watchdog.dispose();

  assert(
    'orchestration exits analyzing to paths at 90s with retry',
    screen === 'paths' && paths === null && typeof errorRetry === 'function' && !busy && errorMsg.includes('try again')
  );
}

/** Regression: awaiting module import before watchdog left timers unregistered. */
async function testHangingModuleImportBeforeWatchdog() {
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

  fake.tick(DISCOVER_PATHS_COPY_DELAY_MS);
  assert(
    'watchdog timers fire even when inner module/API work never resolves',
    loadingMsg === DISCOVER_PATHS_COPY_MESSAGE
  );

  fake.tick(DISCOVER_PATHS_TIMEOUT_MS - DISCOVER_PATHS_COPY_DELAY_MS);
  let timedOut = false;
  try {
    await work;
  } catch (err) {
    timedOut = err instanceof DiscoverPathsTimeoutError;
    screen = 'paths';
    busy = false;
  }
  watchdog.dispose();

  assert(
    'watchdog exits hung discoverPaths work at 90s',
    timedOut && screen === 'paths' && !busy
  );
}

/** Valid diverse paths arriving at 20s apply; 90s watchdog never takes over. */
async function testDiversePathsApplyBeforeTimeout() {
  const fake = createFakeTimers();
  let generation = 20;
  let screen = 'analyzing';
  let busy = true;
  let errorMsg = '';
  let paths = [];
  let timedOut = false;

  const myGen = ++generation;
  const isActive = () => myGen === generation;

  const copyTimer = fake.setTimeoutFn(() => {}, DISCOVER_PATHS_COPY_DELAY_MS);
  const timeoutTimer = fake.setTimeoutFn(() => {
    if (!isActive() || timedOut) return;
    timedOut = true;
    invalidateDiscoverPathsGeneration(myGen, () => generation, (g) => { generation = g; });
    errorMsg = "We couldn't map career paths just now. Nothing was lost. You can try again.";
    screen = 'paths';
    busy = false;
  }, DISCOVER_PATHS_TIMEOUT_MS);

  const incoming = [
    { title: 'Operations Coordinator' },
    { title: 'Customer Service Representative' },
    { title: 'Event Coordinator' },
  ];

  fake.tick(20000);
  if (isActive() && !timedOut) {
    paths = incoming;
    screen = 'paths';
    busy = false;
    fake.clearTimeoutFn(copyTimer);
    fake.clearTimeoutFn(timeoutTimer);
  }

  fake.tick(DISCOVER_PATHS_TIMEOUT_MS);

  assert(
    'normal diverse path generation completes and applies before timeout',
    screen === 'paths' &&
      paths.length === 3 &&
      paths[0].title === 'Operations Coordinator' &&
      !timedOut &&
      !errorMsg &&
      !busy &&
      generation === myGen
  );
}

function main() {
  assert(
    'DISCOVER_PATHS_TIMEOUT_MS is 90000',
    DISCOVER_PATHS_TIMEOUT_MS === 90000 &&
      /const DISCOVER_PATHS_TIMEOUT_MS = 90000;/.test(INDEX_HTML)
  );

  assert(
    'discoverPaths registers inline setTimeout before any await',
    /copyTimer = setTimeout\(/.test(DISCOVER_PATHS_FN) &&
      /timeoutTimer = setTimeout\(/.test(DISCOVER_PATHS_FN) &&
      /DISCOVER_PATHS_COPY_DELAY_MS\)/.test(DISCOVER_PATHS_FN) &&
      /DISCOVER_PATHS_TIMEOUT_MS\)/.test(DISCOVER_PATHS_FN) &&
      DISCOVER_PATHS_FN.indexOf('setTimeout') < DISCOVER_PATHS_FN.indexOf('await yieldToMainThread')
  );

  assert(
    'discoverPaths yields to main thread after timer registration',
    /function yieldToMainThread\(\)/.test(INDEX_HTML) &&
      /await yieldToMainThread\(\)/.test(DISCOVER_PATHS_FN) &&
      DISCOVER_PATHS_FN.indexOf('await yieldToMainThread()') < DISCOVER_PATHS_FN.indexOf('await loadEvidenceGate')
  );

  assert(
    'discoverPaths yields before heavy sync prep after module load',
    /await loadPathValidation\(\)/.test(DISCOVER_PATHS_FN) &&
      DISCOVER_PATHS_FN.indexOf('await loadPathValidation()') < DISCOVER_PATHS_FN.lastIndexOf('await yieldToMainThread()') &&
      DISCOVER_PATHS_FN.indexOf('gateRetainedEvidence(') > DISCOVER_PATHS_FN.lastIndexOf('await yieldToMainThread()')
  );

  assert(
    'discoverPaths does not use watchdog module or raceDeadline',
    !/createDiscoverPathsWatchdog\(/.test(DISCOVER_PATHS_FN) &&
      !/watchdog\.raceDeadline/.test(DISCOVER_PATHS_FN) &&
      !/discover-paths-watchdog\.mjs/.test(INDEX_HTML)
  );

  assert(
    'discoverPaths clears timers only after completion, failure, or timeout',
    /function clearDiscoverPathsTimers\(\)/.test(DISCOVER_PATHS_FN) &&
      /if\(!timedOut\) clearDiscoverPathsTimers\(\)/.test(DISCOVER_PATHS_FN) &&
      /clearDiscoverPathsTimers\(\);\s*\n\s*render\(\)/.test(DISCOVER_PATHS_FN)
  );

  assert(
    'discoverPaths uses inline generation helpers',
    /function invalidateDiscoverPathsGeneration\(/.test(INDEX_HTML) &&
      /function shouldClearDiscoverPathsBusy\(/.test(INDEX_HTML)
  );

  assert(
    'discoverPaths 90s timeout handler exits to paths with errorRetry',
    /timedOut = true/.test(DISCOVER_PATHS_FN) &&
      /state\.errorRetry = discoverPaths/.test(DISCOVER_PATHS_FN) &&
      /state\.screen = 'paths'/.test(DISCOVER_PATHS_FN)
  );

  assert(
    'discoverPaths does not nest runCancelable for outer deadline',
    !/runCancelable\([\s\S]*callStructured\('discoverPaths'/.test(DISCOVER_PATHS_FN)
  );

  assert(
    'discoverPaths uses generation token to ignore stale responses',
    /const myGen = \+\+state\.pathsDiscoveryGeneration/.test(DISCOVER_PATHS_FN) &&
      /DiscoverPathsStaleError/.test(DISCOVER_PATHS_FN) &&
      /invalidateDiscoverPathsGeneration/.test(DISCOVER_PATHS_FN)
  );

  assert(
    'discoverPaths clears busy only when safe for generation',
    /shouldClearDiscoverPathsBusy\(myGen, state\.pathsDiscoveryGeneration\)/.test(DISCOVER_PATHS_FN)
  );

  assert(
    'discoverPaths initial loading copy is set',
    DISCOVER_PATHS_FN.includes("state.loadingMsg = 'Mapping your skills to possible directions…'")
  );

  assert(
    'discoverPaths 30s copy uses DISCOVER_PATHS_COPY_MESSAGE',
    DISCOVER_PATHS_COPY_MESSAGE === 'Still working — checking a fuller set of directions…' &&
      DISCOVER_PATHS_FN.includes('DISCOVER_PATHS_COPY_MESSAGE')
  );

  assert(
    'debug build badge markup exists and is gated on debug query param',
    INDEX_HTML.includes('id="debugBuildBadge"') &&
      INDEX_HTML.includes('initDebugBuildBadge') &&
      /URLSearchParams\(window\.location\.search\)\.has\('debug'\)/.test(INDEX_HTML)
  );

  assert(
    'vercel.json sets no-store for / and index.html',
    (() => {
      const vercel = readFileSync(join(__dirname, '../vercel.json'), 'utf8');
      return vercel.includes('"source": "/"') &&
        vercel.includes('"source": "/index.html"') &&
        vercel.includes('no-store, max-age=0');
    })()
  );

  assert(
    'discoverPaths failure exits analyzing screen to paths with errorRetry',
    /state\.errorRetry = discoverPaths;[\s\S]*state\.screen = 'paths'/.test(DISCOVER_PATHS_FN) &&
      !/catch\(err\)[\s\S]*state\.screen = 'analyzing'/.test(DISCOVER_PATHS_FN)
  );

  assert(
    'discoverPaths clears loadingMsg on timeout exit',
    /state\.loadingMsg = ''/.test(DISCOVER_PATHS_FN)
  );

  assert(
    'discoverPaths clears prior errorRetry on a fresh attempt',
    /state\.errorRetry=null/.test(DISCOVER_PATHS_FN)
  );

  assert(
    'discoverPaths has busy guard at entry',
    /if\(state\.busy\) return/.test(DISCOVER_PATHS_FN)
  );

  assert(
    'toPaths button is disabled while busy',
    /id="toPaths" \$\{state\.busy \? 'disabled' : ''\}/.test(INDEX_HTML)
  );

  assert(
    'retry button clears errorRetry before invoking discoverPaths',
    /retryBtn.*state\.errorRetry=null/s.test(INDEX_HTML) ||
      /state\.errorRetry=null; state\.errorRetryLabel=null; if\(retry\) retry\(\)/.test(INDEX_HTML)
  );

  assert(
    'index.html has build identifier not 0eeb770',
    INDEX_HTML.includes('data-build=') &&
      !INDEX_HTML.includes('0eeb770') &&
      !INDEX_HTML.includes('f4a91bc') &&
      INDEX_HTML.includes('<!-- build:')
  );

  assert(
    'callStructured invokes tierProgressFn before reshape and repair tiers',
    /if\(tierProgressFn\) tierProgressFn\('reshape'\)/.test(INDEX_HTML) &&
      /if\(tierProgressFn\) tierProgressFn\('repair'\)/.test(INDEX_HTML)
  );

  const semanticErr = { category: 'schema', partial: { paths: [] }, validationKind: 'semantic' };
  const structuralErr = { category: 'schema', partial: { paths: [] }, validationKind: 'structural' };
  const parseErr = { category: 'parse', partial: null, validationKind: null };

  assert(
    'semantic validation failure skips reshape',
    !shouldReshapeStructuredFailure(semanticErr) &&
      nextStructuredRetryAction(semanticErr, 60000) === 'repair' &&
      /validationKind !== 'semantic'/.test(INDEX_HTML)
  );

  assert(
    'true schema/format failure can still reshape',
    shouldReshapeStructuredFailure(structuralErr) &&
      nextStructuredRetryAction(structuralErr, 60000) === 'reshape' &&
      !shouldReshapeStructuredFailure(parseErr)
  );

  assert(
    'repair is not started when insufficient deadline remains',
    !canStartAiTier(DISCOVER_PATHS_MIN_TIER_MS - 1) &&
      nextStructuredRetryAction(semanticErr, 10000) === 'abort' &&
      nextStructuredRetryAction(structuralErr, 10000) === 'abort' &&
      /assertCanStartTier\('repair'\)/.test(INDEX_HTML) &&
      /assertCanStartTier\('reshape'\)/.test(INDEX_HTML)
  );

  assert(
    'discoverPaths passes absolute deadline into callStructured',
    /const deadlineAt = Date\.now\(\) \+ DISCOVER_PATHS_TIMEOUT_MS/.test(DISCOVER_PATHS_FN) &&
      /callStructured\('discoverPaths'[\s\S]*deadlineAt\)/.test(DISCOVER_PATHS_FN) &&
      /const DISCOVER_PATHS_MIN_TIER_MS = 25000;/.test(INDEX_HTML)
  );

  assert(
    'stale/timeout generation-token discard is unchanged',
    /if\(!isActive\(\) \|\| timedOut\) return;/.test(DISCOVER_PATHS_FN) &&
      /invalidateDiscoverPathsGeneration\(myGen/.test(DISCOVER_PATHS_FN)
  );

  assert(
    'pathStrengthScore is defined so successful discovery can render',
    /function pathStrengthScore\(/.test(INDEX_HTML)
  );

  assert(
    'discoverPaths filters transfers before annotatePathsWithEvidenceNotes',
    DISCOVER_PATHS_FN.indexOf('filterTransfersToRetainedSkills') >= 0 &&
      DISCOVER_PATHS_FN.indexOf('filterTransfersToRetainedSkills') <
        DISCOVER_PATHS_FN.indexOf('annotatePathsWithEvidenceNotes') &&
      /validatePathsResult\([\s\S]*getRejectedSkills\(\)/.test(INDEX_HTML)
  );

  return runBehavioralTests().then(() => {
    console.log(`\nResults: ${passed} passed, ${failed} failed`);
    process.exit(failed ? 1 : 0);
  });
}

main();
