// Saves a cutter to the library, makes a new size from the library window and
// opens it back in the editor. Usage: node test/e2e-library.mjs [outDir]
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import { mkdirSync } from 'node:fs';
const out = process.argv[2] || '/tmp/shots';
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
await page.goto('file://' + process.cwd() + '/dist/index.html');
const waitResult = async (prev) => {
  await page.waitForFunction((p) => { const r = window.cookiemaker?.result; return r && r.id !== p; }, prev, { timeout: 60000 });
  await page.waitForTimeout(400);
  return page.evaluate(() => window.cookiemaker.result.id);
};
let id = await waitResult(-1);

// Cortador + sello starts with 0.9 mm of clearance.
await page.getByRole('button', { name: 'Cortador + sello', exact: true }).click();
id = await waitResult(id);
console.log('set clearance', await page.evaluate(() => window.cookiemaker.state.params.setClearance));
await page.screenshot({ path: out + '/l1-set-simple.png' });

// Save it.
await page.getByRole('button', { name: 'Guardar en biblioteca' }).click();
await page.getByRole('combobox', { name: 'Categoría' }).fill('Navidad');
await page.screenshot({ path: out + '/l2-save.png' });
await page.getByRole('button', { name: 'Guardar', exact: true }).click();
await page.waitForSelector('.link-card:not([hidden])');
await page.screenshot({ path: out + '/l3-linked.png' });

// Exporting the same piece and size replaces that version instead of adding one.
await page.getByRole('button', { name: 'STL', exact: true }).click();
await page.waitForTimeout(1500);

// A second cutter, exported directly.
await page.getByRole('button', { name: 'Estrella', exact: true }).click();
id = await waitResult(id);
await page.getByRole('button', { name: 'Cortador', exact: true }).click();
id = await waitResult(id);
await page.getByRole('button', { name: 'Exportar 3MF' }).click();
await page.waitForTimeout(1500);

await page.getByRole('button', { name: /^Biblioteca/ }).click();
await page.waitForSelector('.lcard');
console.log('cards', await page.locator('.lcard').count());
await page.screenshot({ path: out + '/l4-library.png' });
await page.locator('.list button', { hasText: 'Navidad' }).click();
console.log('filtered', await page.locator('.lcard').count());

// Open it and make a 15 cm version.
await page.locator('.lcard').first().click();
await page.waitForSelector('.dlg-item[open]');
console.log('versions before', await page.locator('.vrow').count());
await page.getByRole('button', { name: '15 cm', exact: true }).click();
await page.getByRole('button', { name: 'Generar versión' }).click();
await page.waitForFunction(() => document.querySelectorAll('.vrow').length >= 2, null, { timeout: 90000 });
console.log('versions after', await page.locator('.vrow').count(), await page.locator('.vtitle').allInnerTexts());
await page.screenshot({ path: out + '/l5-item.png' });
const dl = page.waitForEvent('download');
await page.locator('.vrow').last().getByRole('button', { name: 'STL' }).click();
console.log('download', (await dl).suggestedFilename());

// Back to the editor with the 15 cm version.
await page.locator('.vrow').last().getByRole('button', { name: 'Abrir en Diseñar' }).click();
id = await waitResult(id);
console.log('opened size', await page.evaluate(() => { const p = window.cookiemaker.state.params; return [p.sizeW, p.sizeH, window.cookiemaker.state.piece]; }));
await page.screenshot({ path: out + '/l6-opened.png' });

await page.getByRole('button', { name: 'Avanzado', exact: true }).click();
await page.screenshot({ path: out + '/l7-advanced.png' });
await page.locator('.theme').click();
await page.waitForTimeout(400);
await page.screenshot({ path: out + '/l8-dark.png' });
await page.getByRole('button', { name: /^Biblioteca/ }).click();
await page.waitForTimeout(400);
await page.screenshot({ path: out + '/l9-library-dark.png' });
console.log(errors.length ? errors.join('\n') : 'no errors');
await browser.close();
