import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createRequire} from 'node:module';
import {createSettingsStore, defaults} from './settings.mjs';
import * as plugin from './index.mjs';

const local = createRequire(import.meta.url);
let Context, HostConnectionService, sdkMissing;
try {
  const sdkPath = local.resolve('@deepseek-ai/dsh/package.json');
  const sdk = createRequire(sdkPath);
  if (local(sdkPath).version !== '0.2.1-alpha.2') {
    sdkMissing = 'Requires official @deepseek-ai/dsh 0.2.1-alpha.2';
  } else {
    const connectionPath = sdk.resolve('@deepseek-ai/dsh-client-connection');
    const dependency = createRequire(connectionPath);
    ({Context} = await import(dependency.resolve('@deepseek-ai/cordis')));
    ({HostConnectionService} = await import(connectionPath));
  }
} catch (error) {
  if (!['MODULE_NOT_FOUND', 'ERR_MODULE_NOT_FOUND'].includes(error.code)) throw error;
  sdkMissing = 'Requires installed official DSH SDK and its Cordis/Connection dependencies';
}
async function directory(t) {
  const path = await fs.mkdtemp(join(tmpdir(), 'session-notify-'));
  t.after(() => fs.rm(path, {recursive: true, force: true})); return path;
}

test('settings validate partial booleans, serialize writes, persist and recover after failed atomic rename', async t => {
  const root = await directory(t), path = join(root, 'settings.json');
  let fail = false, renames = 0;
  const store = await createSettingsStore(root, {fs: {...fs, async rename(from, to) {
    assert.equal(to, path); assert.notEqual(from, to);
    assert.equal((await fs.stat(from)).mode & 0o777, 0o600);
    assert.deepEqual(JSON.parse(await fs.readFile(from, 'utf8')), {enabled: false, notifyReplies: true, lockScreenContent: true});
    if (fail) throw new Error('fictional write failure');
    renames++; return fs.rename(from, to);
  }}});
  assert.deepEqual(store.read(), defaults);
  for (const bad of [null, [], false, {enabled: 1}, {notifyReplies: 'false'}, {unknown: true}])
    assert.throws(() => store.update(bad), /Invalid/);
  fail = true;
  await assert.rejects(store.update({enabled: false}));
  assert.deepEqual(store.read(), defaults);
  assert.deepEqual(await fs.readdir(root), []);
  fail = false; await store.update({enabled: false}); assert.equal(renames, 1);
  const second = await createSettingsStore(root);
  await Promise.all([second.update({notifyReplies: false}), second.update({lockScreenContent: false})]);
  assert.deepEqual((await createSettingsStore(root)).read(), {enabled: false, notifyReplies: false, lockScreenContent: false});
  assert.deepEqual(await fs.readdir(root), ['settings.json']);
  await fs.writeFile(path, '{invalid');
  await assert.rejects(createSettingsStore(root), /Cannot read/);
  assert.equal(await fs.readFile(path, 'utf8'), '{invalid');
});

