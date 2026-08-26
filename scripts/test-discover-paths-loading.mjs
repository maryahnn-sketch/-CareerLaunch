/**
 * Static regression checks for discoverPaths loading, timeout, and retry safety.
 * Run: node scripts/test-discover-paths-loading.mjs
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

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

function main() {
  assert(
    'DISCOVER_PATHS_TIMEOUT_MS is 90000',
    /const DISCOVER_PATHS_TIMEOUT_MS = 90000;/.test(INDEX_HTML)
  );

  assert(
    'discoverPaths wraps callStructured in runCancelable',
    /runCancelable\(\s*\n?\s*\(signal\) => callStructured\('discoverPaths'/.test(DISCOVER_PATHS_FN)
  );

  assert(
    'discoverPaths passes DISCOVER_PATHS_TIMEOUT_MS to runCancelable',
    /runCancelable\([\s\S]*DISCOVER_PATHS_TIMEOUT_MS/.test(DISCOVER_PATHS_FN)
  );

  assert(
    'discoverPaths uses generation token to ignore stale responses',
    /const myGen = \+\+state\.pathsDiscoveryGeneration/.test(DISCOVER_PATHS_FN) &&
      /if\(myGen !== state\.pathsDiscoveryGeneration\) return/.test(DISCOVER_PATHS_FN)
  );

  assert(
    'discoverPaths clears busy only for the active generation',
    /if\(myGen === state\.pathsDiscoveryGeneration\) state\.busy = false/.test(DISCOVER_PATHS_FN)
  );

  assert(
    'discoverPaths initial loading copy is set',
    DISCOVER_PATHS_FN.includes("state.loadingMsg = 'Mapping your skills to possible directions…'")
  );

  assert(
    'discoverPaths reshape/repair loading copy is wired via tierProgressFn',
    DISCOVER_PATHS_FN.includes("state.loadingMsg = 'Still working — checking a fuller set of directions…'") &&
      /tierProgressFn\('reshape'\)|tier === 'reshape'/.test(INDEX_HTML) &&
      /tierProgressFn\('repair'\)|tier === 'repair'/.test(DISCOVER_PATHS_FN)
  );

  assert(
    'callStructured invokes tierProgressFn before reshape and repair tiers',
    /if\(tierProgressFn\) tierProgressFn\('reshape'\)/.test(INDEX_HTML) &&
      /if\(tierProgressFn\) tierProgressFn\('repair'\)/.test(INDEX_HTML)
  );

  assert(
    'discoverPaths failure exits analyzing screen to paths with errorRetry',
    /state\.errorRetry = discoverPaths; state\.screen = 'paths'/.test(DISCOVER_PATHS_FN) &&
      !/catch\(err\)[\s\S]*state\.screen = 'analyzing'/.test(DISCOVER_PATHS_FN)
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
    'runCancelable rejects with TIMEOUT StructuredCallError',
    /reject\(new StructuredCallError\('TIMEOUT'/.test(INDEX_HTML)
  );

  console.log(`\nResults: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main();
