const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const source = fs.readFileSync(path.join(__dirname, '../app/panel-motion-controller.tsx'), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
function harness({reduced = false, panel = true} = {}) {
  const nodes = [], animations = [], listeners = new Map(); let observer, effect, cleanup, preferenceChanged;
  const preference = { matches: reduced, addEventListener(_, fn) { preferenceChanged = fn; }, removeEventListener() { preferenceChanged = null; } };
  class Element {
    constructor(type = 'dialog') { this.type = type; this.isConnected = true; this.attrs = new Map(); this.dataset = {}; this.style = {}; this.parentElement = null; this.hidden = false; this.children = []; this.rect = {top:50,left:100,width:500,height:300}; }
    get attributes() { return [...this.attrs].map(([name,value]) => ({name,value})); }
    setAttribute(k,v) { this.attrs.set(k,v); }
    getAttribute(k) { return this.attrs.get(k) ?? null; }
    hasAttribute(k) { return this.attrs.has(k); }
    removeAttribute(k) { this.attrs.delete(k); }
    getBoundingClientRect() { return this.rect; }
    matches(selector) { return this.type === 'dialog' && selector.includes('dialog[open]') || this.type === 'menu' && selector.includes('[data-motion-menu]'); }
    closest(selector) { if (selector.includes('[data-motion-exit]') && this.hasAttribute('data-motion-exit')) return this; if (selector.includes('[hidden]') && this.hidden) return this; return null; }
    querySelector() { return null; }
    querySelectorAll(selector) { return selector === '*' ? this.children : []; }
    contains(el) { return el === this || this.children.some(child=>child.contains(el)); }
    cloneNode() { const copy = new Element(this.type); copy.attrs = new Map(this.attrs); return copy; }
    remove() { this.isConnected = false; }
    animate(frames, options) { let resolve; const animation = { element:this, frames, options, cancelled:false, finished: new Promise(r=>{resolve=r;}), cancel(){this.cancelled=true;resolve();}, finish(){resolve();} }; animations.push(animation); return animation; }
  }
  const document = {
    body: { appendChild(el){nodes.push(el);} },
    querySelector() { return panel ? {} : null; },
    querySelectorAll() { return nodes.filter(el=>el.isConnected); },
    getElementById() { return null; },
    addEventListener(name,fn){listeners.set(name,fn);}, removeEventListener(name){listeners.delete(name);},
  };
  const module = {exports:{}};
  vm.runInNewContext(compiled, { module, exports:module.exports, require(){return {useEffect(fn){effect=fn;}};}, document, window:{matchMedia(){return preference;}}, Element,
    getComputedStyle(){const s=['display'];s.display='block';s.getPropertyValue=()=> 'block';return s;},
    MutationObserver: class { constructor(fn){observer=fn;} observe(){} disconnect(){observer=null;} },
  });
  module.exports.default(); cleanup=effect();
  const mutation = (added=[], removed=[])=>observer?.([{type:'childList',target:document.body,addedNodes:added,removedNodes:removed}]);
  return {nodes,animations,listeners,preference,Element,
    add(type='dialog'){const el=new Element(type);nodes.push(el);mutation([el]);return el;},
    close(el){listeners.get('pointerdown')?.();el.isConnected=false;mutation([],[el]);},
    repeat(el){mutation([el]);},
    hide(el){listeners.get('pointerdown')?.();el.hidden=true;observer([{type:'attributes',target:el,attributeName:'hidden',oldValue:null}]);},
    ghosts(){return nodes.filter(el=>el.isConnected&&el.hasAttribute('data-motion-exit'));},
    reduce(){preference.matches=true;preferenceChanged();}, cleanup,
  };
}
async function flush(){for(let i=0;i<8;i++)await Promise.resolve();}
(async()=>{
  const h=harness(); const dialog=h.add();
  assert.equal(h.animations.length,1); assert.equal(h.animations[0].options.duration,300);
  h.repeat(dialog); assert.equal(h.animations.length,1,'ordinary rerenders must not restart motion');
  dialog.setAttribute('id','sensitive-form'); dialog.setAttribute('onclick','submit()');
  h.close(dialog);
  assert.equal(dialog.isConnected,false,'real form closes immediately');
  const ghost=h.ghosts()[0]; assert.ok(ghost); assert.equal(ghost.inert,true); assert.equal(ghost.getAttribute('aria-hidden'),'true');
  assert.equal(ghost.hasAttribute('id'),false); assert.equal(ghost.hasAttribute('onclick'),false); assert.equal(ghost.style.pointerEvents,'none');
  assert.equal(h.animations[1].options.duration,180); h.animations[1].finish(); await flush(); assert.equal(h.ghosts().length,0);
  const menu=h.add('menu'); h.close(menu); const reopened=h.add('menu');
  assert.equal(reopened.isConnected,true); assert.equal(h.ghosts().length,1);
  h.reduce(); await flush(); assert.equal(h.ghosts().length,0); assert.ok(h.animations.every(a=>a.cancelled||a===h.animations[1]));
  h.cleanup(); assert.equal(h.listeners.size,0);
  const quiet=harness({reduced:true});quiet.close(quiet.add());assert.equal(quiet.animations.length,0);quiet.cleanup();
  const outside=harness({panel:false});outside.close(outside.add());assert.equal(outside.animations.length,0);outside.cleanup();
  const hidden=harness();const pane=hidden.add('menu');hidden.hide(pane);assert.equal(hidden.ghosts().length,1,'persistent hidden panels also exit');hidden.cleanup();
  const unmount=harness();unmount.close(unmount.add());unmount.cleanup();await flush();assert.equal(unmount.ghosts().length,0);
  console.log('PASS panel motion: entry, exit, immediate functional close, inert stripped copies, rerenders, quick reopen, reduced motion, outside-panel isolation and cleanup.');
})().catch(error=>{console.error(error);process.exitCode=1;});
