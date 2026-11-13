/** Angular 21 AOT server response: route must render via bundled SSR engine.
 * Never return the client-side CSR shell as if it were prerendered HTML.
 */
import {mkdir,writeFile} from "node:fs/promises";
import {join,dirname,resolve} from "node:path";
import {renderBenchmarkRoute} from "./dist/server/server.mjs";

const root=resolve("benchmarks/h4-hydration/angular/dist/browser");
for(const size of [100,1000,10000]){
  const html=await renderBenchmarkRoute("http://localhost/angular/"+size+"/");
  const count=(html.match(/data-key=/g)??[]).length;
  if(count!==size) throw new Error("Angular SSR row mismatch: expected "+size+" actual "+count);
  if(!html.includes("ngh=") && !html.includes("ng-server-context"))
    throw new Error("Angular hydration metadata missing");
  const output=join(root,String(size),"index.html");
  await mkdir(dirname(output),{recursive:true});
  await writeFile(output,html);
  console.log(JSON.stringify({size,rows:count,bytes:Buffer.byteLength(html)}));
}
