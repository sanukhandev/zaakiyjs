/** Shared validated region metadata and scalar primitives. No generic attachment engine. */
import {setAttribute} from "@zaakiyjs/dom/compiler";
import type {FlatKeyedRow} from "@zaakiyjs/dom/compiler";
import type {RegionNodeV2,RegionHydrationPlanV2} from "./hydrate-region.js";

export const ID = /^[a-f0-9]{32}$/;
export const HASH = /^[a-f0-9]{64}$/;
export const FIELD = /^[A-Za-z_$][\w$]*$/;
const SAFE_KEY = /^[A-Za-z0-9_.:]{1,64}$/;
export const ATTR = /^ ([a-z][a-z0-9:_-]*)="([^"]*)"$/;
export const EVENT = /^[a-z][a-z0-9:_-]*$/;
export const DENIED = new Set(["__proto__", "constructor", "prototype"]);
const MAX_NODES = 8192;
export function dataMarker(plan:RegionHydrationPlanV2,id:string,side:"start"|"end"):string{
  return plan.markerFormat!==undefined
    ? "z-d:"+id.slice(0,16)+":"+(side==="start"?"s":"e")
    : "zaakiy-d2:"+id+":"+side;
}
export function keyedMarker(plan:RegionHydrationPlanV2,id:string,key:string,side:"start"|"end"):string{
  return plan.markerFormat!==undefined
    ? "z-k:"+key+":"+(side==="start"?"s":"e")
    : "zaakiy-k2:"+id+":"+key+":"+side;
}

export function getBudgets(plan:RegionHydrationPlanV2){
  if(plan.markerFormat!==undefined && plan.markerFormat!=="compact-v1" && plan.markerFormat!=="compact-v2" && plan.markerFormat!=="compact-v3")
    mismatch("unsupported hydration marker format");
  if(plan.markerFormat!==undefined && !plan.limits)
    mismatch("compact markers require an approved large-list plan");
  if(plan.limits===undefined) return {maxRows:4096,maxNodes:MAX_NODES};
  const limits=plan.limits;
  if(!limits || limits.maxRows!==10000 || limits.maxNodes!==50000 ||
      limits.maxHtmlBytes!==8388608 || Object.keys(limits).length!==3)
    mismatch("invalid compiler-selected hydration scale");
  return limits;
}

export type ComponentNode = Extract<RegionNodeV2, {kind:"component"}>;
export type ConditionalNode = Extract<RegionNodeV2, {kind:"conditional"}>;
export type KeyedNode = Extract<RegionNodeV2, {kind:"keyed"}>;
export type DataNode = Extract<RegionNodeV2, {kind:"data"}>;
export type ElementNode = Extract<RegionNodeV2, {kind:"element"}>;
// compact-v2 uses the verified native element as the boundary for a sole
// item-derived scalar. Exclude parser-sensitive/raw-text elements.
export function scalarChild(plan:RegionHydrationPlanV2,spec:ElementNode):DataNode|undefined {
  if((plan.markerFormat!=="compact-v2" && plan.markerFormat!=="compact-v3") || spec.children.length!==1 ||
      !/^(?:li|span|p|div|button|h[1-6])$/.test(spec.tag)) return undefined;
  const child=spec.children[0];
  return child?.kind==="data" && child.source==="item" ? child : undefined;
}

