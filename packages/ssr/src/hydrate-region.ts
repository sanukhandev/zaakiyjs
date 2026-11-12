/**
 * H4: compiler-generated region hydration, fail-closed before native adoption.
 * The v2 path reuses the existing DOM keyed/conditional reconciler and owner
 * lifecycle; it does not ship a TSX interpreter or a virtual DOM.
 */
import { bindText, listen, setText, setAttribute, bindConditionalRegion, bindKeyedRegion } from "@zaakiyjs/dom/compiler";
import { hydrate } from "@zaakiyjs/dom";
import type { HydrationMountHandle } from "@zaakiyjs/dom";
import { createOwner, disposeOwner, initializeOwnedComponent, mountOwner, onMount, runWithOwner } from "@zaakiyjs/core";
import type { OwnerScope } from "@zaakiyjs/core";
import { inspectHydration } from "./client.js";
import type { HydrationEnvelopeV1, TrustedServerBuildManifestV1 } from "./protocol.js";

export type RegionNodeV2 =
  | { readonly kind: "element"; readonly id: string; readonly tag: string; readonly attrs: readonly string[]; readonly events?: readonly {readonly name:string;readonly path:readonly string[]}[]; readonly children: readonly RegionNodeV2[] }
  | { readonly kind: "component"; readonly id: string; readonly children: readonly RegionNodeV2[] }
  | { readonly kind: "literal"; readonly value: string }
  | { readonly kind: "data"; readonly id: string; readonly source: "props" | "item"; readonly path: readonly string[] }
  | { readonly kind: "conditional"; readonly id: string; readonly path: readonly string[]; readonly yes: readonly RegionNodeV2[]; readonly no: readonly RegionNodeV2[] }
  | { readonly kind: "keyed"; readonly id: string; readonly path: readonly string[]; readonly itemName: string; readonly key: string; readonly rows: readonly RegionNodeV2[] };
export interface RegionHydrationPlanV2 {
  readonly schema: "zaakiy.region-hydration/2";
  readonly routeId: string;
  readonly markerId: string;
  readonly templateDigest: string;
  readonly nodes: readonly RegionNodeV2[];
}
export interface RegionHydrationEventV2 {
  /** Compiler element ID; keyed item elements use id:key. */
  readonly elementId: string;
  readonly name: string;
  readonly handler: EventListener;
  readonly options?: AddEventListenerOptions;
}
export interface RegionHydrationBindingsV2 {
  readonly read: (path: readonly string[]) => unknown;
  readonly events?: readonly RegionHydrationEventV2[];
  /** Resolve compiled onClick={props.handle} references from trusted client code. */
  readonly resolveEvent?: (path:readonly string[]) => EventListener;
  readonly signal?: AbortSignal;
}
const ID = /^[a-f0-9]{32}$/;
const HASH = /^[a-f0-9]{64}$/;
const FIELD = /^[A-Za-z_$][\w$]*$/;
const SAFE_KEY = /^[A-Za-z0-9_.:]{1,64}$/;
const ATTR = /^ ([a-z][a-z0-9:_-]*)="([^"]*)"$/;
const EVENT = /^[a-z][a-z0-9:_-]*$/;
const DENIED = new Set(["__proto__", "constructor", "prototype"]);
const MAX_NODES = 8192;
type ComponentNode = Extract<RegionNodeV2, {kind:"component"}>;
type ConditionalNode = Extract<RegionNodeV2, {kind:"conditional"}>;
type KeyedNode = Extract<RegionNodeV2, {kind:"keyed"}>;
type DataNode = Extract<RegionNodeV2, {kind:"data"}>;

