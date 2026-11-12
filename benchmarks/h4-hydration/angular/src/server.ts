import {
  AngularNodeAppEngine,
  createNodeRequestHandler,
  writeResponseToNodeResponse
} from "@angular/ssr/node";
import type {IncomingMessage,ServerResponse} from "node:http";

const angularApp = new AngularNodeAppEngine();
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
