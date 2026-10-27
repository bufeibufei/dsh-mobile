import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';
import {createTestDOM} from './test-dom.mjs';

const client = await readFile(new URL('./client.js', import.meta.url), 'utf8');
const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
const FileTypeIcon = props => ({type: 'svg', props});

// A reactive hook/DOM fixture for the complete generated client. State changes
// schedule renders; dependency changes clean up effects as React does.
async function fixture({width = 390, sessionId = 'composer-two', available = true} = {}) {
  const {document, Element} = createTestDOM();
  const host = new Element();
  document.body.append(host);
  const mediaListeners = new Set(), inputListeners = new Set(), sessionListeners = new Set();
  const slots = [], disposers = [], states = [], effects = [], calls = [], queries = [];
  const availability = new Map([[sessionId, available], ['global-one', true]]);
  let module, cursor = 0, pending = false, disposed = false, tree, props, View;
  function schedule() {
    if (pending || disposed) return;
    pending = true;
    queueMicrotask(() => { pending = false; if (!disposed) render(); });
  }
  const hooks = {
    useState(initial) {
      const i = cursor++;
      if (!(i in states)) states[i] = typeof initial === 'function' ? initial() : initial;
      return [states[i], value => {
        const next = typeof value === 'function' ? value(states[i]) : value;
        if (!Object.is(states[i], next)) { states[i] = next; schedule(); }
      }];
    },
    useEffect(effect, deps) {
      const i = cursor++, old = effects[i];
      if (!old || !deps || deps.some((v, j) => !Object.is(v, old.deps?.[j]))) {
        effects[i] = {effect, deps, cleanup: old?.cleanup, dirty: true};
      }
    }
  };
  function storeHook(listeners) {
    return selector => {
      hooks.useEffect(() => { listeners.add(schedule); return () => listeners.delete(schedule); }, []);
      return selector({});
    };
  }
  function toDOM(node) {
    if (typeof node.type === 'function') return toDOM(node.type(node.props));
    const element = new Element(node.type);
    for (const [key, value] of Object.entries(node.props)) {
      if (key === 'children') { if (value) element.append(toDOM(value)); }
      else if (key.startsWith('on')) element[key.toLowerCase()] = value;
      else if (key.startsWith('aria-')) element.setAttribute(key, value);
      else element[key] = value;
    }
    return element;
  }
  function render() {
    cursor = 0;
    tree = View(props);
    host.replaceChildren(...(tree ? [toDOM(tree)] : []));
    for (const entry of effects) if (entry?.dirty) {
      entry.dirty = false;
      entry.cleanup?.();
      entry.cleanup = entry.effect();
    }
  }
  const window = {
    matchMedia: () => ({get matches() { return width <= 700; },
      addEventListener: (_type, listener) => mediaListeners.add(listener),
      removeEventListener: (_type, listener) => mediaListeners.delete(listener)}),
    __ModuleLoader__: {load: value => { module = value; }}
  };
  runInNewContext(client, {document, window, queueMicrotask,
    MutationObserver: class {observe() {} disconnect() {}},
    getComputedStyle: () => ({visibility: 'visible'})});
  const plugin = module.factory(name => {
    if (name === 'react') return hooks;
    if (name === 'react/jsx-runtime') return {jsx: (type, props) => ({type, props})};
    if (name === '@deepseek-ai/dsh-client-ui-primitives') return {FileTypeIcon};
    throw Error(`Unexpected import: ${name}`);
  });
  assert.ok(plugin.inject.includes('conversation'));
  const input = {
    canPickFiles(id) { queries.push(id); return availability.get(id) === true; },
    pickFiles(id) { calls.push(id); }
  };
  plugin.apply({
    effect: fn => disposers.push(fn()),
    conversation: {input},
    layout: {panelInfo: {getSnapshot: () => ({activePanelId: null})}},
    slots: {
      inject(name, fn) { return name === 'conversation.input.left' ? fn() : () => {}; },
      register(options, component) {
        slots.push(options); View = component;
        return () => { View = null; };
      }
    }
  });
  props = {sessionId, useInput: storeHook(inputListeners), useSession: storeHook(sessionListeners)};
  render();
  await flush();
  return {
    document, slots, calls, queries, input,
    button: () => host.querySelector('button'),
    tree: () => tree,
    async resize(value) { width = value; mediaListeners.forEach(fn => fn()); await flush(); },
    async setAvailable(value, source = 'input') {
      availability.set(props.sessionId, value);
      const listeners = source === 'input' ? inputListeners : source === 'session' ? sessionListeners : [];
      for (const fn of listeners) fn();
      await flush();
    },
    async switchSession(id, allowed) {
      availability.set(id, allowed); props = {...props, sessionId: id}; render(); await flush();
    },
    dispose() {
      disposed = true;
      effects.forEach(entry => entry?.cleanup?.());
      disposers.reverse().forEach(fn => fn?.());
      assert.equal(mediaListeners.size, 0);
      assert.equal(inputListeners.size, 0);
      assert.equal(sessionListeners.size, 0);
    }
  };
}

