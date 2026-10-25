import test from 'node:test';
import assert from 'node:assert/strict';
import {createSessionNotify, openNotifiedSession, createNotifySettingsView} from './session-notify.mjs';
import {createTestDOM} from './test-dom.mjs';
import {loadOfficialSwitch} from './official-switch-test-helper.mjs';

const Switch = await loadOfficialSwitch();

const flush = async () => { for (let i = 0; i < 15; i++) await Promise.resolve(); };
const defaults = {enabled: true, notifyReplies: true, lockScreenContent: true};
function source(value) {
  const listeners = new Set();
  return {getSnapshot: () => value, subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    set(next) { value = next; for (const fn of listeners) fn(); }, listeners};
}
function fixture({fetch, native, obscured} = {}) {
  const {document} = createTestDOM();
  const current = source({key: 'one'}), panelInfo = source({activePanelId: null});
  const intervals = new Map(), timeouts = new Map(), calls = [], bridges = [];
  let id = 0;
  const timers = {
    setInterval(fn, ms) { intervals.set(++id, {fn, ms}); return id; },
    clearInterval(key) { intervals.delete(key); },
    setTimeout(fn, ms) { timeouts.set(++id, {fn, ms}); return id; },
    clearTimeout(key) { timeouts.delete(key); }
  };
  const notify = createSessionNotify({current, panelInfo, document, timers, obscured,
    native: native ?? (() => ({viewingSession: value => bridges.push(value),
      notifySettingsChanged: () => bridges.push('settings')})),
    fetch: async (url, options) => {
      calls.push({url, ...options, body: options.body && JSON.parse(options.body)});
      return fetch ? fetch(url, options) : new Response(null, {status: 204});
    }});
  return {notify, current, panelInfo, document, intervals, timeouts, calls, bridges,
    tick() { for (const timer of [...intervals.values()]) timer.fn(); }};
}

test('session/visibility/panel transitions, 45-second refresh, and cleanup use official sources', async () => {
  const f = fixture(); await flush();
  assert.deepEqual(f.calls[0].body, {sessionId: 'one', visible: true});
  assert.equal([...f.intervals.values()][0].ms, 45000);
  f.current.set({key: 'two'}); await flush();
  assert.equal(f.calls.at(-1).body.sessionId, 'two');
  f.tick(); await flush(); assert.equal(f.calls.length, 3);
  f.document.visibilityState = 'hidden'; f.document.emit('visibilitychange'); await flush();
  assert.deepEqual(f.calls.at(-1).body, {sessionId: null, visible: false});
  assert.equal(f.bridges.at(-1), null); assert.equal(f.intervals.size, 0);
  const hiddenCount = f.calls.length; f.tick(); await flush(); assert.equal(f.calls.length, hiddenCount);
  f.current.set({key: 'three'}); await flush();
  assert.deepEqual(f.calls.at(-1).body, {sessionId: null, visible: false});
  assert.equal(f.intervals.size, 0);
  f.document.visibilityState = 'visible'; f.document.emit('visibilitychange'); await flush();
  assert.equal(f.calls.at(-1).body.sessionId, 'three');
  f.panelInfo.set({activePanelId: 'jarvis-life'}); await flush();
  assert.deepEqual(f.calls.at(-1).body, {sessionId: null, visible: true});
  assert.equal(f.intervals.size, 0);
  f.panelInfo.set({activePanelId: null}); await flush();
  f.current.set({key: undefined}); await flush(); assert.equal(f.intervals.size, 0);
  f.notify.dispose(); f.notify.dispose();
  assert.equal(f.current.listeners.size, 0); assert.equal(f.panelInfo.listeners.size, 0);
  assert.equal(f.timeouts.size, 0);
  const count = f.calls.length; f.document.emit('visibilitychange'); await flush(); assert.equal(f.calls.length, count);
});

test('a settings dialog clears viewing and restoring it reports again without DOM session parsing', async () => {
  let hidden = false;
  const f = fixture({obscured: () => hidden}); await flush();
  hidden = true; f.notify.sync(); await flush();
  assert.equal(f.bridges.at(-1), null); assert.equal(f.intervals.size, 0);
  f.notify.sync(); await flush(); assert.equal(f.calls.length, 2);
  hidden = false; f.notify.sync(); await flush(); assert.equal(f.bridges.at(-1), 'one');
  f.notify.dispose();
});

