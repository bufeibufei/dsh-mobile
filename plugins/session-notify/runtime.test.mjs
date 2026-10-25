import test from 'node:test';
import assert from 'node:assert/strict';
import {createNotifyRuntime, previewText} from './runtime.mjs';

function fixture(t, options = {}) {
  let time = Date.parse('2026-10-25T09:00:00Z'), seq = 0;
  const ticks = new Map(), session = {id: 'fictional-session'};
  const runtime = createNotifyRuntime({now: () => time, sequence: {epoch: 'fixture-epoch', id: 0},
    timers: {setInterval(fn, ms) { const key = {}; ticks.set(key, {fn, ms}); return key; },
      clearInterval(key) { ticks.delete(key); }}, ...options});
  t.after(() => runtime.close());
  return {runtime, session, ticks, advance(ms) { time += ms; },
    event(type, data) { runtime.observe(session, {type, data, seq: seq++}); },
    async read(after) {
      const response = runtime.stream({after}), reader = response.body.getReader();
      const reset = await frame(reader); assert.equal(reset.event, 'reset');
      return reader;
    }};
}
async function frame(reader) {
  const {value, done} = await reader.read();
  if (done) return null;
  const raw = new TextDecoder().decode(value);
  const lines = Object.fromEntries(raw.trim().split('\n').map(line => {
    const n = line.indexOf(':'); return [line.slice(0, n), line.slice(n + 1).trim()];
  }));
  return {...lines, ...(lines.data ? {data: JSON.parse(lines.data)} : {})};
}
const assistant = (turn, text) => ({turn, message: {content: [{type: 'text', text},
  {type: 'reasoning', text: 'private-reasoning'}, {type: 'image', data: 'private-image'}]}});

