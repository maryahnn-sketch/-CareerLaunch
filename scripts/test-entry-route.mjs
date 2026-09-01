import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dirname = fileURLToPath(new URL('.', import.meta.url));
const root = join(dirname, '..');
const indexHtml = readFileSync(join(root, 'index.html'), 'utf8');
const vercel = JSON.parse(readFileSync(join(root, 'vercel.json'), 'utf8'));

let failures = 0;

function check(name, condition) {
  if (condition) {
    console.log(`PASS ${name}`);
    return;
  }
  failures += 1;
  console.error(`FAIL ${name}`);
}

const startRewrite = vercel.rewrites?.find((rule) => rule.source === '/start');
const startHeaders = vercel.headers?.find((rule) => rule.source === '/start');

check('Vercel rewrites /start to the single-page app', startRewrite?.destination === '/index.html');
check(
  '/start is never served from a stale cache',
  startHeaders?.headers?.some(
    (header) => header.key === 'Cache-Control' && header.value === 'no-store, max-age=0'
  )
);
check('the browser applies the entry route after restoring saved progress', (
  indexHtml.indexOf('if(savedProfile) applyHydratedState(hydrateProfile(savedProfile));') <
  indexHtml.indexOf('applyEntryRoute(window.location.pathname);')
));
check('a new /start visit enters the story flow', (
  indexHtml.includes("normalizedPath === '/start' && state.screen === 'landing'") &&
  indexHtml.includes("state.screen = 'intake';")
));

if (failures) process.exit(1);
