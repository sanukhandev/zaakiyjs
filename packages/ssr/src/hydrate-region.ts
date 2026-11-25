/**
 * H4: compiler-generated region hydration, fail-closed before native adoption.
 * The v2 path reuses the existing DOM keyed/conditional reconciler and owner
 * lifecycle; it does not ship a TSX interpreter or a virtual DOM.
 */
import { bindText, listen, setText, setAttribute, bindConditionalRegion, bindKeyedRegion, bindFlatKeyedRegion } from "@zaakiyjs/dom/compiler";
import type { FlatKeyedRow } from "@zaakiyjs/dom/compiler";
import { hydrate } from "@zaakiyjs/dom";
import { signal, untrack } from "@zaakiyjs/signals";
import type { WritableSignal } from "@zaakiyjs/signals";
import type { HydrationMountHandle } from "@zaakiyjs/dom";
import { createOwner, disposeOwner, initializeOwnedComponent, mountOwner, onMount, runWithOwner } from "@zaakiyjs/core";
import type { OwnerScope } from "@zaakiyjs/core";
import { inspectHydration, validateHydrationIdentity } from "./hydration-probe.js";
import type { HydrationEnvelopeV1, TrustedServerBuildManifestV1 } from "./protocol.js";

export type RegionNodeV2 =
  | { readonly kind: "element"; readonly id: string; readonly tag: string; readonly attrs: readonly string[]; readonly events?: readonly {readonly name:string;readonly path:readonly string[]}[]; readonly children: readonly RegionNodeV2[] }
  | { readonly kind: "component"; readonly id: string; readonly children: readonly RegionNodeV2[] }
  | { readonly kind: "literal"; readonly value: string }
  | { readonly kind: "data"; readonly id: string; readonly source: "props" | "item"; readonly path: readonly string[] }
  | { readonly kind: "conditional"; readonly id: string; readonly path: readonly string[]; readonly source?: "props" | "item"; readonly yes: readonly RegionNodeV2[]; readonly no: readonly RegionNodeV2[] }
  | { readonly kind: "keyed"; readonly id: string; readonly path: readonly string[]; readonly source?: "props" | "item"; readonly itemName: string; readonly key: string; readonly rows: readonly RegionNodeV2[]; readonly flat?: true };
export interface RegionHydrationPlanV2 {
  readonly schema: "zaakiy.region-hydration/2";
  readonly routeId: string;
  readonly markerId: string;
  readonly templateDigest: string;
  readonly nodes: readonly RegionNodeV2[];
  readonly limits?: {readonly maxRows:10000;readonly maxNodes:50000;readonly maxHtmlBytes:8388608};
  /** Omission deliberately selects the original full-length v2 markers. */
  readonly markerFormat?: "compact-v1" | "compact-v2" | "compact-v3";
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
  readonly resolveEvent?: (path:readonly string[], currentItem?:()=>unknown) => EventListener;
  readonly signal?: AbortSignal;
  /** Opt-in: item paths are immutable plain data snapshots without proxies or
   * reactive descriptor reads. Replace changed keyed items; never mutate them.
   * Default attachment retains tracked reads for backward compatibility. */
  readonly itemDataMode?: "snapshot";
}
import {ID, HASH, FIELD, ATTR, EVENT, DENIED, dataMarker, keyedMarker, getBudgets, scalarChild, mismatch, textOf, own, rowKey, decodeAttr, attributes, flatTemplate, describeFlat, createFlat, validateFlatPlan} from "./region-validation.js";
import type {ComponentNode, ConditionalNode, KeyedNode, DataNode, FlatTemplate} from "./region-validation.js";

interface Slot {
  readonly spec: DataNode;
  text: Text | null;
  readonly anchor: Comment | Element;
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
  readonly flat?: {readonly template:FlatTemplate;readonly rows:readonly FlatKeyedRow<unknown>[]};
}
interface Zone {
  readonly key: string;
  itemValue: unknown;
  itemSignal?: WritableSignal<unknown>;
  readonly elements: Map<string, Element>;
  readonly slots: Slot[];
  readonly compiledEvents: {readonly elementId:string;readonly name:string;readonly path:readonly string[]}[];
  readonly components: ComponentScope[];
  readonly conditions: Condition[];
  readonly keyed: Keyed[];
}
function zone(key = "", item:unknown=null): Zone {
  return {key,itemValue:item, elements:new Map(),slots:[],compiledEvents:[],components:[],conditions:[],keyed:[]};
}
/** Only region predicates, nested lists and event closures need a reactive item cell. */
function readItem(target:Zone):unknown {
  return (target.itemSignal ??= signal(target.itemValue)).value;
}
function scopedKey(parent:string, key:string):string {
  return parent ? parent.length+"_"+parent+"_"+key : key;
}

