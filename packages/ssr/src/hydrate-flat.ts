/** Compiler-selected compact-v3 route entry. No component or range-list interpreter. */
import {bindText,listen,setAttribute,bindConditionalRegion,bindFlatKeyedRegion} from "@zaakiyjs/dom/compiler";
import {hydrate} from "@zaakiyjs/dom";
import type {HydrationMountHandle} from "@zaakiyjs/dom";
import type {FlatKeyedRow,DomRegion} from "@zaakiyjs/dom/compiler";
import type {RegionHydrationPlanV2,RegionHydrationBindingsV2,RegionNodeV2} from "./hydrate-region.js";
import type {HydrationEnvelopeV1,TrustedServerBuildManifestV1} from "./protocol.js";
import {validateHydrationIdentity} from "./hydration-probe.js";
import {ID,HASH,ATTR,EVENT,attributes,decodeAttr,describeFlat,createFlat,flatTemplate,
  getBudgets,inspectFlatRows,mismatch,safeField,textOf,dataMarker,validateFlatPlan} from "./region-validation.js";
import type {FlatTemplate,ConditionalNode} from "./region-validation.js";

const TAG=/^(?:main|div|section|article|header|footer|nav|aside|p|span|strong|em|small|h[1-6]|ul|ol|li|dl|dt|dd|label|button|input|br|hr)$/;
const STATIC_ATTR=/^(?:class|role|title|tabindex|type|name|value|placeholder|id|for|data-[a-z0-9_-]+|aria-[a-z0-9_-]+)$/;
type Path=readonly string[];
type Slot={path:Path;anchor:Comment;text:Text|null;initial:string};
type EventSeed={node:Element;name:string;path:Path};
type ConditionSeed={region:DomRegion;spec:ConditionalNode;shown:boolean};
type ListSeed={region:DomRegion;path:Path;template:FlatTemplate;rows:FlatKeyedRow<unknown>[]};
function pathValid(path:Path):boolean{
  return Array.isArray(path)&&path.length>=1&&path.length<=4&&path.every(safeField);
}
/** Validate all branches before any DOM operation; compiler chooses this same
 * restricted capability. Unsupported plans fail closed, never silently fall back. */
function validateCapabilities(plan:RegionHydrationPlanV2):void{
  validateFlatPlan(plan);
  const visit=(nodes:readonly RegionNodeV2[],staticOnly=false):void=>{
    for(const node of nodes){
      if(node.kind==="element"){
        if(!TAG.test(node.tag)||!Array.isArray(node.attrs))mismatch("specialized element");
        const names=new Set<string>();
        for(const raw of node.attrs){
          const attr=typeof raw==="string"?ATTR.exec(raw):null;
          if(!attr||!STATIC_ATTR.test(attr[1]!)||names.has(attr[1]!))mismatch("specialized static attribute");
          names.add(attr[1]!);
        }
        if(node.events!==undefined){
          if(staticOnly||!Array.isArray(node.events)||node.events.length>16)mismatch("specialized event scope");
          const events=new Set<string>();
          for(const event of node.events){
            if(!event||!EVENT.test(event.name)||!pathValid(event.path)||events.has(event.name))mismatch("specialized event");
            events.add(event.name);
          }
        }
        visit(node.children,staticOnly);
      }else if(node.kind==="literal"){
        if(typeof node.value!=="string")mismatch("specialized literal");
      }else if(!staticOnly&&node.kind==="data"&&node.source==="props"&&pathValid(node.path)){
        continue;
      }else if(!staticOnly&&node.kind==="conditional"&&(node.source===undefined||node.source==="props")&&pathValid(node.path)){
        visit(node.yes,true);visit(node.no,true);
      }else if(!staticOnly&&node.kind==="keyed"&&node.flat===true&&(node.source===undefined||node.source==="props")){
        continue; // validateFlatPlan already validates the complete flat template.
      }else mismatch("unsupported specialized capability");
    }
  };
  if(plan.nodes.length!==1||plan.nodes[0]?.kind!=="element")mismatch("specialized root");
  visit(plan.nodes);
}
function buildStatic(doc:Document,nodes:readonly RegionNodeV2[]):DocumentFragment{
  const result=doc.createDocumentFragment();
  for(const spec of nodes){
    if(spec.kind==="literal")result.appendChild(doc.createTextNode(spec.value));
    else if(spec.kind==="element"){
      const el=doc.createElement(spec.tag);
      for(const raw of spec.attrs){
        const attr=ATTR.exec(raw)!;
        setAttribute(el,attr[1]!,decodeAttr(attr[2]!));
      }
      el.appendChild(buildStatic(doc,spec.children));result.appendChild(el);
    }else mismatch("nonstatic specialized branch");
  }
  return result;
}
function expectComment(node:Node|null,value:string):Comment{
  if(!node||node.nodeType!==8||node.nodeValue!==value)mismatch("specialized marker");
  return node as Comment;
}
function bindList(owner:HydrationMountHandle["owner"],seed:ListSeed,read:RegionHydrationBindingsV2["read"],maxRows:number,doc:Document):void{
  // Do not capture the seed/initial row array in long-lived callbacks.
  const {region,path,template,rows}=seed;
  bindFlatKeyedRegion(owner,region,()=>{
    const items=read(path);
    if(!Array.isArray(items)||items.length>maxRows)mismatch("unsafe flat collection");
    return items as readonly unknown[];
  },item=>describeFlat(template,item),(key,value)=>createFlat(doc,template,key,value),rows);
}

