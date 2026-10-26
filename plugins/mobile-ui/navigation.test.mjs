import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';
import {createTestDOM} from './test-dom.mjs';
import {parseCSS} from './css-test-helper.mjs';
const client=await readFile(new URL('./client.js',import.meta.url),'utf8');
function IconSparkleRegular() {}
const mainStyle = f => f.document.head.children.find(e => e.tagName === 'STYLE' && 'jarvisMainSession' in e.dataset);
const flush = async () => { for (let i=0;i<20;i++) await Promise.resolve(); };
const defaults = {enabled:true,notifyReplies:true,lockScreenContent:true};
// The generated module receives these hooks; effects run after the panel render.
function panelHooks() {
  const states = [], effects = [], cleanups = [];
  let cursor = 0, mounted = false;
  return {
    useState(initial) {
      const index = cursor++;
      if (!(index in states)) states[index] = typeof initial === 'function' ? initial() : initial;
      return [states[index], value => { states[index] = value; }];
    },
    useEffect(effect) { if (!mounted) effects.push(effect); },
    render(View) {
      cursor = 0;
      const tree = View();
      mounted = true;
      for (const effect of effects.splice(0)) cleanups.push(effect());
      return tree;
    },
    dispose() { cleanups.splice(0).forEach(cleanup => cleanup?.()); }
  };
}
function fixture(panelId=null,{details=false,dialog=false,drawer=false,lifeBack,notifications=false,
 settings=false,width=390,sessionId='one',settingsResponse=()=>Response.json({ok:true,value:defaults}),
 mainSession=false, mainResponse=()=>new Response(null,{status:404}),
 ensureResponse=()=>Response.json({ok:true,value:{sessionId:'two'}})}={}) {
 const {document,Element}=createTestDOM();let module,active=panelId,closed=0,sidebarToggles=0;
 let documentClick;
 const addDocumentListener = document.addEventListener;
 document.addEventListener = (type, listener) => {
  if (type === 'click') documentClick = listener;
  addDocumentListener(type, listener);
 };
 // Match compound attribute selectors used by the actual navigation code.
 const matches=Element.prototype.matches;
 Element.prototype.matches=function(selector){
  const parts=selector.match(/\[[^\]]+\]|\.[\w-]+|^[a-z]+/g);
  return parts?.length ? parts.every(part=>matches.call(this,part)) : matches.call(this,selector);
 };
 Element.prototype.contains = function(node) {
  for (let current = node; current; current = current.parentElement) {
   if (current === this) return true;
  }
  return false;
 };
 // Model DOM listener composition and data attributes for settings navigation.
 Element.prototype.addEventListener=function(type,fn){const previous=this['on'+type];this['on'+type]=event=>{previous?.(event);fn(event);};};
 const setAttribute=Element.prototype.setAttribute,removeAttribute=Element.prototype.removeAttribute;
 const dataKey=key=>key.slice(5).replace(/-([a-z])/g,(_,c)=>c.toUpperCase());
 Element.prototype.setAttribute=function(key,value){setAttribute.call(this,key,value);if(key.startsWith('data-'))this.dataset[dataKey(key)]=String(value);};
 Element.prototype.removeAttribute=function(key){removeAttribute.call(this,key);if(key.startsWith('data-'))delete this.dataset[dataKey(key)];};
 const disposers=[],selections=[],opens=[],registered=[],requests=[],nativeReports=[];
 const observers=[],mediaListeners=[],nativeSelections=[];
 const hooks = panelHooks(), catalogListeners = new Set(), timeouts = new Map();
 let timerId = 0, byId = {one: {id: 'one'}, two: {id: 'two'}};
 const list = {
  getSnapshot: () => ({byId}),
  subscribe(listener) { catalogListeners.add(listener); return () => catalogListeners.delete(listener); }
 };
 let settingsPanel,nav;
 if(settings){
  settingsPanel=new Element();settingsPanel.className='VOzbGW_panel';
  settingsPanel.setAttribute('role','dialog');settingsPanel.setAttribute('aria-modal','true');
  nav=new Element();nav.className='VOzbGW_navList';settingsPanel.append(nav);
  for(const label of ['General','Models','Built-in plugins','Agent presets']){
   const cell=new Element('button');cell.className='VOzbGW_navCell';cell.textContent=label;
   cell.onclick=()=>nativeSelections.push(label);nav.append(cell);
  }
  const close=new Element('button');close.className='VOzbGW_close';
  close.onclick=()=>{closed++;settingsPanel.hidden=true;};settingsPanel.append(close);document.body.append(settingsPanel);
 }
 const current={getSnapshot:()=>({key:opens.at(-1)??sessionId}),subscribe:()=>()=>{}};
 const frame=new Element();frame.className='pI_x6G_frame';
 if(!drawer)frame.setAttribute('data-sidebar-collapsed','');document.body.append(frame);
 const schedule=new Element('section');schedule.dataset.testid='task-manager-page';
 schedule.className=details?'t-XoWW_hasDetails':'';
 const heading=new Element();heading.className='t-XoWW_pageHeading';schedule.append(heading);
 schedule.onkeydown=e=>{if(e.key==='Escape'){closed++;schedule.classList.remove('t-XoWW_hasDetails');e.preventDefault();}};
 if(panelId==='schedules')document.body.append(schedule);
 if(dialog){const d=new Element();d.setAttribute('role','dialog');d.setAttribute('aria-modal','true');
  const close=new Element('button');close.className='VOzbGW_close';close.onclick=()=>{closed++;d.remove();};d.append(close);document.body.append(d);}
 const originalQuery=document.querySelectorAll;
 document.querySelectorAll=selector=>selector==='[role="dialog"][aria-modal="true"]'?
  originalQuery('[role="dialog"]').filter(e=>e.getAttribute('aria-modal')==='true'):originalQuery(selector);
 class KeyboardEvent {constructor(type,options){Object.assign(this,options);this.type=type;}preventDefault(){this.defaultPrevented=true;}}
 const window={matchMedia:()=>({matches:width<=700,addEventListener(_type,fn){mediaListeners.push(fn);},removeEventListener(){}}),
  setInterval:()=>1,clearInterval(){},
  setTimeout(fn,ms){timeouts.set(++timerId,{fn,ms});return timerId;},clearTimeout(id){timeouts.delete(id);},
  fetch:async(url,options)=>{
   requests.push({url,options});
   if(url==='/api/jarvis-main/session')return mainResponse(options);
   if(url==='/api/jarvis-main/ensure')return ensureResponse(options);
   return url.endsWith('/settings')?settingsResponse():new Response(null,{status:204});
  },
  JarvisB0Native:{viewingSession:id=>nativeReports.push(id)},
  __JARVIS_B0_LIFE__:lifeBack?{back:lifeBack}:undefined,
  __ModuleLoader__:{load:value=>module=value}};
 runInNewContext(client,{document,window,KeyboardEvent,queueMicrotask,AbortController,getComputedStyle:()=>({visibility:'visible'}),
  MutationObserver:class {constructor(fn){observers.push(fn);}observe(){}disconnect(){}}});
 const plugin=module.factory(name=>name==='react'?hooks:{jsx:(type,props)=>({type,props}),IconSparkleRegular});
 plugin.apply({effect:fn=>disposers.push(fn()),slots:{inject:(name,fn)=>notifications||mainSession?fn():()=>{},
  register:(options,component)=>{
   const registration={options,component};registered.push(registration);
   let cell;
   if(settings&&options.name==='settings.section'){
    cell=new Element('button');cell.className='VOzbGW_navCell';cell.textContent=options.label;
    cell.onclick=()=>nativeSelections.push(options.label);nav.append(cell);
   }
   return ()=>{cell?.remove();registration.removed=true;};
  }},
  ...(notifications?{uiSession:{adapter:{current}}}:{}),
  ...(notifications||mainSession?{sessions:{list},
    uiWorkspace:{openSession:id=>{assert.equal(closed,dialog?1:0);opens.push(id);active=null;}}}:{}),
  layout:{panelInfo:{getSnapshot:()=>({activePanelId:active}),subscribe:()=>()=>{}},selectPanel:value=>{selections.push(value);active=value;},
   toggleSidebar:()=>{sidebarToggles++;if(frame.hasAttribute('data-sidebar-collapsed'))frame.removeAttribute('data-sidebar-collapsed');else frame.setAttribute('data-sidebar-collapsed','');}}});
 return {window,document,Element,frame,sidebarToggles:()=>sidebarToggles,heading,closed:()=>closed,selections,opens,registered,requests,nativeReports,settingsPanel,nativeSelections,
  timeouts, catalogListeners,
  setCatalog(value){byId=value;for(const listener of [...catalogListeners])listener();},
  renderMain(){return hooks.render(registered.find(r=>r.options.key==='jarvis-main').component);},
  unmountMain(){hooks.dispose();},
  clickMainRow(){
   const sidebar = new Element(); sidebar.className = 'pI_x6G_sidebarCol';
   const row = new Element('button'); row.className = 'hHd-Xa_panelRow';
   sidebar.append(row); frame.append(sidebar);
   active = 'jarvis-main'; documentClick({target: row});
  },
  sync(){observers.forEach(fn=>fn());},resize(next){width=next;mediaListeners.forEach(fn=>fn());},
  back:window.__JARVIS_B0_MOBILE__.back,
  dispose(){hooks.dispose();disposers.forEach(fn=>fn?.());}};
}
test('global panel returns to chat, then yields to shell without opening drawer',()=>{
 for(const id of ['schedules','unknown-panel','plugins','jarvis-life']){
  const f=fixture(id);assert.equal(f.back(),true);assert.deepEqual(f.selections,[null]);
  assert.equal(f.back(),false);assert.equal(f.sidebarToggles(),0);f.dispose();
 }
});
test('generated frozen bridge opens known sessions and registers a settings section after successful GET',async()=>{
 const f=fixture('plugins',{dialog:true,drawer:true,notifications:true});
 const bridge=f.window.__JARVIS_B0_MOBILE__;
 assert.equal(Object.isFrozen(bridge),true);
 assert.equal(bridge.openSession('missing'),false);assert.equal(f.closed(),0);
 assert.equal(bridge.openSession('two'),true);assert.equal(f.closed(),1);
 assert.deepEqual(f.opens,['two']);assert.deepEqual(f.selections,[null]);assert.equal(f.back(),false);
 assert.equal(f.sidebarToggles(),1);assert.equal(f.frame.hasAttribute('data-sidebar-collapsed'),true);
 await flush();
 assert.ok(!f.registered.some(({options})=>options.name==='settings.general.item'));
 assert.ok(f.registered.some(({options,component})=>options.name==='settings.section'&&
   options.id==='jarvis-session-notify'&&typeof component==='function'));
 assert.equal(f.requests[0].url,'/api/session-notify/viewing');
 assert.deepEqual(JSON.parse(f.requests[0].options.body),{sessionId:null,visible:true});
 f.dispose();assert.equal(f.window.__JARVIS_B0_MOBILE__,undefined);assert.equal(f.nativeReports.at(-1),null);
});