test('Markdown previews use Unicode characters, labels and whitespace, without images', () => {
  assert.equal(previewText('# 标题\n> **你好** [链接](https://private.invalid) ![图片](secret)\n- `代码`'), '标题 你好 链接 代码');
  assert.equal(previewText('```js\nconst a = 1\n```'), 'const a = 1');
  assert.equal(previewText('😊'.repeat(61)), '😊'.repeat(60));
  assert.equal(previewText(null), '');
});
test('official event shapes: last assistant text, reasons, question, approval and schedule turns', async t => {
  const f = fixture(t, {title: () => '虚构会话'}), reader = await f.read();
  f.event('turn/start', {turn: 1});
  f.event('user/message', {source: {kind: 'schedule'}, content: [{type: 'text', text: 'private-user'}]});
  f.event('assistant/message', assistant(1, '第一条'));
  f.event('assistant/message', assistant(1, '**最后一条**'));
  f.event('tool/call', {turn: 1, name: 'ask_user_question', arguments: JSON.stringify({questions: [{id: 'q', question: '去哪里？'}]})});
  f.event('approval/asked', {id: 'a', toolName: 'bash', reason: '**批准摘要**'});
  f.event('turn/end', {turn: 1, reason: {kind: 'completed'}});
  for (const [kind, preview] of [['question', '去哪里？'], ['approval', '批准摘要'], ['reply', '最后一条']]) {
    const row = (await frame(reader)).data;
    assert.equal(row.kind, kind); assert.equal(row.preview, preview); assert.equal(row.automated, true);
    assert.equal(row.sessionTitle, '虚构会话'); assert.equal(row.viewing, false);
  }
  f.event('turn/start', {turn: 2});
  f.event('user/message', {source: {kind: 'user'}});
  f.event('turn/end', {turn: 2, reason: {kind: 'error', error: {message: 'private-error'}}});
  const error = (await frame(reader)).data;
  assert.equal(error.kind, 'failed'); assert.equal(error.preview, ''); assert.equal(error.automated, false);
  await reader.cancel();
});
test('non-notification events, malformed questions, other end reasons and duplicates are ignored', async t => {
  const f = fixture(t), reader = await f.read();
  for (const kind of ['aborted', 'blocked', 'max-tokens', 'interrupted', 'forked']) {
    f.event('turn/start', {turn: 1}); f.event('assistant/message', assistant(1, 'discarded'));
    f.event('turn/end', {turn: 1, reason: {kind}});
  }
  for (const type of ['user/message', 'assistant/attempt', 'tool/result', 'approval/decided', 'life/saved']) f.event(type, {});
  for (const args of ['{', 'null', '{}', '{"questions":[]}', '{"questions":[{"question":9}]}'])
    f.event('tool/call', {name: 'ask_user_question', arguments: args});
  f.event('tool/call', {name: 'other', arguments: '{}'});
  f.event('turn/end', {turn: 20, reason: {kind: 'completed'}});
  f.runtime.observe(f.session, {seq: 0, type: 'turn/end', data: {turn: 20, reason: {kind: 'completed'}}});
  const row = (await frame(reader)).data;
  assert.equal(row.id, 1); assert.equal(row.preview, ''); assert.equal(row.sessionTitle, null);
  f.runtime.close(); assert.equal(await frame(reader), null);
});
test('cache cap, 24-hour expiry, omitted after and process reset', async t => {
  const f = fixture(t);
  for (let turn = 1; turn <= 205; turn++) f.event('turn/end', {turn, reason: {kind: 'completed'}});
  const reader = await f.read(0);
  for (let id = 6; id <= 205; id++) assert.equal((await frame(reader)).data.id, id);
  await reader.cancel();
  const fresh = await f.read();
  f.event('turn/end', {turn: 206, reason: {kind: 'completed'}});
  assert.equal((await frame(fresh)).data.id, 206); await fresh.cancel();
  f.advance(86400000);
  for (const {fn} of f.ticks.values()) fn();
  const expired = await f.read(0);
  f.event('turn/end', {turn: 207, reason: {kind: 'completed'}});
  assert.equal((await frame(expired)).data.id, 207); await expired.cancel();
  const restarted = fixture(t, {sequence: {epoch: 'new-process', id: 0}});
  const r = restarted.runtime.stream({after: 207}).body.getReader();
  assert.deepEqual((await frame(r)).data, {epoch: 'new-process', last: 0});
  restarted.event('turn/end', {turn: 1, reason: {kind: 'completed'}});
  assert.equal((await frame(r)).data.id, 1); await r.cancel();
});
test('reset last is the process maximum even after cache expiry or runtime replacement', async t => {
  const sequence = {epoch: 'fixture-epoch', id: 0}, f = fixture(t, {sequence});
  const reset = async runtime => {
    const reader = runtime.stream().body.getReader();
    const value = await frame(reader); await reader.cancel(); return value.data;
  };
  assert.deepEqual(await reset(f.runtime), {epoch: sequence.epoch, last: 0});
  for (let turn = 1; turn <= 3; turn++) f.event('turn/end', {turn, reason: {kind: 'completed'}});
  assert.deepEqual(await reset(f.runtime), {epoch: sequence.epoch, last: 3});
  f.advance(86400000);
  for (const {fn} of f.ticks.values()) fn();
  assert.deepEqual(await reset(f.runtime), {epoch: sequence.epoch, last: 3});
  f.runtime.close();
  assert.deepEqual(await reset(fixture(t, {sequence}).runtime), {epoch: sequence.epoch, last: 3});
});
for (const epoch of [undefined, 'fixture-epoch', 'old-process']) {
  test(`reconnect with epoch ${epoch} replays the expected cache then live events`, async t => {
    const f = fixture(t);
    for (let turn = 1; turn <= 3; turn++) f.event('turn/end', {turn, reason: {kind: 'completed'}});
    const different = epoch === 'old-process';
    const reader = f.runtime.stream({after: different ? 999 : 1, epoch}).body.getReader();
    assert.deepEqual((await frame(reader)).data, {epoch: 'fixture-epoch', last: 3});
    f.event('turn/end', {turn: 4, reason: {kind: 'completed'}});
    for (const id of different ? [1, 2, 3, 4] : [2, 3, 4]) assert.equal((await frame(reader)).data.id, id);
    f.runtime.close(); assert.equal(await frame(reader), null);
  });
}
test('viewing expires exactly at 60 seconds and never filters notifications', async t => {
  const f = fixture(t), reader = await f.read();
  f.runtime.viewing({sessionId: f.session.id, visible: true});
  for (const [ms, expected] of [[0, true], [59999, true], [1, false]]) {
    f.advance(ms); f.event('turn/end', {turn: 1, reason: {kind: 'completed'}});
    assert.equal((await frame(reader)).data.viewing, expected);
  }
  for (const state of [{sessionId: f.session.id, visible: false}, {sessionId: 'other', visible: true}, {sessionId: null, visible: true}]) {
    f.runtime.viewing(state); f.event('turn/end', {turn: 1, reason: {kind: 'completed'}});
    assert.equal((await frame(reader)).data.viewing, false);
  }
  await reader.cancel();
});
test('25s heartbeat, abort/cancel/unload and slow-reader cleanup release all timers', async t => {
  const f = fixture(t), abort = new AbortController();
  const reader = f.runtime.stream({signal: abort.signal}).body.getReader(); await frame(reader);
  assert.equal(f.ticks.size, 2);
  for (const {fn, ms} of f.ticks.values()) { assert.equal(ms, 25000); fn(); }
  assert.equal((await frame(reader))[''], 'ping');
  assert.doesNotThrow(() => abort.abort());
  assert.doesNotThrow(() => f.runtime.closeStreams());
  assert.equal(await frame(reader), null); assert.equal(f.ticks.size, 1);
  await assert.doesNotReject(reader.cancel());
  const other = await f.read(); await other.cancel(); assert.equal(f.ticks.size, 1);
  const slow = f.runtime.stream();
  for (let i = 0; i < 260; i++) f.event('turn/end', {turn: i, reason: {kind: 'completed'}});
  assert.equal(f.ticks.size, 1); await slow.body.cancel();
  const ended = f.runtime.stream({signal: AbortSignal.abort()});
  assert.equal((await ended.body.getReader().read()).done, true);
  const last = await f.read(); f.runtime.close(); assert.equal(await frame(last), null);
  assert.equal(f.ticks.size, 0);
});