export function mismatch(reason: string): never { throw new TypeError("Region hydration mismatch: " + reason); }
export function textOf(value: unknown): string {
  if (value == null || typeof value === "boolean") return "";
  if (typeof value !== "string" && typeof value !== "number" && typeof value !== "bigint")
    return mismatch("nonprimitive data text");
  const text = String(value);
  if (text.length > 65536) return mismatch("data text budget");
  return text;
}
export function own(item: unknown, path: readonly string[]): unknown {
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
export function rowKey(item: unknown, name: string): string {
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
export function decodeAttr(value: string): string {
  return value.replace(/&quot;/g,'"').replace(/&#39;/g,"'")
    .replace(/&lt;/g,"<").replace(/&gt;/g,">").replace(/&amp;/g,"&");
}
export function attributes(element: Element, values: readonly string[]): void {
  if (!Array.isArray(values)) mismatch("invalid static attributes");
  if (values.length === 0) {
    if (element.attributes.length !== 0) mismatch("unexpected native attributes");
    return;
  }
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
/** Parse a repeated resource-free row definition once, never per native row. */
export interface FlatTemplate {
  readonly tag:string;
  readonly attrs:readonly (readonly [string,string])[];
  readonly keyField:string;
  readonly textField:string;
}
export function safeField(field:unknown):field is string {
  return typeof field==="string" && FIELD.test(field) && !DENIED.has(field);
}
export function flatTemplate(plan:RegionHydrationPlanV2,spec:KeyedNode):FlatTemplate {
  const leaf=spec.rows[0];
  if(plan.markerFormat!=="compact-v3" || spec.flat!==true ||
      (spec.source!==undefined && spec.source!=="props") || !Array.isArray(spec.path) ||
      spec.path.length<1 || spec.path.length>4 || !spec.path.every(safeField) ||
      spec.rows.length!==1 || leaf?.kind!=="element" || !ID.test(leaf.id) ||
      !Array.isArray(leaf.attrs) || !Array.isArray(leaf.children) ||
      (leaf.events!==undefined && (!Array.isArray(leaf.events)||leaf.events.length!==0)) ||
      !safeField(spec.key)) mismatch("invalid flat keyed template");
  const child=scalarChild(plan,leaf);
  if(!child || !ID.test(child.id) || !Array.isArray(child.path) ||
      child.path.length!==1 || !safeField(child.path[0])) mismatch("invalid flat scalar field");
  const attrs:[string,string][]=[];
  const seen=new Set<string>(["data-zk"]);
  for(const raw of leaf.attrs){
    const parsed=typeof raw==="string"?ATTR.exec(raw):null;
    if(!parsed || !/^(?:class|role|title|tabindex|data-[a-z0-9_-]+|aria-[a-z0-9_-]+)$/.test(parsed[1]!) ||
       seen.has(parsed[1]!)) mismatch("invalid flat static attribute");
    const value=decodeAttr(parsed[2]!);
    if(encoded(value)!==parsed[2]) mismatch("invalid flat attribute encoding");
    seen.add(parsed[1]!);attrs.push([parsed[1]!,value]);
  }
  return {tag:leaf.tag,attrs,keyField:spec.key,textField:child.path[0]!};
}
function readFlatField(item:object,field:string):unknown{
  const descriptor=Object.getOwnPropertyDescriptor(item,field);
  if(!descriptor)return null;
  if(!Object.hasOwn(descriptor,"value"))mismatch("getter in flat row data");
  return descriptor.value;
}
export function describeFlat(template:FlatTemplate,item:unknown):{key:string;value:string}{
  if(!item || typeof item!=="object" || Array.isArray(item)) mismatch("invalid flat row data");
  const proto=Object.getPrototypeOf(item);
  if(proto!==Object.prototype && proto!==null) mismatch("nonplain flat row data");
  const raw=readFlatField(item,template.keyField);
  if(typeof raw!=="string" && typeof raw!=="number")mismatch("invalid keyed identity");
  const key=String(raw);
  if(!SAFE_KEY.test(key))mismatch("unsafe keyed identity");
  return {key,value:textOf(readFlatField(item,template.textField))};
}
export function createFlat(doc:Document,template:FlatTemplate,key:string,value:string):Element{
  const node=doc.createElement(template.tag);
  for(const [name,attr] of template.attrs)setAttribute(node,name,attr);
  setAttribute(node,"data-zk",key);
  if(value)node.appendChild(doc.createTextNode(value));
  return node;
}
/** Compiler IDs in v3 are globally unique template identities. Validate once
 * before any callback/attachment; row identity is then list scope plus key. */
export function validateFlatPlan(plan:RegionHydrationPlanV2):void{
  const ids=new Set<string>();
  let budget=0;
  const visit=(nodes:readonly RegionNodeV2[],depth:number):void=>{
    if(!Array.isArray(nodes)||depth>64)mismatch("invalid flat plan depth");
    for(const node of nodes){
      if(!node || ++budget>50000)mismatch("flat template budget");
      if(node.kind!=="literal"){
        if(!ID.test(node.id)||ids.has(node.id))mismatch("duplicate or invalid flat template identity");
        ids.add(node.id);
      }
      if(node.kind==="element"||node.kind==="component")visit(node.children,depth+1);
      else if(node.kind==="conditional"){visit(node.yes,depth+1);visit(node.no,depth+1);}
      else if(node.kind==="keyed"){
        if(node.flat!==undefined)flatTemplate(plan,node);
        visit(node.rows,depth+1);
      }else if(node.kind!=="literal"&&node.kind!=="data")mismatch("unsupported flat plan node");
    }
  };
  visit(plan.nodes,0);
}

/** Verify every native scalar row. Shared by specialized and generic entrypoints. */
export function inspectFlatRows(template:FlatTemplate,data:readonly unknown[],
  begin:Node|null,end:Node|null):{rows:FlatKeyedRow<unknown>[];cursor:Node|null}{
  const rows:FlatKeyedRow<unknown>[]=[];
  const seen=new Set<string>();
  let cursor=begin;
  const attrCount=template.attrs.length+1;
  for(const item of data){
    const {key,value}=describeFlat(template,item);
    if(seen.has(key))mismatch("duplicate keyed identity");
    seen.add(key);
    if(!cursor||cursor===end||cursor.nodeType!==1)mismatch("flat native row");
    const node=cursor as Element;
    if(node.namespaceURI!=="http://www.w3.org/1999/xhtml"||node.localName!==template.tag||
       node.getAttribute("data-zk")!==key||node.attributes.length!==attrCount)
      mismatch("flat native identity or attributes");
    for(const [name,expected] of template.attrs)
      if(node.getAttribute(name)!==expected)mismatch("flat native attribute");
    const first=node.firstChild;
    if(first?(first.nodeType!==3||first.nextSibling!==null||first.nodeValue!==value):value!=="")
      mismatch("flat native scalar text");
    rows.push({key,item,node,text:first as Text|null});
    cursor=node.nextSibling;
  }
  return {rows,cursor};
}
