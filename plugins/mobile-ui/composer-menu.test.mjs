import test from 'node:test';
import assert from 'node:assert/strict';
import {mountComposerMenu} from './composer-menu.mjs';
function fixture(ime) {
  const handlers=new Map();let launcher=null,sessionId='one',mobile=true,panel=null;
  const calls=[],button={disabled:false,focus:()=>calls.push('control-focus')},outside={closest:()=>null};
  button.closest=selector=>selector.startsWith('button.')?button:null;
  const shell={snapshot:{draft:'还没发送',draftRev:7},caretSpan:()=>({start:2,end:2}),
    dismissPopup:()=>calls.push('popup'),focus:()=>assert.fail('must not focus')};
  const controller={launcher:{getSnapshot:()=>launcher},dismiss(){calls.push('close');launcher=null;},
    toggleSource(source,hit){calls.push({source,hit});launcher=source;}};
  const document={addEventListener:(name,fn)=>handlers.set(name,fn),removeEventListener:name=>handlers.delete(name)};
  const control=mountComposerMenu({document,narrow:()=>mobile,current:{getSnapshot:()=>({key:sessionId})},
    panelInfo:{getSnapshot:()=>({activePanelId:panel})},input:{shell:()=>shell,inputTriggers:()=>controller},imeVisible:()=>ime});
  const emit=(type,target=button)=>{const event={target,preventDefault(){this.prevented=true;},stopImmediatePropagation(){this.stopped=true;}};handlers.get(type)?.(event);return event;};
  return {control,emit,calls,shell,button,outside,handlers,setLauncher:value=>launcher=value,
    mobile:value=>mobile=value,panel:value=>panel=value,session:value=>sessionId=value};
}
test('mobile plus opens/closes official command menu without editing/focusing the draft',()=>{
 const f=fixture();assert.equal(f.emit('pointerdown').prevented,true);assert.equal(f.emit('mousedown').stopped,true);f.emit('click');
 assert.deepEqual(f.calls[1],{source:'command',hit:{trigger:'/',query:'',quoted:false,position:'inline',span:{start:2,end:2,draftRev:7}}});
 f.emit('pointerdown');f.setLauncher(null);f.emit('click');assert.equal(f.calls.at(-1),'close');
 assert.deepEqual(f.shell.snapshot,{draft:'还没发送',draftRev:7});
 f.emit('click');assert.equal(f.control.close(),true);assert.equal(f.control.close(),false);
});
test('outside tap closes; desktop, disabled controls, other panels and disposed handlers stay untouched',()=>{
 const f=fixture();f.emit('click');f.emit('pointerdown',f.outside);assert.equal(f.calls.at(-1),'close');
 for(const set of [()=>f.mobile(false),()=>{f.mobile(true);f.button.disabled=true;},()=>{f.button.disabled=false;f.panel('life');}]){
  set();const before=f.calls.length;assert.equal(f.emit('click').prevented,undefined);assert.equal(f.calls.length,before);
 }
 f.control.dispose();assert.equal(f.handlers.size,0);
});
test('native touch cancels WebView default and toggles without relying on a compatibility click',()=>{
 const f=fixture();f.emit('pointerdown');assert.equal(f.emit('touchstart').prevented,true);
 f.emit('touchend');assert.equal(f.calls.length,2);
 f.emit('pointerdown');f.emit('touchstart');f.emit('touchend');assert.equal(f.calls.at(-1),'close');
 f.emit('pointerdown');f.emit('touchstart');f.emit('touchcancel');f.emit('touchend');assert.equal(f.calls.at(-1),'close');
 assert.deepEqual(f.shell.snapshot,{draft:'还没发送',draftRev:7});
});
test('only a positively hidden native IME moves focus; caret is captured before that move',()=>{
 for(const ime of [false,true,undefined]){
  const f=fixture(ime);f.emit('pointerdown');f.shell.caretSpan=()=>({start:99,end:99});f.emit('click');
  assert.equal(f.calls.includes('control-focus'),ime===false);
  assert.deepEqual(f.calls.at(-1).hit.span,{start:2,end:2,draftRev:7});
 }
});