test('real Cordis and official Connection dispatch GET/PUT, admission, SSE and disposal without a listener', async t => {
  if (sdkMissing) return t.skip(sdkMissing);
  const root = await directory(t), ctx = new Context();
  ctx.provide('sessions', {});
  // Real Connection carrier and trust fence; only browser-auth persistence is substituted.
  const connection = new HostConnectionService(ctx, ['localhost:3210'], {
    isAuthenticated: request => request.headers.get?.('cookie') === 'fictional=ok',
  });
  const handler = connection.createSharedFetchHandler('/api');
  const request = (path, {method = 'GET', body, auth = true} = {}) => handler.fetch(
    new Request('http://localhost:3210/api/session-notify/' + path, {method,
      headers: {host: 'localhost:3210', ...(auth ? {cookie: 'fictional=ok'} : {}), 'content-type': 'application/json'},
      ...(body === undefined ? {} : {body: JSON.stringify(body)})}));
  const fiber = ctx.plugin(plugin, {directory: root});
  t.after(async () => { await fiber.dispose(); await ctx.fiber.dispose(); });
  await fiber.await();
  for (const [path, method] of [['stream', 'GET'], ['viewing', 'POST'], ['settings', 'GET'], ['settings', 'PUT']])
    assert.equal((await request(path, {method, auth: false})).status, 401);
  assert.deepEqual(await (await request('settings')).json(), {ok: true, value: defaults});
  const put = await request('settings', {method: 'PUT', body: {notifyReplies: false}});
  assert.equal(put.status, 200);
  assert.deepEqual(await put.json(), {ok: true, value: {...defaults, notifyReplies: false}});
  for (const body of [{enabled: 'false'}, {lockScreenContent: 0}, {unexpected: true}, null, []])
    assert.equal((await request('settings', {method: 'PUT', body})).status, 400);
  for (const body of [{sessionId: 's'}, {sessionId: 1, visible: true}, {sessionId: 's', visible: 'true'},
    {sessionId: 's', visible: true, extra: true}])
    assert.equal((await request('viewing', {method: 'POST', body})).status, 400);
  assert.equal((await request('viewing', {method: 'POST', body: {sessionId: 's', visible: true}})).status, 204);
  for (const query of ['?after=-1', '?after=1.5', '?after=', '?after=9007199254740992', '?after=1&after=2', '?extra=1',
    '?epoch=old', '?after=0&epoch=old&epoch=old'])
    assert.equal((await request('stream' + query)).status, 400);
  const response = await request('stream');
  assert.equal(response.headers.get('content-type'), 'text/event-stream');
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const reader = response.body.getReader(), decode = async () => new TextDecoder().decode((await reader.read()).value);
  const initialReset = JSON.parse((await decode()).split('data: ')[1]);
  assert.equal(typeof initialReset.epoch, 'string');
  assert.equal(initialReset.last, 0);
  const session = {id: 's'};
  ctx.emit('session/event', session, {seq: 0, type: 'turn/start', data: {turn: 1}});
  ctx.emit('session/event', session, {seq: 1, type: 'assistant/message', data: {turn: 1,
    message: {content: [{type: 'text', text: '虚构回复'}]}}});
  ctx.emit('session/event', session, {seq: 2, type: 'turn/end', data: {turn: 1, reason: {kind: 'completed'}}});
  const row = JSON.parse((await decode()).split('data: ')[1]);
  assert.equal(row.preview, '虚构回复'); assert.equal(row.viewing, true); assert.equal(row.sessionTitle, null);
  for (const epoch of [undefined, initialReset.epoch, 'old-process']) {
    const query = epoch === undefined ? '' : '&epoch=' + encodeURIComponent(epoch);
    const replay = (await request(`stream?after=${row.id}${query}`)).body.getReader();
    const reset = JSON.parse(new TextDecoder().decode((await replay.read()).value).split('data: ')[1]);
    assert.equal(reset.last, row.id);
    if (epoch === 'old-process') {
      const replayed = JSON.parse(new TextDecoder().decode((await replay.read()).value).split('data: ')[1]);
      assert.deepEqual(replayed, row);
    }
    await replay.cancel();
  }
  await fiber.dispose();
  assert.equal((await reader.read()).done, true);
  assert.equal((await request('settings')).status, 404);
});

test('optional connection and title services can arrive and disappear independently', async t => {
  if (sdkMissing) return t.skip(sdkMissing);
  const ctx = new Context(), root = await directory(t), routes = new Map();
  ctx.provide('sessions', {});
  const fiber = ctx.plugin(plugin, {directory: root}); await fiber.await();
  const extra = ctx.plugin({apply(c) {
    c.provide('sessionTitle', {get: () => ({title: '官方虚构标题'})});
    c.provide('connection', {admit: () => ({peer: {}}), fetch: {register(route) {
      c.effect(() => { routes.set(route.path, route); return () => routes.delete(route.path); });
    }}});
  }});
  t.after(async () => { await extra.dispose(); await fiber.dispose(); await ctx.fiber.dispose(); });
  await extra.await();
  const response = await routes.get('/api/session-notify/stream').fetch(new Request('http://localhost/api/session-notify/stream'));
  const reader = response.body.getReader(); await reader.read();
  ctx.emit('session/event', {id: 'fictional'}, {type: 'approval/asked', data: {reason: '确认'}});
  const row = JSON.parse(new TextDecoder().decode((await reader.read()).value).split('data: ')[1]);
  assert.equal(row.sessionTitle, '官方虚构标题');
  await extra.dispose(); assert.equal((await reader.read()).done, true); assert.equal(routes.size, 0);
  // Event feed remains harmless with both optional services gone.
  ctx.emit('session/event', {id: 'fictional'}, {type: 'turn/end', data: {turn: 1, reason: {kind: 'completed'}}});
});
