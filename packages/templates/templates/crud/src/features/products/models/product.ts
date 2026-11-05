export interface Product {
  readonly id:string;readonly sku:string;readonly name:string;
  readonly priceCents:number;readonly version:number;
}
export interface ProductDraft{readonly sku:string;readonly name:string;readonly priceCents:number}
export interface ProductPage{readonly items:readonly Product[];readonly total:number}
export interface ProductRepository{
  list(filter:string,page:number,pageSize:number,signal:AbortSignal):Promise<ProductPage>;
  get(id:string,signal:AbortSignal):Promise<Product>;
  create(data:ProductDraft,signal:AbortSignal):Promise<Product>;
  update(id:string,data:ProductDraft,expectedVersion:number,signal:AbortSignal):Promise<Product>;
  remove(id:string,expectedVersion:number,signal:AbortSignal):Promise<void>;
}