test('notification entry waits for settings success and stays hidden for 404, malformed or failed reads',async()=>{
 for(const settingsResponse of [()=>new Response(null,{status:404}),()=>new Response(null,{status:503}),
  ()=>Response.json({ok:true,value:{enabled:'yes'}}),()=>{throw Error('offline');}]){
  const f=fixture(null,{settings:true,notifications:true,settingsResponse});await flush();f.sync();
  assert.equal(f.settingsPanel.querySelector('[data-jarvis-settings-section="notify"]').hidden,true);
  assert.equal(f.registered.some(r=>r.options.name==='settings.section'),false);f.dispose();
 }
 let finish;
 const f=fixture(null,{settings:true,notifications:true,settingsResponse:()=>new Promise(resolve=>{finish=resolve;})});
 const entry=f.settingsPanel.querySelector('[data-jarvis-settings-section="notify"]');
 assert.equal(entry.hidden,true);finish(Response.json({ok:true,value:defaults}));await flush();f.sync();
 assert.equal(entry.hidden,false);assert.equal(entry.text,'通知会话通知与锁屏显示›');
 const root=f.settingsPanel.querySelector('.jarvis-b0-settings-root');
 const index=root.children.indexOf(entry);assert.equal(root.children[index-1].text,'账号与安全当前账号与修改密码›');
 f.dispose();
});

