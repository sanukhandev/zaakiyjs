/** H4-E opt-in atomic recovery of one compiler-owned v2 region.
 * Do not use for build, route, trust, tenant or manifest identity mismatches.
 */
import { hydrateRegionPage } from "./hydrate-region.js";
import type { RegionHydrationPlanV2,RegionHydrationBindingsV2,RegionNodeV2 } from "./hydrate-region.js";
import { inspectHydration } from "./client.js";
import type { HydrationEnvelopeV1,TrustedServerBuildManifestV1 } from "./protocol.js";
import type { HydrationMountHandle } from "@zaakiyjs/dom";

export interface RegionRecoveryOptions {
  /** A compiler region ID, not a free-form CSS selector. */
  readonly boundaryId:string;
  /** Trusted native-node factory; never HTML strings or parsed markup. */
  readonly prepare:()=>Node | readonly Node[];
}
const ID=/^[a-f0-9]{32}$/;
function compilerBoundaryCount(nodes:readonly RegionNodeV2[],id:string):number {
  let count=0;
  for(const node of nodes){
    if(node.kind==="component" || node.kind==="conditional" || node.kind==="keyed"){
      if(node.id===id) count++;
      if(node.kind==="component") count+=compilerBoundaryCount(node.children,id);
      else if(node.kind==="conditional")
        count+=compilerBoundaryCount(node.yes,id)+compilerBoundaryCount(node.no,id);
      else count+=compilerBoundaryCount(node.rows,id);
    }else if(node.kind==="element"){
      count+=compilerBoundaryCount(node.children,id);
    }
  }
  return count;
}
function snapshot(start:Comment,end:Comment):Node[]{
  const nodes:Node[]=[];
  let cursor=start.nextSibling;
  while(cursor && cursor!==end){
    if(nodes.length>=4096) throw new RangeError("H4 recovered region exceeds node budget");
    nodes.push(cursor);cursor=cursor.nextSibling;
  }
  if(cursor!==end) throw new TypeError("H4 recovered region markers not ordered");
  return nodes;
}
export function hydrateRegionPageRecoverBoundary(
  container:Element,plan:RegionHydrationPlanV2,
  envelope:HydrationEnvelopeV1,manifest:TrustedServerBuildManifestV1,
  routeId:string,bindings:RegionHydrationBindingsV2,
  recovery:RegionRecoveryOptions
):HydrationMountHandle {
  if(!container || !plan || !bindings || !recovery ||
    typeof recovery.prepare!=="function" || !ID.test(recovery.boundaryId) ||
    plan.schema!=="zaakiy.region-hydration/2" || plan.routeId!==routeId ||
    !Array.isArray(plan.nodes) ||
    compilerBoundaryCount(plan.nodes,recovery.boundaryId)!==1 ||
    !inspectHydration(container,envelope,manifest,routeId).compatible ||
    envelope.boundaries.length!==1 ||
    envelope.boundaries[0]?.markerId!==plan.markerId ||
    envelope.boundaries[0]?.templateDigest!==plan.templateDigest){
    throw new TypeError("H4 recovery requires unique compiler-owned and trusted region");
  }
  if(bindings.signal?.aborted) throw new Error("H4 recovery canceled");
  // A successful first adoption must remain zero-mutation.
  try{return hydrateRegionPage(container,plan,envelope,manifest,routeId,bindings);}
  catch(initialError){
    if(bindings.signal?.aborted) throw initialError;
    const doc=container.ownerDocument;
    const walker=doc.createTreeWalker(container,128);
    const startLabel="zaakiy-r2:"+recovery.boundaryId+":start";
    const endLabel="zaakiy-r2:"+recovery.boundaryId+":end";
    let start:Comment|undefined,end:Comment|undefined;
    let foundStart=0,foundEnd=0;
    while(walker.nextNode()){
      const node=walker.currentNode as Comment;
      if(node.data===startLabel){start=node;foundStart++;}
      if(node.data===endLabel){end=node;foundEnd++;}
    }
    if(!start || !end || foundStart!==1 || foundEnd!==1 ||
      !start.parentNode || start.parentNode!==end.parentNode)
      throw new TypeError("H4 recovery markers absent, duplicate or unowned",{cause:initialError});
    const old=snapshot(start,end);
    const parent=start.parentNode;
    const result=recovery.prepare();
    const replacements=Array.isArray(result)?result:[result as Node];
    if(replacements.length>4096 || new Set(replacements).size!==replacements.length ||
      replacements.some(node=>!node || node.ownerDocument!==doc || node.parentNode!==null ||
        node.nodeType===9 || node.nodeType===10 || node.nodeType===11))
      throw new TypeError("H4 recovery factory must return unique detached native nodes");
    if(bindings.signal?.aborted) throw new Error("H4 recovery canceled");
    let inserted=false;
    try {
      const staged=doc.createDocumentFragment();
      for(const node of replacements) staged.appendChild(node);
      parent.insertBefore(staged,end);
      inserted=true;
      for(const node of old) parent.removeChild(node);
      if(bindings.signal?.aborted) throw new Error("H4 recovery canceled");
      return hydrateRegionPage(container,plan,envelope,manifest,routeId,bindings);
    }catch(error){
      if(inserted){
        for(const node of replacements) node.parentNode?.removeChild(node);
        for(const node of old) parent.insertBefore(node,end);
      }
      throw error;
    }
  }
}
