import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {createRegistry, canonical} from './runtime.mjs';
import {mountRoutes} from './routes.mjs';
import * as plugin from './index.mjs';

const from = '2026-10-26T00:00:00.000Z', to = '2026-11-02T00:00:00.000Z';
const item = (key = 'one', at = from) => ({key, at, title: 'Example', text: '', open: 'opaque:1',
  actions: [{id: 'done', label: 'Done'}], snooze: true});
const daily = {key: 'summary', time: '08:00', timezone: 'America/New_York'};
const provider = (id = 'demo', extra = {}) => ({id, list: () => ({items: [item()], daily: [daily]}),
  action: () => ({status: 'done'}), content: () => ({shouldNotify: true, title: 'Daily', text: '', open: null}), ...extra});
function setup(t, options) {
  const registry = createRegistry(options), routes = new Map();
  // Mirrors the official admit(): an attached Origin must be the Host's own authority.
  const sameOrigin = req => { const origin = req.headers.get('origin');
    try { return origin === null || new URL(origin).origin === new URL(req.url).origin; } catch { return false; } };
  mountRoutes({connection: {admit: req => req.headers.get('cookie') !== 'fictional=ok' ? {rejection: 401} :
    sameOrigin(req) ? {} : {rejection: 403},
    fetch: {register: route => routes.set(route.path, route)}}}, registry, {now: () => Date.parse(from)});
  t.after(() => registry.close());
  const request = async (path = '', {method = path.split('?')[0] === '/action' ? 'POST' : 'GET', body, origin = 'https://dsh.example.com', auth = true} = {}) => {
    const url = new URL('/api/mobile-schedule' + path, 'https://dsh.example.com');
    const response = await routes.get(url.pathname).fetch(new Request(url, {method,
      headers: {...(auth ? {cookie: 'fictional=ok'} : {}), ...(origin ? {origin} : {}), 'content-type': 'application/json'},
      ...(body === undefined ? {} : {body: typeof body === 'string' ? body : JSON.stringify(body)})}));
    assert.equal(response.headers.get('cache-control'), 'no-store');
    return {status: response.status, ...await response.json()};
  };
  return {registry, request};
}
test('registration validates API and ids; unregister/disposal are idempotent', () => {
  const registry = createRegistry(); let count = 0;
  for (const p of [null, {}, provider('Bad'), provider('x'.repeat(33)), provider('a', {list: 1}), provider('a', {dispose: true})])
    assert.throws(() => registry.register(p));
  const dispose = registry.register(provider('a', {dispose() { count++; }}));
  assert.throws(() => registry.register(provider('a')), /Duplicate/);
  dispose(); dispose(); assert.equal(count, 1);
  registry.register(provider('a', {dispose() { count++; }})); registry.close(); registry.close();
  assert.equal(count, 2); assert.throws(() => registry.register(provider()));
});
test('stable canonical SHA256, prefixes, sort, window filtering and defaults', async t => {
  const {registry, request} = setup(t);
  let received;
  registry.register(provider('z', {list(args) { received = args; return {items: [item('b'), item('a'), item('old', '2026-10-25T00:00:00Z')], daily: [daily]}; }}));
  registry.register(provider('a'));
  const response = await request(); assert.equal(response.status, 200);
  assert.equal(received.from, from); assert.equal(received.to, to); assert.ok(received.signal instanceof AbortSignal);
  assert.deepEqual(response.value.items.map(i => i.key), ['a/one', 'z/a', 'z/b']);
  assert.deepEqual(response.value.daily.map(i => i.key), ['a/summary', 'z/summary']);
  assert.equal(response.value.version, createHash('sha256').update(canonical({daily: response.value.daily, items: response.value.items})).digest('hex'));
  assert.equal((await request()).value.version, response.value.version);
  const second = createRegistry(); t.after(() => second.close());
  second.register(provider('a')); second.register(provider('z', {list: () => ({daily: [daily], items: [item('a'), item('b')]})}));
  assert.equal((await second.list({from, to})).version, response.value.version);
});
test('query contract rejects unknown, duplicate, invalid dates and spans', async t => {
  const {request} = setup(t);
  for (const query of ['?x=1', '?from=', '?from=now', '?from=2026-02-30T00:00:00Z', '?from=2026-10-26T24:00:00Z',
    '?from=' + from + '&from=' + from, '?to=2026-10-25T00:00:00Z', '?to=2026-11-10T00:00:00Z']) {
    assert.deepEqual(await request(query), {status: 400, ok: false, error: {code: 'CONTRACT_MISMATCH'}}, query);
  }
  assert.equal((await request('?to=2026-11-09T00:00:00Z')).status, 200);
  assert.equal((await request('?from=' + from + '&to=' + from)).status, 200);
});
test('admission and same-origin action fence', async t => {
  const {registry, request} = setup(t); registry.register(provider());
  for (const path of ['', '/action', '/content?key=demo/summary&date=2026-10-26'])
    assert.deepEqual(await request(path, {auth: false}), {status: 401, ok: false, error: {code: 'UNAUTHORIZED'}});
  for (const origin of [null, 'https://elsewhere.example.com', 'null', 'http://dsh.example.com'])
    assert.equal((await request('/action', {body: {key: 'demo/one', action: 'done'}, origin})).status, 403);
});
test('action routes local key and preserves provider error codes', async t => {
  const {registry, request} = setup(t); let code, args;
  registry.register(provider('demo', {action(input) { args = input; if (code) throw Object.assign(new Error(), {code}); return {status: 'done'}; }}));
  const body = {key: 'demo/one', action: 'done'};
  assert.deepEqual(await request('/action', {body}), {status: 200, ok: true, value: {...body, status: 'done'}});
  assert.equal(args.key, 'one'); assert.equal(args.action, 'done');
  for (const [error, status] of [['NOT_FOUND', 404], ['NOT_ACTIVE', 409], ['OTHER', 503]]) {
    code = error; assert.equal((await request('/action', {body})).status, status);
  }
  assert.equal((await request('/action', {body: {...body, key: 'missing/one'}})).status, 404);
  for (const bad of [null, [], {}, {...body, extra: 1}, {...body, key: 'one'}, {...body, action: 'BAD'}, '{'])
    assert.equal((await request('/action', {body: bad})).status, 400);
  assert.equal((await request('/action?key=a', {body})).status, 400);
});
test('action rejects duplicate JSON members, including escaped names', async t => {
  const {registry, request} = setup(t); registry.register(provider());
  for (const body of ['{"key":"demo/one","key":"demo/one","action":"done"}',
    '{"key":"demo/one","action":"done","action":"done"}',
    '{"key":"demo/one","\\u006bey":"demo/one","action":"done"}'])
    assert.equal((await request('/action', {body})).status, 400);
  assert.equal((await request('/action', {body: '{"action":"done","key":"demo/one"}'})).status, 200);
});
test('version changes when item content, actions or daily time changes', async t => {
  const {registry, request} = setup(t); let value = {items: [item()], daily: [daily]};
  registry.register(provider('demo', {list: () => value}));
  let previous = (await request()).value.version;
  for (const next of [
    {items: [{...item(), title: 'Changed'}], daily: [daily]},
    {items: [{...item(), at: '2026-10-27T00:00:00Z'}], daily: [daily]},
    {items: [{...item(), snooze: false, actions: []}], daily: [daily]},
    {items: [item()], daily: [{...daily, time: '09:00'}]},
  ]) {
    value = next; const version = (await request()).value.version;
    assert.notEqual(version, previous); previous = version;
  }
});
test('content uses provider-local key and validates date and output', async t => {
  const {registry, request} = setup(t); let args, invalid = false;
  registry.register(provider('demo', {content(input) { args = input; return {shouldNotify: true, title: 'Daily', text: '', open: invalid ? 42 : null}; }}));
  const response = await request('/content?key=demo/summary&date=2026-10-26');
  assert.equal(response.status, 200); assert.equal(args.key, 'summary'); assert.equal(args.date, '2026-10-26');
  assert.equal(response.value.key, 'demo/summary'); assert.equal(response.value.date, args.date);
  for (const query of ['', '?key=demo/summary', '?key=demo/summary&date=2026-02-30', '?key=demo/summary&date=2026-10-26&date=2026-10-26',
    '?key=demo/summary&date=2026-10-26&x=1']) assert.equal((await request('/content' + query)).status, 400);
  invalid = true; assert.equal((await request('/content?key=demo/summary&date=2026-10-26')).status, 503);
});
test('content passes through a provider-reported date so the shell can drop a stale summary', async t => {
  const {registry, request} = setup(t); let reported = '2026-10-25';
  registry.register(provider('demo', {content: () => ({date: reported, shouldNotify: true, title: 'Daily', text: '', open: null})}));
  const response = await request('/content?key=demo/summary&date=2026-10-26');
  assert.equal(response.status, 200); assert.equal(response.value.date, '2026-10-25');
  reported = 'not-a-date'; assert.equal((await request('/content?key=demo/summary&date=2026-10-26')).status, 503);
});
test('provider throw, invalid item and timeout never expose partial snapshots', async t => {
  for (const list of [() => { throw new Error('private'); }, () => ({items: [{...item(), open: 'x'.repeat(257)}], daily: []}),
    () => ({items: [item(), item()], daily: []}), () => ({items: [{...item(), actions: Array(3).fill({id: 'a', label: 'a'})}], daily: []}),
    () => ({items: [], daily: [{...daily, timezone: 'Not/AZone'}]}), () => new Promise(() => {})]) {
    const {registry, request} = setup(t, {timeout: 10}); registry.register(provider('good')); registry.register(provider('bad', {list}));
    assert.deepEqual(await request(), {status: 503, ok: false, error: {code: 'UNAVAILABLE'}});
  }
});
test('default provider deadline is three seconds and aborts its signal', async t => {
  const {registry, request} = setup(t); let signal;
  registry.register(provider('slow', {list(args) { signal = args.signal; return new Promise(() => {}); }}));
  const start = performance.now(); assert.equal((await request()).status, 503);
  assert.ok(performance.now() - start >= 2900); assert.equal(signal.aborted, true);
});
test('unregister and request abort cancel pending providers', async t => {
  const registry = createRegistry(); t.after(() => registry.close()); let started;
  const ready = new Promise(resolve => { started = resolve; }); let signal;
  const dispose = registry.register(provider('demo', {list(args) { signal = args.signal; started(); return new Promise(() => {}); }}));
  const pending = registry.list({from, to}); await ready; dispose();
  await assert.rejects(pending, {code: 'UNAVAILABLE'}); assert.equal(signal.aborted, true);
  const controller = new AbortController();
  registry.register(provider('demo', {list: () => new Promise(() => {})}));
  const another = registry.list({from, to, signal: controller.signal}); controller.abort();
  await assert.rejects(another, {code: 'UNAVAILABLE'});
});
test('apply provides mobileSchedule without resolving the SDK; optional connection owns routes and disposal closes registry', async () => {
  let dispose, optional, provided;
  plugin.apply({effect(fn) { dispose = fn(); }, provide(name, value) { provided = {name, value}; },
    inject(names, fn) { optional = {names, fn}; }});
  assert.equal(provided.name, 'mobileSchedule'); assert.deepEqual(optional.names, ['connection']);
  const service = provided.value;
  const routes = []; optional.fn({connection: {fetch: {register(route) { routes.push(route); }}}});
  assert.equal(routes.length, 3); service.register(provider()); dispose(); assert.throws(() => service.register(provider('another')));
});