test('notification detail uses native section, button/back restore scroll and focus, close/reopen starts at root',async()=>{
 const f=fixture(null,{settings:true,notifications:true});await flush();f.sync();
 const panel=f.settingsPanel,root=panel.querySelector('.jarvis-b0-settings-root');
 const entry=root.querySelector('[data-jarvis-settings-section="notify"]');
 const back=panel.querySelector('.jarvis-b0-settings-detail-back');
 for(const returnHome of [()=>back.click(),()=>assert.equal(f.back(),true)]){
  root.scrollTop=137;entry.click();assert.equal(panel.dataset.jarvisSettingsView,'detail');
  assert.equal(f.nativeSelections.at(-1),'通知');assert.equal(f.document.activeElement,back);
  assert.equal(panel.querySelector('.jarvis-b0-settings-detail-header').children[1].textContent,'通知');
  root.scrollTop=0;returnHome();assert.equal(panel.dataset.jarvisSettingsView,'root');
  assert.equal(root.scrollTop,137);assert.equal(f.document.activeElement,entry);
 }
 entry.click();panel.querySelector('.VOzbGW_close').click();panel.hidden=false;f.sync();
 assert.equal(panel.dataset.jarvisSettingsView,'root');assert.equal(root.scrollTop,0);
 const general=root.querySelector('[data-jarvis-settings-section="dsh"]');general.click();
 assert.equal(f.nativeSelections.at(-1),'General');assert.equal(f.back(),true);
 assert.equal(f.back(),true);assert.equal(f.closed(),2);f.dispose();
});

