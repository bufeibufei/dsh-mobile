/** Local DOM smoke for the mobile Settings shell; no Host, credentials or model. */
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const {chromium} = require(process.env.B0_PLAYWRIGHT_MODULE ?? 'playwright');
const client = await readFile(join(here, 'client.js'), 'utf8');
const categories = ['General', 'Models', 'Built-in plugins', 'Agent presets'];
const html = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1">
<style>
:root {--dsw-alias-bg-layer-1:#fff;--dsw-alias-bg-layer-2:#fff;--dsw-alias-border-l3:#e5e8ee;--dsw-alias-label-primary:#17191f;--dsw-alias-label-secondary:#777e89;--dsw-alias-state-error-primary:#c44747}
* {box-sizing:border-box} body {margin:0;font:15px Arial} button {font:inherit}
.VOzbGW_overlay {position:fixed;inset:0;display:flex}.VOzbGW_panel {position:relative;display:flex;width:100%;height:100%;background:#fff}
.VOzbGW_nav {width:160px;display:flex;flex-direction:column}.VOzbGW_navList {display:flex;flex-direction:column}
.VOzbGW_content {flex:1;min-width:0;overflow:auto}.VOzbGW_options {min-height:100%;padding:20px}
.VOzbGW_header {position:absolute;right:0;top:0;display:flex}.VOzbGW_close {width:44px;height:44px}
</style></head><body><div class="VOzbGW_overlay"><div class="VOzbGW_panel" role="dialog" aria-modal="true">
<nav class="VOzbGW_nav"><span class="VOzbGW_navTitle">Settings</span><div class="VOzbGW_navList">
${categories.map(value => `<button class="VOzbGW_navCell" type="button">${value}</button>`).join('')}
</div></nav><main class="VOzbGW_content"><div class="VOzbGW_options"><label>Official General control <input value="untouched"></label></div></main>
<header class="VOzbGW_header"><button class="VOzbGW_action" type="button" aria-label="Official settings action">Docs</button><button class="VOzbGW_close" type="button" aria-label="Close">×</button></header>
</div></div><script>
window.__ModuleLoader__={load(spec){window.__mobilePlugin=spec.factory(name=>{
  if(name==='react/jsx-runtime') return {jsx(){return null}};
  if(name==='react') return {useEffect(){},useState(){return [false,()=>{}]}};
  if(name==='@deepseek-ai/dsh-client-ui-primitives') return {Switch(){return null}};
  throw Error(name);
})}};
const panel=document.querySelector('.VOzbGW_panel');
document.querySelectorAll('.VOzbGW_navCell').forEach(cell=>cell.addEventListener('click',()=>{
  panel.querySelector('.VOzbGW_options').innerHTML='<label>Official '+cell.textContent+' control <input value="untouched"></label>';
}));
panel.querySelector('.VOzbGW_close').addEventListener('click',()=>{document.querySelector('.VOzbGW_overlay').hidden=true});
window.__bridgeValues=[];
window.__applyMobile=()=>window.__mobilePlugin.apply({
  effect(fn){fn()},slots:{inject(){return ()=>{}}},layout:{toggleSidebar(){},selectPanel(){},panelInfo:{getSnapshot(){return {activePanelId:null}}}}
});
</script></body></html>`;

const browser = await chromium.launch(process.env.B0_CHROMIUM_EXECUTABLE ?
  {executablePath: process.env.B0_CHROMIUM_EXECUTABLE} : {});
try {
  for (const width of [360, 390, 412]) {
    const page = await browser.newPage({viewport: {width, height: 844}});
    await page.setContent(html);
    await page.addScriptTag({content: client});
    await page.evaluate(() => window.__applyMobile());
    const root = page.locator('.jarvis-b0-settings-root');
    await root.waitFor();
    assert.deepEqual(await root.locator('h2').allTextContents(), ['Jarvis', 'DSH']);
    assert.deepEqual(await root.locator('[data-jarvis-settings-section="dsh"] strong').allTextContents(),
      ['通用', '模型', '内置插件', 'Agent 预设']);
    assert.deepEqual(await root.locator('[data-jarvis-settings-section="jarvis"] strong').allTextContents(),
      ['服务器', '连接状态与文件', '账号与安全']);
    assert.ok(!(await root.locator('[data-jarvis-settings-section="notify"]').isVisible()),
      'legacy fixture without the notification service must hide its entry');
    assert.equal(await page.locator('.jarvis-b0-mobile-settings').count(), 0);
    assert.ok(!(await page.locator('.VOzbGW_action').isVisible()),'settings root keeps only Close');
    if (process.env.B0_SCREENSHOT_DIR && width===390)
      await page.screenshot({path:join(process.env.B0_SCREENSHOT_DIR,'settings-root.png')});
    await page.setViewportSize({width,height:360});
    await root.locator('[data-jarvis-settings-section="jarvis"]').first().click();
    assert.ok(await root.locator('.jarvis-b0-settings-notice').isVisible());
    assert.equal(await root.locator('.jarvis-b0-settings-notice').evaluate(node=>
      node.previousElementSibling?.dataset.jarvisSettingsSection),'notify');
    assert.equal(await root.locator('.jarvis-b0-settings-notice').evaluate(node=>
      node.nextElementSibling?.textContent),'DSH');
    assert.ok(await root.locator('.jarvis-b0-settings-notice').evaluate(node=>
      node.getBoundingClientRect().bottom<=innerHeight));
    assert.ok(await root.evaluate(node=>node.scrollTop<node.querySelectorAll('h2')[1].offsetTop),
      'missing-listener feedback must remain in the Jarvis group');
    await page.setViewportSize({width,height:844});
    await page.evaluate(() => { window.JarvisB0Settings={postMessage(value){window.__bridgeValues.push(value)}}; });
    for (const row of await root.locator('[data-jarvis-settings-section="jarvis"]').all()) await row.click();
    assert.deepEqual(await page.evaluate(() => window.__bridgeValues), ['servers', 'connection', 'account']);
    for (let i = 0; i < 4; i++) {
      await root.locator('[data-jarvis-settings-section="dsh"]').nth(i).click();
      await page.locator('.VOzbGW_panel[data-jarvis-settings-view="detail"]').waitFor();
      assert.equal(await page.locator('.jarvis-b0-settings-detail-header h1').textContent(),
        ['通用', '模型', '内置插件', 'Agent 预设'][i]);
      assert.equal(await page.locator('.VOzbGW_options input').inputValue(), 'untouched');
      assert.ok((await page.locator('.VOzbGW_options').textContent()).includes('Official '+categories[i]+' control'));
      assert.equal(await page.locator('.VOzbGW_nav').evaluate(node=>getComputedStyle(node).display), 'none');
      assert.ok(await page.locator('.jarvis-b0-settings-detail-back').isVisible());
      assert.equal(await page.locator('.jarvis-b0-settings-detail-back').evaluate(node=>document.activeElement===node),true);
      assert.ok(await page.locator('.VOzbGW_action').isVisible());
      assert.ok(!(await page.locator('.VOzbGW_close').isVisible()));
      if (process.env.B0_SCREENSHOT_DIR && width===390 && i===0)
        await page.screenshot({path:join(process.env.B0_SCREENSHOT_DIR,'settings-detail.png')});
      assert.equal(await page.evaluate(() => window.__JARVIS_B0_MOBILE__.back()), true);
      await page.locator('.VOzbGW_panel[data-jarvis-settings-view="root"]').waitFor();
      assert.equal(await root.locator('[data-jarvis-settings-return]').count(),1);
    }
    await root.locator('[data-jarvis-settings-section="dsh"]').first().click();
    await page.evaluate(() => {document.querySelector('.jarvis-b0-settings-detail-header h1').textContent='一个很长的官方设置分类标题，用于检查狭窄屏幕上的顶栏截断和返回按钮';});
    await page.locator('.VOzbGW_options input').focus();
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth<=innerWidth));
    assert.ok(await page.locator('.jarvis-b0-settings-detail-back').isVisible());
    await page.locator('.jarvis-b0-settings-detail-back').click();
    await page.setViewportSize({width,height:520});
    await root.evaluate(node=>{node.scrollTop=130});
    await root.locator('[data-jarvis-settings-section="dsh"]').last().scrollIntoViewIfNeeded();
    const saved = await root.evaluate(node=>node.scrollTop);
    assert.ok(saved>0);
    await root.locator('[data-jarvis-settings-section="dsh"]').last().click();
    await page.locator('.jarvis-b0-settings-detail-back').click();
    assert.equal(await root.evaluate(node=>node.scrollTop),saved);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth<=innerWidth));
    assert.equal(await page.evaluate(() => window.__JARVIS_B0_MOBILE__.back()),true);
    assert.ok(await page.locator('.VOzbGW_overlay').evaluate(node=>node.hidden));
    await page.evaluate(() => {document.querySelector('.VOzbGW_overlay').hidden=false});
    assert.equal(await page.locator('.VOzbGW_panel').getAttribute('data-jarvis-settings-view'),'root');
    assert.equal(await root.evaluate(node=>node.scrollTop),0);
    await page.close();
  }
  const desktop = await browser.newPage({viewport:{width:1024,height:768}});
  await desktop.setContent(html);
  await desktop.addScriptTag({content:client});
  await desktop.evaluate(() => window.__applyMobile());
  assert.equal(await desktop.locator('.jarvis-b0-settings-root').count(),0);
  assert.ok(await desktop.locator('.VOzbGW_navList').isVisible());
  await desktop.close();
  console.log(JSON.stringify({result:'passed',widths:[360,390,412],dshDetails:4,bridgeValues:3,modelRequests:0}));
} finally { await browser.close(); }
