// Browser logic with injected official sources, HTTP and timers for offline tests.
export function createSessionNotify({current, panelInfo, document, fetch, native,
  timers, obscured = () => false}) {
  let disposed = false, unavailable = false, heartbeat, last, lastKey, pending, sending = false;
  const requests = new Set();
  async function request(path, method = 'GET', body) {
    if (disposed || unavailable) return null;
    const abort = new AbortController();
    requests.add(abort);
    const timeout = timers.setTimeout(() => abort.abort(), 10000);
    try {
      const response = await fetch(`/api/session-notify/${path}`, {
        method, credentials: 'same-origin', cache: 'no-store', signal: abort.signal,
        ...(body === undefined ? {} : {
          headers: {'content-type': 'application/json'}, body: JSON.stringify(body)
        })
      });
      if (response.status === 404) {
        unavailable = true;
        stopHeartbeat();
      }
      return !disposed && response.ok ? response : null;
    } catch { return null; }
    finally { timers.clearTimeout(timeout); requests.delete(abort); }
  }
  function bridge(method, ...args) {
    try { native()?.[method]?.(...args); } catch { /* Optional Android bridge. */ }
  }
  function stopHeartbeat() {
    if (heartbeat !== undefined) timers.clearInterval(heartbeat);
    heartbeat = undefined;
  }
  async function drain() {
    if (sending) return;
    sending = true;
    try {
      while (pending && !disposed && !unavailable) {
        const value = pending;
        pending = undefined;
        await request('viewing', 'POST', value);
      }
    } finally { sending = false; }
  }
  function sync(force = false) {
    if (disposed) return;
    const visible = document.visibilityState === 'visible';
    const key = current.getSnapshot().key;
    const sessionId = visible && !panelInfo.getSnapshot().activePanelId && !obscured()
      ? key ?? null : null;
    const value = {sessionId, visible};
    const changed = !last || key !== lastKey || last.sessionId !== sessionId || last.visible !== visible;
    if (!changed && !force) return;
    last = value;
    lastKey = key;
    // Native state stays useful even when the optional HTTP plugin is absent.
    bridge('viewingSession', sessionId);
    if (!unavailable) { pending = value; void drain(); }
    stopHeartbeat();
    if (visible && sessionId && !unavailable) {
      heartbeat = timers.setInterval(() => sync(true), 45000);
    }
  }
  const onVisibility = () => sync(true);
  const unsubscribe = [current.subscribe(() => sync()), panelInfo.subscribe(() => sync())];
  document.addEventListener('visibilitychange', onVisibility);
  sync();
  return {
    sync,
    available: () => !unavailable,
    async settings(method = 'GET', patch) {
      const response = await request('settings', method, patch);
      if (!response) return null;
      try {
        const result = await response.json();
        const keys = ['enabled', 'notifyReplies', 'lockScreenContent'];
        if (disposed || result?.ok !== true || !keys.every(key => typeof result.value?.[key] === 'boolean')) return null;
        if (method === 'PUT') bridge('notifySettingsChanged');
        return Object.fromEntries(keys.map(key => [key, result.value[key]]));
      } catch { return null; }
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      stopHeartbeat();
      pending = undefined;
      unsubscribe.forEach(stop => stop());
      document.removeEventListener('visibilitychange', onVisibility);
      requests.forEach(abort => abort.abort());
      bridge('viewingSession', null);
    }
  };
}

export function openNotifiedSession(sessionId, {sessions, uiWorkspace, close}) {
  if (typeof sessionId !== 'string' || !sessionId.trim() || sessionId !== sessionId.trim()) return false;
  try {
    // The synchronous Android contract cannot wait for a catalog refresh.
    // Unknown/not-yet-loaded identities fail closed; never create a Session.
    const catalog = sessions.list.getSnapshot().byId;
    if (!Object.hasOwn(catalog, sessionId) || catalog[sessionId]?.id !== sessionId) return false;
    close();
    uiWorkspace.openSession(sessionId);
    return true;
  } catch { return false; }
}

export function createNotifySettingsView({jsx, useEffect, useState, Switch}, notify,
  onUnavailable = () => {}) {
  return function NotifySettings() {
    const [value, setValue] = useState(null);
    const [busy, setBusy] = useState(false);
    const [message, setMessage] = useState('');
    // Ref-like lifetime state also closes the rapid-double-click gap before render.
    const [lifetime] = useState(() => ({mounted: false, saving: false}));
    useEffect(() => {
      lifetime.mounted = true;
      let cancelled = false;
      void notify.settings().then(next => {
        if (cancelled) return;
        setValue(next);
        if (!next) onUnavailable();
      });
      return () => { cancelled = true; lifetime.mounted = false; };
    }, []);
    if (!value) return null;
    const change = async key => {
      if (lifetime.saving) return;
      lifetime.saving = true;
      setBusy(true); setMessage('');
      try {
        const next = await notify.settings('PUT', {[key]: !value[key]});
        if (!lifetime.mounted) return;
        if (next) { setValue(next); setMessage('已保存'); }
        else if (notify.available?.() === false) { setValue(null); onUnavailable(); }
        else setMessage('保存失败，请稍后再试');
      } finally {
        lifetime.saving = false;
        if (lifetime.mounted) setBusy(false);
      }
    };
    return jsx('section', {className: 'jarvis-b0-notify-settings', 'aria-label': '会话通知', children: [
      jsx('h2', {className: 'jarvis-b0-notify-title', children: '通知'}),
      ...[
        ['enabled', '开启会话通知', '接收会话相关通知'],
        ['notifyReplies', '回复完成时通知', '回复完成后发送通知'],
        ['lockScreenContent', '锁屏显示内容', '关闭后锁屏只显示“有新回复”']
      ].map(([key, label, description]) => jsx('div', {className: 'jarvis-b0-notify-row', children: [
        jsx('div', {children: [jsx('strong', {children: label}), jsx('small', {children: description})]}),
        jsx(Switch, {label, checked: value[key], disabled: busy, onChange: () => change(key)})
      ]}, key)),
      jsx('p', {role: 'status', className: 'jarvis-b0-notify-status', children: message})
    ]});
  };
}