test('wide settings exposes native notification navigation and shrinking creates the mobile root',async()=>{
 const f=fixture(null,{settings:true,notifications:true,width:1024});await flush();f.sync();
 assert.equal(f.settingsPanel.querySelector('.jarvis-b0-settings-root'),null);
 const cells=f.settingsPanel.querySelectorAll('.VOzbGW_navCell');assert.equal(cells.at(-1).textContent,'通知');
 cells.at(-1).click();assert.equal(f.nativeSelections.at(-1),'通知');
 f.resize(390);assert.equal(f.settingsPanel.querySelector('[data-jarvis-settings-section="notify"]').hidden,false);
 f.settingsPanel.querySelector('[data-jarvis-settings-section="notify"]').click();
 f.resize(1024);assert.equal(f.back(),true);assert.equal(f.closed(),1);
 f.dispose();assert.equal(f.settingsPanel.querySelector('.jarvis-b0-settings-root'),null);
});

test('disposing before settings response prevents late section registration',async()=>{
 let finish;
 const f=fixture(null,{settings:true,notifications:true,settingsResponse:()=>new Promise(resolve=>{finish=resolve;})});
 f.dispose();finish(Response.json({ok:true,value:defaults}));await flush();
 assert.equal(f.registered.some(r=>r.options.name==='settings.section'),false);
});
test('schedule adds the plugin-style header button; native detail closes before panel',()=>{
 const f=fixture('schedules',{details:true});const button=f.heading.querySelector('.jarvis-b0-plugin-back');
 assert.ok(button);assert.equal(button.getAttribute('aria-label'),'返回会话');
 button.click();assert.equal(f.closed(),1);assert.deepEqual(f.selections,[]);
 button.click();assert.deepEqual(f.selections,[null]);f.dispose();assert.equal(f.heading.children.length,0);
});
test('dialog precedes drawer; closing drawer preserves covered schedule detail until next Back',()=>{
 const f=fixture('schedules',{dialog:true,drawer:true,details:true});assert.equal(f.back(),true);
 assert.equal(f.closed(),1);assert.deepEqual(f.selections,[]);
 assert.equal(f.sidebarToggles(),0);
 assert.equal(f.back(),true);assert.deepEqual(f.selections,[]);assert.equal(f.closed(),1);
 assert.equal(f.sidebarToggles(),1);assert.equal(f.frame.hasAttribute('data-sidebar-collapsed'),true);
 assert.ok(f.document.querySelector('[data-testid="task-manager-page"]').classList.contains('t-XoWW_hasDetails'));
 assert.equal(f.back(),true);assert.equal(f.closed(),2);assert.deepEqual(f.selections,[]);
 assert.equal(f.back(),true);assert.deepEqual(f.selections,[null]);assert.equal(f.back(),false);f.dispose();
});
test('drawer closes before any covered main panel or life internal Back',()=>{
 for(const id of ['schedules','plugins','jarvis-life','unknown-panel']){
  let backs=0;const f=fixture(id,{drawer:true,lifeBack:()=>{backs++;return true;}});
  assert.equal(f.back(),true);assert.equal(f.sidebarToggles(),1);
  assert.equal(f.frame.hasAttribute('data-sidebar-collapsed'),true);
  assert.deepEqual(f.selections,[]);assert.equal(backs,0);
  assert.equal(f.back(),true);
  assert.deepEqual(f.selections,id==='jarvis-life'?[]:[null]);assert.equal(backs,id==='jarvis-life'?1:0);
  f.dispose();
 }
});
test('mobile CSS leaves official preset seat visible without overriding its native disabled state',async()=>{
 const css=await readFile(new URL('./mobile.css',import.meta.url),'utf8');
 // This presentation regression check deliberately inspects CSS, not sliced JS.
 const rules=[...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)];
 assert.ok(!rules.some(([,selector,body])=>selector.includes('.cubgiG_seat')&&
  /(?:display\s*:\s*none|visibility\s*:\s*hidden|pointer-events\s*:\s*none)/.test(body)));
 assert.ok(!css.includes('.cubgiG_seat[disabled]'));
});

function popup(f, role = 'menu', parent = f.document.body) {
 const node = new f.Element();
 if (role === 'popover') node.setAttribute('popover', 'auto');
 else node.setAttribute('role', role);
 node.onkeydown = event => {
  if (event.key === 'Escape') { event.preventDefault(); node.remove(); }
 };
 parent.append(node);
 return node;
}

test('menus, listboxes and popovers dismiss first on every page, one layer per Back', () => {
 for (const panel of [null, 'plugins', 'schedules', 'jarvis-life', 'unknown-panel']) {
  for (const role of ['menu', 'listbox', 'popover', 'dialog']) {
   const f = fixture(panel, {dialog: true, drawer: true});
   const lower = popup(f, 'menu');
   const upper = popup(f, role);
   assert.equal(f.back(), true);
   assert.ok(!f.document.body.children.includes(upper));
   assert.ok(f.document.body.children.includes(lower));
   assert.equal(f.closed(), 0);
   assert.deepEqual(f.selections, []);
   assert.equal(f.sidebarToggles(), 0);
   assert.equal(f.back(), true);
   assert.ok(!f.document.body.children.includes(lower));
   f.dispose();
  }
 }
});