test('404 is quiet, stops HTTP and heartbeat, but native session changes continue', async () => {
  const f = fixture({fetch: () => new Response(null, {status: 404})}); await flush();
  assert.equal(f.intervals.size, 0); assert.equal(await f.notify.settings(), null);
  f.current.set({key: 'two'}); f.tick(); await flush();
  assert.equal(f.calls.length, 1); assert.equal(f.bridges.at(-1), 'two'); f.notify.dispose();
});

test('network/401 failures have no immediate retries and bridge absence/throw is harmless', async () => {
  for (const fetch of [() => { throw Error('offline'); }, () => new Response(null, {status: 401})]) {
    const f = fixture({fetch, native: () => ({viewingSession() { throw Error('bridge unavailable'); }})});
    await flush(); assert.equal(f.calls.length, 1);
    f.tick(); await flush(); assert.equal(f.calls.length, 2); f.notify.dispose();
  }
  const f = fixture({native: () => undefined}); await flush(); f.notify.dispose();
});

test('viewing writes are serialized and coalesce pending transitions to the newest state', async () => {
  let finish;
  const f = fixture({fetch: () => new Promise(resolve => { finish = resolve; })});
  f.current.set({key: 'two'});
  f.document.visibilityState = 'hidden'; f.document.emit('visibilitychange');
  assert.equal(f.calls.length, 1); assert.equal(f.bridges.at(-1), null);
  finish(new Response(null, {status: 204})); await flush();
  assert.equal(f.calls.length, 2);
  assert.deepEqual(f.calls[1].body, {sessionId: null, visible: false});
  finish(new Response(null, {status: 204})); await flush(); f.notify.dispose();
});

test('stalled requests time out and disposing aborts in-flight work', async () => {
  const f = fixture({fetch: (_url, {signal}) => new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(Error('aborted')), {once: true});
  })});
  assert.equal([...f.timeouts.values()][0].ms, 10000);
  [...f.timeouts.values()][0].fn(); await flush(); assert.equal(f.timeouts.size, 0);
  f.tick(); assert.equal(f.calls.length, 2);
  f.notify.dispose(); await flush(); assert.equal(f.calls[1].signal.aborted, true);
  assert.equal(f.timeouts.size, 0); assert.equal(f.intervals.size, 0);
});

test('openSession validates catalog, closes first, calls official navigation, and returns synchronous booleans', () => {
  const actions = [];
  const dependencies = {sessions: {list: source({byId: {one: {id: 'one'}}})},
    close: () => actions.push('close'), uiWorkspace: {openSession: id => actions.push(id)}};
  for (const id of [undefined, null, 123, {}, '', ' ', ' one', 'missing', '__proto__']) {
    assert.equal(openNotifiedSession(id, dependencies), false);
  }
  assert.deepEqual(actions, []);
  assert.equal(openNotifiedSession('one', dependencies), true); assert.deepEqual(actions, ['close', 'one']);
  dependencies.uiWorkspace.openSession = () => { throw Error('unavailable'); };
  assert.equal(openNotifiedSession('one', dependencies), false);
});

test('settings GET/partial PUT validate responses and notify Android only after successful persistence', async () => {
  let value = {...defaults}, failure = false;
  const f = fixture({fetch: (url, {method, body}) => {
    if (url.endsWith('/viewing')) return new Response(null, {status: 204});
    if (failure) return new Response(null, {status: 503});
    if (method === 'PUT') value = {...value, ...JSON.parse(body)};
    return Response.json({ok: true, value});
  }}); await flush();
  assert.deepEqual(await f.notify.settings(), defaults);
  assert.deepEqual(await f.notify.settings('PUT', {enabled: false}), {...defaults, enabled: false});
  assert.deepEqual(f.calls.at(-1).body, {enabled: false});
  assert.equal(f.calls.at(-1).credentials, 'same-origin');
  assert.equal(f.calls.at(-1).cache, 'no-store');
  assert.equal(f.bridges.filter(v => v === 'settings').length, 1);
  failure = true; assert.equal(await f.notify.settings('PUT', {enabled: true}), null);
  assert.equal(f.bridges.filter(v => v === 'settings').length, 1); f.notify.dispose();
});

