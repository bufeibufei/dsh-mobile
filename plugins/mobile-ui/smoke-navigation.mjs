/** Isolated fixed DSH browser navigation smoke. Fictional login; no model prompt. */
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {mkdtemp, mkdir, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname, join, resolve} from 'node:path';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {provisionInitial} from '../login/credentials.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const {chromium} = require(process.env.B0_PLAYWRIGHT_MODULE ?? 'playwright');
const app = resolve(process.env.B0_DSH_APP ?? join(here, '../..'));
const cli = join(app, 'node_modules/@deepseek-ai/dsh/lib/bin.js');
assert.equal(JSON.parse(await readFile(join(app, 'node_modules/@deepseek-ai/dsh/package.json'), 'utf8')).version,
  '0.2.1-alpha.2', 'Requires official DSH 0.2.1-alpha.2');
async function freePort() {
  const server = createServer();
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  const port = server.address().port;
  await new Promise(done => server.close(done));
  return port;
}
const root = await mkdtemp(join(tmpdir(), 'jarvis-b0-mobile-nav-'));
const home = join(root, 'home'), work = join(root, 'work');
await mkdir(home); await mkdir(work);
await provisionInitial(join(home, 'jarvis-auth.json'), join(root, 'delivery'));
const creds = Object.fromEntries((await readFile(join(root, 'delivery'), 'utf8')).trim().split('\n').map(line => line.split('=')));
const port = await freePort(), base = `http://127.0.0.1:${port}`;
const patch = join(root, 'patch.yml');
await writeFile(patch, [
  '- id: session-title-llm', '  disabled: true',
  '- id: llm-pi-ai', '  disabled: true',
  '- id: llm-deepseek', '  disabled: true',
  '- insert:', '    - id: jarvis-b0-login',
  `      name: ${JSON.stringify(join(here, '../login/index.mjs'))}`,
  '      config:', '        authorities:', `          - "127.0.0.1:${port}"`,
  '    - id: jarvis-b0-mobile-ui', `      name: ${JSON.stringify(join(here, 'index.js'))}`
].join('\n') + '\n');
const child = spawn(process.execPath, [cli, 'web', '--patch', patch, '--no-open', '--host', '127.0.0.1', '--port', String(port)], {
  cwd: work,
  env: {PATH: process.env.PATH, HOME: root, DSH_HOME: home, DSH_AGENTS_HOME: join(root, 'agents'), DSH_TELEMETRY_DISABLED: '1'},
  stdio: ['ignore', 'pipe', 'pipe']
});
// Native stdout can contain a launch token. Never emit or save it.
child.stdout.resume(); child.stderr.resume();
let browser;
try {
  let ready = false;
  for (let i = 0; i < 150; i++) {
    try { if ((await fetch(base + '/jarvis-auth')).status === 405) { ready = true; break; } } catch {}
    await new Promise(done => setTimeout(done, 200));
  }
  assert.ok(ready, 'Official DSH did not start');
  const login = await fetch(base + '/jarvis-auth', {
    method: 'POST', redirect: 'manual',
    headers: {'content-type': 'application/x-www-form-urlencoded'}, body: new URLSearchParams(creds)
  });
  assert.equal(login.status, 303);
  const [name, value] = login.headers.get('set-cookie').split(';')[0].split('=');
  browser = await chromium.launch(process.env.B0_CHROMIUM_EXECUTABLE ? {executablePath: process.env.B0_CHROMIUM_EXECUTABLE} : {});
  const checks = [];
  for (const width of [360, 390, 412]) {
    const context = await browser.newContext({viewport: {width, height: 844}});
    await context.addCookies([{name, value, url: base}]);
    const page = await context.newPage();
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto(base + '/', {waitUntil: 'networkidle'});
    await page.locator('style[data-jarvis-b0-mobile="0.1.12-back-drawer"]').waitFor({state: 'attached'});
    const continueButton = page.getByRole('button', {name: 'Continue'});
    if (await continueButton.isVisible().catch(() => false)) await continueButton.click();
    await page.getByRole('button', {name: '打开会话侧栏'}).click();
    const drawer = await page.locator('.pI_x6G_sidebarCol').evaluate(node => Math.round(node.getBoundingClientRect().width));
    assert.equal(drawer, 288);
    assert.ok(await page.locator('.jarvis-b0-mobile-backdrop').isVisible());
    await page.waitForTimeout(250);
    if (process.env.B0_SCREENSHOT_DIR && width === 390) await page.screenshot({path: join(process.env.B0_SCREENSHOT_DIR, 'drawer.png')});
    assert.equal(await page.evaluate(() => window.__JARVIS_B0_MOBILE__.back()), true);
    await page.getByRole('button', {name: '打开会话侧栏'}).click();
    const pluginsEntry = page.getByRole('button', {name: 'Plugins'});
    if (width === 390) await pluginsEntry.evaluate(node => node.setAttribute('aria-label', '插件'));
    await page.getByRole('button', {name: width === 390 ? '插件' : 'Plugins'}).click();
    await page.locator('[data-plugin-panel]').waitFor();
    await page.locator('[data-plugin-panel][aria-busy="false"]').waitFor();
    await page.locator('.pI_x6G_frame[data-sidebar-collapsed]').waitFor();
    assert.equal(await page.locator('.pI_x6G_sidebarCol').evaluate(node => getComputedStyle(node).display), 'none');
    await page.getByRole('button', {name: '返回会话'}).waitFor();
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Plugin page overflow');
    const pluginGeometry = await page.locator('[data-plugin-panel]').evaluate(panel => {
      const group = panel.querySelector('.X_2TxG_group').getBoundingClientRect();
      const bounds = panel.getBoundingClientRect();
      return {left: group.left, right: group.right, panelRight: bounds.right,
        scrollWidth: panel.scrollWidth, clientWidth: panel.clientWidth};
    });
    assert.ok(pluginGeometry.left >= 16 && pluginGeometry.right <= pluginGeometry.panelRight - 16,
      `Plugin group inset: ${JSON.stringify(pluginGeometry)}`);
    assert.ok(pluginGeometry.scrollWidth <= pluginGeometry.clientWidth, 'Plugin panel scrolls horizontally');
    const pluginBackWidth = await page.getByRole('button', {name: '返回会话'}).evaluate(node => Math.round(node.getBoundingClientRect().width));
    assert.equal(pluginBackWidth, 44);
    if (process.env.B0_SCREENSHOT_DIR && width === 390) await page.screenshot({path: join(process.env.B0_SCREENSHOT_DIR, 'plugins.png')});
    await page.locator('.X_2TxG_addButton').click();
    await page.locator('[role="dialog"][aria-modal="true"]').waitFor();
    assert.equal(await page.evaluate(() => window.__JARVIS_B0_MOBILE__.back()), true);
    await page.locator('[role="dialog"][aria-modal="true"]').waitFor({state: 'detached'});
    const item = page.locator('[data-plugin-item] button').first();
    await item.click();
    await page.locator('[data-plugin-item-detail]').waitFor();
    const detailGeometry = await page.locator('[data-plugin-item-detail]').evaluate(node => {
      const bounds = node.getBoundingClientRect();
      return {left: bounds.left, right: bounds.right, width: bounds.width};
    });
    assert.ok(detailGeometry.left >= 16 && detailGeometry.right <= width - 16,
      `Plugin detail inset: ${JSON.stringify(detailGeometry)}`);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Plugin detail overflow');
    if (process.env.B0_SCREENSHOT_DIR && width === 390) await page.screenshot({path: join(process.env.B0_SCREENSHOT_DIR, 'plugin-detail.png')});
    assert.equal(await page.evaluate(() => window.__JARVIS_B0_MOBILE__.back()), true);
    await page.locator('[data-plugin-item-detail]').waitFor({state: 'detached'});
    const listBack = await page.evaluate(() => window.__JARVIS_B0_MOBILE__.back());
    assert.equal(listBack, true);
    await page.locator('[data-plugin-panel]').waitFor({state: 'detached'});
    // Official alpha.2 automation panel: header exit and Android back use the same action.
    await page.getByRole('button', {name: '打开会话侧栏'}).click();
    await page.getByRole('button', {name: /Automation tasks|自动化任务/}).click();
    await page.locator('[data-testid="task-manager-page"]').waitFor();
    await page.locator('[data-testid="task-manager-page"] .jarvis-b0-plugin-back').click();
    await page.locator('[data-testid="task-manager-page"]').waitFor({state:'detached'});
    await page.getByRole('button', {name: '打开会话侧栏'}).click();
    await page.getByRole('button', {name: /Automation tasks|自动化任务/}).click();
    await page.locator('[data-testid="task-manager-page"]').waitFor();
    assert.equal(await page.evaluate(() => window.__JARVIS_B0_MOBILE__.back()), true);
    await page.locator('[data-testid="task-manager-page"]').waitFor({state:'detached'});
    await page.getByRole('button', {name: '打开会话侧栏'}).click();
    await page.getByRole('button', {name: 'Settings'}).click();
    await page.locator('.VOzbGW_panel').waitFor();
    await page.locator('.VOzbGW_panel[data-jarvis-settings-view="root"]').waitFor();
    await page.locator('.pI_x6G_frame[data-sidebar-collapsed]').waitFor();
    const settingsRoot = page.locator('.jarvis-b0-settings-root');
    assert.deepEqual(await settingsRoot.locator('h2').allTextContents(), ['Jarvis', 'DSH']);
    assert.deepEqual((await settingsRoot.locator('[data-jarvis-settings-section="dsh"] strong').allTextContents()).map(x => x.trim()),
      ['通用', '模型', '内置插件', 'Agent 预设']);
    assert.deepEqual(await settingsRoot.locator('[data-jarvis-settings-section="jarvis"] strong').allTextContents(),
      ['服务器', '连接状态与文件', '账号与安全']);
    assert.equal(await page.locator('.jarvis-b0-mobile-settings').count(), 0);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Settings overflow');
    const settingsClose = await page.locator('.VOzbGW_close').evaluate(node => Math.round(node.getBoundingClientRect().width));
    assert.equal(settingsClose, 44, await page.locator('.VOzbGW_close').evaluate(node => JSON.stringify({
      css: getComputedStyle(node).width, media: matchMedia('(max-width: 700px)').matches,
      rules: [...document.querySelector('style[data-jarvis-b0-mobile]').sheet.cssRules].flatMap(rule => [...rule.cssRules ?? []]).filter(rule => rule.selectorText?.includes('.VOzbGW_close')).map(rule => rule.cssText)
    })));
    if (process.env.B0_SCREENSHOT_DIR && width === 390) await page.screenshot({path: join(process.env.B0_SCREENSHOT_DIR, 'settings.png')});
    if (width === 390) {
      await page.setViewportSize({width, height: 520});
      const beforeScroll = await page.evaluate(() => ({
        title: document.querySelector('.jarvis-b0-settings-root h1').getBoundingClientRect().top,
        close: document.querySelector('.VOzbGW_close').getBoundingClientRect().top
      }));
      const scroll = await page.locator('.jarvis-b0-settings-root').evaluate(node => {
        node.scrollTop = node.scrollHeight;
        return {top: node.scrollTop, max: node.scrollHeight - node.clientHeight};
      });
      assert.ok(scroll.max > 0 && scroll.top > 0, 'Settings did not scroll');
      const afterScroll = await page.evaluate(() => ({
        title: document.querySelector('.jarvis-b0-settings-root h1').getBoundingClientRect().top,
        close: document.querySelector('.VOzbGW_close').getBoundingClientRect().top
      }));
      assert.ok(Math.abs(afterScroll.title - beforeScroll.title) <= 1, 'Settings title moved');
      assert.ok(Math.abs(afterScroll.close - beforeScroll.close) <= 1, 'Settings close moved');
      if (process.env.B0_SCREENSHOT_DIR) await page.screenshot({path: join(process.env.B0_SCREENSHOT_DIR, 'settings-scroll.png')});
      await page.setViewportSize({width, height: 844});
    }
    await settingsRoot.locator('[data-jarvis-settings-section="jarvis"]').first().click();
    assert.ok(await settingsRoot.locator('.jarvis-b0-settings-notice').isVisible());
    await page.evaluate(() => { window.__jarvisBridgeValues = []; window.JarvisB0Settings = {
      postMessage(value) { window.__jarvisBridgeValues.push(value); }
    }; });
    for (const row of await settingsRoot.locator('[data-jarvis-settings-section="jarvis"]').all()) await row.click();
    assert.deepEqual(await page.evaluate(() => window.__jarvisBridgeValues), ['servers', 'connection', 'account']);
    for (let i = 0; i < 4; i++) {
      const label = (await settingsRoot.locator('[data-jarvis-settings-section="dsh"] strong').nth(i).textContent()).trim();
      await settingsRoot.locator('[data-jarvis-settings-section="dsh"]').nth(i).click();
      await page.locator('.VOzbGW_panel[data-jarvis-settings-view="detail"]').waitFor();
      assert.ok(await page.locator('.VOzbGW_options').isVisible());
      assert.equal((await page.locator('.jarvis-b0-settings-detail-header h1').textContent()).trim(), label);
      assert.equal(await page.locator('.VOzbGW_nav').evaluate(node => getComputedStyle(node).display), 'none');
      assert.ok(!(await page.locator('.VOzbGW_close').isVisible()));
      for (const action of await page.locator('.VOzbGW_header button:not(.VOzbGW_close)').all())
        assert.ok(await action.isVisible(), 'Official Settings action hidden');
      assert.equal(await page.locator('.jarvis-b0-mobile-settings').count(), 0);
      const settingsHeader = await page.evaluate(() => ({
        back: document.querySelector('.jarvis-b0-settings-detail-back').getBoundingClientRect().toJSON(),
        title: document.querySelector('.jarvis-b0-settings-detail-header h1').getBoundingClientRect().toJSON()
      }));
      assert.ok(settingsHeader.back.right <= settingsHeader.title.left,
        `Settings Back overlaps title: ${JSON.stringify(settingsHeader)}`);
      if (process.env.B0_SCREENSHOT_DIR && width === 390 && i === 0)
        await page.screenshot({path: join(process.env.B0_SCREENSHOT_DIR, 'settings-detail.png')});
      if (i === 0) await page.locator('.jarvis-b0-settings-detail-back').click();
      else assert.equal(await page.evaluate(() => window.__JARVIS_B0_MOBILE__.back()), true);
      await page.locator('.VOzbGW_panel[data-jarvis-settings-view="root"]').waitFor();
    }
    if (width === 390) {
      await page.setViewportSize({width, height: 520});
      const lastDshRow = settingsRoot.locator('[data-jarvis-settings-section="dsh"]').last();
      const rootScroll = await settingsRoot.evaluate(node => {
        node.scrollTop = Math.min(100, node.scrollHeight - node.clientHeight);
        return node.scrollTop;
      });
      assert.ok(rootScroll > 0, 'Settings root cannot test scroll restoration');
      await lastDshRow.scrollIntoViewIfNeeded();
      const scrollBeforeClick = await settingsRoot.evaluate(node => node.scrollTop);
      assert.ok(scrollBeforeClick > 0, 'Settings root scrolled to top before opening detail');
      await lastDshRow.click();
      await page.locator('.VOzbGW_panel[data-jarvis-settings-view="detail"]').waitFor();
      await page.locator('.jarvis-b0-settings-detail-back').click();
      await page.locator('.VOzbGW_panel[data-jarvis-settings-view="root"]').waitFor();
      assert.equal(await settingsRoot.evaluate(node => node.scrollTop), scrollBeforeClick);
      await page.setViewportSize({width, height: 844});
    }
    assert.equal(await page.evaluate(() => window.__JARVIS_B0_MOBILE__.back()), true);
    await page.locator('.VOzbGW_panel').waitFor({state: 'detached'});
    await page.locator('.pI_x6G_frame[data-sidebar-collapsed]').waitFor();
    assert.equal(await page.evaluate(() => window.__JARVIS_B0_MOBILE__.back()), false);
    await page.getByRole('button', {name: '打开会话侧栏'}).click();
    await page.getByRole('button', {name: 'Settings'}).click();
    await page.locator('.VOzbGW_panel[data-jarvis-settings-view="root"]').waitFor();
    await page.locator('.pI_x6G_frame[data-sidebar-collapsed]').waitFor();
    assert.equal(await page.locator('.jarvis-b0-settings-root').evaluate(node => node.scrollTop), 0);
    await page.locator('.VOzbGW_close').click();
    await page.locator('.VOzbGW_panel').waitFor({state: 'detached'});
    assert.equal(await page.evaluate(() => window.__JARVIS_B0_MOBILE__.back()), false);
    await page.getByRole('button', {name: 'Open right sidebar'}).click();
    await page.locator('[data-sidebar-right-panel][data-sidebar-right-open]').waitFor();
    const guide = await page.locator('[data-sidebar-right-guide]').isVisible();
    assert.ok(guide);
    const guideTitle = await page.locator('[data-jarvis-guide-tab]').getAttribute('aria-label');
    assert.equal(guideTitle, 'DSH Guide');
    assert.equal(await page.locator('[data-jarvis-guide-tab]').getAttribute('aria-disabled'), 'true');
    const guideEntries = await page.locator('[data-sidebar-right-guide-entry]').count();
    assert.ok(guideEntries >= 2);
    const modeHidden = await page.locator('[data-sidebar-right-mode]').evaluate(node => getComputedStyle(node).display === 'none');
    assert.ok(modeHidden);
    const splitHidden = await page.locator('[data-dockkit-split-button]').evaluate(node => getComputedStyle(node).display === 'none');
    assert.ok(splitHidden);
    assert.equal(await page.locator('[data-sidebar-right-guide] kbd:visible').count(), 0);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Guide overflow');
    if (process.env.B0_SCREENSHOT_DIR && width === 390) await page.screenshot({path: join(process.env.B0_SCREENSHOT_DIR, 'guide.png')});
    if (width === 390) {
      await page.setViewportSize({width: 1024, height: 844});
      await page.waitForFunction(() => !document.querySelector('[data-jarvis-guide-tab]'));
      assert.equal(await page.locator('[data-dockkit-tab][aria-selected="true"]').getAttribute('aria-disabled'), null);
      assert.equal(await page.locator('[data-dockkit-tab][aria-selected="true"]').getAttribute('tabindex'), '0');
      await page.setViewportSize({width, height: 844});
      await page.locator('[data-jarvis-guide-tab]').waitFor();
      await page.locator('[data-sidebar-right-guide-entry="files"]').click();
      await page.locator('[data-sidebar-right-guide]').waitFor({state: 'detached'});
      assert.equal(await page.locator('[data-jarvis-guide-tab]').count(), 0);
      assert.equal(await page.locator('[data-dockkit-tab][aria-selected="false"][tabindex="0"]').count(), 0);
      assert.ok(await page.locator('[data-sidebar-right-panel][data-sidebar-right-open]').count());
      assert.equal(await page.locator('[data-sidebar-right-mode]').evaluate(node => getComputedStyle(node).display), 'none');
      assert.equal(await page.locator('[data-dockkit-split-button]').evaluate(node => getComputedStyle(node).display), 'none');
      if (process.env.B0_SCREENSHOT_DIR) await page.screenshot({path: join(process.env.B0_SCREENSHOT_DIR, 'files.png')});
      assert.equal(await page.evaluate(() => window.__JARVIS_B0_MOBILE__.back()), true);
      await page.getByRole('button', {name: 'Open right sidebar'}).click();
      await page.locator('[data-dockkit-add-tab]').click();
      await page.locator('[data-sidebar-right-guide]').waitFor();
      await page.locator('[data-sidebar-right-guide-entry="terminal"] .zjup-W_main').click();
      await page.locator('[data-sidebar-right-guide]').waitFor({state: 'detached'});
      assert.equal(await page.locator('[data-sidebar-right-mode]').evaluate(node => getComputedStyle(node).display), 'none');
      assert.equal(await page.locator('[data-dockkit-split-button]').evaluate(node => getComputedStyle(node).display), 'none');
      if (process.env.B0_SCREENSHOT_DIR) await page.screenshot({path: join(process.env.B0_SCREENSHOT_DIR, 'terminal.png')});
      assert.equal(await page.evaluate(() => window.__JARVIS_B0_MOBILE__.back()), true);
      await page.getByRole('button', {name: 'Open right sidebar'}).click();
      await page.locator('[data-dockkit-add-tab]').click();
      await page.locator('[data-sidebar-right-guide]').waitFor();
    }
    if (width === 390) {
      // DSH keeps the Session rightbar mounted when selecting a global main
      // panel. Trigger its real Plugins action behind the fullscreen guide.
      await page.locator('button.hHd-Xa_panelRow').evaluate(node => node.click());
      await page.locator('[data-plugin-panel]').waitFor();
      assert.ok(await page.locator('[data-sidebar-right-panel][data-sidebar-right-open]').count());
      assert.equal(await page.evaluate(() => window.__JARVIS_B0_MOBILE__.back()), true);
      await page.locator('[data-plugin-panel]').waitFor({state: 'detached'});
    }
    assert.equal(await page.evaluate(() => window.__JARVIS_B0_MOBILE__.back()), true);
    await page.locator('[data-sidebar-right-panel][data-sidebar-right-open]').waitFor({state: 'detached'});
    assert.deepEqual(errors, []);
    checks.push({width, drawer, pluginBackWidth, settingsClose, guideEntries, modeHidden, splitHidden,
      pluginDialogBack: true, pluginDetailBack: true, pluginListBack: listBack,
      settingsBack: true, guideBack: true, pageErrors: errors.length});
    await context.close();
  }
  const desktop = await browser.newContext({viewport: {width: 1024, height: 768}});
  await desktop.addCookies([{name, value, url: base}]);
  const desktopPage = await desktop.newPage();
  await desktopPage.goto(base + '/', {waitUntil: 'networkidle'});
    await desktopPage.locator('style[data-jarvis-b0-mobile="0.1.12-back-drawer"]').waitFor({state: 'attached'});
  assert.equal(await desktopPage.locator('.jarvis-b0-mobile-open').evaluate(node => getComputedStyle(node).display), 'none');
  await desktop.close();
  console.log(JSON.stringify({result: 'passed', officialDsh: '0.2.1-alpha.2', checks, modelRequests: 0}));
} finally {
  if (browser) await browser.close();
  child.kill('SIGTERM');
  await new Promise(done => child.once('exit', done));
  await rm(root, {recursive: true, force: true});
}