test('Escape fallback toggles only the associated trigger and waits for React removal', async () => {
 for (const mode of ['fallback', 'handled', 'async-removal']) {
  const f = fixture();
  const unrelated = new f.Element('button');
  unrelated.setAttribute('aria-expanded', 'true');
  unrelated.onclick = () => assert.fail('must not toggle another control');
  const trigger = new f.Element('button');
  trigger.setAttribute('aria-controls', 'picker');
  trigger.setAttribute('aria-expanded', 'true');
  f.document.body.append(unrelated, trigger);
  const layer = popup(f, 'listbox');layer.setAttribute('id', 'picker');
  let clicks = 0;
  trigger.onclick = () => { clicks++; layer.remove(); };
  layer.onkeydown = event => {
   if (mode === 'handled') event.preventDefault();
   if (mode !== 'fallback') queueMicrotask(() => layer.remove());
  };
  assert.equal(f.back(), true);
  assert.equal(clicks, 0);
  await flush();
  assert.equal(clicks, mode === 'fallback' ? 1 : 0);
  assert.ok(!f.document.body.children.includes(layer));
  assert.equal(f.sidebarToggles(), 0);
  f.dispose();
 }
});

test('closed and aria-hidden popups do not intercept Back', () => {
 const f = fixture();
 popup(f).hidden = true;
 const hidden = new f.Element();hidden.setAttribute('aria-hidden', 'true');
 f.document.body.append(hidden);popup(f, 'listbox', hidden);
 assert.equal(f.back(), false);assert.equal(f.sidebarToggles(), 0);
 assert.equal(f.back(), false);f.dispose();
});

test('chat/new-chat Back closes an open drawer once; repeated Back never opens it', () => {
 for (const sessionId of ['one', null]) {
  for (const drawer of [false, true]) {
   const f = fixture(null, {drawer, sessionId, notifications: true});
   if (drawer) {
    // A menu above the drawer closes first, leaving the drawer open.
    popup(f);assert.equal(f.back(), true);
    assert.equal(f.sidebarToggles(), 0);
    assert.equal(f.frame.hasAttribute('data-sidebar-collapsed'), false);
    assert.equal(f.back(), true);
   }
   for (let i = 0; i < 4; i++) {
    assert.equal(f.back(), false);
    assert.equal(f.frame.hasAttribute('data-sidebar-collapsed'), true);
   }
   assert.equal(f.sidebarToggles(), drawer ? 1 : 0);
   assert.deepEqual(f.selections, []);
   f.dispose();
  }
 }
 const wide = fixture(null, {width: 1024});
 assert.equal(wide.back(), false);assert.equal(wide.sidebarToggles(), 0);wide.dispose();
});

test('header menu button still opens drawer, and Back closes it without reopening', () => {
 const f = fixture(null, {notifications: true});
 const button = f.registered.find(({options}) => options.id === 'jarvis-b0-mobile-open').component();
 assert.equal(button.props.children, '☰');
 button.props.onClick();assert.equal(f.frame.hasAttribute('data-sidebar-collapsed'), false);
 button.props.onClick();assert.equal(f.sidebarToggles(), 1);
 assert.equal(f.back(), true);assert.equal(f.frame.hasAttribute('data-sidebar-collapsed'), true);
 assert.equal(f.back(), false);assert.equal(f.sidebarToggles(), 2);f.dispose();
});

test('settings detail/root, main panel, retained rightbar, then shell keep their order', () => {
 const f = fixture('plugins', {settings: true});
 const right = new f.Element();
 right.setAttribute('data-sidebar-right-panel', '');right.setAttribute('data-sidebar-right-open', '');
 const close = new f.Element('button');close.setAttribute('data-sidebar-right-toggle', '');
 let rightClosed = 0;close.onclick = () => {rightClosed++;right.remove();};
 right.append(close);f.document.body.append(right);
 f.settingsPanel.querySelector('[data-jarvis-settings-section="dsh"]').click();
 const button = f.settingsPanel.querySelector('.jarvis-b0-settings-detail-back');
 popup(f);button.click();
 assert.equal(f.settingsPanel.dataset.jarvisSettingsView, 'detail');
 button.click();assert.equal(f.settingsPanel.dataset.jarvisSettingsView, 'root');
 assert.equal(f.back(), true);assert.equal(f.closed(), 1);
 assert.equal(f.back(), true);assert.deepEqual(f.selections, [null]);assert.equal(rightClosed, 0);
 assert.equal(f.back(), true);assert.equal(rightClosed, 1);assert.equal(f.sidebarToggles(), 0);
 assert.equal(f.back(), false);assert.equal(f.sidebarToggles(), 0);f.dispose();
});

