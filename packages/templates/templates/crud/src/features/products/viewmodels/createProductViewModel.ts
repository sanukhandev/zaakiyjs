import {onCleanup} from "@zaakiyjs/core";
import {createResource} from "@zaakiyjs/async";
import {createForm} from "@zaakiyjs/forms";
import {computed,signal} from "@zaakiyjs/signals";
import type {Product,ProductDraft,ProductPage,ProductRepository} from "../models/product";
export function createProductViewModel(repository:ProductRepository){
  const search=signal("");
  const page=signal(1);
  const pageSize=10;
  const mode=signal<"list"|"detail"|"create"|"edit">("list");
  const selected=signal<Product|null>(null);
  const pendingDelete=signal<Product|null>(null);
  const busy=signal(false);
  const notice=signal("");
  const error=signal("");
  const list=createResource<ProductPage,string>({
    key:()=>search.value+"\u0000"+page.value,
    load:({signal})=>repository.list(search.peek(),page.peek(),pageSize,signal),
    eager:false,keepPreviousData:true
  });
  const totalPages=computed(()=>Math.max(1,Math.ceil((list.data.value?.total ?? 0)/pageSize)));
  let active:AbortController|null=null,disposed=false,requestId=0,saveGeneration=0;
  const form=createForm<ProductDraft,Product>({
    initialValues:{name:"",sku:"",priceCents:0},
    onSubmit:async(values,{signal})=>{
      const product=selected.peek();
      return mode.peek()==="edit"&&product?
        repository.update(product.id,values as ProductDraft,product.version,signal):
        repository.create(values as ProductDraft,signal);
    }
  });
  const name=form.field("name",{required:"Product name is required",validators:[v=>v.trim().length>=2?null:"Use at least two characters."]});
  const sku=form.field("sku",{required:"SKU is required",validators:[v=>/^[A-Za-z0-9-]{2,32}$/.test(v)?null:"Use 2–32 alphanumeric or hyphen characters."]});
  const priceCents=form.field("priceCents",{validators:[v=>Number.isSafeInteger(v)&&v>=0?null:"Enter a nonnegative amount in cents."]});
  const fields={name,sku,priceCents};
  onCleanup(()=>{disposed=true;requestId++;active?.abort();list.dispose();form.dispose();});
  function refresh():void{void list.refresh().catch(()=>{/* resource.error is the read error */});}
  function setSearch(value:string):void{search.value=value;page.value=1;refresh();}
  function changePage(to:number):void{
    if(!Number.isSafeInteger(to)||to<1||to>totalPages.value)return;
    page.value=to;refresh();
  }
  function create():void{saveGeneration++;form.abortSubmit();selected.value=null;form.reset({name:"",sku:"",priceCents:0});mode.value="create";notice.value="";}
  function edit(item:Product):void{
    saveGeneration++;form.abortSubmit();selected.value=item;form.reset({name:item.name,sku:item.sku,priceCents:item.priceCents});
    mode.value="edit";notice.value="";
  }
  function view(item:Product):void{saveGeneration++;form.abortSubmit();selected.value=item;mode.value="detail";}
  function back():void{saveGeneration++;form.abortSubmit();mode.value="list";pendingDelete.value=null;}
  async function submit():Promise<void>{
    if(disposed||busy.value)return;busy.value=true;error.value="";
    const current=++saveGeneration;
    try {
      const result=await form.submit();
      if(disposed||current!==saveGeneration)return;
      if(result.status==="success"){
        notice.value=`Saved ${result.value.name}.`;mode.value="list";selected.value=null;refresh();
      } else if(result.status==="invalid"){error.value="Correct the product fields.";}
      else if(result.status==="failed"){error.value="Save failed. The product may have changed; reload before retrying.";}
    }finally{if(!disposed)busy.value=false;}
  }
  function requestDelete(item:Product):void{pendingDelete.value=item;notice.value="";}
  function cancelDelete():void{pendingDelete.value=null;}
  async function confirmDelete():Promise<void>{
    const item=pendingDelete.peek();
    if(!item||disposed||busy.value)return;
    active?.abort();
    const controller=new AbortController();
    active=controller;const current=++requestId;
    busy.value=true;error.value="";
    try {
      await repository.remove(item.id,item.version,controller.signal);
      if(disposed||controller.signal.aborted||current!==requestId)return;
      pendingDelete.value=null;selected.value=null;mode.value="list";
      notice.value="Product deleted.";refresh();
    }catch {
      if(!disposed&&!controller.signal.aborted&&current===requestId){
        error.value="Deletion failed or record changed. Refresh before retrying.";
      }
    }finally{
      if(active===controller){active=null;if(!disposed)busy.value=false;}
    }
  }
  return {list,search,page,pageSize,totalPages,mode,selected,pendingDelete,busy,notice,error,form,fields,
    refresh,setSearch,changePage,create,edit,view,back,submit,requestDelete,cancelDelete,confirmDelete};
}
export type ProductViewModel=ReturnType<typeof createProductViewModel>;