test('mobile slot renders an accessible 14px official image icon with InputBar add styling', async () => {
  for (const width of [360, 390, 412, 700]) {
    const f = await fixture({width});
    assert.equal(f.slots.length, 1);
    assert.equal(f.slots[0].name, 'conversation.input.left');
    assert.equal(f.button().getAttribute('aria-label'), '添加图片');
    assert.equal(f.button().type, 'button');
    assert.ok(f.button().classList.contains('uV2eYG_add'));
    assert.equal(f.tree().props.children.type, FileTypeIcon);
    assert.equal(f.tree().props.children.props.kind, 'image');
    assert.equal(f.tree().props.children.props.size, 14);
    f.dispose();
  }
});

test('desktop renders nothing and resizing across 700px mounts/removes the button', async () => {
  for (const width of [701, 1280]) {
    const f = await fixture({width});
    assert.equal(f.tree(), null); assert.equal(f.button(), null);
    await f.resize(700); assert.ok(f.button());
    await f.resize(701); assert.equal(f.button(), null);
    f.dispose();
  }
});

test('click calls official InputHub file intake with the slot session, including after switching', async () => {
  const f = await fixture();
  f.button().click();
  assert.deepEqual(f.calls, ['composer-two']);
  assert.ok(f.queries.every(id => id === 'composer-two'));
  await f.switchSession('composer-three', true);
  f.button().click();
  assert.deepEqual(f.calls, ['composer-two', 'composer-three']);
  f.dispose();
});

test('unavailable stays visible and disabled, ignores clicks, and reactive changes enable it again', async () => {
  const f = await fixture({available: false});
  assert.equal(f.button().disabled, true);
  f.button().click();
  f.tree().props.onClick(); // Also guard direct/stale event delivery.
  assert.deepEqual(f.calls, []);
  await f.setAvailable(true);
  assert.equal(f.button().disabled, false);
  f.button().click(); assert.deepEqual(f.calls, ['composer-two']);
  await f.setAvailable(false, 'session');
  assert.equal(f.button().disabled, true);
  f.dispose();
});

test('live availability is rechecked at click time and document focus/pointerdown refresh disabled buttons', async () => {
  const f = await fixture();
  await f.setAvailable(false, 'silent');
  f.button().click(); await flush();
  assert.deepEqual(f.calls, []); assert.equal(f.button().disabled, true);
  for (const event of ['focusin', 'pointerdown']) {
    await f.setAvailable(true, 'silent');
    f.document.emit(event); await flush();
    assert.equal(f.button().disabled, false);
    await f.setAvailable(false, 'silent');
    f.document.emit(event); await flush();
    assert.equal(f.button().disabled, true);
  }
  f.dispose();
  const count = f.queries.length;
  f.document.emit('focusin'); f.document.emit('pointerdown'); await flush();
  assert.equal(f.queries.length, count);
});

test('missing runtime intake methods fail closed', async () => {
  const f = await fixture();
  delete f.input.pickFiles;
  f.document.emit('focusin'); await flush();
  assert.equal(f.button().disabled, true);
  f.tree().props.onClick(); assert.deepEqual(f.calls, []);
  f.dispose();
});