const local = createRequire(import.meta.url);
let Context, HostConnectionService, sdkMissing;
try {
  const sdkPath = local.resolve('@deepseek-ai/dsh/package.json');
  const sdk = createRequire(sdkPath);
  if (local(sdkPath).version !== '0.2.1-alpha.2') sdkMissing = 'Requires official @deepseek-ai/dsh 0.2.1-alpha.2';
  else {
    const connectionPath = sdk.resolve('@deepseek-ai/dsh-client-connection');
    ({Context} = await import(createRequire(connectionPath).resolve('@deepseek-ai/cordis')));
    ({HostConnectionService} = await import(connectionPath));
  }
} catch (error) {
  if (!['MODULE_NOT_FOUND', 'ERR_MODULE_NOT_FOUND'].includes(error.code)) throw error;
  sdkMissing = 'Requires installed official DSH SDK and its Cordis/Connection dependencies';
}
test('real Cordis service and official connection dispatch and unload without listener', async t => {
  if (sdkMissing) return t.skip(sdkMissing);
  const ctx = new Context();
  const connection = new HostConnectionService(ctx, ['localhost:3210'], {isAuthenticated: () => true});
  const handler = connection.createSharedFetchHandler('/api');
  const fiber = ctx.plugin(plugin); await fiber.await();
  t.after(async () => { await fiber.dispose(); await ctx.fiber.dispose(); });
  assert.equal(typeof ctx.mobileSchedule.register, 'function');
  let disposed = 0;
  const external = ctx.plugin({apply(c) { c.inject(['mobileSchedule'], exact => exact.effect(() =>
    exact.mobileSchedule.register(provider('demo', {dispose() { disposed++; }})))); }});
  await external.await();
  const request = () => handler.fetch(new Request('http://localhost:3210/api/mobile-schedule?from=' + from, {headers: {host: 'localhost:3210'}}));
  assert.equal((await (await request()).json()).value.items[0].key, 'demo/one');
  const act = origin => handler.fetch(new Request('http://localhost:3210/api/mobile-schedule/action', {method: 'POST',
    headers: {host: 'localhost:3210', 'content-type': 'application/json', ...(origin ? {origin} : {})},
    body: JSON.stringify({key: 'demo/one', action: 'done'})}));
  assert.equal((await act('http://localhost:3210')).status, 200);
  for (const origin of [null, 'http://elsewhere.example', 'null']) assert.equal((await act(origin)).status, 403);
  await external.dispose(); assert.equal(disposed, 1);
  assert.equal((await (await request()).json()).value.items.length, 0);
  await fiber.dispose(); assert.equal((await request()).status, 404);
});
test('real Cordis allows connection to arrive and disappear independently', async t => {
  if (sdkMissing) return t.skip(sdkMissing);
  const ctx = new Context(), routes = new Map();
  const fiber = ctx.plugin(plugin); await fiber.await();
  assert.ok(ctx.mobileSchedule);
  const carrier = ctx.plugin({apply(c) { c.provide('connection', {admit: () => ({}), fetch: {register(route) {
    c.effect(() => { routes.set(route.path, route); return () => routes.delete(route.path); });
  }}}); }});
  t.after(async () => { await carrier.dispose(); await fiber.dispose(); await ctx.fiber.dispose(); });
  await carrier.await(); assert.equal(routes.size, 3);
  await carrier.dispose(); assert.equal(routes.size, 0); assert.equal(typeof ctx.mobileSchedule.register, 'function');
});