export function hydrateFlatPage(container:Element,plan:RegionHydrationPlanV2,
  envelope:HydrationEnvelopeV1,manifest:TrustedServerBuildManifestV1,routeId:string,
  bindings:RegionHydrationBindingsV2):HydrationMountHandle{
  if(!container||container.nodeType!==1||!plan||plan.schema!=="zaakiy.region-hydration/2"||
    plan.markerFormat!=="compact-v3"||plan.routeId!==routeId||!ID.test(plan.markerId)||
    !HASH.test(plan.templateDigest)||!Array.isArray(plan.nodes)||!bindings||
    typeof bindings.read!=="function"||bindings.itemDataMode!=="snapshot"||
    (bindings.events?.length??0)!==0||!Array.isArray(envelope?.boundaries)||
    envelope.boundaries.length!==1||envelope.boundaries[0]?.markerId!==plan.markerId||
    envelope.boundaries[0]?.templateDigest!==plan.templateDigest)
    mismatch("specialized plan and envelope identity");
  if(bindings.signal?.aborted)mismatch("navigation canceled");
  if(!validateHydrationIdentity(envelope,manifest,routeId).compatible)mismatch("build/route/marker identity");
  const limits=getBudgets(plan);
  validateCapabilities(plan);
  const root=container.childNodes[1];
  if(container.childNodes.length!==2||!root||root.nodeType!==1)mismatch("route root");
  expectComment(container.firstChild,"zaakiy-h:"+plan.markerId+":"+plan.templateDigest);
  const read=bindings.read,doc=container.ownerDocument;
  let budget=0;
  const slots:Slot[]=[],events:EventSeed[]=[],conditions:ConditionSeed[]=[],lists:ListSeed[]=[];
  const scan=(parent:Node,begin:Node|null,nodes:readonly RegionNodeV2[],depth:number):Node|null=>{
    let cursor=begin;
    for(const spec of nodes){
      if(++budget>limits.maxNodes||depth>64)mismatch("specialized structural budget");
      switch(spec.kind){
        case "element":{
          if(!cursor||cursor.nodeType!==1)mismatch("specialized native element");
          const el=cursor as Element;
          if(el.namespaceURI!=="http://www.w3.org/1999/xhtml"||el.localName!==spec.tag)mismatch("specialized native tag");
          attributes(el,spec.attrs);
          if(spec.events)for(const event of spec.events)events.push({node:el,name:event.name,path:event.path});
          if(scan(el,el.firstChild,spec.children,depth+1)!==null)mismatch("unlisted native children");
          cursor=el.nextSibling;break;
        }
        case "literal":
          if(!cursor||cursor.nodeType!==3||cursor.nodeValue!==spec.value)mismatch("static literal");
          cursor=cursor.nextSibling;break;
        case "data":{
          cursor=expectComment(cursor,dataMarker(plan,spec.id,"start")).nextSibling;
          const value=textOf(read(spec.path));
          let text:Text|null=null;
          if(cursor?.nodeType===3){
            text=cursor as Text;if(text.data!==value)mismatch("initial data text");cursor=text.nextSibling;
          }else if(value)mismatch("missing data text");
          const anchor=expectComment(cursor,dataMarker(plan,spec.id,"end"));
          slots.push({path:spec.path,anchor,text,initial:value});cursor=anchor.nextSibling;break;
        }
        case "conditional":{
          const start=expectComment(cursor,"zaakiy-r2:"+spec.id+":start");
          const shown=Boolean(read(spec.path));
          cursor=scan(parent,start.nextSibling,shown?spec.yes:spec.no,depth+1);
          const end=expectComment(cursor,"zaakiy-r2:"+spec.id+":end");
          conditions.push({region:{parent,start,end},spec,shown});cursor=end.nextSibling;break;
        }
        case "keyed":{
          const start=expectComment(cursor,"zaakiy-r2:"+spec.id+":start");
          const data=read(spec.path);
          if(!Array.isArray(data)||data.length>limits.maxRows||
            (budget+=2*data.length)>limits.maxNodes||(data.length>0&&depth+2>64))mismatch("flat row budget");
          const template=flatTemplate(plan,spec);
          const verified=inspectFlatRows(template,data,start.nextSibling,null);
          const end=expectComment(verified.cursor,"zaakiy-r2:"+spec.id+":end");
          lists.push({region:{parent,start,end},path:spec.path,template,rows:verified.rows});
          cursor=end.nextSibling;break;
        }
        default:mismatch("unsupported specialized node");
      }
    }
    return cursor;
  };
  if(scan(container,root,plan.nodes,0)!==null)mismatch("unlisted root siblings");
  if(events.length>4096||events.length&&typeof bindings.resolveEvent!=="function")mismatch("specialized event count or resolver");
  const handlers=events.map(event=>{
    const handler=bindings.resolveEvent!(event.path,()=>null);
    if(typeof handler!=="function")mismatch("compiled event handler unavailable");
    return {...event,handler};
  });
  if(bindings.signal?.aborted)mismatch("navigation canceled");
  const inserted:Text[]=[];
  try{
    const handle=hydrate(root,owner=>{
      for(const slot of slots){
        const text=slot.text??doc.createTextNode("");
        if(!slot.text){slot.anchor.parentNode!.insertBefore(text,slot.anchor);inserted.push(text);}
        const {path,initial}=slot;let first=true;
        bindText(owner,text,()=>{
          const value=textOf(read(path));
          if(first&&value!==initial)mismatch("text changed during preflight");
          first=false;return value;
        });
      }
      for(const {node,name,handler} of handlers)listen(owner,node,name,handler);
      for(const {region,spec,shown} of conditions){
        let first=true;
        bindConditionalRegion(owner,region,()=>{
          const active=Boolean(read(spec.path));
          if(first&&active!==shown)mismatch("condition changed during preflight");
          first=false;return active;
        },()=>buildStatic(doc,spec.yes),()=>buildStatic(doc,spec.no),
        {initialBranch:shown,preserveMarkupOnDispose:true,adopt:()=>undefined});
      }
      for(const seed of lists)bindList(owner,seed,read,limits.maxRows,doc);
    });
    // Initial row records must not remain reachable through this function's
    // lexical environment after the list effect has taken ownership.
    lists.length=0;slots.length=0;events.length=0;conditions.length=0;handlers.length=0;inserted.length=0;
    const signal=bindings.signal;
    if(!signal)return handle;
    let disposed=false;
    const close=()=>{if(disposed)return;disposed=true;signal.removeEventListener("abort",close);handle.dispose();};
    signal.addEventListener("abort",close,{once:true});
    if(signal.aborted)close();
    return {root:handle.root,owner:handle.owner,dispose:close};
  }catch(error){
    for(const text of inserted)text.parentNode?.removeChild(text);
    throw error;
  }
}
