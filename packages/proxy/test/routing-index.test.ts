import {createServer, type Server} from "node:http";
import {describe,expect,it} from "vitest";
import {createProxyRouter} from "../src/index.js";
import type {ProxyConfig,ProxyOutgoing} from "../src/index.js";

async function serverFixture():Promise<{port:number;close:()=>Promise<void>}>{
 const server:Server=createServer((request,response)=>{
  response.setHeader("content-type","text/plain");
  response.end(request.url??"");
 });
 await new Promise<void>(resolve=>server.listen(0,"127.0.0.1",resolve));
 const addr=server.address();
 if(!addr||typeof addr==="string")throw Error("missing test port");
 return {port:addr.port,close:async()=>{
  server.closeAllConnections();
  await new Promise<void>(resolve=>server.close(()=>resolve()));
 }};
}
async function collect(response:ProxyOutgoing):Promise<string>{
 const bytes:Buffer[]=[];
 if(response.body)for await(const value of response.body)bytes.push(Buffer.from(value));
 return Buffer.concat(bytes).toString();
}
const request=(method:string,url:string)=>({
 method,url,headers:{},remoteAddress:"127.0.0.1"
});
function config(port:number,routes:ProxyConfig["routes"]):ProxyConfig{
 return {routes,upstreams:{main:{origin:"http://127.0.0.1:"+port,
   allowInsecureHttp:true,allowedPrivateAddresses:["127.0.0.1"]}}};
}
describe("preindexed proxy route lookup",()=>{
 it("resolves 500 disjoint literal routes without treating an index miss as a hit",async()=>{
  const fixture=await serverFixture();
  try{
   const routes=Array.from({length:500},(_,i)=>({
    id:"route-"+i,path:"/v1/resource-"+i,upstream:"main",
    methods:["GET"] as const,access:"public" as const
   }));
   const router=createProxyRouter(config(fixture.port,routes));
   for(const i of [0,7,245,499]){
    const response=await router.handle(request("GET","/v1/resource-"+i));
    expect(response.status).toBe(200);
    expect(await collect(response)).toBe("/v1/resource-"+i);
   }
   const absent=await router.handle(request("GET","/v1/resource-500"));
   expect(absent.status).toBe(404);
   expect(await collect(absent)).toContain("NOT_FOUND");
  }finally{await fixture.close();}
 });
 it("retains dynamic fallback, method-specific 405 Allow, and wildcard prefix",async()=>{
  const fixture=await serverFixture();
  try{
   const routes=[
    {id:"specific",path:"/api/entry",upstream:"main",methods:["POST"] as const,access:"public" as const},
    {id:"dynamic",path:"/api/:id",upstream:"main",methods:["GET"] as const,access:"public" as const},
    {id:"wildcard",path:"/api/files/*",upstream:"main",methods:["DELETE"] as const,access:"public" as const},
    {id:"root",path:"/:area/health",upstream:"main",methods:["HEAD"] as const,access:"public" as const}
   ];
   const router=createProxyRouter(config(fixture.port,routes));
   for(const [method,path] of [["GET","/api/entry"],["POST","/api/entry"],["GET","/api/other"],["DELETE","/api/files/abc"],["HEAD","/status/health"]] as const){
    const response=await router.handle(request(method,path));
    expect(response.status,method+" "+path).toBe(200);
    await collect(response);
   }
   const missing=await router.handle(request("PATCH","/api/entry"));
   expect(missing.status).toBe(405);
   expect(missing.headers.allow).toBe("POST, GET");
   await collect(missing);
   const unrelated=await router.handle(request("GET","/unknown"));
   expect(unrelated.status).toBe(404);
   await collect(unrelated);
   const unsafe=await router.handle(request("GET","/api/%252e%252e"));
   expect(unsafe.status).toBe(400);
   await collect(unsafe);
  }finally{await fixture.close();}
 });
});
