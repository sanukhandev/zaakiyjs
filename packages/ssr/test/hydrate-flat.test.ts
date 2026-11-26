// @vitest-environment jsdom
import {describe,it,expect} from "vitest";
import {signal,flushSync} from "@zaakiyjs/signals";
import {hydrateFlatPage} from "../src/hydrate-flat.js";
import {hydrateRegionPage} from "../src/hydrate-region.js";
import type {RegionHydrationPlanV2} from "../src/hydrate-region.js";
import type {HydrationEnvelopeV1,TrustedServerBuildManifestV1} from "../src/protocol.js";
const id=(n:number)=>n.toString(16).padStart(32,"0");
const routeId="flat",markerId=id(20),digest="a".repeat(64),buildId="b".repeat(64);
const plan:RegionHydrationPlanV2={
  schema:"zaakiy.region-hydration/2",routeId,markerId,templateDigest:digest,
  markerFormat:"compact-v3",limits:{maxRows:10000,maxNodes:50000,maxHtmlBytes:8388608},
  nodes:[{kind:"element",id:id(1),tag:"main",attrs:[],children:[
    {kind:"element",id:id(2),tag:"input",attrs:[],children:[]},
    {kind:"element",id:id(3),tag:"button",attrs:[],events:[{name:"click",path:["onCount"]}],children:[
      {kind:"literal",value:"Count: "},{kind:"data",id:"c".repeat(32),source:"props",path:["count"]}
    ]},
    {kind:"conditional",id:id(4),path:["shown"],source:"props",
      yes:[{kind:"element",id:id(5),tag:"p",attrs:[],children:[{kind:"literal",value:"Visible"}]}],
      no:[{kind:"element",id:id(6),tag:"p",attrs:[],children:[{kind:"literal",value:"Hidden"}]}]},
    {kind:"element",id:id(7),tag:"ul",attrs:[],children:[
      {kind:"keyed",id:id(8),path:["rows"],source:"props",itemName:"item",key:"id",flat:true,rows:[
        {kind:"element",id:id(9),tag:"li",attrs:[' data-key="row"'],children:[
          {kind:"data",id:"d".repeat(32),source:"item",path:["label"]}
        ]}
      ]}
    ]}
  ]}]
};
const manifest:TrustedServerBuildManifestV1={schema:"zaakiy.render-manifest/1",buildId,domAbiVersion:1,irVersion:1,
  routes:{flat:{routeId,moduleId:"flat",sourceDigest:"e".repeat(64)}}};
const envelope:HydrationEnvelopeV1={schema:"zaakiy.hydration/1",buildId,routeId,domAbiVersion:1,
  boundaries:[{markerId,templateDigest:digest}],payload:null};
const fixture=()=>{
  const host=document.createElement("section");
  host.innerHTML='<!--zaakiy-h:'+markerId+':'+digest+'--><main><input><button>Count: <!--z-d:'+"c".repeat(16)+':s-->0<!--z-d:'+"c".repeat(16)+':e--></button>'+
    '<!--zaakiy-r2:'+id(4)+':start--><p>Visible</p><!--zaakiy-r2:'+id(4)+':end-->'+
    '<ul><!--zaakiy-r2:'+id(8)+':start--><li data-key="row" data-zk="a">Alpha</li><li data-key="row" data-zk="b">Beta</li><!--zaakiy-r2:'+id(8)+':end--></ul></main>';
  return host;
};
const state=()=>({count:0,shown:true,rows:[{id:"a",label:"Alpha"},{id:"b",label:"Beta"}]});
describe("compiler-selected flat-v3 client",()=>{
  for(const attach of [hydrateFlatPage,hydrateRegionPage]){
    it("preserves equivalent identity, updates, focus, lifecycle and cancellation: "+attach.name,()=>{
      const host=fixture();document.body.appendChild(host);
      const original=host.innerHTML,input=host.querySelector("input")!,button=host.querySelector("button")!;
      const first=host.querySelector("li")!,app=signal(state()),abort=new AbortController();
      input.value="draft";input.focus();
      const handle=attach(host,plan,envelope,manifest,routeId,{
        itemDataMode:"snapshot",signal:abort.signal,read:path=>app.value[path[0] as keyof ReturnType<typeof state>],
        resolveEvent:()=>()=>{app.value={...app.value,count:app.value.count+1};}
      });
      try{
        expect(host.innerHTML).toBe(original);
        expect(document.activeElement).toBe(input);
        button.click();flushSync();
        expect(button.textContent).toBe("Count: 1");
        flushSync(()=>{app.value={...app.value,shown:false,rows:[app.value.rows[1]!,{id:"a",label:"<safe>"}]};});
        expect(host.querySelector("p")?.textContent).toBe("Hidden");
        expect(host.querySelectorAll("li")[1]).toBe(first);
        expect(first.textContent).toBe("<safe>");
        expect(input.value).toBe("draft");
        const before=host.innerHTML;
        expect(()=>flushSync(()=>{app.value={...app.value,rows:[{id:"a",label:"x"},{id:"a",label:"y"}]};})).toThrow(/Duplicate key/);
        expect(host.innerHTML).toBe(before);
        abort.abort();
        button.click();flushSync(()=>{app.value=state();});
        expect(host.innerHTML).toBe(before);
      }finally{handle.dispose();host.remove();}
    });
  }
  it("rejects tampering and invalid handlers before attaching",()=>{
    const data=state();
    const read=(path:readonly string[])=>data[path[0] as keyof typeof data];
    for(const corrupt of [
      (host:Element)=>host.querySelector("li")!.setAttribute("data-extra","unexpected"),
      (host:Element)=>host.querySelector("li")!.appendChild(document.createComment("unexpected")),
      (host:Element)=>host.querySelector("li")!.setAttribute("data-zk","wrong"),
      (host:Element)=>host.querySelector("li")!.textContent="Wrong"
    ]){
      const host=fixture();corrupt(host);const before=host.innerHTML;
      let resolutions=0;
      expect(()=>hydrateFlatPage(host,plan,envelope,manifest,routeId,{
        read,itemDataMode:"snapshot",resolveEvent:()=>{resolutions++;return ()=>undefined;}
      })).toThrow(/mismatch/);
      expect(resolutions).toBe(0);expect(host.innerHTML).toBe(before);
    }
    const host=fixture();
    expect(()=>hydrateFlatPage(host,plan,envelope,manifest,routeId,{read,itemDataMode:"snapshot"})).toThrow(/resolver/);
    expect(()=>hydrateFlatPage(host,{...plan,markerFormat:"compact-v2"},envelope,manifest,routeId,{read,itemDataMode:"snapshot"})).toThrow(/identity/);
  });
  it("checks native layout and snapshot together after the initial reactive read",()=>{
    const host=fixture(),data=state();let reads=0;
    expect(()=>hydrateFlatPage(host,plan,envelope,manifest,routeId,{
      itemDataMode:"snapshot",resolveEvent:()=>()=>undefined,
      read:path=>{
        if(path[0]==="rows"&&++reads===2)host.querySelector("li")!.setAttribute("data-zk","changed");
        return data[path[0] as keyof typeof data];
      }
    })).toThrow(/layout mismatch/);
    expect(reads).toBe(2);
  });
});
