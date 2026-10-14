// Opens the built single-file page from disk and drives it like a user.
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import { mkdirSync } from 'node:fs';
const out = process.argv[2] || '/tmp/shots';
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
const logs = [];
page.on('console', (m) => logs.push(m.type() + ': ' + m.text()));
page.on('pageerror', (e) => logs.push('pageerror: ' + e.message));
await page.goto('file://' + process.cwd() + '/dist/index.html');
const waitResult = async (prev) => {
  await page.waitForFunction((p) => {
    const r = window.cookiemaker?.result;
    return r && r.id !== p;
  }, prev, { timeout: 60000 });
  await page.waitForTimeout(400);
  return page.evaluate(() => {
    const r = window.cookiemaker.result;
    return { id: r.id, ok: r.ok, size: r.size.map((v) => +v.toFixed(1)), ms: Math.round(r.ms), issues: r.issues.map((i) => i.level + ': ' + i.text), meshes: r.meshes.map((m) => m.name + '/' + m.role + ':' + m.indices.length / 3) };
  });
};
let r = await waitResult(-1);
console.log('initial', JSON.stringify(r));
await page.screenshot({ path: out + '/1-cutter.png' });
for (const [label, file] of [['Imprint', '2-imprint'], ['Sello', '3-stamp'], ['Cortador + sello', '4-set']]) {
  await page.getByRole('button', { name: label, exact: true }).click();
  r = await waitResult(r.id);
  console.log(label, JSON.stringify(r));
  await page.screenshot({ path: out + '/' + file + '.png' });
}
// Text input
await page.getByRole('button', { name: 'Cortador', exact: true }).click();
r = await waitResult(r.id);
await page.getByRole('button', { name: 'Texto', exact: true }).click();
r = await waitResult(r.id);
await page.getByRole('textbox', { name: 'Texto' }).fill('OAB');
r = await waitResult(r.id);
console.log('text OAB', JSON.stringify(r));
await page.screenshot({ path: out + '/5-text.png' });
// Downloads
for (const name of ['STL', 'Exportar 3MF']) {
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name, exact: true }).click()]);
  const p = out + '/' + dl.suggestedFilename();
  await dl.saveAs(p);
  console.log('download', p);
}
console.log(logs.join('\n'));
await browser.close();
