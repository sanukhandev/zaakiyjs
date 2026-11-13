/** Isolated production SSR reference build. No Zaakiy browser package imports. */
import {mkdir,writeFile,readFile} from "node:fs/promises";
import {resolve,join,dirname} from "node:path";
import {createHash} from "node:crypto";
import {createRequire} from "node:module";
import {build} from "vite";
import React from "react";
import {renderToString as reactRender} from "react-dom/server";
import {renderToString as vueRender} from "@vue/server-renderer";
import {ReactBenchmarkApp} from "./react-app.mjs";
import {makeVueApp} from "./vue-app.mjs";

const require=createRequire(import.meta.url);
const root=resolve(process.env.H4_SITE??"../../../../benchmark-artifacts/h4-hydration-sites");
const here=dirname(new URL(import.meta.url).pathname);
const cases=[100,1000,10000];
await mkdir(root,{recursive:true});
const versions={
  react:require("react/package.json").version,
  reactDom:require("react-dom/package.json").version,
  vue:require("vue/package.json").version,
  vueSsr:require("@vue/server-renderer/package.json").version,
  vite:require("vite/package.json").version
};
const js={};
for(const framework of ["react","vue"]){
  const entry=join(here,framework+"-client.mjs");
  await build({root:here,configFile:false,publicDir:false,logLevel:"warn",
    define:{"process.env.NODE_ENV":JSON.stringify("production")},
    build:{outDir:root,emptyOutDir:false,minify:"esbuild",
      lib:{entry,formats:["es"],fileName:framework}}});
  const bytes=await readFile(join(root,framework+".js"));
  if(bytes.includes(Buffer.from("process.env.NODE_ENV")))
    throw new Error(framework+" browser bundle contains unresolved Node environment references");
  js[framework]={sha256:createHash("sha256").update(bytes).digest("hex"),bytes:bytes.length};
}
for(const size of cases){
  const htmls={
    react:reactRender(React.createElement(ReactBenchmarkApp,{size})),
    vue:await vueRender(makeVueApp(size))
  };
  for(const [framework,body] of Object.entries(htmls)){
    if(!body.includes("data-key") || !body.includes("data-draft"))
      throw Error("SSR reference fixture is missing required semantic DOM");
    const output=join(root,framework,String(size),"index.html");
    await mkdir(dirname(output),{recursive:true});
    const page='<!doctype html><html><head><meta charset="utf-8"><title>H4 SSR reference</title></head>'+
      '<body><div id="app" data-size="'+size+'">'+body+'</div>'+
      '<script type="module" src="../../'+framework+'.js"></script></body></html>';
    await writeFile(output,page);
  }
}
const manifest={schema:"zaakiy.h4-reference-build/1",
  generatedAt:new Date().toISOString(),
  variants:{react:{versions,js:js.react},vue:{versions,js:js.vue}}};
await writeFile(join(root,"partial-reference-manifest.json"),JSON.stringify(manifest,null,2)+"\n");
console.log(JSON.stringify(manifest));
