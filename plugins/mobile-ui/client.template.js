// Built by build-client.mjs for the fixed DSH 0.2.1-alpha.2 Client loader.
window.__ModuleLoader__.load({
  id: '@jarvis/b0-mobile-ui',
  factory: require => {
    const {jsx} = require('react/jsx-runtime');
    const {useEffect, useState} = require('react');
    const {Switch} = require('@deepseek-ai/dsh-client-ui-primitives');
    __JARVIS_SESSION_NOTIFY__
    __JARVIS_MAIN_SESSION__
    const CSS = __JARVIS_MOBILE_CSS__;
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
