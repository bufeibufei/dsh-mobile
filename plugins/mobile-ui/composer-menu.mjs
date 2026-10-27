// DSH alpha.2's official button focuses Lexical on mousedown AND click. Keep
// its menu, candidates and draft-span CAS, but separate mobile chrome from IME.
export function mountComposerMenu({document, narrow, current, input, panelInfo}) {
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
      pointer = {id: value.id, button, wasOpen: open(value)};
      event.preventDefault(); event.stopImmediatePropagation();
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
    const closing = pointer?.button === button && pointer.id === value.id ? pointer.wasOpen : open(value);
    pointer = null;
    if (closing) {value.controller.dismiss(); return;}
    const {shell, controller} = value, selection = shell.caretSpan(), snapshot = shell.snapshot;
    shell.dismissPopup();
    controller.toggleSource('command', {trigger: '/', query: '', quoted: false,
      position: snapshot.draft.slice(0, selection.start).trim() === '' ? 'leading' : 'inline',
      span: {...selection, draftRev: snapshot.draftRev}});
  };
  const listeners = {pointerdown: down, mousedown: mouse, click};
  for (const [name, callback] of Object.entries(listeners)) document.addEventListener(name, callback, true);
  return {close, dispose() {
    pointer = null;
    for (const [name, callback] of Object.entries(listeners)) document.removeEventListener(name, callback, true);
  }};
}
