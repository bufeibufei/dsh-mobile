// DSH alpha.2's official button focuses Lexical on mousedown AND click. Keep
// its menu, candidates and draft-span CAS, but separate mobile chrome from IME.
export function mountComposerMenu({document, narrow, current, input, panelInfo, imeVisible = () => undefined}) {
  let pointer = null;
  const session = () => {
    if (!narrow() || panelInfo?.getSnapshot().activePanelId) return null;
    const id = current?.getSnapshot().key;
    const shell = id && input?.shell?.(id), controller = id && input?.inputTriggers?.(id);
    return shell && controller ? {id, shell, controller} : null;
  };
  const open = value => value?.controller.launcher.getSnapshot() === 'command';
  const trigger = event => event?.target?.closest?.('button.uV2eYG_add[aria-haspopup="listbox"]');
  const close = () => {
    const value = session();
    if (!open(value)) return false;
    value.controller.dismiss();
    return true;
  };
  const down = event => {
    const button = trigger(event), value = session();
    if (button && !button.disabled && value) {
      pointer = {id: value.id, button, wasOpen: open(value), selection: value.shell.caretSpan()};
      event.preventDefault(); event.stopImmediatePropagation();
      // A hidden Android IME still leaves Lexical focused. Move only the hidden
      // keyboard's focus to this control; preserve an already visible IME.
      if (imeVisible() === false) button.focus?.({preventScroll: true});
    } else {
      pointer = null;
      if (!event?.target?.closest?.('[role="listbox"]')) close();
    }
  };
  const mouse = event => {
    if (trigger(event) && session()) {event.preventDefault(); event.stopImmediatePropagation();}
  };
  const click = event => {
    const button = trigger(event), value = session();
    if (!button || button.disabled || !value) return;
    event.preventDefault(); event.stopImmediatePropagation();
    const captured = pointer?.button === button && pointer.id === value.id ? pointer : null;
    const closing = captured ? captured.wasOpen : open(value);
    pointer = null;
    if (closing) {value.controller.dismiss(); return;}
    const {shell, controller} = value, selection = captured?.selection ?? shell.caretSpan(), snapshot = shell.snapshot;
    shell.dismissPopup();
    controller.toggleSource('command', {trigger: '/', query: '', quoted: false,
      position: snapshot.draft.slice(0, selection.start).trim() === '' ? 'leading' : 'inline',
      span: {...selection, draftRev: snapshot.draftRev}});
  };
  // Android WebView can reopen IME for the still-focused editable on a native
  // tap even without a DOM focus call. Cancel the touch default as well; then
  // settle this touch ourselves because its compatibility click is suppressed.
  const touchStart = event => {
    if (trigger(event) && session() && !trigger(event).disabled) {
      if (!pointer) down(event);
      else { event.preventDefault(); event.stopImmediatePropagation(); }
    }
  };
  const touchEnd = event => { if (pointer && trigger(event)) click(event); };
  const touchCancel = () => { pointer = null; };
  const listeners = {pointerdown: down, mousedown: mouse, click,
    touchstart: touchStart, touchend: touchEnd, touchcancel: touchCancel};
  const options = {capture: true, passive: false};
  for (const [name, callback] of Object.entries(listeners)) document.addEventListener(name, callback, options);
  return {close, dispose() {
    pointer = null;
    for (const [name, callback] of Object.entries(listeners)) document.removeEventListener(name, callback, options);
  }};
}