// Tiny injected hook runner exercises the actual component, without a server or React renderer.
function viewFixture(notify, onUnavailable) {
  const states = [], effects = []; let cursor = 0, mounted = false;
  const View = createNotifySettingsView({
    Switch,
    jsx: (type, props) => ({type, props}),
    useState(initial) { const i = cursor++; if (!(i in states)) states[i] = typeof initial === 'function' ? initial() : initial;
      return [states[i], value => { states[i] = value; }]; },
    useEffect(fn) { if (!mounted) effects.push(fn()); }
  }, notify, onUnavailable);
  return {render() { cursor = 0; const tree = View(); mounted = true; return tree; },
    dispose() { effects.forEach(fn => fn?.()); }};
}
const switches = tree => tree.props.children.filter(n => n.props.className === 'jarvis-b0-notify-row')
  .map(n => { const control = n.props.children[1]; assert.equal(control.type, Switch); return Switch(control.props).props; });

test('official settings contribution is hidden for absent plugin and malformed/error responses', async () => {
  for (const response of [() => new Response(null, {status: 404}), () => Response.json({ok: true, value: {enabled: 'true'}}),
    () => { throw Error('offline'); }]) {
    const f = fixture({fetch: url => url.endsWith('/viewing') ? new Response(null, {status: 204}) : response()});
    const v = viewFixture(f.notify); assert.equal(v.render(), null); await flush();
    assert.equal(v.render(), null); v.dispose(); f.notify.dispose();
  }
});

test('official switches expose checked state, save once, disable pending writes, and preserve state on failure', async t => {
  if (!Switch) return t.skip('Requires installed official DSH alpha.2 primitives and local esbuild');
  let finish; const writes = [];
  const v = viewFixture({settings(method, patch) {
    if (!method) return Promise.resolve(defaults);
    writes.push(patch); return new Promise(resolve => { finish = resolve; });
  }});
  v.render(); await flush(); let controls = switches(v.render());
  assert.deepEqual(controls.map(c => c['aria-label']), ['开启会话通知', '回复完成时通知', '锁屏显示内容']);
  assert.ok(controls.every(c => c.role === 'switch' && c.type === 'button' && c['aria-checked'] === true));
  // Official button activation handles Enter/Space natively; no custom key trap.
  controls[1].onClick(); controls[2].onClick();
  assert.equal(writes.length, 1); assert.deepEqual(writes[0], {notifyReplies: false});
  assert.ok(switches(v.render()).every(c => c.disabled));
  finish({...defaults, notifyReplies: false}); await flush();
  controls = switches(v.render()); assert.equal(controls[1]['aria-checked'], false); assert.equal(controls[0].disabled, false);
  controls[0].onClick(); finish(null); await flush();
  assert.equal(switches(v.render())[0]['aria-checked'], true);
  assert.equal(v.render().props.children.at(-1).props.children, '保存失败，请稍后再试');
  v.dispose();
});

test('settings disappearing on read or PUT removes the entry; late saves never update an unmounted view', async t => {
  if (!Switch) return t.skip('Requires installed official DSH alpha.2 primitives and local esbuild');
  let unavailable = 0, finish;
  const missing = viewFixture({settings: async () => null}, () => unavailable++);
  missing.render(); await flush(); assert.equal(unavailable, 1); missing.dispose();
  const v = viewFixture({available: () => false, settings: async method => method ? null : defaults}, () => unavailable++);
  v.render(); await flush(); switches(v.render())[0].onClick(); await flush();
  assert.equal(v.render(), null); assert.equal(unavailable, 2); v.dispose();
  const late = viewFixture({settings: method => method ? new Promise(resolve => { finish = resolve; }) : Promise.resolve(defaults)},
    () => unavailable++);
  late.render(); await flush(); switches(late.render())[0].onClick(); late.dispose();
  finish(null); await flush(); assert.equal(unavailable, 2);
});