test('CSS selection rules protect controls globally and restore editable/message text', async () => {
 const rules = parseCSS(await readFile(new URL('./mobile.css', import.meta.url), 'utf8'));
 const controls = ['button', '[role="button"]', '[role="tab"]', '[role="menuitem"]', '[role="option"]',
  '[data-row-key^="session:"]', '[data-row-key^="workspace:"]', '.YDXeBa_searchResultRow', '.jarvis-b0-settings-row'];
 const text = ['input', 'textarea', '[contenteditable]', '.Sixlwa_bubble', '._markdown_1ypvv_5', 'pre', 'code'];
 const properties = ['-webkit-user-select', 'user-select', '-webkit-touch-callout'];
 const selectionRules = rules.filter(rule => properties.some(property => property in rule.declarations));
 for (const rule of selectionRules) {
  assert.deepEqual(rule.media, [], 'selection must also work outside narrow/touch media');
  // Reject broad parent/descendant rules: inherited text must stay selectable,
  // but a copy button nested inside Markdown must still stay a control.
  for (const selector of rule.selectors) assert.ok([...controls, ...text].includes(selector), selector);
 }
 const effective = selector => Object.assign({}, ...selectionRules
  .filter(rule => rule.selectors.includes(selector)).map(rule => rule.declarations));
 for (const selector of controls) {
  const style = effective(selector);
  for (const property of properties) assert.equal(style[property], 'none', `${selector}: ${property}`);
 }
 for (const selector of text) {
  const style = effective(selector);
  assert.equal(style['user-select'], 'text', selector);
  assert.equal(style['-webkit-user-select'], 'text', selector);
  assert.equal(style['-webkit-touch-callout'], 'default', selector);
 }
 // A contenteditable role=button and an input inside a session row must win
 // against their equal/lower-specificity control rule in source order.
 const controlIndex = selectionRules.findLastIndex(rule => rule.selectors.some(s => controls.includes(s)));
 const textIndex = selectionRules.findIndex(rule => rule.selectors.includes('[contenteditable]'));
 assert.ok(textIndex > controlIndex);
});

test('touch CSS exposes row/tool/JSON actions and makes menu targets readable without shortcuts', async () => {
 const rules = parseCSS(await readFile(new URL('./mobile.css', import.meta.url), 'utf8'));
 const touch = rules.filter(rule => rule.media.includes('(hover: none)'));
 const expect = (selector, property, value) => {
  const matching = touch.filter(rule => rule.selectors.includes(selector));
  assert.ok(matching.length, selector);
  assert.equal(Object.assign({}, ...matching.map(rule => rule.declarations))[property], value, selector);
 };
 for (const kind of ['session', 'workspace']) {
  const row = `[data-row-key^="${kind}:"] .YDXeBa_rowActions`;
  expect(row, 'display', 'inline-flex !important');
  expect(`${row} button[aria-label$="的操作"]`, 'display', 'inline-flex !important');
 }
 expect('[data-row-key^="workspace:"] .YDXeBa_rowActions > div > button', 'display', 'inline-flex !important');
 expect('[data-row-key^="session:"] .YDXeBa_rowActions > div > button', 'display', 'none !important');
 for (const selector of ['.o3BgMG_inspectButton', '.CY-8Ka_inspectButton', '.cvtE3a_inspect',
  '.gNWCoW_inspectButton', '.iWrAna_inspectButton', '._copySlot_1alm6_92']) {
  expect(selector, 'opacity', '1 !important');
  expect(selector, 'pointer-events', 'auto !important');
 }
 expect('[role="menu"] ._shortcut_4ub78_198', 'display', 'none !important');
 expect('[role="menu"] kbd', 'display', 'none !important');
 for (const role of ['menuitem', 'menuitemcheckbox', 'menuitemradio']) {
  expect(`[role="menu"] [role="${role}"]`, 'min-height', '44px !important');
 }
 // All action overrides are touch-only; desktop hover affordances retain DSH behavior.
 for (const rule of rules.filter(rule => rule.selectors.some(selector =>
  selector.includes('YDXeBa_rowActions') || selector.includes('inspectButton') || selector.includes('_copySlot')))) {
  assert.deepEqual(rule.media, ['(hover: none)']);
 }
});

test('a resident popup that ignores Escape cannot trap Back; a tap allows closing it again', () => {
 const f = fixture();
 const resident = popup(f, 'listbox');
 resident.onkeydown = () => {};
 assert.equal(f.back(), true);
 assert.ok(f.document.body.children.includes(resident));
 assert.equal(f.sidebarToggles(), 0);
 // Second Back skips the surface that stayed and continues to the chat rule.
 assert.equal(f.back(), false);
 assert.equal(f.sidebarToggles(), 0);
 assert.equal(f.back(), false);
 // A tap may reopen surfaces, so the next Back tries the surface again.
 f.document.emit('pointerdown');
 let escapes = 0;
 resident.onkeydown = event => { if (event.key === 'Escape') { escapes++; event.preventDefault(); resident.remove(); } };
 f.frame.setAttribute('data-sidebar-collapsed', '');
 assert.equal(f.back(), true);
 assert.equal(escapes, 1);
 f.dispose();
});

