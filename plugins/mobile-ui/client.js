// Built by build-client.mjs for the fixed DSH 0.2.1-alpha.2 Client loader.
window.__ModuleLoader__.load({
  id: '@jarvis/b0-mobile-ui',
  factory: require => {
    const {jsx} = require('react/jsx-runtime');
    const {useEffect, useState} = require('react');
    const {Switch} = require('@deepseek-ai/dsh-client-ui-primitives');
    // Browser logic with injected official sources, HTTP and timers for offline tests.
function createSessionNotify({current, panelInfo, document, fetch, native,
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

function openNotifiedSession(sessionId, {sessions, uiWorkspace, close}) {
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

function createNotifySettingsView({jsx, useEffect, useState, Switch}, notify,
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

function createMainSessionPanel({jsx, useEffect, useState}, {fetch, timers, sessions, uiWorkspace}) {
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

function installMainSession(ctx, react, {fetch, timers}) {
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

    const CSS = "/* P0 additions: packaged selectors for DSH 0.2.1-alpha.2 (upgrade checklist).\n * YDXeBa_rowActions          workspace/session action container\n * YDXeBa_searchResultRow     sidebar search result (no data-row-key)\n * YDXeBa_time                session timestamp; reserve room for touch actions\n * Sixlwa_bubble              sent user message text\n * _markdown_1ypvv_5          official MarkdownText body (not file-type icon)\n * o3BgMG_inspectButton       generic tool inspection\n * CY-8Ka_inspectButton       terminal tool inspection\n * cvtE3a_inspect             Cordis tool inspection\n * gNWCoW_inspectButton       PTC tool inspection\n * iWrAna_inspectButton       skill tool inspection\n * _copySlot_1alm6_92         JSON copy action; parent also blocks pointer events\n * _shortcut_4ub78_198        menu shortcut wrapper, including keycap spacing\n * Only selectors added by P0 are listed; existing selectors are tracked in P1-6.\n */\n\n/* Controls do not offer text selection; this applies at every viewport width. */\nbutton,\n[role=\"button\"],\n[role=\"tab\"],\n[role=\"menuitem\"],\n[role=\"option\"],\n[data-row-key^=\"session:\"],\n[data-row-key^=\"workspace:\"],\n.YDXeBa_searchResultRow,\n.jarvis-b0-settings-row {\n  -webkit-user-select: none;\n  user-select: none;\n  -webkit-touch-callout: none;\n}\n\n/* Explicitly restore text/callout even inside a non-selectable control or row.\n * Do not apply to all message descendants: their own buttons stay controls. */\ninput,\ntextarea,\n[contenteditable],\n.Sixlwa_bubble,\n._markdown_1ypvv_5,\npre,\ncode {\n  -webkit-user-select: text;\n  user-select: text;\n  -webkit-touch-callout: default;\n}\n\n@media (hover: none) {\n  [data-row-key^=\"session:\"] .YDXeBa_rowActions,\n  [data-row-key^=\"workspace:\"] .YDXeBa_rowActions {\n    display: inline-flex !important;\n  }\n  /* The menu retains pin/archive actions; don't add two more inline targets.\n   * In alpha.2 the menu trigger sits in a span and archive/pin in a sibling div. */\n  [data-row-key^=\"session:\"] .YDXeBa_rowActions > div > button {\n    display: none !important;\n  }\n  [data-row-key^=\"session:\"] .YDXeBa_rowActions button[aria-label$=\"的操作\"],\n  [data-row-key^=\"session:\"] .YDXeBa_rowActions button[aria-haspopup=\"menu\"],\n  [data-row-key^=\"workspace:\"] .YDXeBa_rowActions button[aria-label$=\"的操作\"],\n  [data-row-key^=\"workspace:\"] .YDXeBa_rowActions button[aria-haspopup=\"menu\"],\n  [data-row-key^=\"workspace:\"] .YDXeBa_rowActions > div > button {\n    display: inline-flex !important;\n  }\n  [data-row-key^=\"session:\"] .YDXeBa_time { display: none !important; }\n  .o3BgMG_inspectButton,\n  .CY-8Ka_inspectButton,\n  .cvtE3a_inspect,\n  .gNWCoW_inspectButton,\n  .iWrAna_inspectButton,\n  ._copySlot_1alm6_92 {\n    opacity: 1 !important;\n    pointer-events: auto !important;\n  }\n  [role=\"menu\"] ._shortcut_4ub78_198,\n  [role=\"menu\"] kbd { display: none !important; }\n  [role=\"menu\"] [role=\"menuitem\"],\n  [role=\"menu\"] [role=\"menuitemcheckbox\"],\n  [role=\"menu\"] [role=\"menuitemradio\"] {\n    box-sizing: border-box;\n    min-height: 44px !important;\n  }\n}\n\n/* Notification controls use the exported official DSH Switch, including its theme CSS. */\n.jarvis-b0-notify-settings { color: var(--dsw-alias-label-primary); min-width: 0; }\n.jarvis-b0-notify-title { margin: 0 0 20px; font-size: 18px; font-weight: 600; }\n.jarvis-b0-notify-row { box-sizing: border-box; display: flex; align-items: center; justify-content: space-between; gap: 12px; min-height: 66px; padding: 10px 14px; margin-bottom: 10px; border: .5px solid var(--dsw-alias-border-l3); border-radius: 12px; background: var(--dsw-alias-bg-layer-1); }\n.jarvis-b0-notify-row > div { min-width: 0; display: flex; flex-direction: column; gap: 4px; }\n.jarvis-b0-notify-row strong { font-size: 15px; font-weight: 500; }\n.jarvis-b0-notify-row small { color: var(--dsw-alias-label-secondary); font-size: 12px; overflow-wrap: anywhere; }\n.jarvis-b0-notify-status { min-height: 18px; font-size: 12px; color: var(--dsw-alias-label-secondary); }\n.jarvis-b0-settings-row[hidden] { display: none !important; }\n@media (max-width: 700px) {\n  .VOzbGW_panel[data-jarvis-settings-view=\"detail\"] .jarvis-b0-notify-title { display: none; }\n  .pI_x6G_frame { grid-template-columns: 0px minmax(0, 1fr) 0px !important; transition: none !important; }\n  .pI_x6G_frame > .pI_x6G_handle { display: none !important; }\n  .pI_x6G_frame > .pI_x6G_sidebarCol { box-sizing: border-box; width: min(288px, calc(100% - 48px)); position: absolute; inset: 0 auto 0 0; z-index: 21; box-shadow: 6px 0 24px #0003; }\n  .pI_x6G_frame > .pI_x6G_sidebarCol > .hHd-Xa_root { width: 100% !important; }\n  .pI_x6G_frame > .pI_x6G_centerCol { grid-column: 2 !important; min-width: 0; }\n  .pI_x6G_frame[data-sidebar-collapsed] > .pI_x6G_sidebarCol { display: none !important; }\n  .jarvis-b0-mobile-backdrop { border: 0; background: #0005; cursor: pointer; position: absolute; inset: 0; z-index: 20; }\n  [data-shell-overlay] { pointer-events: none; }\n  [data-shell-overlay] > * { pointer-events: auto; }\n  .jarvis-b0-mobile-open { border: 0; background: none; color: var(--dsw-alias-label-primary); min-width: 44px; min-height: 44px; padding: 0; font-size: 22px; line-height: 1; display: inline-flex; align-items: center; justify-content: center; }\n  .wSkVaW_header { padding: 8px 16px 0 !important; border-bottom: .5px solid var(--dsw-alias-border-l3); }\n  .wSkVaW_headerLeading { align-self: center; }\n  .wSkVaW_titleRow { min-width: 0; }\n  .wSkVaW_tabs { gap: 32px; margin-top: 8px; padding-left: 4px; }\n  .wSkVaW_headerActions .SVAs4q_label { display: none !important; }\n  [data-composer-stats] { box-sizing: border-box; min-width: 0; width: 100%; min-height: 44px; flex-wrap: wrap !important; justify-content: flex-start !important; align-content: center; gap: 0 12px !important; }\n  [data-composer-stats] .bOPqQW_anchor { max-width: 100%; flex: 0 1 auto; }\n  [data-composer-stats] .bOPqQW_pill { background: none !important; border-radius: 0 !important; white-space: normal !important; text-align: left; min-height: 36px; padding: 3px 4px !important; }\n  [data-composer-stats] .bOPqQW_label { overflow: visible !important; text-overflow: clip !important; white-space: normal !important; overflow-wrap: anywhere; }\n  .VOzbGW_overlay { align-items: stretch; }\n  .VOzbGW_panel { box-sizing: border-box; width: 100vw !important; max-width: 100vw !important; height: 100dvh !important; max-height: 100dvh !important; border-radius: 0 !important; flex-direction: column !important; }\n  .VOzbGW_nav { width: 100% !important; padding: 16px 16px 4px !important; gap: 8px !important; }\n  .VOzbGW_navTitle { padding: 0 4px !important; }\n  .VOzbGW_navList { flex-direction: row !important; flex: none; overflow-x: auto; overflow-y: hidden; }\n  .VOzbGW_navCell { flex: none; min-width: 44px; min-height: 44px; }\n  .VOzbGW_content { flex: 1; min-height: 0; }\n  .VOzbGW_header { height: 40px; padding: 4px 16px !important; }\n  .VOzbGW_nav { padding-top: 14px !important; }\n  .VOzbGW_header { position: absolute; top: 8px; right: 12px; z-index: 2; box-sizing: border-box; width: calc(100% - 128px); height: 44px; padding: 0 !important; justify-content: flex-end !important; }\n  .VOzbGW_close { flex: none !important; min-width: 44px !important; width: 44px !important; height: 44px !important; }\n  .VOzbGW_options { padding: 8px 16px 24px !important; }\n  .VOzbGW_panel[data-jarvis-settings-view=\"root\"] .VOzbGW_nav,\n  .VOzbGW_panel[data-jarvis-settings-view=\"root\"] .VOzbGW_options,\n  .VOzbGW_panel[data-jarvis-settings-view=\"root\"] .VOzbGW_actions { display: none !important; }\n  .VOzbGW_panel[data-jarvis-settings-view=\"root\"] .VOzbGW_header button:not(.VOzbGW_close) { display: none !important; }\n  .jarvis-b0-settings-root { box-sizing: border-box; position: absolute; inset: 0; z-index: 1; overflow-y: auto; background: var(--dsw-alias-bg-layer-2); padding: 12px 16px 32px; }\n  .jarvis-b0-settings-root h1 { box-sizing: border-box; position: sticky; top: -12px; z-index: 1; margin: -12px -16px 22px; min-height: 64px; padding: 12px 72px 0 20px; display: flex; align-items: center; background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); font-size: 18px; font-weight: 600; }\n  .jarvis-b0-settings-root h2 { margin: 20px 4px 12px; color: var(--dsw-alias-label-secondary); font-size: 13px; font-weight: 500; }\n  .jarvis-b0-settings-row { box-sizing: border-box; width: 100%; min-height: 66px; margin-bottom: 10px; padding: 10px 14px; display: flex; align-items: center; justify-content: space-between; gap: 12px; border: .5px solid var(--dsw-alias-border-l3); border-radius: 12px; background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary); font: inherit; text-align: left; cursor: pointer; }\n  .jarvis-b0-settings-row > span:first-child { display: flex; flex-direction: column; gap: 2px; min-width: 0; }\n  .jarvis-b0-settings-row strong { font-size: 15px; font-weight: 500; }\n  .jarvis-b0-settings-row small { color: var(--dsw-alias-label-secondary); font-size: 11px; }\n  .jarvis-b0-settings-row > span:last-child { color: var(--dsw-alias-label-secondary); font-size: 24px; }\n  .jarvis-b0-settings-notice { color: var(--dsw-alias-state-error-primary); font-size: 12px; }\n  .VOzbGW_panel[data-jarvis-settings-view=\"detail\"] .jarvis-b0-settings-root,\n  .VOzbGW_panel[data-jarvis-settings-view=\"detail\"] .VOzbGW_nav { display: none !important; }\n  .VOzbGW_panel[data-jarvis-settings-view=\"detail\"] .VOzbGW_header { top: 10px; right: 12px; z-index: 4; width: auto; }\n  .VOzbGW_panel[data-jarvis-settings-view=\"detail\"] .VOzbGW_close { display: none !important; }\n  .VOzbGW_panel[data-jarvis-settings-view=\"detail\"] .VOzbGW_content { box-sizing: border-box; padding-top: 64px; }\n  .jarvis-b0-settings-detail-header { box-sizing: border-box; position: absolute; top: 0; left: 0; right: 0; z-index: 3; min-height: 64px; padding: 0 72px 0 16px; display: flex; align-items: center; gap: 12px; border-bottom: .5px solid var(--dsw-alias-border-l3); background: var(--dsw-alias-bg-layer-2); }\n  .jarvis-b0-settings-detail-header h1 { min-width: 0; margin: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--dsw-alias-label-primary); font-size: 18px; font-weight: 600; }\n  .jarvis-b0-settings-detail-back { flex: none; box-sizing: border-box; min-height: 44px; padding: 0 8px 0 0; border: 0; background: none; color: var(--dsw-alias-label-primary); font: inherit; font-size: 15px; cursor: pointer; }\n  .VOzbGW_panel[data-jarvis-settings-view=\"root\"] .jarvis-b0-settings-detail-header { display: none; }\n  .Pt1bsG_row { align-items: flex-start !important; flex-direction: column !important; gap: 8px !important; }\n  [data-sidebar-right-panel][data-sidebar-right-open] { position: fixed !important; inset: 0 !important; width: 100vw !important; max-width: 100vw !important; z-index: 30 !important; }\n  [data-sidebar-right-panel][data-sidebar-right-open] [data-sidebar-right-mode],\n  [data-sidebar-right-panel][data-sidebar-right-open] [data-dockkit-split-button] { display: none !important; }\n  [data-sidebar-right-panel][data-sidebar-right-open] [data-sidebar-right-toggle] { width: 44px !important; height: 44px !important; }\n  [data-sidebar-right-panel][data-sidebar-right-open] [data-sidebar-right-toggle] svg { display: none; }\n  [data-sidebar-right-panel][data-sidebar-right-open] [data-sidebar-right-toggle]::before { content: '×'; font-size: 28px; line-height: 1; font-weight: 300; }\n  [data-sidebar-right-guide] { min-height: 0 !important; justify-content: flex-start !important; align-items: stretch !important; gap: 12px !important; padding: 24px 20px !important; }\n  [data-sidebar-right-guide]::before { content: '会话工作区'; color: var(--dsw-alias-label-secondary); font-size: 13px; line-height: 20px; }\n  [data-sidebar-right-guide] .geFEbW_hero { display: none !important; }\n  [data-sidebar-right-guide] .geFEbW_entry span:has(> kbd),\n  [data-sidebar-right-guide] .zjup-W_trigger,\n  [data-sidebar-right-guide] .zjup-W_shortcut { display: none !important; }\n  [data-jarvis-guide-tab] { pointer-events: none; }\n  [data-jarvis-guide-tab] .geFEbW_titleIcon { display: none; }\n  [data-jarvis-guide-tab] [data-dockkit-tab-title] { font-size: 0; }\n  [data-jarvis-guide-tab] [data-dockkit-tab-title]::after { content: 'DSH Guide'; color: var(--dsw-alias-label-primary); font-size: 21px; font-weight: 600; }\n  [data-sidebar-right-guide] .geFEbW_entryCell { width: 100% !important; }\n  [data-sidebar-right-guide] .geFEbW_entry { width: 100% !important; min-height: 82px !important; padding: 14px 16px !important; border-radius: 16px !important; }\n  [data-plugin-panel] { position: relative; z-index: 1; background: var(--dsw-alias-bg-layer-2); }\n  [data-plugin-panel].X_2TxG_page { padding: 0 20px 48px !important; }\n  [data-plugin-panel] .X_2TxG_pageHead { box-sizing: border-box; position: relative; height: 128px; align-items: flex-start; gap: 8px; padding: 18px 0 0 !important; }\n  [data-plugin-panel] .X_2TxG_pageIntro { position: absolute; top: 86px; left: 4px; white-space: nowrap; }\n  [data-plugin-panel] .X_2TxG_pageHead > div:first-of-type { flex: 1; min-width: 0; }\n  [data-plugin-panel] .X_2TxG_toolbar { gap: 8px; }\n  [data-plugin-panel] .X_2TxG_addButton { min-width: 104px; white-space: nowrap; }\n  .jarvis-b0-plugin-back { flex: none; width: 44px; height: 44px; padding: 0 0 0 4px; border: 0; background: none; color: var(--dsw-alias-label-primary); font: inherit; font-size: 32px; line-height: 1; text-align: left; cursor: pointer; }\n  [data-plugin-panel] .X_2TxG_crumb { min-width: 44px; min-height: 44px; }\n}\n@media (min-width: 701px) {\n  .jarvis-b0-mobile-open, .jarvis-b0-mobile-backdrop, .jarvis-b0-plugin-back, .jarvis-b0-settings-root, .jarvis-b0-settings-detail-header { display: none !important; }\n}\n";
    const narrow = () => window.matchMedia('(max-width: 700px)').matches;
    const frame = () => document.querySelector('.pI_x6G_frame');
    const drawerOpen = () => narrow() && !!frame() && !frame().hasAttribute('data-sidebar-collapsed');
    const visible = node => !!node && !!node.getClientRects().length &&
      !node.closest('[hidden], [aria-hidden="true"]') && getComputedStyle(node).visibility !== 'hidden';
    const rightbarOpen = () => [...document.querySelectorAll('[data-sidebar-right-panel][data-sidebar-right-open]')]
      .find(visible);

    function apply(ctx) {
      const style = document.createElement('style');
      style.dataset.jarvisB0Mobile = '0.1.13-main-session';
      style.textContent = CSS;
      document.head.append(style);
      ctx.effect(() => () => style.remove());

      const closeDrawer = () => {
        if (!drawerOpen()) return false;
        ctx.layout.toggleSidebar();
        return true;
      };
      const openDrawer = () => {
        if (!narrow() || !frame() || drawerOpen()) return false;
        ctx.layout.toggleSidebar();
        return true;
      };
      const pluginPanel = () => document.querySelector('[data-plugin-panel]');
      const pluginDetailBack = () => pluginPanel()?.querySelector('.X_2TxG_detailTop .X_2TxG_crumb');
      const rows = [
        ['servers', '服务器'],
        ['connection', '连接状态与文件'],
        ['account', '账号与安全']
      ];
      const showSettingsRoot = panel => {
        const root = panel.querySelector('.jarvis-b0-settings-root');
        if (!root) return false;
        panel.dataset.jarvisSettingsView = 'root';
        delete panel.dataset.jarvisSettingsDetail;
        root.scrollTop = Number(root.dataset.savedScroll || 0);
        root.querySelector('[data-jarvis-settings-return]')?.focus({preventScroll:true});
        return true;
      };
      const dialogs = () => [...document.querySelectorAll('[role="dialog"][aria-modal="true"]')].filter(visible);
      const dismissDialog = (dialog, returnToRoot = true) => {
        if (!dialog) return false;
        if (returnToRoot && narrow() && dialog.classList.contains('VOzbGW_panel') && dialog.dataset.jarvisSettingsView === 'detail') {
          return showSettingsRoot(dialog);
        }
        const close = dialog.querySelector('.VOzbGW_close, .X_2TxG_wizardClose, button[aria-label="关闭"], button[aria-label="Close"]');
        if (close && !close.disabled) close.click();
        else dialog.dispatchEvent(new KeyboardEvent('keydown', {key:'Escape', bubbles:true, cancelable:true}));
        return true;
      };
      const closeTopDialog = () => dismissDialog(dialogs().at(-1));
      // DSH's foreground layers follow document order. Non-modal dialogs include
      // the schedule date/time pickers; native popovers need no packaged class.
      const popups = () => [...document.querySelectorAll(
        '[role="menu"], [role="listbox"], [popover], [role="dialog"]'
      )].filter(node => visible(node) && node.getAttribute('aria-modal') !== 'true');
      const popupTrigger = popup => {
        const triggers = [...document.querySelectorAll(
          '[aria-controls], [aria-expanded="true"], [popovertarget]'
        )].filter(node => visible(node) && !node.disabled);
        // Portaled surfaces use aria-controls; nested listboxes may belong to
        // a parent surface. Do not toggle an unrelated expanded control.
        for (let surface = popup; surface && surface !== document.body; surface = surface.parentElement) {
          const id = surface.getAttribute('id');
          const linked = id && triggers.find(node =>
            (node.getAttribute('aria-controls') || '').split(/\s+/).includes(id) ||
            node.getAttribute('popovertarget') === id);
          if (linked) return linked;
          const sibling = triggers.find(node => node.parentElement === surface.parentElement &&
            node.getAttribute('aria-expanded') === 'true');
          if (sibling && surface.parentElement !== document.body) return sibling;
        }
        return null;
      };
      // A surface that Back already tried to close and is still shown is treated as
      // resident page content, so it cannot trap Back. Any tap may reopen a surface.
      const attempted = new Set();
      const clearAttempts = () => attempted.clear();
      document.addEventListener('pointerdown', clearAttempts, true);
      ctx.effect(() => () => document.removeEventListener('pointerdown', clearAttempts, true));
      const closeTopPopup = () => {
        const popup = popups().filter(node => !attempted.has(node)).at(-1);
        if (!popup) return false;
        attempted.add(popup);
        const trigger = popupTrigger(popup);
        const event = new KeyboardEvent('keydown', {key:'Escape', bubbles:true, cancelable:true});
        popup.dispatchEvent(event);
        // React may commit the Escape update after dispatch. A handled Escape
        // must never be followed by a toggle that reopens the same surface.
        if (!event.defaultPrevented) queueMicrotask(() => {
          if (popups().at(-1) !== popup) return;
          if (trigger && visible(trigger) && !trigger.disabled &&
              trigger.getAttribute('aria-expanded') !== 'false') trigger.click();
          else if (popup.hasAttribute('popover')) popup.hidePopover?.();
        });
        return true;
      };
      const back = () => {
        if (closeTopPopup()) return true;
        if (closeTopDialog()) return true;
        // Close the overlay before handling any panel it covers.
        if (closeDrawer()) return true;
        const activePanelId = ctx.layout.panelInfo.getSnapshot().activePanelId;
        if (activePanelId === 'jarvis-life' && window.__JARVIS_B0_LIFE__?.back() === true) return true;
        if (activePanelId === 'plugins') {
          const crumb = pluginDetailBack();
          if (crumb) { crumb.click(); return true; }
        }
        if (activePanelId === 'schedules') {
          // alpha.2 owns detail/edit state, picker Escape handlers and close controls.
          const schedule = document.querySelector('[data-testid="task-manager-page"]');
          if (schedule?.classList.contains('t-XoWW_hasDetails')) {
            schedule.dispatchEvent(new KeyboardEvent('keydown', {key:'Escape', bubbles:true, cancelable:true}));
            return true;
          }
        }
        if (activePanelId) { ctx.layout.selectPanel(null); return true; }
        // Global panels hide the current Conversation's retained rightbar.
        const panel = rightbarOpen();
        if (panel) {
          panel.querySelector('[data-sidebar-right-toggle]')?.click();
          return true;
        }
        return false;
      };
      const openSession = sessionId => openNotifiedSession(sessionId, {
        sessions: ctx.sessions, uiWorkspace: ctx.uiWorkspace,
        close: () => {
          // React may remove a dismissed layer on the next render: visit each once.
          for (const dialog of dialogs().reverse()) dismissDialog(dialog, false);
          closeDrawer();
          for (const menu of [...document.querySelectorAll('[role="menu"]')].filter(visible)) {
            menu.dispatchEvent(new KeyboardEvent('keydown', {key:'Escape', bubbles:true, cancelable:true}));
          }
          for (const panel of document.querySelectorAll('[data-sidebar-right-panel][data-sidebar-right-open]')) {
            panel.querySelector('[data-sidebar-right-toggle]')?.click();
          }
          ctx.layout.selectPanel(null);
        }
      });
      const bridge = Object.freeze({back, openSession});
      window.__JARVIS_B0_MOBILE__ = bridge;
      ctx.effect(() => () => {
        if (window.__JARVIS_B0_MOBILE__ === bridge) delete window.__JARVIS_B0_MOBILE__;
      });

      // Real applies require these services; optional guards keep legacy DOM smokes usable.
      const notify = ctx.uiSession && ctx.sessions && ctx.uiWorkspace ? createSessionNotify({
        current: ctx.uiSession.adapter.current, panelInfo: ctx.layout.panelInfo,
        document, fetch: (...args) => window.fetch(...args), native: () => window.JarvisB0Native,
        timers: window, obscured: () => dialogs().length > 0
      }) : null;
      let notifySettingsReady = false;
      if (notify) {
        ctx.effect(() => () => notify.dispose());
        ctx.effect(() => ctx.slots.inject('settings.section', () => {
          let active = true, unregister;
          const hide = () => {
            notifySettingsReady = false;
            const panel = document.querySelector('.VOzbGW_panel');
            if (panel?.dataset.jarvisSettingsDetail === 'notify') {
              showSettingsRoot(panel);
              panel.querySelector('.jarvis-b0-settings-root [data-jarvis-settings-section="jarvis"]')?.focus({preventScroll:true});
            }
            unregister?.();
            unregister = undefined;
            syncSettingsRoot();
          };
          const NotifySettings = createNotifySettingsView({jsx, useEffect, useState, Switch}, notify, hide);
          // Register the official nav entry only after a valid settings response.
          void notify.settings().then(value => {
            if (!active || !value) return;
            notifySettingsReady = true;
            unregister = ctx.slots.register({
              name: 'settings.section', id: 'jarvis-session-notify', order: 100, label: '通知'
            }, NotifySettings);
            syncSettingsRoot();
          });
          return () => { active = false; hide(); };
        }));
      }

      if (ctx.sessions && ctx.uiWorkspace) {
        installMainSession(ctx, {jsx, useEffect, useState}, {
          fetch: (...args) => window.fetch(...args), timers: window
        });
      }

      const onSession = event => {
        if (!drawerOpen() || !event.target.closest) return;
        if (frame()?.querySelector('.pI_x6G_sidebarCol')?.contains(event.target) &&
            event.target.closest('.hHd-Xa_settingsArea button')) {
          queueMicrotask(closeDrawer);
          return;
        }
        if (frame()?.querySelector('.pI_x6G_sidebarCol')?.contains(event.target) && event.target.closest('button.hHd-Xa_panelRow')) {
          queueMicrotask(() => {
            if (ctx.layout.panelInfo.getSnapshot().activePanelId) closeDrawer();
          });
          return;
        }
        const item = event.target.closest('[data-row-key^="session:"], .YDXeBa_searchResultRow:not(.YDXeBa_archived)');
        if (item && !event.target.closest('button')) queueMicrotask(closeDrawer);
      };
      document.addEventListener('click', onSession);
      ctx.effect(() => () => document.removeEventListener('click', onSession));

      // The official manager owns detail state. Add only a list-level exit;
      // detail Back keeps using its native crumb action.
      const syncPluginBack = () => {
        const headers = [pluginPanel()?.querySelector('.X_2TxG_pageHead'),
          document.querySelector('[data-testid="task-manager-page"] .t-XoWW_pageHeading')];
        for (const header of headers) {
          if (!header || header.querySelector('.jarvis-b0-plugin-back')) continue;
          const button = document.createElement('button');
          button.type = 'button';
          button.className = 'jarvis-b0-plugin-back';
          button.setAttribute('aria-label', '返回会话');
          button.textContent = '‹';
          button.addEventListener('click', back);
          header.prepend(button);
        }
      };
      const guideOriginal = new WeakMap();
      const syncGuideTitle = () => {
        for (const panel of document.querySelectorAll('[data-sidebar-right-panel]')) {
          const active = panel.querySelector('[data-dockkit-tab][aria-selected="true"]');
          const marked = panel.querySelector('[data-jarvis-guide-tab]');
          if (marked && (!narrow() || marked !== active || !panel.querySelector('[data-sidebar-right-guide]'))) {
            marked.removeAttribute('data-jarvis-guide-tab');
            const original = guideOriginal.get(marked);
            if (original?.label === null) marked.removeAttribute('aria-label');
            else if (original) marked.setAttribute('aria-label', original.label);
            if (original?.disabled === null) marked.removeAttribute('aria-disabled');
            else if (original) marked.setAttribute('aria-disabled', original.disabled);
            marked.tabIndex = marked.getAttribute('aria-selected') === 'true' ? 0 : -1;
            guideOriginal.delete(marked);
          }
          if (!narrow() || !active || !panel.querySelector('[data-sidebar-right-guide]')) continue;
          if (!guideOriginal.has(active)) guideOriginal.set(active, {
            label: active.getAttribute('aria-label'), disabled: active.getAttribute('aria-disabled')
          });
          active.setAttribute('data-jarvis-guide-tab', '');
          active.setAttribute('aria-label', 'DSH Guide');
          active.setAttribute('aria-disabled', 'true');
          active.tabIndex = -1;
        }
      };
      const syncSettingsRoot = () => {
        const panel = document.querySelector('.VOzbGW_panel');
        if (!panel) return;
        const notifyNative = () => [...panel.querySelectorAll('.VOzbGW_navCell')]
          .find(cell => cell.textContent.trim() === '通知');
        const existing = panel.querySelector('.jarvis-b0-settings-root');
        if (existing) {
          const entry = existing.querySelector('[data-jarvis-settings-section="notify"]');
          const hidden = !notifySettingsReady || !notifyNative();
          if (entry && entry.hidden !== hidden) entry.hidden = hidden;
          return;
        }
        if (!narrow()) return;
        const nativeCells = [...panel.querySelectorAll('.VOzbGW_navCell')].slice(0, 4);
        const categories = [
          {match:/通用|General/i,label:'通用',description:'DSH 外观与基础选项'},
          {match:/模型|Models/i,label:'模型',description:'模型与提供方'},
          {match:/内置插件|Built-in/i,label:'内置插件',description:'工具开关'},
          {match:/预设|presets/i,label:'Agent 预设',description:'标准、PTC、极简、创造'}
        ];
        if(nativeCells.length!==categories.length ||
          !nativeCells.every((cell,index)=>categories[index].match.test(cell.textContent)))return;
        const root = document.createElement('div');
        root.className = 'jarvis-b0-settings-root';
        const title = document.createElement('h1');
        title.textContent = '设置';
        root.append(title);
        const detailHeader = document.createElement('div');
        detailHeader.className = 'jarvis-b0-settings-detail-header';
        const backButton = document.createElement('button');
        backButton.type = 'button'; backButton.className = 'jarvis-b0-settings-detail-back';
        backButton.setAttribute('aria-label', '返回设置');
        backButton.textContent = `‹ ${title.textContent}`;
        backButton.addEventListener('click', back);
        const detailTitle = document.createElement('h1');
        detailHeader.append(backButton, detailTitle);
        const group = (heading) => {
          const label = document.createElement('h2'); label.textContent = heading; root.append(label);
        };
        const row = (section, label, description, action) => {
          const button = document.createElement('button');
          button.type = 'button'; button.className = 'jarvis-b0-settings-row';
          button.dataset.jarvisSettingsSection = section;
          const main = document.createElement('span');
          const name = document.createElement('strong'); name.textContent = label;
          main.append(name);
          if (description) {
            const hint = document.createElement('small'); hint.textContent = description;
            main.append(hint);
          }
          const arrow = document.createElement('span'); arrow.textContent = '›'; arrow.setAttribute('aria-hidden', 'true');
          button.append(main, arrow); button.addEventListener('click', action); root.append(button);
          return button;
        };
        const openDetail = (selected, label, native, section) => {
          if (!native) return;
          root.dataset.savedScroll = String(root.scrollTop);
          root.querySelectorAll('[data-jarvis-settings-return]').forEach(node=>node.removeAttribute('data-jarvis-settings-return'));
          selected.setAttribute('data-jarvis-settings-return', '');
          detailTitle.textContent = label;
          native.click();
          panel.dataset.jarvisSettingsDetail = section;
          panel.dataset.jarvisSettingsView = 'detail';
          backButton.focus({preventScroll:true});
        };
        group('Jarvis');
        const jarvisHints = ['选择或编辑服务器', '查看在线状态和文件反馈', '当前账号与修改密码'];
        rows.forEach(([code, label], index) => row('jarvis', label, jarvisHints[index], () => {
          const channel = window.JarvisB0Settings;
          const notice = root.querySelector('.jarvis-b0-settings-notice');
          if (channel && typeof channel.postMessage === 'function') {
            notice.textContent = '';
            channel.postMessage(code);
          } else {
            notice.textContent = '当前客户端无法打开原生设置';
            notice.scrollIntoView({block: 'nearest'});
          }
        }));
        const notifyEntry = row('notify', '通知', '会话通知与锁屏显示', () => {
          if (notifySettingsReady) openDetail(notifyEntry, '通知', notifyNative(), 'notify');
        });
        notifyEntry.hidden = !notifySettingsReady || !notifyNative();
        const notice = document.createElement('p');
        notice.className = 'jarvis-b0-settings-notice'; notice.setAttribute('role', 'status'); root.append(notice);
        group('DSH');
        nativeCells.forEach((native,index) => {
          const {label,description}=categories[index];
          const entry = row('dsh', label, description, () => openDetail(entry, label, native, 'dsh'));
        });
        panel.querySelector('.VOzbGW_close')?.addEventListener('click', () => {
          panel.dataset.jarvisSettingsView = 'root';
          root.scrollTop = 0;
          root.dataset.savedScroll = '0';
        });
        panel.append(root, detailHeader);
        panel.dataset.jarvisSettingsView = 'root';
      };
      const pluginObserver = new MutationObserver(() => {
        syncPluginBack(); syncGuideTitle(); syncSettingsRoot(); notify?.sync();
      });
      pluginObserver.observe(document.body, {subtree: true, childList: true, attributes: true,
        attributeFilter: ['aria-selected', 'hidden', 'aria-hidden']});
      const guideMedia = window.matchMedia('(max-width: 700px)');
      const syncMedia = () => { syncGuideTitle(); syncSettingsRoot(); };
      guideMedia.addEventListener('change', syncMedia);
      syncPluginBack();
      syncGuideTitle();
      syncSettingsRoot();
      ctx.effect(() => () => {
        pluginObserver.disconnect();
        guideMedia.removeEventListener('change', syncMedia);
        document.querySelectorAll('.jarvis-b0-settings-root, .jarvis-b0-settings-detail-header').forEach(node => node.remove());
        document.querySelectorAll('.VOzbGW_panel').forEach(panel => {
          delete panel.dataset.jarvisSettingsView;
          delete panel.dataset.jarvisSettingsDetail;
        });
        document.querySelectorAll('.jarvis-b0-plugin-back').forEach(button => button.remove());
      });

      function OpenButton() {
        return jsx('button', {
          type: 'button', className: 'jarvis-b0-mobile-open',
          'aria-label': '打开会话侧栏', title: '打开会话侧栏',
          onClick: openDrawer, children: '☰'
        });
      }
      function Backdrop() {
        const [shown, setShown] = useState(drawerOpen);
        useEffect(() => {
          const root = frame();
          const update = () => setShown(drawerOpen());
          const media = window.matchMedia('(max-width: 700px)');
          const observer = new MutationObserver(update);
          if (root) observer.observe(root, {attributes: true, attributeFilter: ['data-sidebar-collapsed']});
          media.addEventListener('change', update);
          update();
          return () => { observer.disconnect(); media.removeEventListener('change', update); };
        }, []);
        return shown ? jsx('button', {
          type: 'button', className: 'jarvis-b0-mobile-backdrop',
          'aria-label': '关闭会话侧栏', onClick: closeDrawer
        }) : null;
      }
      ctx.effect(() => ctx.slots.inject('conversation.header.leading', () => ctx.slots.register({
        name: 'conversation.header.leading', id: 'jarvis-b0-mobile-open', order: -100
      }, OpenButton)));
      ctx.effect(() => ctx.slots.inject('shell.overlay', () => ctx.slots.register({
        name: 'shell.overlay', id: 'jarvis-b0-mobile-backdrop', order: 10
      }, Backdrop)));
    }
    return {inject: ['slots', 'layout', 'sessions', 'uiSession', 'uiWorkspace'], apply};
  }
});
