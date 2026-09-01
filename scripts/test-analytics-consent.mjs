/**
 * Static regression checks for analytics consent and PostHog deferral.
 * Run: node scripts/test-analytics-consent.mjs
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const INDEX_HTML = readFileSync(join(__dirname, '../index.html'), 'utf8');
const CONSENT_JS = readFileSync(join(__dirname, '../js/analytics-consent.js'), 'utf8');

let passed = 0;
let failed = 0;

function assert(label, ok) {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}`);
  if (ok) passed += 1;
  else failed += 1;
}

assert(
  'index.html loads analytics consent script instead of inline PostHog init',
  INDEX_HTML.includes('<script src="/js/analytics-consent.js"></script>') &&
    !INDEX_HTML.includes('posthog.init(')
);

assert(
  'consent module stores choice in ifw_analytics_consent',
  CONSENT_JS.includes("'ifw_analytics_consent'")
);

assert(
  'consent UI includes Allow analytics and Continue without analytics',
  CONSENT_JS.includes('Allow analytics') &&
    CONSENT_JS.includes('Continue without analytics')
);

assert(
  'consent UI explains masked career content and access is unaffected',
  CONSENT_JS.includes('Sensitive typed and generated career content is masked') &&
    CONSENT_JS.includes('Declining analytics will not affect your access')
);

assert(
  'footer exposes Analytics & privacy choices link hook',
  INDEX_HTML.includes('data-ifw-analytics-choices') &&
    INDEX_HTML.includes('Analytics &amp; privacy choices')
);

assert(
  'PostHog init is deferred until consent is granted',
  /function initPostHog\(\)[\s\S]*readConsent\(\) !== 'granted'/.test(CONSENT_JS) &&
    /window\.posthog\.init\(/.test(CONSENT_JS) &&
    !/^\s*posthog\.init\(/m.test(INDEX_HTML)
);

assert(
  'declining or withdrawing consent opts out and stops session replay',
  CONSENT_JS.includes('stopSessionRecording') &&
    CONSENT_JS.includes('opt_out_capturing')
);

assert(
  'maskTextSelector includes .path-title',
  /\.path-title/.test(CONSENT_JS.match(/maskTextSelector:[\s\S]*?`,/)?.[0] || CONSENT_JS)
);

assert(
  'starter benefits use separated label and body markup',
  INDEX_HTML.includes('starter-benefit-copy') &&
    INDEX_HTML.includes('starter-benefit-desc') &&
    /<strong>Know which roles to pursue<\/strong>\s*<span class="starter-benefit-desc">/.test(INDEX_HTML)
);

assert(
  'starter benefits CSS stacks label above body text',
  INDEX_HTML.includes('.starter-benefit-copy{display:flex;flex-direction:column')
);

console.log(`\nResults: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