function mismatch(reason: string): never { throw new TypeError("Region hydration mismatch: " + reason); }
function textOf(value: unknown): string {
  if (value == null || typeof value === "boolean") return "";
  if (typeof value !== "string" && typeof value !== "number" && typeof value !== "bigint")
    return mismatch("nonprimitive data text");
  const text = String(value);
  if (text.length > 65536) return mismatch("data text budget");
  return text;
}
function own(item: unknown, path: readonly string[]): unknown {
  let current: unknown = item;
  if (!Array.isArray(path) || path.length < 1 || path.length > 4)
    return mismatch("invalid data path");
  for (const key of path) {
    if (typeof key !== "string" || !FIELD.test(key) || DENIED.has(key))
      return mismatch("unsafe data path");
    if (typeof current !== "object" || !current || Array.isArray(current)) return null;
    const proto = Object.getPrototypeOf(current);
    if (proto !== Object.prototype && proto !== null) return mismatch("nonplain item data");
    const field = Object.getOwnPropertyDescriptor(current, key);
    if (!field) return null;
    if (!Object.hasOwn(field, "value")) return mismatch("getter in item data");
    current = field.value;
  }
  return current;
}
function rowKey(item: unknown, name: string): string {
  const key = own(item,[name]);
  if (typeof key !== "string" && typeof key !== "number")
    return mismatch("invalid keyed identity");
  const text = String(key);
  if (!SAFE_KEY.test(text)) return mismatch("unsafe keyed identity");
  return text;
}
function encoded(value: string): string {
  return value.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")
    .replace(/"/g,"&quot;").replace(/'/g,"&#39;");
}
function decodeAttr(value: string): string {
  return value.replace(/&quot;/g,'"').replace(/&#39;/g,"'")
    .replace(/&lt;/g,"<").replace(/&gt;/g,">").replace(/&amp;/g,"&");
}
function attributes(element: Element, values: readonly string[]): void {
  if (!Array.isArray(values)) mismatch("invalid static attributes");
  const names = new Set<string>();
  for (const raw of values) {
    if (typeof raw !== "string") mismatch("invalid static attribute");
    const parsed = ATTR.exec(raw);
    if (!parsed || names.has(parsed[1]!)) mismatch("compiled attribute format");
    names.add(parsed[1]!);
    const actual = element.getAttribute(parsed[1]!);
    if (actual === null || encoded(actual) !== parsed[2]) mismatch("native attribute");
  }
  if (element.attributes.length !== names.size) mismatch("unexpected native attributes");
}
interface Slot {
  readonly spec: DataNode;
  text: Text | null;
  readonly end: Comment;
  item: unknown;
}
interface ComponentScope {
  readonly spec: ComponentNode;
  readonly child: Zone;
}
interface Condition {
  readonly spec: ConditionalNode;
  readonly parent: Node;
  readonly start: Comment;
  readonly end: Comment;
  readonly shown: boolean;
  readonly child: Zone;
}
interface Row {
  readonly key: string;
  readonly item: unknown;
  readonly start: Comment;
  readonly end: Comment;
  readonly child: Zone;
  readonly node: Node;
}
interface Keyed {
  readonly spec: KeyedNode;
  readonly parent: Node;
  readonly start: Comment;
  readonly end: Comment;
  readonly rows: readonly Row[];
}
interface Zone {
  readonly key: string;
  readonly elements: Map<string, Element>;
  readonly slots: Slot[];
  readonly compiledEvents: {readonly elementId:string;readonly name:string;readonly path:readonly string[]}[];
  readonly components: ComponentScope[];
  readonly conditions: Condition[];
  readonly keyed: Keyed[];
}
function zone(key = ""): Zone {
  return {key, elements:new Map(),slots:[],compiledEvents:[],components:[],conditions:[],keyed:[]};
}
/** No user callbacks are registered and no native mutations occur in preflight. */
function inspect(container: Element, plan: RegionHydrationPlanV2,
  read: RegionHydrationBindingsV2["read"]): Zone {
  if (container.childNodes.length !== 2 || container.childNodes[0]?.nodeType !== 8 ||
      container.childNodes[0]?.nodeValue !== "zaakiy-h:" + plan.markerId + ":" + plan.templateDigest)
    mismatch("route root marker");
  const root = container.childNodes[1];
  if (!root || root.nodeType !== 1) mismatch("native root");
  const tree = zone();
  let budget = 0;
  const scan = (parent: Node, begin: Node | null, end: Node | null,
    specs: readonly RegionNodeV2[], item: unknown, target: Zone,
    depth: number): Node | null => {
    if (!Array.isArray(specs) || depth > 64) mismatch("invalid region depth");
    let cursor = begin;
    for (const spec of specs) {
      if (++budget > MAX_NODES || !spec || typeof spec !== "object")
        mismatch("region structural budget");
      switch (spec.kind) {
        case "element": {
          if (!ID.test(spec.id) || !cursor || cursor === end || cursor.nodeType !== 1 ||
              target.elements.has(spec.id + (target.key ? ":" + target.key : "")) ||
              !Array.isArray(spec.children) || !/^[a-z][a-z0-9-]*$/.test(spec.tag))
            mismatch("element definition");
          const element = cursor as Element;
          if (element.namespaceURI !== "http://www.w3.org/1999/xhtml" ||
              element.localName !== spec.tag) mismatch("native element");
          attributes(element,spec.attrs);
          target.elements.set(spec.id + (target.key ? ":" + target.key : ""),element);
          if (spec.events !== undefined) {
            if (!Array.isArray(spec.events) || spec.events.length>16)
              mismatch("compiled event budget");
            for (const event of spec.events) {
              if (!event || !EVENT.test(event.name) || !Array.isArray(event.path) ||
                  event.path.length<1 || event.path.length>4 ||
                  event.path.some(key=>!FIELD.test(key) || DENIED.has(key)))
                mismatch("compiled event descriptor");
              target.compiledEvents.push({
                elementId:spec.id+(target.key?":"+target.key:""),
                name:event.name,path:event.path
              });
            }
          }
          if (scan(element,element.firstChild,null,spec.children,item,target,depth+1) !== null)
            mismatch("unlisted native children");
          cursor=element.nextSibling;
          break;
        }
        case "literal":
          if (typeof spec.value !== "string" || !cursor || cursor === end ||
              cursor.nodeType !== 3 || cursor.nodeValue !== spec.value)
            mismatch("static literal");
          cursor=cursor.nextSibling;
          break;
        case "data": {
          if (!ID.test(spec.id) || !Array.isArray(spec.path) ||
              (spec.source !== "props" && spec.source !== "item") ||
              !cursor || cursor === end || cursor.nodeType !== 8 ||
              cursor.nodeValue !== "zaakiy-d2:" + spec.id + ":start")
            mismatch("dynamic text start");
          cursor=cursor.nextSibling;
          const expected=textOf(spec.source === "props" ? read(spec.path) : own(item,spec.path));
          let text:Text|null=null;
          if (cursor && cursor !== end && cursor.nodeType === 3) {
            text=cursor as Text;
            if (text.data !== expected) mismatch("initial data text");
            cursor=cursor.nextSibling;
          } else if (expected) mismatch("missing data text");
          if (!cursor || cursor === end || cursor.nodeType !== 8 ||
              cursor.nodeValue !== "zaakiy-d2:" + spec.id + ":end")
            mismatch("dynamic text end");
          target.slots.push({spec,text,end:cursor as Comment,item});
          cursor=cursor.nextSibling;
          break;
        }
        case "component": {
          if (!ID.test(spec.id) || !Array.isArray(spec.children) ||
              !cursor || cursor===end || cursor.nodeType!==8 ||
              cursor.nodeValue!=="zaakiy-r2:"+spec.id+":start")
            mismatch("component boundary start");
          const child=zone(target.key);
          cursor=scan(parent,cursor.nextSibling,end,spec.children,item,child,depth+1);
          if (!cursor || cursor===end || cursor.nodeType!==8 ||
              cursor.nodeValue!=="zaakiy-r2:"+spec.id+":end")
            mismatch("component boundary end");
          target.components.push({spec,child});
          cursor=cursor.nextSibling;
          break;
        }
        case "conditional": {
          if (!ID.test(spec.id) || !cursor || cursor === end || cursor.nodeType !== 8 ||
              cursor.nodeValue !== "zaakiy-r2:" + spec.id + ":start")
            mismatch("conditional start");
          // H4 v2 currently supports only flat region templates. This is
          // enforced by the compiler and checked again on the browser.
          const shown=Boolean(read(spec.path));
          const child=zone(target.key);
          const start=cursor as Comment;
          cursor=scan(parent,cursor.nextSibling,end,shown?spec.yes:spec.no,item,child,depth+1);
          if (!cursor || cursor === end || cursor.nodeType !== 8 ||
              cursor.nodeValue !== "zaakiy-r2:" + spec.id + ":end")
            mismatch("conditional end");
          target.conditions.push({spec,parent,start,end:cursor as Comment,shown,child});
          cursor=cursor.nextSibling;
          break;
        }
        case "keyed": {
          if (!ID.test(spec.id) || !FIELD.test(spec.key) || DENIED.has(spec.key) ||
              !cursor || cursor === end || cursor.nodeType !== 8 ||
              cursor.nodeValue !== "zaakiy-r2:" + spec.id + ":start" ||
              spec.rows.length !== 1 || spec.rows[0]?.kind !== "element")
            mismatch("keyed region plan");
          const data=read(spec.path);
          if (!Array.isArray(data) || data.length > 4096) mismatch("keyed data collection");
          const start=cursor as Comment;
          cursor=cursor.nextSibling;
          const rows:Row[]=[];
          const seen=new Set<string>();
          for (const item of data) {
            const key=rowKey(item,spec.key);
            if (seen.has(key)) mismatch("duplicate keyed identity");
            seen.add(key);
            if (!cursor || cursor === end || cursor.nodeType !== 8 ||
                cursor.nodeValue !== "zaakiy-k2:" + spec.id + ":" + key + ":start")
              mismatch("keyed item start");
            const rowStart=cursor as Comment;
            const child=zone(key);
            const first=cursor.nextSibling;
            cursor=scan(parent,first,end,spec.rows,item,child,depth+1);
            if (!cursor || cursor === end || cursor.nodeType !== 8 ||
                cursor.nodeValue !== "zaakiy-k2:" + spec.id + ":" + key + ":end")
              mismatch("keyed item end");
            if (!first || first.nodeType !== 1) mismatch("row native element");
            rows.push({key,item,start:rowStart,end:cursor as Comment,child,node:first});
            cursor=cursor.nextSibling;
          }
          if (!cursor || cursor === end || cursor.nodeType !== 8 ||
              cursor.nodeValue !== "zaakiy-r2:" + spec.id + ":end")
            mismatch("keyed list end");
          target.keyed.push({spec,parent,start,end:cursor as Comment,rows});
          cursor=cursor.nextSibling;
          break;
        }
        default: mismatch("unsupported H4 region specification");
      }
    }
    return cursor;
  };
  if (scan(container,root,null,plan.nodes,null,tree,0)!==null)
    mismatch("unlisted root siblings");
  return tree;
}

function allElements(target:Zone, output:Map<string,Element>):void {
  for (const [id,node] of target.elements) {
    if (output.has(id)) mismatch("duplicate element ID");
    output.set(id,node);
  }
  for (const component of target.components) allElements(component.child,output);
  for (const conditional of target.conditions) allElements(conditional.child,output);
  for (const keyed of target.keyed)
    for (const row of keyed.rows) allElements(row.child,output);
}
/** Adopt exactly matching server markup; a mismatched region is never replaced. */
export function hydrateRegionPage(
  container:Element,plan:RegionHydrationPlanV2,
  envelope:HydrationEnvelopeV1,manifest:TrustedServerBuildManifestV1,
  routeId:string,bindings:RegionHydrationBindingsV2
):HydrationMountHandle {
  if (!container || container.nodeType!==1 || !plan ||
      plan.schema!=="zaakiy.region-hydration/2" || plan.routeId!==routeId ||
      !ID.test(plan.markerId) || !HASH.test(plan.templateDigest) ||
      !Array.isArray(plan.nodes) || !bindings || typeof bindings.read!=="function" ||
      !Array.isArray(envelope?.boundaries) || envelope.boundaries.length!==1 ||
      envelope.boundaries[0]?.markerId!==plan.markerId ||
      envelope.boundaries[0]?.templateDigest!==plan.templateDigest)
    mismatch("plan and envelope identity");
  if (bindings.signal?.aborted) mismatch("navigation canceled");
  if (!inspectHydration(container,envelope,manifest,routeId).compatible)
    mismatch("build/route/marker identity");
  const tree=inspect(container,plan,bindings.read);
  const targetElements=new Map<string,Element>();
  allElements(tree,targetElements);
  const events=[...(bindings.events??[])];
  const compiledEvents:(typeof tree.compiledEvents) = [];
  const collectEvents=(target:Zone):void=>{
    compiledEvents.push(...target.compiledEvents);
    for(const comp of target.components) collectEvents(comp.child);
    for(const condition of target.conditions) collectEvents(condition.child);
    for(const list of target.keyed) for(const row of list.rows) collectEvents(row.child);
  };
  collectEvents(tree);
  if(compiledEvents.length && typeof bindings.resolveEvent!=="function")
    mismatch("compiler event resolver required");
  for(const event of compiledEvents){
    const handler=bindings.resolveEvent!(event.path);
    if(typeof handler!=="function") mismatch("compiled event handler unavailable");
    events.push({elementId:event.elementId,name:event.name,handler});
  }
  if (!Array.isArray(events) || events.length>4096) mismatch("event count");
  const eventMap=new Map<string,RegionHydrationEventV2[]>();
  const registered=new Set<string>();
  for (const event of events) {
    if (!event || !targetElements.has(event.elementId) ||
        !EVENT.test(event.name) || typeof event.handler!=="function" ||
        registered.has(event.elementId+":"+event.name))
      mismatch("event identity");
    registered.add(event.elementId+":"+event.name);
    const list=eventMap.get(event.elementId)??[];
    list.push(event);
    eventMap.set(event.elementId,list);
  }
  if (bindings.signal?.aborted) mismatch("navigation canceled");
  const inserted:Text[]=[];
  const read=bindings.read;
  const attachElements=(owner:OwnerScope,nodes:ReadonlyMap<string,Element>):void=>{
    for (const [id,node] of nodes)
      for (const event of eventMap.get(id)??[])
        listen(owner,node,event.name,event.handler,event.options);
  };
  const attachSlots=(owner:OwnerScope,slots:readonly Slot[]):void=>{
    for (const slot of slots) {
      if (!slot.text) {
        slot.text=slot.end.ownerDocument.createTextNode("");
        slot.end.parentNode!.insertBefore(slot.text,slot.end);
        inserted.push(slot.text);
      }
      bindText(owner,slot.text,()=>slot.spec.source==="props"
        ? read(slot.spec.path):own(slot.item,slot.spec.path));
    }
  };
  const updateSlots=(slots:readonly Slot[],item:unknown):void=>{
    const changes=slots.filter(slot=>slot.spec.source==="item").map(slot=>({
      slot,value:textOf(own(item,slot.spec.path))
    }));
    for (const change of changes) {
      change.slot.item=item;
      if (change.slot.text) setText(change.slot.text,change.value);
    }
  };
  const buildStatic=(spec:RegionNodeV2,owner:OwnerScope,
    doc:Document,item:unknown,key:string,newSlots:Slot[]):Node=>{
    if (spec.kind==="literal") return doc.createTextNode(spec.value);
    if (spec.kind==="data") {
      const wrap=doc.createDocumentFragment();
      const start=doc.createComment("zaakiy-d2:"+spec.id+":start");
      const data=doc.createTextNode(textOf(spec.source==="props"?read(spec.path):own(item,spec.path)));
      const end=doc.createComment("zaakiy-d2:"+spec.id+":end");
      wrap.append(start,data,end);
      const slot:Slot={spec,text:data,end,item};
      newSlots.push(slot);
      bindText(owner,data,()=>spec.source==="props"?read(spec.path):own(slot.item,spec.path));
      return wrap;
    }
    if (spec.kind!=="element" || !ID.test(spec.id) ||
        !/^[a-z][a-z0-9-]*$/.test(spec.tag))
      mismatch("dynamic branch cannot contain nested region");
    const el=doc.createElement(spec.tag);
    for (const raw of spec.attrs) {
      const parsed=ATTR.exec(raw);
      if (!parsed) mismatch("invalid generated attribute");
      setAttribute(el,parsed[1]!,decodeAttr(parsed[2]!));
    }
    const id=spec.id+(key?":"+key:"");
    for (const event of eventMap.get(id)??[])
      listen(owner,el,event.name,event.handler,event.options);
    for(const event of spec.events??[]){
      if(eventMap.get(id)?.some(binding=>binding.name===event.name)) continue;
      const handler=bindings.resolveEvent?.(event.path);
      if(typeof handler!=="function") mismatch("missing compiled event handler");
      listen(owner,el,event.name,handler);
    }
    for (const child of spec.children)
      el.appendChild(buildStatic(child,owner,doc,item,key,newSlots));
    return el;
  };
  const buildBranch=(specs:readonly RegionNodeV2[],owner:OwnerScope,key:string):Node=>{
    const doc=container.ownerDocument;
    const fragment=doc.createDocumentFragment();
    const slots:Slot[]=[];
    for (const spec of specs) fragment.appendChild(buildStatic(spec,owner,doc,null,key,slots));
    return fragment;
  };
  const buildRow=(spec:KeyedNode,owner:OwnerScope,item:unknown,key:string)=>{
    const slots:Slot[]=[];
    const node=buildStatic(spec.rows[0]!,owner,container.ownerDocument,item,key,slots);
    if (node.nodeType!==1) mismatch("keyed item requires native element root");
    return {node,update(next:unknown){updateSlots(slots,next);}};
  };
  const attachZone=(owner:OwnerScope,target:Zone):void=>{
    attachSlots(owner,target.slots);
    attachElements(owner,target.elements);
    for (const component of target.components) {
      const child=createOwner(owner);
      try {
        initializeOwnedComponent(child,()=>attachZone(child,component.child));
        if (owner.state==="created" || owner.state==="initialized") {
          runWithOwner(owner,()=>onMount(()=>{
            if (!child.disposed) mountOwner(child);
          }));
        } else mountOwner(child);
      } catch(error) {
        try {disposeOwner(child);} catch { /* original attachment failure takes precedence */ }
        throw error;
      }
    }
    for (const condition of target.conditions) {
      bindConditionalRegion(owner,
        {parent:condition.parent,start:condition.start,end:condition.end},
        ()=>Boolean(read(condition.spec.path)),
        child=>buildBranch(condition.spec.yes,child,target.key),
        child=>buildBranch(condition.spec.no,child,target.key),
        {initialBranch:condition.shown,preserveMarkupOnDispose:true,
          adopt:child=>attachZone(child,condition.child)});
    }
    for (const list of target.keyed) {
      bindKeyedRegion(owner,{parent:list.parent,start:list.start,end:list.end},
        ()=>{
          const rows=read(list.spec.path);
          if (!Array.isArray(rows) || rows.length>4096)
            return mismatch("keyed collection changed to unsafe data");
          return rows as readonly unknown[];
        },
        item=>rowKey(item,list.spec.key),
        (item,child)=>buildRow(list.spec,child,item,rowKey(item,list.spec.key)),
        {initial:list.rows.map(row=>({
          key:row.key,item:row.item,start:row.start,end:row.end,
          adopt:(_item,child)=>{
            attachZone(child,row.child);
            return {node:row.node,update(next:unknown){updateSlots(row.child.slots,next);}};
          }
        })),preserveMarkupOnDispose:true,
        markerForKey:(key,doc)=>({
          start:doc.createComment("zaakiy-k2:"+list.spec.id+":"+key+":start"),
          end:doc.createComment("zaakiy-k2:"+list.spec.id+":"+key+":end")
        })});
    }
  };
  try {
    const handle=hydrate(container.childNodes[1]!,owner=>attachZone(owner,tree));
    const signal=bindings.signal;
    if (!signal) return handle;
    let disposed=false;
    const close=()=>{
      if (disposed) return;
      disposed=true;
      signal.removeEventListener("abort",close);
      handle.dispose();
    };
    signal.addEventListener("abort",close,{once:true});
    if (signal.aborted) close();
    return {root:handle.root,owner:handle.owner,dispose:close};
  } catch(error) {
    for (const node of inserted) node.parentNode?.removeChild(node);
    throw error;
  }
}