test('unrelated reentrant events do not discard source/assistant events; no stale preview after disposal', async t => {
  const f = fixture(t), reader = await f.read();
  f.runtime.observe(f.session, {seq: 0, type: 'turn/start', data: {turn: 1}});
  // Another listener can append a higher-seq metadata event before our callback for the original.
  f.runtime.observe(f.session, {seq: 2, type: 'session/title', data: {title: 'fixture'}});
  f.runtime.observe(f.session, {seq: 1, type: 'user/message', data: {source: {kind: 'schedule'}}});
  f.runtime.observe(f.session, {seq: 3, type: 'assistant/message', data: assistant(1, 'older')});
  f.runtime.observe(f.session, {seq: 4, type: 'assistant/message', data: {turn: 1, message: {content: []}}});
  f.runtime.observe(f.session, {seq: 5, type: 'turn/end', data: {turn: 1, reason: {kind: 'completed'}}});
  const row = (await frame(reader)).data;
  assert.equal(row.automated, true); assert.equal(row.preview, '');
  f.runtime.forget(f.session);
  f.runtime.observe(f.session, {seq: 6, type: 'turn/end', data: {turn: 2, reason: {kind: 'completed'}}});
  assert.equal((await frame(reader)).data.automated, false);
  await reader.cancel();
});

test('abort on an errored stream releases listeners and timers without throwing', async t => {
  const f = fixture(t), abort = new AbortController();
  const enqueue = ReadableStreamDefaultController.prototype.enqueue;
  let controller;
  const capture = t.mock.method(ReadableStreamDefaultController.prototype, 'enqueue', function(value) {
    controller = this; return enqueue.call(this, value);
  });
  const reader = f.runtime.stream({signal: abort.signal}).body.getReader();
  capture.mock.restore(); await frame(reader);
  controller.error(new Error('fictional transport failure'));
  assert.doesNotThrow(() => abort.abort());
  assert.doesNotThrow(() => f.runtime.closeStreams());
  assert.doesNotThrow(() => f.runtime.close());
  assert.equal(f.ticks.size, 0);
  await assert.rejects(reader.read(), /fictional transport failure/);
});
test('enqueue failure during reset or heartbeat cleans up without leaking a timer', async t => {
  for (const duringReset of [true, false]) {
    const f = fixture(t), abort = new AbortController();
    let reader;
    if (!duringReset) {
      reader = f.runtime.stream({signal: abort.signal}).body.getReader(); await frame(reader);
    }
    const enqueue = ReadableStreamDefaultController.prototype.enqueue;
    const failure = t.mock.method(ReadableStreamDefaultController.prototype, 'enqueue', function(value) {
      this.error(new Error('fictional enqueue failure'));
      return enqueue.call(this, value);
    });
    if (duringReset) {
      assert.doesNotThrow(() => { reader = f.runtime.stream({signal: abort.signal}).body.getReader(); });
    } else {
      for (const {fn} of f.ticks.values()) assert.doesNotThrow(fn);
    }
    failure.mock.restore();
    assert.equal(f.ticks.size, 1);
    assert.doesNotThrow(() => abort.abort());
    assert.doesNotThrow(() => f.runtime.close());
    await assert.rejects(reader.read(), /fictional enqueue failure/);
  }
});
