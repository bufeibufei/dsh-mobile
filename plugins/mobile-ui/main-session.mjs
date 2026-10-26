// Optional main-session entry, using the frozen HTTP and official Client APIs.
async function mainSessionRequest(fetch, path, signal, method = 'GET') {
  const response = await fetch(`/api/jarvis-main/${path}`, {
    method, credentials: 'same-origin', cache: 'no-store', signal,
    ...(method === 'POST' ? {
      headers: {'content-type': 'application/json'}, body: '{}'
    } : {})
  });
  if (response.status !== 200) throw new Error('Main session unavailable');
  const result = await response.json();
  const id = result?.value?.sessionId;
  if (result?.ok !== true || !(id === null || typeof id === 'string')) {
    throw new Error('Invalid main session response');
  }
  return id;
}

function waitForMainSession(list, id, signal, timers) {
  return new Promise((resolve, reject) => {
    let settled = false, unsubscribe, timeout;
    const finish = error => {
      if (settled) return;
      settled = true;
      unsubscribe?.();
      timers.clearTimeout(timeout);
      signal.removeEventListener('abort', abort);
      if (error) reject(error);
      else resolve();
    };
    const abort = () => finish(new Error('Main session cancelled'));
    const check = () => {
      try {
        const catalog = list.getSnapshot().byId;
        if (Object.hasOwn(catalog, id) && catalog[id]?.id === id) finish();
      } catch (error) { finish(error); }
    };
    if (signal.aborted) { abort(); return; }
    signal.addEventListener('abort', abort, {once: true});
    check();
    if (settled) return;
    timeout = timers.setTimeout(() => finish(new Error('Main session catalog timeout')), 10000);
    try {
      unsubscribe = list.subscribe(check);
      // Also handle sources which publish immediately during subscribe.
      if (settled) unsubscribe();
      else check();
    } catch (error) { finish(error); }
  });
}

export function createMainSessionPanel({jsx, useEffect, useState}, {fetch, timers, sessions, uiWorkspace}) {
  return function MainSessionPanel() {
    const [failed, setFailed] = useState(false);
    const [lifetime] = useState(() => ({mounted: false, pending: null}));
    const open = () => {
      if (!lifetime.mounted || lifetime.pending) return;
      const abort = new AbortController();
      lifetime.pending = abort;
      setFailed(false);
      void (async () => {
        try {
          const id = await mainSessionRequest(fetch, 'ensure', abort.signal, 'POST');
          if (abort.signal.aborted) return;
          if (typeof id !== 'string' || !id.trim() || id !== id.trim()) {
            throw new Error('Invalid main session id');
          }
          await waitForMainSession(sessions.list, id, abort.signal, timers);
          if (!abort.signal.aborted && lifetime.mounted) uiWorkspace.openSession(id);
        } catch {
          if (!abort.signal.aborted && lifetime.mounted) setFailed(true);
        } finally {
          if (lifetime.pending === abort) lifetime.pending = null;
        }
      })();
    };
    useEffect(() => {
      lifetime.mounted = true;
      open();
      return () => {
        lifetime.mounted = false;
        lifetime.pending?.abort();
        lifetime.pending = null;
      };
    }, []);
    return jsx('div', {children: failed ? [
      jsx('p', {role: 'alert', children: '暂时无法打开主会话'}, 'message'),
      jsx('button', {type: 'button', onClick: open, children: '重试'}, 'retry')
    ] : null});
  };
}

export function installMainSession(ctx, react, {fetch, timers}) {
  ctx.effect(() => {
    const abort = new AbortController();
    const disposers = [];
    const Panel = createMainSessionPanel(react, {
      fetch, timers, sessions: ctx.sessions, uiWorkspace: ctx.uiWorkspace
    });
    const Icon = () => react.jsx('span', {'aria-hidden': true, children: 'J'});
    void mainSessionRequest(fetch, 'session', abort.signal).then(() => {
      if (abort.signal.aborted) return;
      disposers.push(ctx.slots.inject('main', () => {
        if (abort.signal.aborted) return;
        const unregisterPanel = ctx.slots.register({name: 'main', key: 'jarvis-main'}, Panel);
        const stopSidebar = ctx.slots.inject('sidebar.panellist', () => {
          if (abort.signal.aborted) return;
          return ctx.slots.register({
            name: 'sidebar.panellist', id: 'jarvis-main', order: -10, label: 'Jarvis'
          }, Icon);
        });
        return () => { stopSidebar(); unregisterPanel(); };
      }));
    }).catch(() => { /* An absent or unavailable plugin has no entry. */ });
    return () => {
      abort.abort();
      disposers.forEach(dispose => dispose());
    };
  });
}
