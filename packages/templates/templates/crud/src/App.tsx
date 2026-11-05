import {createProductPage} from "./features/products/adapters/createProductPage";
import {createDemoProductRepository} from "./features/products/services/productRepository";
import {ProductView} from "./features/products/views/ProductView";
export function App(){
  const vm=createProductPage(createDemoProductRepository());
  return <ProductView vm={vm}/>;
}
