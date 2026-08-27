/**
 * Real headless-browser integration test for discoverPaths() inline timer behavior.
 * Run: node scripts/playwright-discover-paths-integration.mjs
 *
 * Requires: playwright (npx playwright install chromium)
 * Serves index.html via Playwright routes; hangs /api/claude for discoverPaths; uses real ~30s/90s timers.
 */

import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, extname } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const PORT = 8765;
const ARTIFACT_DIR = join(ROOT, '.test-artifacts', 'discover-paths-integration');
const BUILD_ID = 'c8d41f2';
const COPY_DELAY_MS = 30000;
const TIMEOUT_MS = 90000;
const STALE_PATH_TITLE = 'STALE_PATH_SHOULD_NOT_APPEAR';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.json': 'application/json',
};

function contentFor(urlPath) {
  const rel = urlPath.split('?')[0].replace(/^\//, '') || 'index.html';
  const filePath = join(ROOT, rel);
  if (!existsSync(filePath)) return null;
  return readFileSync(filePath);
}

function installStaticRoutes(page) {
  const origin = `http://127.0.0.1:${PORT}`;
  return page.route(`${origin}/**`, async (route) => {
    const url = new URL(route.request().url());
    if (!url.href.startsWith(origin)) {
      await route.continue();
      return;
    }
    const rel = url.pathname.replace(/^\//, '') || 'index.html';
    const body = contentFor(`/${rel}`);
    if (!body) {
      await route.fulfill({ status: 404, body: 'not found' });
      return;
    }
    const ext = extname(url.pathname);
    await route.fulfill({
      status: 200,
      contentType: MIME[ext] || 'application/octet-stream',
      body,
    });
  }).then(() =>
    page.route(origin, async (route) => {
      const body = contentFor('/');
      await route.fulfill({
        status: 200,
        contentType: MIME['.html'],
        body,
      });
    })
  );
}

function makeSeedProfile() {
  const skills = [
    { name: 'Team Coordination', evidence: 'Coordinated volunteer schedules at the food pantry.', strength: 'Strong' },
    { name: 'Inventory Management', evidence: 'Tracked pantry donations and restock levels weekly.', strength: 'Moderate' },
    { name: 'Customer Service', evidence: 'Greeted visitors and answered questions at intake.', strength: 'Strong' },
    { name: 'Record Keeping', evidence: 'Maintained sign-in logs and donation records.', strength: 'Moderate' },
    { name: 'Event Planning', evidence: 'Helped plan monthly community distribution events.', strength: 'Developing' },
    { name: 'Problem Solving', evidence: 'Resolved supply shortages by contacting alternate donors.', strength: 'Moderate' },
    { name: 'Communication', evidence: 'Sent weekly updates to volunteer team leads.', strength: 'Strong' },
  ];
  const skillValidation = Object.fromEntries(skills.map((s) => [s.name, 'yes']));
  return {
    schemaVersion: 2,
    savedAt: new Date().toISOString(),
    currentScreen: 'skills',
    story:
      'For three years I managed a church food pantry volunteer team, tracked inventory, planned monthly distribution events, and kept donation records organized.',
    additionalExperiences: [],
    skills,
    skillValidation,
    preferences: { interests: [], dislikes: [] },
    priorities: [],
    paths: [],
    reranked: false,
    changeSummary: '',
    chosenPath: null,
    convo: [],
    paymentStatus: 'unpaid',
    roadmap: null,
    roadmapSections: { foundation: 'idle', actionPlan: 'idle', direction: 'idle' },
    roadmapStatus: 'idle',
    evidenceLibrary: [],
    kit: null,
    selectedHeadline: 0,
    storyBank: null,
    jdText: '',
    jdAnalysis: null,
    pathFeedback: {},
    pathRegenerationCount: 0,
  };
}

function fakePathsPayload() {
  return {
    stop_reason: 'end_turn',
    content: [
      {
        type: 'tool_use',
        name: 'report_career_paths',
        input: {
          paths: [
            {
              title: STALE_PATH_TITLE,
              entryPoint: 'Operations Coordinator',
              progression: 'Program Manager',
              category: 'Strong Evidence',
              why: 'Volunteer coordination maps directly to operations roles.',
              transfers: ['Team Coordination', 'Inventory Management', 'Communication'],
              gaps: ['Formal HR systems'],
              transition: 'Strong',
              workEnvironment: 'Team-based, fast-paced',
              relevance: ['Employment'],
            },
          ],
        },
      },
    ],
  };
}

async function ensurePlaywright() {
  try {
    await import('playwright');
    return true;
  } catch {
    const localPlaywright = join(ROOT, 'node_modules', 'playwright', 'index.mjs');
    if (existsSync(localPlaywright)) {
      return true;
    }
    throw new Error(
      'playwright not installed — run: npm install playwright && npx playwright install chromium'
    );
  }
}

async function runIntegrationTest() {
  mkdirSync(ARTIFACT_DIR, { recursive: true });
  const { chromium } = await import('playwright');

  const consoleErrors = [];
  const criteria = {
    buildId: { pass: false, detail: '' },
    copyAt30s: { pass: false, detail: '', timestampMs: null, elapsedMs: null },
    spinnerExitAt90s: { pass: false, detail: '', timestampMs: null, elapsedMs: null },
    timeoutUi: { pass: false, detail: '' },
    staleProtection: { pass: false, detail: '' },
  };

  let hungRoute = null;
  let clickStartedAt = 0;

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => consoleErrors.push(String(err)));

  await installStaticRoutes(page);

  await page.route('**/api/public-config', async (route) => {
    await route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'Supabase is not configured' }),
    });
  });

  await page.route('**/api/beta-access', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ privateBetaEnabled: false }),
    });
  });

  await page.route('**/api/claude', async (route) => {
    let body;
    try {
      body = route.request().postDataJSON();
    } catch {
      body = {};
    }
    const op = body?.operation || '';
    if (op === 'discoverPaths' || op.startsWith('discoverPaths:')) {
      hungRoute = route;
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ stop_reason: 'end_turn', content: [] }),
    });
  });

  const seedProfile = makeSeedProfile();
  await page.addInitScript((profile) => {
    localStorage.setItem('careerlaunch.profile.v1', JSON.stringify(profile));
    localStorage.setItem('ifw_analytics_consent', 'denied');
  }, seedProfile);

  const baseUrl = `http://127.0.0.1:${PORT}/`;
  await page.goto(baseUrl, { waitUntil: 'load', timeout: 60000 });

  await page.waitForFunction(() => document.getElementById('toPaths'), { timeout: 15000 });

  const build = await page.evaluate(() => document.body.dataset.build);
  criteria.buildId.pass = build === BUILD_ID;
  criteria.buildId.detail = `document.body.dataset.build=${JSON.stringify(build)}`;

  await page.screenshot({ path: join(ARTIFACT_DIR, '00-skills-screen.png'), fullPage: true });

  clickStartedAt = Date.now();
  await page.click('#toPaths');

  await page.waitForSelector('.analyzing-wrap .spinner', { timeout: 5000 });
  await page.screenshot({ path: join(ARTIFACT_DIR, '01-analyzing-t0.png'), fullPage: true });

  const initialMsg = await page.locator('.analyzing-wrap .msg').innerText();
  criteria.copyAt30s.detail = `initial msg=${JSON.stringify(initialMsg)}`;

  let copyChangedAt = null;
  const copyDeadline = clickStartedAt + COPY_DELAY_MS + 15000;
  while (Date.now() < copyDeadline) {
    const msg = await page.locator('.analyzing-wrap .msg').innerText().catch(() => '');
    if (msg.includes('Still working')) {
      copyChangedAt = Date.now();
      break;
    }
    await page.waitForTimeout(500);
  }

  if (copyChangedAt) {
    const elapsed = copyChangedAt - clickStartedAt;
    criteria.copyAt30s.pass = elapsed >= COPY_DELAY_MS - 3000 && elapsed <= COPY_DELAY_MS + 5000;
    criteria.copyAt30s.timestampMs = copyChangedAt;
    criteria.copyAt30s.elapsedMs = elapsed;
    criteria.copyAt30s.detail += `; changed at ${elapsed}ms with msg containing "Still working"`;
    await page.screenshot({ path: join(ARTIFACT_DIR, '02-still-working-30s.png'), fullPage: true });
  } else {
    criteria.copyAt30s.detail += '; never saw "Still working" copy';
    await page.screenshot({ path: join(ARTIFACT_DIR, '02-still-working-missing.png'), fullPage: true });
  }

  let timeoutAt = null;
  const timeoutDeadline = clickStartedAt + TIMEOUT_MS + 20000;
  while (Date.now() < timeoutDeadline) {
    const spinnerVisible = await page.locator('.analyzing-wrap .spinner').isVisible().catch(() => false);
    const retryVisible = await page.locator('#retryBtn').isVisible().catch(() => false);
    if (!spinnerVisible && retryVisible) {
      timeoutAt = Date.now();
      break;
    }
    await page.waitForTimeout(500);
  }

  if (timeoutAt) {
    const elapsed = timeoutAt - clickStartedAt;
    criteria.spinnerExitAt90s.pass = elapsed >= TIMEOUT_MS - 3000 && elapsed <= TIMEOUT_MS + 5000;
    criteria.spinnerExitAt90s.timestampMs = timeoutAt;
    criteria.spinnerExitAt90s.elapsedMs = elapsed;
    criteria.spinnerExitAt90s.detail = `spinner gone + retry visible at ${elapsed}ms`;
    await page.screenshot({ path: join(ARTIFACT_DIR, '03-timeout-90s.png'), fullPage: true });
  } else {
    criteria.spinnerExitAt90s.detail = 'spinner did not exit / retry not visible within deadline';
    await page.screenshot({ path: join(ARTIFACT_DIR, '03-timeout-missing.png'), fullPage: true });
  }

  const errorText = await page.locator('.error-box').innerText().catch(() => '');
  const retryLabel = await page.locator('#retryBtn').innerText().catch(() => '');
  criteria.timeoutUi.pass =
    errorText.includes("couldn't map career paths") && retryLabel.trim() === 'Try Again';
  criteria.timeoutUi.detail = `error=${JSON.stringify(errorText.slice(0, 120))}; retryLabel=${JSON.stringify(retryLabel)}`;

  if (hungRoute) {
    await hungRoute.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(fakePathsPayload()),
    });
    hungRoute = null;
    await page.waitForTimeout(3000);
    await page.screenshot({ path: join(ARTIFACT_DIR, '04-after-late-response.png'), fullPage: true });

    const pageText = await page.locator('#app').innerText();
    const retryStillVisible = await page.locator('#retryBtn').isVisible().catch(() => false);
    const staleVisible = pageText.includes(STALE_PATH_TITLE);
    const successHeading = pageText.includes('We found') && pageText.includes('career path');
    criteria.staleProtection.pass = retryStillVisible && !staleVisible && !successHeading;
    criteria.staleProtection.detail = `retryVisible=${retryStillVisible}; staleTitleVisible=${staleVisible}; successHeading=${successHeading}`;
  } else {
    criteria.staleProtection.detail = 'no hung discoverPaths route captured';
    await page.screenshot({ path: join(ARTIFACT_DIR, '04-no-hung-route.png'), fullPage: true });
  }

  await browser.close();
  return { criteria, consoleErrors, artifactDir: ARTIFACT_DIR };
}

