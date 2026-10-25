/** Optional isolated Linux DSH smoke. Uses a caller-provided loopback profile and fictional data. */
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.B0_PLAYWRIGHT_MODULE||'playwright');
// The caller prepares an isolated Host and authenticated browser storage state.
const base=process.env.B0_ISOLATED_BASE;
const storageState=process.env.B0_ISOLATED_STORAGE_STATE;
assert.ok(base&&storageState,'Set B0_ISOLATED_BASE and B0_ISOLATED_STORAGE_STATE');
const url=new URL(base);
assert.ok(['127.0.0.1','localhost','[::1]'].includes(url.hostname),'Loopback Host required');
let browser;
try{
  browser=await chromium.launch(process.env.B0_CHROMIUM_EXECUTABLE?
    {executablePath:process.env.B0_CHROMIUM_EXECUTABLE}:{});
  const page=await browser.newPage({storageState,viewport:{width:390,height:844}}),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.goto(base,{waitUntil:'domcontentloaded'});
  await page.locator('style[data-jarvis-b0-mobile="0.1.12-back-drawer"]').waitFor({state:'attached'});
  const continueButton=page.getByRole('button',{name:/继续|Continue/});
  if(await continueButton.waitFor({state:'visible',timeout:5000}).then(()=>true).catch(()=>false)){
    await continueButton.click();
    const skipButton=page.getByRole('button',{name:'稍后配置'});
    if(await skipButton.waitFor({state:'visible',timeout:2500}).then(()=>true).catch(()=>false))
      await skipButton.click();
  }
  await page.getByRole('button',{name:'打开会话侧栏'}).click();
  await page.locator('.hHd-Xa_settingsArea button').click();
  const root=page.locator('.jarvis-b0-settings-root');await root.waitFor();
  assert.deepEqual(await root.locator('h2').allTextContents(),['Jarvis','DSH']);
  assert.deepEqual(await root.locator('[data-jarvis-settings-section="dsh"] strong').allTextContents(),
    ['通用','模型','内置插件','Agent 预设']);
  assert.deepEqual(await root.locator('[data-jarvis-settings-section="jarvis"] strong').allTextContents(),
    ['服务器','连接状态与文件','账号与安全']);
  await page.setViewportSize({width:390,height:360});
  await root.locator('[data-jarvis-settings-section="jarvis"]').first().click();
  await root.locator('.jarvis-b0-settings-notice').waitFor({state:'visible'});
  assert.ok(await root.locator('.jarvis-b0-settings-notice').evaluate(node=>
    node.getBoundingClientRect().bottom<=innerHeight));
  assert.ok(await root.evaluate(node=>node.scrollTop<node.querySelectorAll('h2')[1].offsetTop));
  await page.setViewportSize({width:390,height:844});
  for(let index=0;index<4;index++){
    await root.locator('[data-jarvis-settings-section="dsh"]').nth(index).click();
    await page.locator('.VOzbGW_panel[data-jarvis-settings-view="detail"]').waitFor();
    assert.equal(await page.locator('.VOzbGW_nav').evaluate(node=>getComputedStyle(node).display),'none');
    assert.ok(await page.locator('.VOzbGW_options').isVisible());
    assert.equal(await page.locator('.jarvis-b0-settings-detail-header h1').innerText(),
      ['通用','模型','内置插件','Agent 预设'][index]);
    assert.equal(await page.evaluate(()=>window.__JARVIS_B0_MOBILE__.back()),true);
    await page.locator('.VOzbGW_panel[data-jarvis-settings-view="root"]').waitFor();
  }
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({runtime:'caller-provided isolated DSH',checks:{rootOrder:true,
    shortScreenNotice:true,fourOfficialDetails:true,noGlobalTabsInDetail:true,pageErrors:0}}));
 }catch(error){
  console.error(JSON.stringify({failure:error.message.replace(/token=[^\s]+/g,'token=[redacted]').slice(0,600)}));
  process.exitCode=1;
}finally{if(browser)await browser.close();}
