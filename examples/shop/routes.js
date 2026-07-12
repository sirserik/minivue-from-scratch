// Route table: path → component. The `:id` param is read in ProductPage via
// useRoute(). History is provided in main.js (hash history in the browser).
import { CatalogPage, ProductPage } from './components.js'

export const routes = [
  { path: '/', component: CatalogPage },
  { path: '/product/:id', component: ProductPage },
]
