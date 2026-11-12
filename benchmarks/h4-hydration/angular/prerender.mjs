/** Generate real Angular 21 SSR HTML from AOT-compiled server bootstrap.
 * This avoids relying on implicit CLI route discovery, and never emits
 * client-rendered placeholders as an SSR benchmark substitute.
 */
import "@angular/compiler";
import {readFile,writeFile,mkdir} from "node:fs/promises";
import {join,dirname,resolve} from "node:path";
import {renderApplication} from "@angular/platform-server";
import bootstrap from "./dist/server/main.server.mjs";

const root=resolve("benchmarks/h4-hydration/angular/dist/browser");
const shell=await readFile(join(root,"index.html"),"utf8");
if(!shell.includes("<h4-root")) throw new Error("Angular production shell not found");
for(const size of [100,1000,10000]){
  const html=await renderApplication(bootstrap,{
    document:shell,url:"http://localhost/angular/"+size+"/"
  });
  const matches=html.match(/data-key=/g)??[];
  if(matches.length!==size){
    throw new Error("Angular SSR semantic row mismatch: "+size+" actual "+matches.length);
  }
  if(!html.includes("ngh=") && !html.includes("ng-server-context")){
    throw new Error("Angular SSR hydration metadata missing");
  }
  const output=join(root,String(size),"index.html");
  await mkdir(dirname(output),{recursive:true});
  await writeFile(output,html);
  console.log(JSON.stringify({size,bytes:Buffer.byteLength(html),rows:matches.length}));
}