const mainResult = id => Response.json({ok: true, value: {sessionId: id}});
const mainEntry = f => f.registered.find(r => r.options.id === 'jarvis-main');
const ensureCalls = f => f.requests.filter(r => r.url === '/api/jarvis-main/ensure');
const assertMainFailure = f => {
  const children = f.renderMain().props.children;
  assert.equal(children[0].props.children, '暂时无法打开主会话');
  assert.equal(children[1].type, 'button');
  assert.equal(children[1].props.children, '重试');
  return children[1].props.onClick;
};

for (const [name, mainResponse] of [
  ['404', () => new Response(null, {status: 404})],
  ['503', () => new Response(null, {status: 503})],
  ['non-200 success', () => Response.json({ok: true, value: {sessionId: null}}, {status: 201})],
  ['missing id', () => Response.json({ok: true, value: {}})],
  ['wrong id type', () => mainResult(123)],
  ['ok false', () => Response.json({ok: false, value: {sessionId: null}})],
  ['malformed JSON', () => new Response('{', {status: 200})],
  ['fetch error', () => { throw Error('offline'); }]
]) {
  test(`main entry is absent after ${name}`, async () => {
    const f = fixture(null, {mainSession: true, mainResponse});
    await flush();
    assert.equal(mainEntry(f), undefined);
    assert.equal(f.registered.some(r => r.options.key === 'jarvis-main'), false);
    assert.equal(ensureCalls(f).length, 0);
    f.dispose();
  });
}

for (const width of [390, 1280]) {
  test(`main entry waits for valid GET and registers matching slots at ${width}px`, async () => {
    for (const sessionId of [null, 'two']) {
      let finish;
      const f = fixture(null, {width, mainSession: true,
        mainResponse: () => new Promise(resolve => { finish = resolve; })});
      assert.equal(mainEntry(f), undefined);
      const probe = f.requests.find(r => r.url === '/api/jarvis-main/session');
      assert.equal(probe.options.method, 'GET');
      assert.equal(probe.options.credentials, 'same-origin');
      assert.equal(probe.options.cache, 'no-store');
      assert.equal(probe.options.body, undefined);
      finish(mainResult(sessionId));
      await flush();
      const entry = mainEntry(f);
      assert.equal(entry.options.order, -10);
      assert.equal(entry.options.label, 'Jarvis');
      assert.equal(entry.options.name, 'sidebar.panellist');
      // Official icon at the sidebar-provided size, like the other panel entries.
      for (const size of [16, 18]) {
        const icon = entry.component({size, active: false});
        assert.equal(icon.type, IconSparkleRegular); assert.equal(icon.props.size, size);
      }
      if (sessionId === null) assert.equal(mainStyle(f), undefined);
      else assert.equal(mainStyle(f).textContent,
        '[data-row-key="session:two"], :has(> [data-row-key="session:two"]) { display: none !important; }');
      assert.ok(f.registered.some(r => r.options.name === 'main' && r.options.key === entry.options.id));
      assert.equal(ensureCalls(f).length, 0);
      f.dispose();
      assert.equal(mainStyle(f), undefined);
      assert.equal(entry.removed, true);
      assert.equal(probe.options.signal.aborted, true);
    }
  });
}

test('main probe disposal prevents registration after a late response', async () => {
  let finish;
  const f = fixture(null, {mainSession: true,
    mainResponse: () => new Promise(resolve => { finish = resolve; })});
  f.dispose();
  finish(mainResult(null));
  await flush();
  assert.equal(mainEntry(f), undefined);
  assert.equal(f.registered.some(r => r.options.key === 'jarvis-main'), false);
});

test('mounted main panel POSTs ensure, stays blank and opens exactly once after catalog publication', async () => {
  const f = fixture('jarvis-main', {mainSession: true, mainResponse: () => mainResult(null)});
  f.setCatalog({});
  await flush();
  assert.equal(f.renderMain().props.children, null);
  await flush();
  const request = ensureCalls(f)[0];
  assert.equal(request.options.method, 'POST');
  assert.equal(request.options.body, '{}');
  assert.equal(request.options.credentials, 'same-origin');
  assert.equal(request.options.headers['content-type'], 'application/json');
  assert.equal(f.renderMain().props.children, null);
  assert.deepEqual(f.opens, []);
  // The session created by ensure is hidden from the tree before it is opened.
  assert.match(mainStyle(f).textContent, /^\[data-row-key="session:two"\]/);
  assert.equal(f.catalogListeners.size, 1);
  assert.equal([...f.timeouts.values()][0].ms, 10000);
  f.setCatalog({two: {id: 'wrong'}});
  await flush();
  assert.deepEqual(f.opens, []);
  f.setCatalog({two: {id: 'two'}});
  await flush();
  f.setCatalog({two: {id: 'two'}});
  await flush();
  assert.deepEqual(f.opens, ['two']);
  assert.deepEqual(f.selections, []); // No separate selectPanel(null) call.
  assert.equal(f.catalogListeners.size, 0);
  assert.equal(f.timeouts.size, 0);
  assert.equal(f.back(), false);
  f.dispose();
});

