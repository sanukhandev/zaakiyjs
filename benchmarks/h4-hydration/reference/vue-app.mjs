import {createSSRApp,h,ref,onMounted} from "vue";

export const makeRows = count => Array.from({ length: count }, (_,i) => ({
  id:"row_"+i, label:"Row "+i
}));
export const VueBenchmarkApp = {
  props:{size:{type:Number,required:true},onReady:{type:Function,required:false}},
  setup(props){
    const rows=ref(makeRows(props.size));
    const count=ref(0);
    const enabled=ref(true);
    const actions={
      update:()=>{count.value+=1;},
      reverse:()=>{rows.value=[...rows.value].reverse();},
      toggle:()=>{enabled.value=!enabled.value;}
    };
    onMounted(()=>props.onReady?.(actions));
    return ()=>h("main",null,[
      h("input",{"data-draft":"yes"}),
      h("button",{type:"button","data-counter":"yes",
        onClick:actions.update},"Count: "+count.value),
      enabled.value?h("p",{"data-condition":"yes"},"Visible"):null,
      h("ul",{"data-list":"yes"},rows.value.map(row=>
        h("li",{key:row.id,"data-key":row.id},row.label)))
    ]);
  }
};
export function makeVueApp(size,onReady){
  return createSSRApp(VueBenchmarkApp,{size,onReady});
}
