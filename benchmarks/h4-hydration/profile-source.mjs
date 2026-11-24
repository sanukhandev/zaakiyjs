/** Instrument a disposable CI source checkout, never the production package. */
import {readFile,writeFile} from "node:fs/promises";
const path="packages/ssr/src/hydrate-region.ts";
let source=await readFile(path,"utf8");
const replace=(before,after)=>{
  if(source.split(before).length!==2) throw Error("H4 profiling anchor changed: "+before);
  source=source.replace(before,after);
};
replace('  return tree;\n}', '  performance.mark("h4/structural-counters",{detail:{visitedPlanNodes:budget}});\n  return tree;\n}');
replace('):HydrationMountHandle {\n  if (!container', `):HydrationMountHandle {
  const profileCounts={slots:0,itemSlots:0,createdTextNodes:0,listeners:0,components:0,conditions:0,keyedLists:0,adoptedRows:0};
  performance.mark("h4/start");
  if (!container`);
replace('  const tree=inspect(container,plan,bindings.read);', `  performance.mark("h4/protocol-end");
  performance.measure("h4/protocol","h4/start","h4/protocol-end");
  const tree=inspect(container,plan,bindings.read);
  performance.mark("h4/inspection-end");
  performance.measure("h4/structural-inspection","h4/protocol-end","h4/inspection-end");`);
replace('  discoverBindings(tree,targetElements,compiledEvents);', `  discoverBindings(tree,targetElements,compiledEvents);
  performance.mark("h4/discovery-end");
  performance.measure("h4/binding-discovery","h4/inspection-end","h4/discovery-end");`);
replace('  const inserted:Text[]=[];', `  performance.mark("h4/events-end");
  performance.measure("h4/event-validation","h4/discovery-end","h4/events-end");
  const inserted:Text[]=[];`);
replace('      if(explicit) for(const event of explicit)\n        listen(owner,node,event.name,event.handler,event.options);', `      if(explicit) for(const event of explicit) {
        profileCounts.listeners++;
        listen(owner,node,event.name,event.handler,event.options);
      }`);
replace('        listen(owner,node,descriptor.name,handler);', '        profileCounts.listeners++;\n        listen(owner,node,descriptor.name,handler);');
replace('    for (const slot of slots) {\n      if (!slot.text) {', `    for (const slot of slots) {
      profileCounts.slots++;
      if(slot.spec.source==="item")profileCounts.itemSlots++;
      if (!slot.text) {
        profileCounts.createdTextNodes++;`);
replace('    for (const component of target.components) {\n      const child=createOwner(owner);', '    for (const component of target.components) {\n      profileCounts.components++;\n      const child=createOwner(owner);');
replace('    for (const condition of target.conditions) {\n      bindConditionalRegion(owner,', '    for (const condition of target.conditions) {\n      profileCounts.conditions++;\n      bindConditionalRegion(owner,');
replace('    for (const list of target.keyed) {\n      bindKeyedRegion(owner,', '    for (const list of target.keyed) {\n      profileCounts.keyedLists++;\n      profileCounts.adoptedRows+=list.rows.length;\n      bindKeyedRegion(owner,');
replace('    const handle=hydrate(container.childNodes[1]!,owner=>attachZone(owner,tree));', `    performance.mark("h4/setup-end");
    performance.measure("h4/attachment-setup","h4/events-end","h4/setup-end");
    const handle=hydrate(container.childNodes[1]!,owner=>{
      performance.mark("h4/attach-start");
      performance.measure("h4/root-owner","h4/setup-end","h4/attach-start");
      attachZone(owner,tree);
      performance.mark("h4/attach-end");
      performance.measure("h4/attachment","h4/attach-start","h4/attach-end");
    });
    performance.mark("h4/activated");
    performance.measure("h4/mount-activation","h4/attach-end","h4/activated");
    performance.measure("h4/total","h4/start","h4/activated");
    performance.mark("h4/attachment-counters",{detail:profileCounts});`);
await writeFile(path,source);
console.log("H4 profiling instrumented disposable source checkout; never publish this build.");