/** No user callbacks are registered and no native mutations occur in preflight. */
function inspect(container: Element, plan: RegionHydrationPlanV2,
  read: RegionHydrationBindingsV2["read"], item:unknown=null, scopeKey="", syntheticRoot=false): Zone {
  if (container.childNodes.length !== 2 || container.childNodes[0]?.nodeType !== 8 ||
      container.childNodes[0]?.nodeValue !== "zaakiy-h:" + plan.markerId + ":" + plan.templateDigest)
    mismatch("route root marker");
  const root = container.childNodes[1];
  if (!root || root.nodeType !== 1) mismatch("native root");
  const tree = zone(scopeKey,item);
  const limits=getBudgets(plan);
  let budget = 0;
  const scan = (parent: Node, begin: Node | null, end: Node | null,
    specs: readonly RegionNodeV2[], item: unknown, target: Zone,
    depth: number): Node | null => {
    if (!Array.isArray(specs) || depth > 64) mismatch("invalid region depth");
    let cursor = begin;
    for (const spec of specs) {
      if (++budget > limits.maxNodes || !spec || typeof spec !== "object")
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
                  event.path.some((key:string)=>!FIELD.test(key) || DENIED.has(key)))
                mismatch("compiled event descriptor");
              target.compiledEvents.push({
                elementId:spec.id+(target.key?":"+target.key:""),
                name:event.name,path:event.path
              });
            }
          }
          const scalar=syntheticRoot && depth===0 ? undefined : scalarChild(plan,spec);
          if(scalar){
            if(++budget>limits.maxNodes || depth+1>64 || !ID.test(scalar.id))
              mismatch("scalar region budget or identity");
            const expected=textOf(own(item,scalar.path));
            const first=element.firstChild;
            if(first && (first.nodeType!==3 || first.nextSibling || first.nodeValue!==expected))
              mismatch("scalar native text");
            if(!first && expected) mismatch("missing scalar native text");
            target.slots.push({spec:scalar,text:first as Text|null,anchor:element,item});
          }else if (scan(element,element.firstChild,null,spec.children,item,target,depth+1) !== null)
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
              cursor.nodeValue !== dataMarker(plan,spec.id,"start"))
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
              cursor.nodeValue !== dataMarker(plan,spec.id,"end"))
            mismatch("dynamic text end");
          target.slots.push({spec,text,anchor:cursor as Comment,item});
          cursor=cursor.nextSibling;
          break;
        }
        case "component": {
          if (!ID.test(spec.id) || !Array.isArray(spec.children) ||
              !cursor || cursor===end || cursor.nodeType!==8 ||
              cursor.nodeValue!=="zaakiy-r2:"+spec.id+":start")
            mismatch("component boundary start");
          const child=zone(target.key,item);
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
          const shown=Boolean(spec.source==="item" ? own(item,spec.path) : read(spec.path));
          const child=zone(target.key,item);
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
          const data=spec.source==="item" ? own(item,spec.path) : read(spec.path);
          if (!Array.isArray(data) || data.length > limits.maxRows) mismatch("keyed data collection");
          const start=cursor as Comment;
          cursor=cursor.nextSibling;
          const rows:Row[]=[];
          const seen=new Set<string>();
          if(spec.flat!==undefined){
            const template=flatTemplate(plan,spec);
            const nativeRows:FlatKeyedRow<unknown>[]=[];
            for(const item of data){
              if((budget+=2)>limits.maxNodes || depth+2>64)mismatch("flat row budget");
              const {key,value}=describeFlat(template,item);
              if(seen.has(key))mismatch("duplicate keyed identity");
              seen.add(key);
              if(!cursor||cursor===end||cursor.nodeType!==1)mismatch("flat native row");
              const node=cursor as Element;
              if(node.namespaceURI!=="http://www.w3.org/1999/xhtml"||node.localName!==template.tag||
                 node.getAttribute("data-zk")!==key||node.attributes.length!==template.attrs.length+1)
                mismatch("flat native identity or attributes");
              for(const [name,expected] of template.attrs)
                if(node.getAttribute(name)!==expected)mismatch("flat native attribute");
              const first=node.firstChild;
              if(first?(first.nodeType!==3||first.nextSibling!==null||first.nodeValue!==value):value!=="")
                mismatch("flat native scalar text");
              nativeRows.push({key,item,node,text:first as Text|null});
              cursor=node.nextSibling;
            }
            if(!cursor||cursor===end||cursor.nodeType!==8||cursor.nodeValue!=="zaakiy-r2:"+spec.id+":end")
              mismatch("flat list end");
            target.keyed.push({spec,parent,start,end:cursor as Comment,rows,flat:{template,rows:nativeRows}});
            cursor=cursor.nextSibling;
            break;
          }
          for (const item of data) {
            const key=rowKey(item,spec.key);
            if (seen.has(key)) mismatch("duplicate keyed identity");
            seen.add(key);
            if (!cursor || cursor === end || cursor.nodeType !== 8 ||
                cursor.nodeValue !== keyedMarker(plan,spec.id,key,"start"))
              mismatch("keyed item start");
            const rowStart=cursor as Comment;
            const child=zone(scopedKey(target.key,key),item);
            const first=cursor.nextSibling;
            cursor=scan(parent,first,end,spec.rows,item,child,depth+1);
            if (!cursor || cursor === end || cursor.nodeType !== 8 ||
                cursor.nodeValue !== keyedMarker(plan,spec.id,key,"end"))
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
  if (scan(container,root,null,plan.nodes,item,tree,0)!==null)
    mismatch("unlisted root siblings");
  return tree;
}

type DiscoveredEvent = {
  readonly event: Zone["compiledEvents"][number];
  readonly item: () => unknown;
};
/** Preserve the existing zone order and validate every identity before resolving callbacks. */
function discoverBindings(target:Zone, output:Map<string,Element>, events:DiscoveredEvent[]):void {
  for (const [id,node] of target.elements) {
    if (output.has(id)) mismatch("duplicate element ID");
    output.set(id,node);
  }
  for (const event of target.compiledEvents)
    events.push({event,item:()=>readItem(target)});
  for (const component of target.components) discoverBindings(component.child,output,events);
  for (const conditional of target.conditions) discoverBindings(conditional.child,output,events);
  for (const keyed of target.keyed)
    for (const row of keyed.rows) discoverBindings(row.child,output,events);
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
      (bindings.itemDataMode!==undefined && bindings.itemDataMode!=="snapshot") ||
      !Array.isArray(envelope?.boundaries) || envelope.boundaries.length!==1 ||
      envelope.boundaries[0]?.markerId!==plan.markerId ||
      envelope.boundaries[0]?.templateDigest!==plan.templateDigest)
    mismatch("plan and envelope identity");
  if (bindings.signal?.aborted) mismatch("navigation canceled");
  // v3 structural preflight validates the sole root marker and every native
  // descendant (including comment boundaries). Avoid a separate tree walk.
  const identity=plan.markerFormat==="compact-v3"
    ? validateHydrationIdentity(envelope,manifest,routeId)
    : inspectHydration(container,envelope,manifest,routeId);
  if(!identity.compatible)mismatch("build/route/marker identity");
  if(plan.markerFormat==="compact-v3"){
    if(bindings.itemDataMode!=="snapshot" || (bindings.events?.length??0)!==0)
      mismatch("compact-v3 requires immutable snapshots and compiler-declared events");
    validateFlatPlan(plan);
  }
  const tree=inspect(container,plan,bindings.read);
  const targetElements=new Map<string,Element>();
  const compiledEvents:DiscoveredEvent[]=[];
  discoverBindings(tree,targetElements,compiledEvents);
  const events=[...(bindings.events??[])];
  if(compiledEvents.length && typeof bindings.resolveEvent!=="function")
    mismatch("compiler event resolver required");
  for(const {event,item} of compiledEvents){
    const handler=bindings.resolveEvent!(event.path,item);
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
  const limits=getBudgets(plan);
  const read=bindings.read;
  const attachElements=(owner:OwnerScope,target:Zone):void=>{
    for(const [id,node] of target.elements){
      const explicit=eventMap.get(id);
      if(explicit) for(const event of explicit)
        listen(owner,node,event.name,event.handler,event.options);
      for(const descriptor of target.compiledEvents){
        if(descriptor.elementId!==id ||
            explicit?.some(event=>event.name===descriptor.name)) continue;
        const handler=bindings.resolveEvent?.(descriptor.path,()=>readItem(target));
        if(typeof handler!=="function") mismatch("missing compiled event handler");
        listen(owner,node,descriptor.name,handler);
      }
    }
  };
  const attachSlots=(owner:OwnerScope,slots:readonly Slot[]):void=>{
    for (const slot of slots) {
      if (!slot.text) {
        slot.text=slot.anchor.ownerDocument.createTextNode("");
        if(slot.anchor.nodeType===8) slot.anchor.parentNode!.insertBefore(slot.text,slot.anchor);
        else slot.anchor.appendChild(slot.text);
        inserted.push(slot.text);
      }
      if(slot.spec.source==="item" && bindings.itemDataMode==="snapshot"){
        // No reactive descriptor reads are permitted by this explicit contract.
        // Keyed replacement still uses updateSlots with full scalar validation.
        untrack(()=>setText(slot.text!,textOf(own(slot.item,slot.spec.path))));
      }else bindText(owner,slot.text,()=>slot.spec.source==="props"
        ? read(slot.spec.path):own(slot.item,slot.spec.path));
    }
  };
  const updateSlots=(target:Zone,item:unknown):void=>{
    target.itemValue=item;
    if(target.itemSignal) target.itemSignal.value=item;
    let changes:{slot:Slot;value:string}[]|undefined;
    for(const slot of target.slots) {
      if(slot.spec.source==="item") (changes??=[]).push({slot,value:textOf(own(item,slot.spec.path))});
    }
    if(changes) for(const change of changes){
      change.slot.item=item;
      if(change.slot.text) setText(change.slot.text,change.value);
    }
    for(const component of target.components) updateSlots(component.child,item);
    for(const condition of target.conditions) updateSlots(condition.child,item);
  };
  /**
   * Build only inert native nodes, then run the exact same structural preflight
   * as existing SSR markup. Ownership is attached after the fragment is inserted.
   * No HTML parser, eval or second JSX renderer.
   */
  const stage=(specs:readonly RegionNodeV2[],item:unknown,key:string):{
    readonly fragment:DocumentFragment;readonly discovered:Zone;
  }=>{
    const doc=container.ownerDocument;
    let nodes=0;
    const draw=(items:readonly RegionNodeV2[],row:unknown,depth:number):DocumentFragment=>{
      if(depth>64 || !Array.isArray(items)) mismatch("dynamic region depth");
      const fragment=doc.createDocumentFragment();
      for(const spec of items){
        if(++nodes>limits.maxNodes) mismatch("dynamic region node budget");
        if(spec.kind==="literal"){
          fragment.appendChild(doc.createTextNode(spec.value));
        } else if(spec.kind==="data"){
          fragment.appendChild(doc.createComment(dataMarker(plan,spec.id,"start")));
          const value=textOf(spec.source==="props"?read(spec.path):own(row,spec.path));
          if(value) fragment.appendChild(doc.createTextNode(value));
          fragment.appendChild(doc.createComment(dataMarker(plan,spec.id,"end")));
        } else if(spec.kind==="element"){
          if(!ID.test(spec.id) || !/^[a-z][a-z0-9-]*$/.test(spec.tag))
            mismatch("invalid native element template");
          const el=doc.createElement(spec.tag);
          for(const raw of spec.attrs){
            const parsed=ATTR.exec(raw);
            if(!parsed) mismatch("invalid compiled attribute");
            setAttribute(el,parsed[1]!,decodeAttr(parsed[2]!));
          }
          const scalar=scalarChild(plan,spec);
          if(scalar){
            if(++nodes>limits.maxNodes || depth+1>64 || !ID.test(scalar.id)) mismatch("scalar region budget or identity");
            const value=textOf(own(row,scalar.path));
            if(value) el.appendChild(doc.createTextNode(value));
          }else el.appendChild(draw(spec.children,row,depth+1));
          fragment.appendChild(el);
        } else if(spec.kind==="component"){
          fragment.appendChild(doc.createComment("zaakiy-r2:"+spec.id+":start"));
          fragment.appendChild(draw(spec.children,row,depth+1));
          fragment.appendChild(doc.createComment("zaakiy-r2:"+spec.id+":end"));
        } else if(spec.kind==="conditional"){
          fragment.appendChild(doc.createComment("zaakiy-r2:"+spec.id+":start"));
          fragment.appendChild(draw((spec.source==="item"?own(row,spec.path):read(spec.path))?spec.yes:spec.no,row,depth+1));
          fragment.appendChild(doc.createComment("zaakiy-r2:"+spec.id+":end"));
        } else if(spec.kind==="keyed"){
          const rows=spec.source==="item" ? own(row,spec.path) : read(spec.path);
          if(!Array.isArray(rows) || rows.length>limits.maxRows)
            mismatch("invalid nested keyed data");
          const keys=new Set<string>();
          fragment.appendChild(doc.createComment("zaakiy-r2:"+spec.id+":start"));
          const flat=spec.flat!==undefined?flatTemplate(plan,spec):undefined;
          for(const entry of rows){
            if(flat){
              if((nodes+=2)>limits.maxNodes||depth+2>64)mismatch("flat staged row budget");
              const {key,value}=describeFlat(flat,entry);
              if(keys.has(key))mismatch("duplicate nested keyed identity");
              keys.add(key);fragment.appendChild(createFlat(doc,flat,key,value));continue;
            }
            const rowKeyValue=rowKey(entry,spec.key);
            if(keys.has(rowKeyValue)) mismatch("duplicate nested keyed identity");
            keys.add(rowKeyValue);
            fragment.appendChild(doc.createComment(keyedMarker(plan,spec.id,rowKeyValue,"start")));
            fragment.appendChild(draw(spec.rows,entry,depth+1));
            fragment.appendChild(doc.createComment(keyedMarker(plan,spec.id,rowKeyValue,"end")));
          }
          fragment.appendChild(doc.createComment("zaakiy-r2:"+spec.id+":end"));
        } else mismatch("unrecognized native region node");
      }
      return fragment;
    };
    const fake=doc.createElement("section");
    const root=doc.createElement("div");
    root.appendChild(draw(specs,item,0));
    fake.append(doc.createComment("zaakiy-h:"+plan.markerId+":"+plan.templateDigest),root);
    const synthetic:RegionHydrationPlanV2={
      ...plan,nodes:[{kind:"element",id:"0".repeat(32),
        tag:"div",attrs:[],children:specs}]
    };
    const discovered=inspect(fake,synthetic,read,item,key,true);
    const fragment=doc.createDocumentFragment();
    while(root.firstChild) fragment.appendChild(root.firstChild);
    return {fragment,discovered};
  };
  const buildBranch=(specs:readonly RegionNodeV2[],owner:OwnerScope,item:unknown,key:string):Node=>{
    const prepared=stage(specs,item,key);
    onMount(()=>attachZone(owner,prepared.discovered));
    return prepared.fragment;
  };
  const buildRow=(spec:KeyedNode,owner:OwnerScope,item:unknown,key:string)=>{
    const prepared=stage(spec.rows,item,key);
    const node=prepared.fragment.firstChild;
    if(!node || node.nodeType!==1 || prepared.fragment.childNodes.length!==1)
      mismatch("keyed item requires a single native element");
    onMount(()=>attachZone(owner,prepared.discovered));
    return {node,update(next:unknown){updateSlots(prepared.discovered,next);}};
  };
  const attachZone=(owner:OwnerScope,target:Zone):void=>{
    attachSlots(owner,target.slots);
    attachElements(owner,target);
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
        {parent:condition.start.parentNode!,start:condition.start,end:condition.end},
        ()=>Boolean(condition.spec.source==="item" ? own(readItem(target),condition.spec.path) : read(condition.spec.path)),
        child=>buildBranch(condition.spec.yes,child,readItem(target),target.key),
        child=>buildBranch(condition.spec.no,child,readItem(target),target.key),
        {initialBranch:condition.shown,preserveMarkupOnDispose:true,
          adopt:child=>attachZone(child,condition.child)});
    }
    for (const list of target.keyed) {
      if(list.flat){
        const {template,rows}=list.flat;
        const path=list.spec.path;
        bindFlatKeyedRegion(owner,{parent:list.start.parentNode!,start:list.start,end:list.end},
          ()=>{
            const items=read(path);
            if(!Array.isArray(items)||items.length>limits.maxRows)mismatch("unsafe flat collection");
            return items as readonly unknown[];
          },item=>describeFlat(template,item),
          (key,value)=>createFlat(container.ownerDocument,template,key,value),rows);
        continue;
      }
      bindKeyedRegion(owner,{parent:list.start.parentNode!,start:list.start,end:list.end},
        ()=>{
          const rows=list.spec.source==="item" ? own(readItem(target),list.spec.path) : read(list.spec.path);
          if (!Array.isArray(rows) || rows.length>limits.maxRows)
            return mismatch("keyed collection changed to unsafe data");
          return rows as readonly unknown[];
        },
        item=>rowKey(item,list.spec.key),
        (item,child)=>buildRow(list.spec,child,item,scopedKey(target.key,rowKey(item,list.spec.key))),
        {initial:list.rows.map(row=>({
          key:row.key,item:row.item,start:row.start,end:row.end,
          adopt:(_item,child)=>{
            attachZone(child,row.child);
            return {node:row.node,update(next:unknown){updateSlots(row.child,next);}};
          }
        })),preserveMarkupOnDispose:true,
        markerForKey:(key,doc)=>({
          start:doc.createComment(keyedMarker(plan,list.spec.id,key,"start")),
          end:doc.createComment(keyedMarker(plan,list.spec.id,key,"end"))
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
