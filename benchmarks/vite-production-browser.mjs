/** Run the actual emitted Vite assets in an isolated native Chromium profile.
 * Only the diagnostic HTML response gets an appended verifier; hashes and
 * measured build outputs are collected before this untimed verification.
 */
import {createServer} from "node:http";
import {spawn} from "node:child_process";
import {setTimeout,clearTimeout} from "node:timers";
import {existsSync} from "node:fs";
import {mkdtemp,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {digest} from "./vite-production-evidence.mjs";

const verifier=count=>`<script>
const browserErrors=[];
window.addEventListener("error",event=>browserErrors.push(event.message||"resource error"),true);
window.addEventListener("unhandledrejection",event=>browserErrors.push(String(event.reason)));
window.addEventListener("load",async()=>{
  try{
    const host=document.getElementById("app");
    const buttons=[...host.querySelectorAll("button")];
    const assert=(condition,message)=>{if(!condition)throw Error(message);};
    assert(buttons.length===${count},"button count");
    assert(buttons.every(b=>b.textContent==="Count: 0"&&[...b.classList].sort().join(" ")==="flex gap-4 p-4"),"initial state");
    const style=getComputedStyle(buttons[0]);
    const styles=[style.display,style.columnGap,style.paddingTop];
    assert(styles[0]==="flex"&&parseFloat(styles[1])>0&&parseFloat(styles[2])>0,"stylesheet not applied");
    // Capture both delivered and pending mutation records.
    const records=[];
    const tracked=new MutationObserver(changes=>records.push(...changes));
    tracked.observe(host,{subtree:true,characterData:true,childList:true,attributes:true});
    buttons[0].click();
    await new Promise(resolve=>setTimeout(resolve,0));
    records.push(...tracked.takeRecords());
    assert(records.length===1&&records[0].type==="characterData"&&buttons[0].contains(records[0].target),"unrelated mutation");
    assert(buttons[0].textContent==="Count: 1"&&buttons.slice(1).every(b=>b.textContent==="Count: 0"),"isolated update");
    records.length=0;
    const last=buttons[buttons.length-1];
    last.click();
    await new Promise(resolve=>setTimeout(resolve,0));
    records.push(...tracked.takeRecords());
    assert(records.length===1&&records[0].type==="characterData"&&last.contains(records[0].target),"second update");
    assert([...host.querySelectorAll("button")].every((b,i)=>b===buttons[i]),"DOM identity");
    const expected=buttons.map((_,i)=>"Count: "+(i===0&&i===buttons.length-1?2:i===0||i===buttons.length-1?1:0));
    assert(buttons.every((b,i)=>b.textContent===expected[i]),"final state");
    assert(browserErrors.length===0,browserErrors.join("; "));
    tracked.disconnect();
    document.body.dataset.zaakiyViteEvidence=JSON.stringify({count:${count},styles,expected,mutations:[1,1],identity:true});
    document.body.dataset.zaakiyViteResult="pass";
  }catch(error){document.body.dataset.zaakiyViteResult="fail: "+String(error);}
});
</script>`;

export async function verifyProductionBrowser(assets,count){
  const chrome=[process.env.CHROME_BIN,"/usr/bin/google-chrome","/usr/bin/google-chrome-stable",
    "/usr/bin/chromium","/usr/bin/chromium-browser"].find(value=>value&&existsSync(value));
  if(!chrome)throw Error("B8 requires a real Chromium executable; cannot skip");
  const files=new Map(assets.map(item=>["/"+item.name,item.content]));
  const html=files.get("/index.html");
  if(!html?.includes("</body>"))throw Error("Missing diagnostic HTML insertion point");
  const profile=await mkdtemp(join(tmpdir(),"zaakiy-vite-browser-"));
  const server=createServer((req,res)=>{
    const path=req.url==="/"?"/index.html":req.url;
    const content=files.get(path);
    if(content===undefined){res.writeHead(404);res.end();return;}
    const type=path.endsWith(".js")?"text/javascript":path.endsWith(".css")?"text/css":
      path.endsWith(".json")?"application/json":"text/html";
    res.writeHead(200,{"Content-Type":type+"; charset=utf-8","Cache-Control":"no-store"});
    res.end(path==="/index.html"?content.replace("</body>",verifier(count)+"</body>"):content);
  });
  try{
    await new Promise((resolve,reject)=>{server.once("error",reject);server.listen(0,"127.0.0.1",resolve);});
    const url="http://127.0.0.1:"+server.address().port+"/";
    const result=await new Promise((resolve,reject)=>{
      const child=spawn(chrome,["--headless=new","--no-sandbox","--disable-gpu",
        "--disable-dev-shm-usage","--disable-extensions","--user-data-dir="+profile,
        "--virtual-time-budget=5000","--dump-dom",url],{stdio:["ignore","pipe","pipe"]});
      let stdout="",stderr="",timedOut=false,overflow=false;
      const timer=setTimeout(()=>{timedOut=true;child.kill("SIGKILL");},90000);
      child.stdout.on("data",chunk=>{stdout+=chunk.toString();if(stdout.length>2*1024*1024){overflow=true;child.kill("SIGKILL");}});
      child.stderr.on("data",chunk=>{stderr=(stderr+chunk.toString()).slice(-16000);});
      child.once("error",error=>{clearTimeout(timer);reject(error);});
      child.once("close",code=>{
        clearTimeout(timer);
        if(timedOut||overflow||code!==0)reject(Error("Chromium verification failed: "+JSON.stringify({code,timedOut,overflow,stderr})));
        else resolve(stdout);
      });
    });
    const body=/<body\b[^>]*>/i.exec(result)?.[0]??"";
    if(!/\bdata-zaakiy-vite-result="pass"/.test(body))throw Error("B8 browser assertions failed: "+body);
    const encoded=/\bdata-zaakiy-vite-evidence="([^"]+)"/.exec(body)?.[1];
    if(!encoded)throw Error("Missing browser evidence");
    const evidence=JSON.parse(encoded.replaceAll("&quot;",'"').replaceAll("&amp;","&"));
    if(evidence.count!==count||evidence.identity!==true||JSON.stringify(evidence.mutations)!=="[1,1]")
      throw Error("Invalid native browser evidence");
    return {status:"passed",sha256:digest(JSON.stringify(evidence)),evidence};
  }finally{
    server.closeAllConnections();
    await new Promise(resolve=>server.close(()=>resolve()));
    await rm(profile,{recursive:true,force:true});
  }
}