test('catalog-present main session opens immediately and retains drawer, Back and Android bridge behavior', async () => {
  const f = fixture(null, {mainSession: true, drawer: true, mainResponse: () => mainResult('two')});
  await flush();
  f.clickMainRow();
  f.renderMain();
  await flush();
  assert.deepEqual(f.opens, ['two']);
  assert.equal(f.catalogListeners.size, 0);
  assert.equal(f.timeouts.size, 0);
  assert.equal(f.sidebarToggles(), 1);
  assert.equal(f.frame.hasAttribute('data-sidebar-collapsed'), true);
  assert.deepEqual(f.selections, []);
  assert.equal(f.back(), false);
  assert.equal(f.window.__JARVIS_B0_MOBILE__.openSession('two'), true);
  assert.deepEqual(f.opens, ['two', 'two']);
  assert.equal(ensureCalls(f).length, 1);
  f.dispose();
});

test('catalog timeout shows manual retry; retry repeats ensure and succeeds', async () => {
  const f = fixture('jarvis-main', {mainSession: true, mainResponse: () => mainResult(null)});
  f.setCatalog({});
  await flush();
  f.renderMain();
  await flush();
  for (const timer of [...f.timeouts.values()]) timer.fn();
  await flush();
  assert.equal(f.catalogListeners.size, 0);
  assert.equal(f.timeouts.size, 0);
  const retry = assertMainFailure(f);
  assert.equal(ensureCalls(f).length, 1);
  f.setCatalog({two: {id: 'two'}});
  await flush();
  assert.deepEqual(f.opens, []);
  retry(); retry(); // Rapid repeat clicks still make only one attempt.
  assert.equal(f.renderMain().props.children, null);
  await flush();
  assert.equal(ensureCalls(f).length, 2);
  assert.deepEqual(f.opens, ['two']);
  f.dispose();
});

for (const [name, failure] of [
  ['503', () => Response.json({ok: false, error: {code: 'MAIN_SESSION_UNAVAILABLE'}}, {status: 503})],
  ['ok false', () => Response.json({ok: false})],
  ['invalid id', () => mainResult(null)],
  ['malformed JSON', () => new Response('{', {status: 200})],
  ['fetch error', () => { throw Error('offline'); }]
]) {
  test(`ensure ${name} shows failure and manual retry succeeds`, async () => {
    let attempts = 0;
    const f = fixture('jarvis-main', {mainSession: true, mainResponse: () => mainResult(null),
      ensureResponse: () => ++attempts === 1 ? failure() : mainResult('two')});
    await flush();
    f.renderMain();
    await flush();
    const retry = assertMainFailure(f);
    await flush();
    assert.equal(attempts, 1);
    assert.deepEqual(f.opens, []);
    retry();
    assert.equal(f.renderMain().props.children, null);
    await flush();
    assert.equal(attempts, 2);
    assert.deepEqual(f.opens, ['two']);
    f.dispose();
  });
}

test('unmount aborts pending ensure and ignores late success', async () => {
  let finish;
  const f = fixture('jarvis-main', {mainSession: true, mainResponse: () => mainResult(null),
    ensureResponse: () => new Promise(resolve => { finish = resolve; })});
  await flush();
  f.renderMain();
  const request = ensureCalls(f)[0];
  f.unmountMain();
  assert.equal(request.options.signal.aborted, true);
  finish(mainResult('two'));
  await flush();
  assert.deepEqual(f.opens, []);
  assert.equal(f.catalogListeners.size, 0);
  assert.equal(f.timeouts.size, 0);
  f.dispose();
});

test('unmount cancels catalog subscription and timeout; late publication does not navigate', async () => {
  const f = fixture('jarvis-main', {mainSession: true, mainResponse: () => mainResult(null)});
  f.setCatalog({});
  await flush();
  f.renderMain();
  await flush();
  assert.equal(f.catalogListeners.size, 1);
  f.unmountMain();
  assert.equal(f.catalogListeners.size, 0);
  assert.equal(f.timeouts.size, 0);
  f.setCatalog({two: {id: 'two'}});
  await flush();
  assert.deepEqual(f.opens, []);
  f.dispose();
});