function printReport({ criteria, consoleErrors, artifactDir }) {
  console.log('\n=== discoverPaths integration test report ===\n');
  const rows = [
    ['1. Build ID loaded', criteria.buildId],
    ['2. Loading copy changes ~30s', criteria.copyAt30s],
    ['3. Spinner exits ~90s', criteria.spinnerExitAt90s],
    ['4. Timeout message + Try Again', criteria.timeoutUi],
    ['5. Late response cannot overwrite timeout', criteria.staleProtection],
  ];

  let allPass = true;
  for (const [label, c] of rows) {
    const status = c.pass ? 'PASS' : 'FAIL';
    if (!c.pass) allPass = false;
    console.log(`${status} — ${label}`);
    console.log(`       ${c.detail}`);
    if (c.elapsedMs != null) console.log(`       elapsed=${c.elapsedMs}ms timestamp=${c.timestampMs}`);
  }

  console.log('\nScreenshots:');
  for (const name of [
    '00-skills-screen.png',
    '01-analyzing-t0.png',
    '02-still-working-30s.png',
    '03-timeout-90s.png',
    '04-after-late-response.png',
  ]) {
    const p = join(artifactDir, name);
    if (existsSync(p)) console.log(`  ${p}`);
  }

  if (consoleErrors.length) {
    console.log('\nConsole errors:');
    for (const e of consoleErrors) console.log(`  ${e}`);
  } else {
    console.log('\nConsole errors: none');
  }

  console.log(`\nOVERALL: ${allPass ? 'PASS' : 'FAIL'}\n`);
  return allPass ? 0 : 1;
}

console.log(`Static routes: http://127.0.0.1:${PORT}/`);

try {
  await ensurePlaywright();
  const result = await runIntegrationTest();
  const code = printReport(result);
  process.exit(code);
} catch (err) {
  console.error('Test runner error:', err);
  process.exit(2);
}
