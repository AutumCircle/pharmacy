/* Read-only browser smoke. Optional Playwright runtime; no application dependency.
 * Usage: PLAYWRIGHT_MODULE=<module> MIRROR_UI_BASE_URL=<origin> node this-file
 * ADMIN_SESSION_SECRET is read only in Node from the environment or ignored .env.local.
 * No login credentials, tokens, customer/order content, or session cookies are printed.
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE
    ? pathToFileURL(path.resolve(process.env.PLAYWRIGHT_MODULE, 'index.mjs')).href
    : 'playwright'
);
const config = Object.fromEntries(
  fs
    .readFileSync('.env.local', 'utf8')
    .split(/\r?\n/)
    .filter((l) => /^[A-Z_]+=/.test(l))
    .map((l) => {
      const i = l.indexOf('=');
      return [l.slice(0, i), l.slice(i + 1).replace(/^"|"$/g, '')];
    }),
);
const base = process.env.MIRROR_UI_BASE_URL || 'http://127.0.0.1:3084';
const out = process.env.MIRROR_UI_OUTPUT || 'build/mirror-release/ui';
fs.mkdirSync(out, { recursive: true });
async function main() {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const anonymous = await browser.newContext();
    const guest = await anonymous.newPage();
    await guest.goto(base + '/admin/pharmacy-mirror');
    assert(
      new URL(guest.url()).pathname === '/admin/login',
      'Anonymous mirror page must redirect to login',
    );
    await anonymous.close();
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const secret = process.env.ADMIN_SESSION_SECRET || config.ADMIN_SESSION_SECRET;
    const payload = Buffer.from(
      JSON.stringify({ role: 'admin', expiresAt: Math.floor(Date.now() / 1000) + 300 }),
    ).toString('base64url');
    const signature = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
    await context.addCookies([
      {
        name: 'vatan_admin_session',
        value: payload + '.' + signature,
        url: base,
        httpOnly: true,
        secure: base.startsWith('https:'),
        sameSite: 'Lax',
      },
    ]);
    const page = await context.newPage();
    const mutations = [];
    await page.route('**/*', async (route) => {
      if (!['GET', 'HEAD'].includes(route.request().method())) {
        mutations.push(route.request().method());
        await route.abort();
        return;
      }
      await route.continue();
    });
    await page.goto(base + '/admin/pharmacy-mirror');
    await page.getByRole('heading', { name: 'База аптеки · Аптека №1' }).waitFor();
    await page.getByText('Только просмотр · тестовая база', { exact: true }).waitFor();
    await page
      .getByText('Не удалось получить состояние зеркала. Нажмите «Обновить данные».', {
        exact: true,
      })
      .waitFor({ state: 'hidden' });
    await page.getByLabel('Поиск товара', { exact: true }).fill('парацетамол');
    await page.getByRole('button', { name: 'Найти', exact: true }).click();
    await page.waitForURL(/q=/);
    await page.locator('.mirror-desktop tbody tr').first().waitFor();
    assert.equal(await page.locator('.mirror-desktop tbody tr').count(), 25);
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
      false,
      'Desktop overflow',
    );
    await page.screenshot({ path: out + '/desktop-search.png', fullPage: true });
    await page.getByRole('link', { name: 'Далее →', exact: true }).first().click();
    await page.waitForURL(/page=2/);
    await page
      .getByText(/Страница 2 из/)
      .first()
      .waitFor();
    await page.goto(base + '/admin/pharmacy-mirror?q=%25_&mode=name');
    await page
      .getByText('Товары не найдены. Проверьте запрос или тип поиска.', { exact: true })
      .waitFor();
    await page.getByLabel('Поиск товара', { exact: true }).fill('a');
    await page.getByLabel('Поиск товара', { exact: true }).press('Enter');
    await page.getByText('Введите минимум 2 символа.', { exact: true }).waitFor();
    await page.goto(base + '/admin/pharmacy-mirror/products/144403');
    await page
      .getByRole('heading', { name: 'Остатки по складам и партиям', exact: true })
      .waitFor();
    await page.locator('details').first().locator('summary').click();
    await page.locator('pre').first().waitFor();
    assert.equal(
      await page
        .locator('button')
        .filter({ hasText: /Удалить|Импорт|Сохранить|Редактировать/ })
        .count(),
      0,
    );
    await page.screenshot({ path: out + '/desktop-detail.png', fullPage: true });
    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 844 });
      await page.goto(base + '/admin/pharmacy-mirror?q=440050&mode=id');
      await page.locator('.mirror-mobile article').first().waitFor();
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
        false,
        'Mobile search overflow ' + width,
      );
      await page.screenshot({ path: out + '/mobile-search-' + width + '.png', fullPage: true });
      await page.goto(base + '/admin/pharmacy-mirror/products/144403');
      await page
        .getByRole('heading', { name: 'Связанные приходы / партии', exact: true })
        .waitFor();
      await page.locator('details').first().locator('summary').click();
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
        false,
        'Mobile detail overflow ' + width,
      );
      await page.screenshot({ path: out + '/mobile-detail-' + width + '.png', fullPage: true });
    }
    assert.deepEqual(mutations, [], 'Mirror UI must only issue reads');
    console.log(
      'PASS: anonymous auth redirect; 25-row desktop results; page 2; literal wildcard empty state; keyboard Enter validation; raw Oracle detail; no edit controls; 390/320px layouts without overflow; GET-only browser traffic',
    );
  } finally {
    await browser.close();
  }
}
main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
