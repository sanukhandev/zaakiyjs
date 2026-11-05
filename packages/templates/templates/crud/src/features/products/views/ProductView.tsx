import {For,Show} from "@zaakiyjs/core";
import type {ProductViewModel} from "../viewmodels/createProductViewModel";
export function ProductView({vm}:{readonly vm:ProductViewModel}){
  return <main class="stack mx-auto p-8">
    <header><h1>Product management</h1><p>Demonstration records, stored only in this app instance.</p></header>
    <p role="status" aria-live="polite">{vm.notice.value}</p>
    <p role="alert">{vm.error.value}</p>
    <Show when={vm.mode.value==="list"}>
      <section class="stack" aria-label="Product list">
        <div class="inline">
          <label htmlFor="product-search">Search products</label>
          <input id="product-search" type="search" value={vm.search.value}
            onInput={event=>vm.setSearch((event.currentTarget as HTMLInputElement).value)}/>
          <button type="button" onClick={()=>vm.create()}>Create product</button>
          <button type="button" onClick={()=>vm.refresh()}>Refresh</button>
        </div>
        <Show when={vm.list.pending.value}><p role="status">Loading products…</p></Show>
        <Show when={vm.list.error.value!==null}><p role="alert">Product list failed to load.</p></Show>
        <Show when={(vm.list.data.value?.items.length ?? 0)===0}><p>No products match your search.</p></Show>
        <ul class="stack"><For each={vm.list.data.value?.items ?? []} by={item=>item.id}>{item=>
          <li class="surface inline">
            <span>{item.name} ({item.sku})</span>
            <span>{item.priceCents} cents</span>
            <button type="button" onClick={()=>vm.view(item)}>Details</button>
            <button type="button" onClick={()=>vm.edit(item)}>Edit</button>
            <button type="button" onClick={()=>vm.requestDelete(item)}>Delete</button>
          </li>
        }</For></ul>
        <nav aria-label="Product pagination" class="inline">
          <button type="button" onClick={()=>vm.changePage(vm.page.value-1)}>Previous</button>
          <span>Page {vm.page.value} of {vm.totalPages.value}</span>
          <button type="button" onClick={()=>vm.changePage(vm.page.value+1)}>Next</button>
        </nav>
      </section>
    </Show>
    <Show when={vm.mode.value==="detail"}>
      <section class="surface stack" aria-label="Product details">
        <h2>Product details</h2>
        <p>Name: {vm.selected.value?.name ?? ""}</p>
        <p>SKU: {vm.selected.value?.sku ?? ""}</p>
        <p>Price (cents): {vm.selected.value?.priceCents ?? 0}</p>
        <button type="button" onClick={()=>vm.back()}>Back to list</button>
      </section>
    </Show>
    <Show when={vm.mode.value==="create"||vm.mode.value==="edit"}>
      <section class="surface stack">
        <h2>{vm.mode.value==="edit"?"Edit product":"Create product"}</h2>
        <form class="stack" onSubmit={event=>{event.preventDefault();void vm.submit();}}>
          <div class="field"><label htmlFor="product-name">Name</label><input id="product-name" type="text" required
            value={vm.fields.name.value.value} onInput={event=>vm.form.setValue("name",(event.currentTarget as HTMLInputElement).value)}/></div>
          <div class="field"><label htmlFor="product-sku">SKU</label><input id="product-sku" type="text" required
            value={vm.fields.sku.value.value} onInput={event=>vm.form.setValue("sku",(event.currentTarget as HTMLInputElement).value)}/></div>
          <div class="field"><label htmlFor="product-price">Price in cents</label><input id="product-price" type="number" min="0" required
            value={vm.fields.priceCents.value.value} onInput={event=>vm.form.setValue("priceCents",Number((event.currentTarget as HTMLInputElement).value))}/></div>
          <button type="submit">Save product</button>
          <button type="button" onClick={()=>vm.back()}>Cancel</button>
        </form>
      </section>
    </Show>
    <Show when={vm.pendingDelete.value!==null}>
      <section role="group" aria-labelledby="confirm-delete-title" aria-describedby="confirm-delete-message" class="surface stack">
        <h2 id="confirm-delete-title">Confirm deletion</h2>
        <p id="confirm-delete-message">Permanently delete {vm.pendingDelete.value?.name ?? "this product"}?</p>
        <div class="inline"><button type="button" onClick={()=>{void vm.confirmDelete();}}>Confirm delete</button>
          <button type="button" onClick={()=>vm.cancelDelete()}>Keep product</button></div>
      </section>
    </Show>
  </main>;
}
