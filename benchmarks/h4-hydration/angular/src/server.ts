import {
  AngularNodeAppEngine,
  createNodeRequestHandler,
  writeResponseToNodeResponse
} from "@angular/ssr/node";
import type {IncomingMessage,ServerResponse} from "node:http";

const angularApp = new AngularNodeAppEngine({allowedHosts:["localhost"]});

/** Run the exact bundled Angular SSR engine (same AOT-injected token graph). */
export async function renderBenchmarkRoute(url:string):Promise<string>{
  const parsed=new URL(url);
  if(parsed.hostname!=="localhost" || !/^\\/angular\\/(100|1000|10000)\\/$/.test(parsed.pathname))
    throw new TypeError("Unapproved SSR benchmark route");
  const response=await angularApp.handle(new Request(parsed.href));
  if(!response || response.status!==200)
    throw new Error("Angular SSR route refused: "+(response?.status??"not found"));
  return response.text();
}

export const reqHandler=createNodeRequestHandler(async (
  req:IncomingMessage,res:ServerResponse
)=>{
  try{
    const response=await angularApp.handle(req);
    if(response) await writeResponseToNodeResponse(response,res);
    else {res.statusCode=404;res.end();}
  }catch(error){
    res.statusCode=500;res.end("SSR error");
    throw error;
  }
});
