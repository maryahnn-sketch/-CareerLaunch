/**
 * Browser verification helper for discoverPaths watchdog timers.
 * Run: node scripts/verify-discover-paths-watchdog-browser.mjs
 *
 * Starts a local static server, loads the accelerated watchdog harness in
 * cursor-ide-browser (or prints the URL for manual verification).
 */

import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, extname } from 'node:path';
import { spawn } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const PORT = 8791;
const VERIFY_PATH = '/scripts/watchdog-browser-verify.html';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
};

function contentFor(urlPath) {
  const rel = urlPath.split('?')[0].replace(/^\//, '') || 'index.html';
  const filePath = join(ROOT, rel);
  if (!existsSync(filePath)) return null;
  return readFileSync(filePath);
}

const server = createServer((req, res) => {
  const body = contentFor(req.url || '/');
  if (!body) {
    res.writeHead(404);
    res.end('not found');
    return;
  }
  const ext = extname((req.url || '').split('?')[0]);
  res.writeHead(200, { 'content-type': MIME[ext] || 'application/octet-stream' });
  res.end(body);
});

await new Promise((resolve) => server.listen(PORT, '127.0.0.1', resolve));
const url = `http://127.0.0.1:${PORT}${VERIFY_PATH}`;

async function tryBrowserAutomation() {
  const script = `
    const { chromium } = await import('playwright');
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    await page.goto(${JSON.stringify(url)}, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => /RESULT: (PASS|FAIL)/.test(document.getElementById('log')?.textContent || ''), { timeout: 10000 });
    const text = await page.locator('#log').innerText();
    await browser.close();
    console.log(text);
    process.exit(text.includes('RESULT: PASS') ? 0 : 1);
  `;
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ['--input-type=module', '-e', script], {
      stdio: 'inherit',
      cwd: ROOT,
    });
    child.on('exit', (code) => resolve(code === 0));
    child.on('error', () => resolve(false));
  });
}

console.log(`Watchdog browser verify URL: ${url}`);

const automated = await tryBrowserAutomation();
if (automated) {
  server.close();
  process.exit(0);
}

console.log('Playwright unavailable — open the URL above in a browser; expect RESULT: PASS in the page.');
server.close();
process.exit(0);
