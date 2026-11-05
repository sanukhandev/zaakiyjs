import type {Product,ProductDraft,ProductRepository} from "../models/product";
/** In-memory fixture is scoped to this factory, never process-global or production persistent. */
export function createDemoProductRepository():ProductRepository{
  let next=4;
  let products:Product[]=[
    {id:"demo-1",sku:"SAMPLE-01",name:"Example keyboard",priceCents:7900,version:1},
    {id:"demo-2",sku:"SAMPLE-02",name:"Example monitor",priceCents:16900,version:1},
    {id:"demo-3",sku:"SAMPLE-03",name:"Example dock",priceCents:9900,version:1}
  ];
  function check(signal:AbortSignal):void{if(signal.aborted)throw signal.reason;}
  function clone(product:Product):Product{return {...product};}
  return {
    async list(filter,page,pageSize,signal){
      check(signal);
      const q=filter.trim().toLowerCase();
      const matches=products.filter(p=>p.name.toLowerCase().includes(q)||p.sku.toLowerCase().includes(q));
      return {items:matches.slice((page-1)*pageSize,page*pageSize).map(clone),total:matches.length};
    },
    async get(id,signal){
      check(signal);const item=products.find(p=>p.id===id);
      if(!item)throw new Error("Product no longer exists.");
      return clone(item);
    },
    async create(draft,signal){
      check(signal);const product:Product={...draft,id:`demo-${next++}`,version:1};
      products=[...products,product];return clone(product);
    },
    async update(id,draft,version,signal){
      check(signal);const found=products.find(p=>p.id===id);
      if(!found||found.version!==version)throw new Error("Product changed or was deleted.");
      const updated:Product={...draft,id,version:version+1};
      products=products.map(p=>p.id===id?updated:p);return clone(updated);
    },
    async remove(id,version,signal){
      check(signal);const found=products.find(p=>p.id===id);
      if(!found||found.version!==version)throw new Error("Product changed or was deleted.");
      products=products.filter(p=>p.id!==id);
    }
  };
}
