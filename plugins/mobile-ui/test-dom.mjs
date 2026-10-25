// Small injected DOM for deterministic client behavior tests (no browser/server).
export function createTestDOM() {
  const listeners=new Map();
  class Element {
    constructor(tag='div') { this.tagName=tag.toUpperCase();this.children=[];this.dataset={};this.style={};this.attributes={};this.className='';this.textContent='';this.scrollTop=0;this.hidden=false; }
    append(...nodes) { for(const node of nodes){node.remove();node.parentElement=this;this.children.push(node);} }
    prepend(node) { node.remove();node.parentElement=this;this.children.unshift(node); }
    replaceChildren(...nodes) { this.children.forEach(n=>n.parentElement=null);this.children=[];this.append(...nodes); }
    remove() { if(this.parentElement)this.parentElement.children=this.parentElement.children.filter(n=>n!==this); }
    setAttribute(key,value) { this.attributes[key]=String(value); }
    getAttribute(key) { return this.attributes[key]??null; }
    hasAttribute(key) { return key in this.attributes; }
    removeAttribute(key) { delete this.attributes[key]; }
    get classList() { return {contains:v=>this.className.split(' ').includes(v),add:v=>{this.className+=' '+v;},remove:v=>{this.className=this.className.split(' ').filter(c=>c!==v).join(' ');}}; }
    get text() { return this.textContent+this.children.map(c=>c.text).join(''); }
    addEventListener(type,fn) { this['on'+type]=fn; }
    removeEventListener(type,fn) { if(this['on'+type]===fn)delete this['on'+type]; }
    dispatchEvent(event) { event.target??=this;this['on'+event.type]?.(event);return !event.defaultPrevented; }
    click() { if(!this.disabled)this.onclick?.({target:this,detail:0,preventDefault(){}}); }
    getClientRects() { return this.hidden?[]:[{}]; }
    focus() { document.activeElement=this; }
    matches(selector) {
      if(selector.startsWith('.'))return this.classList.contains(selector.slice(1));
      if(selector.startsWith('[')){
        const [,key,value]=selector.match(/^\[([^=\]]+)(?:=["']?([^"'\]]+)["']?)?\]$/)||[];
        if(!key)return false;
        const actual=key.startsWith('data-')?this.dataset[key.slice(5).replace(/-([a-z])/g,(_,c)=>c.toUpperCase())]:this.getAttribute(key);
        return value===undefined?actual!==null&&actual!==undefined:actual===value;
      }
      return this.tagName===selector.toUpperCase();
    }
    closest(selector) { return selector.split(',').some(s=>this.matches(s.trim()))?this:this.parentElement?.closest(selector)||null; }
    querySelectorAll(selector) {
      const selectors=selector.split(',').map(s=>s.trim());const result=[];
      const walk=n=>{for(const child of n.children){if(selectors.some(s=>{
        const parts=s.split(/\s+/);const last=parts.pop();
        return child.matches(last)&&(!parts.length||child.parentElement?.closest(parts.join(' ')));
      }))result.push(child);walk(child);}};walk(this);return result;
    }
    querySelector(selector) { return this.querySelectorAll(selector)[0]||null; }
  }
  const document={head:new Element('head'),body:new Element('body'),visibilityState:'visible',
    createElement:tag=>new Element(tag),
    addEventListener:(name,fn)=>{if(!listeners.has(name))listeners.set(name,new Set());listeners.get(name).add(fn);},
    removeEventListener:(name,fn)=>listeners.get(name)?.delete(fn),
    querySelector:selector=>document.body.querySelector(selector),querySelectorAll:selector=>document.body.querySelectorAll(selector),
    emit:name=>{for(const fn of listeners.get(name)||[])fn();}};
  return {document,Element};
}
